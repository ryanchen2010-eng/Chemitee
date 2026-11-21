"""Standalone workspace WSGI app. Neither Beta nor the local library uses it."""
from __future__ import annotations

import hmac
import os
import re
import secrets
from datetime import timedelta
from urllib.parse import urlsplit
from uuid import UUID

from authlib.integrations.flask_client import OAuth
import certifi
from flask import Flask, jsonify, redirect, request, session
from psycopg import Error as DatabaseError
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from werkzeug.exceptions import HTTPException

from .hosted_workspace_store import HostedWorkspaceStore, LibraryProblem
from .local_account import PrivateAccountRequestHandler, _failure_category

LOOPBACK_ORIGIN = "http://127.0.0.1:5188"
SESSION_TTL = timedelta(days=7)
MAX_WORKSPACE_BODY = 410_000
TOKEN_FORMAT = re.compile(r"[A-Za-z0-9_-]{43}")
ACTIONS = {
    "create_folder": {"name"},
    "save_molecule": {"name", "folder", "molfile"},
    "rename_folder": {"id", "name"},
    "rename_molecule": {"id", "name"},
    "move_molecule": {"id", "folder"},
    "delete_folder": {"id"},
    "delete_molecule": {"id"},
}


def library_change(body):
    """Validate the wire contract, with no browser-supplied owner field."""
    try:
        action = body.get("action") if isinstance(body, dict) else None
        if not isinstance(action, str) or action not in ACTIONS or set(body) != ACTIONS[action] | {"action"}:
            raise ValueError
        inputs = {}
        for key in ACTIONS[action]:
            value = body[key]
            if key in {"id", "folder"}:
                if key == "folder" and value is None:
                    inputs[key] = None
                    continue
                if not isinstance(value, str) or len(value) != 36:
                    raise ValueError
                value = UUID(value)
                inputs["item_id" if key == "id" else key] = value
                continue
            if not isinstance(value, str) or "\x00" in value:
                raise ValueError
            if key == "name":
                value = value.strip()
                if not 1 <= len(value) <= 120:
                    raise ValueError
            elif not value.strip() or len(value) > 200_000:
                raise ValueError
            if len(value.encode("utf-8")) > 200_000:
                raise ValueError
            inputs[key] = value
    except ValueError:
        raise LibraryProblem("Invalid library request.", 400) from None
    return action, inputs


def create_app(config=None):
    overrides = config or {}

    def setting(name, default=""):
        return overrides.get(name, os.environ.get(f"CAPSTONE_WORKSPACE_{name}", default))

    mode, origin = setting("MODE"), setting("ORIGIN")
    if mode == "loopback":
        if origin != LOOPBACK_ORIGIN:
            raise ValueError("The loopback preview requires the exact port-5188 origin.")
    elif mode == "hosted":
        # Match a canonical HTTPS origin and preserve the frozen V1 and V2.
        if (not re.fullmatch(r"https://[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}", origin)
                or origin in {"https://molecule-playground-beta-v1.onrender.com",
                              "https://molecule-playground-beta-v2.onrender.com"}):
            raise ValueError("Use an independent HTTPS workspace origin.")
    else:
        raise ValueError("Explicitly select loopback or hosted workspace mode.")

    dsn = setting("DATABASE_URL")
    try:
        parts = conninfo_to_dict(dsn)
    except DatabaseError:
        raise ValueError("Workspace database configuration is invalid.") from None
    if (not parts.get("dbname") or not parts.get("host") or "service" in parts or "hostaddr" in parts
            or (mode == "loopback" and parts["host"] != "127.0.0.1")
            or (mode == "hosted" and (parts.get("sslmode") != "verify-full" or parts.get("gssencmode", "disable") != "disable"))):
        raise ValueError("Use a dedicated localhost PostgreSQL database for testing, or a verified TLS database for hosting.")
    if mode == "hosted":
        parts.setdefault("sslrootcert", certifi.where())
        dsn = make_conninfo(**{**parts, "gssencmode": "disable"})

    secret = setting("SESSION_SECRET")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", secret) or len(set(bytes.fromhex(secret))) < 16:
        raise ValueError("Set a new workspace session secret generated from 32 random bytes.")
    client_id, client_secret = setting("GOOGLE_CLIENT_ID"), setting("GOOGLE_CLIENT_SECRET")
    store = HostedWorkspaceStore(dsn)
    hosted = mode == "hosted"
    app = Flask(__name__, static_folder=None)
    app.extensions["workspace_store"] = store
    app.config.update(
        SECRET_KEY=bytes.fromhex(secret), TRUSTED_HOSTS=[urlsplit(origin).hostname],
        SESSION_COOKIE_NAME="__Host-capstone-workspace" if hosted else "capstone_workspace_preview",
        SESSION_COOKIE_SECURE=hosted, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_PATH="/" if hosted else "/api/account", SESSION_REFRESH_EACH_REQUEST=False,
        PERMANENT_SESSION_LIFETIME=SESSION_TTL, MAX_CONTENT_LENGTH=MAX_WORKSPACE_BODY,
        PROPAGATE_EXCEPTIONS=False,
    )
    google = None
    if client_id and client_secret:
        google = OAuth(app, cache=store).register(
            name="google_workspace", client_id=client_id, client_secret=client_secret,
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={"scope": "openid profile", "code_challenge_method": "S256"},
        )
        google.framework.expires_in = 600
    if hosted and google is None:
        raise ValueError("Hosted workspace mode requires its own Google OAuth client.")

    def browser_token():
        value = session.get("workspace_token")
        return value if isinstance(value, str) and TOKEN_FORMAT.fullmatch(value) else None

    def context_id(token):
        # Not a credential: binds writes to the session seen by that page.
        return hmac.digest(app.secret_key, b"workspace-write:" + token.encode("ascii"), "sha256").hex()

    def same_session(expected, supplied):
        return bool(supplied and re.fullmatch(r"[a-f0-9]{64}", supplied) and hmac.compare_digest(expected, supplied))

    @app.after_request
    def private(response):
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
        response.vary.add("Cookie")
        return response

    @app.errorhandler(DatabaseError)
    def database_error(_error):
        app.logger.warning("Workspace database unavailable.")
        return jsonify(error="Your library is temporarily unavailable. No save was confirmed."), 503

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error="The workspace request could not be processed."), error.code

    @app.errorhandler(Exception)
    def unexpected_error(_error):
        app.logger.warning("Unexpected workspace request failure.")
        return jsonify(error="The workspace request could not be completed."), 500

    @app.get("/healthz")
    def health():
        return (jsonify(status="ok"), 200) if store.ready() else (jsonify(status="unavailable"), 503)

    @app.get("/api/account/session")
    def status():
        result = {"workspace": "hosted", "configured": google is not None, "authenticated": False}
        token = browser_token()
        if token:
            with store.transaction() as db:
                identity = store.identity(db, token)
            if identity:
                result.update(authenticated=True, context=context_id(token),
                              user={"name": identity["display_name"]})
        return jsonify(result)

    @app.get("/api/account/login")
    def login():
        if not google:
            return jsonify(error="Workspace Google sign-in is not configured."), 503
        if request.headers.get("Sec-Fetch-Site") == "cross-site":
            return jsonify(error="Start sign-in from Molecule Playground."), 403
        # Keep only one outstanding attempt per browser cookie.
        for key in list(session):
            if key.startswith("_state_google_workspace_"):
                store.delete(key)
                session.pop(key)
        try:
            return google.authorize_redirect(origin + "/api/account/callback", prompt="select_account")
        except DatabaseError:
            raise
        except Exception as error:
            app.logger.warning("Workspace sign-in start failed: %s", _failure_category(error))
            return redirect("/?account_error=sign-in-failed", code=303)

    @app.get("/api/account/callback")
    def callback():
        if not google:
            return jsonify(error="Workspace Google sign-in is not configured."), 503
        state = request.args.get("state", "")
        key = "_state_google_workspace_" + state
        # Only the initiating browser may consume (or cancel) its pending attempt.
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", state) or key not in session:
            return redirect("/?account_error=state", code=303)
        try:
            if request.args.get("error"):
                store.delete(key)
                session.pop(key, None)
            response = google.authorize_access_token()
            claims = response.get("userinfo")
            sub = claims.get("sub") if isinstance(claims, dict) else None
            if not isinstance(sub, str) or not re.fullmatch(r"[\x21-\x7e]{1,255}", sub):
                raise ValueError("Missing verified Google subject.")
            name = claims.get("name")
            name = name.replace("\x00", "").encode("utf-8", "ignore").decode()[:200] if isinstance(name, str) else ""
            token = secrets.token_urlsafe(32)
            store.login(sub, name.strip() or "Google user", token, browser_token())
        except DatabaseError:
            raise
        except Exception as error:
            app.logger.warning("Workspace sign-in return failed: %s", _failure_category(error))
            return redirect("/?account_error=" + _failure_category(error), code=303)
        session.clear()
        session["workspace_token"] = token
        session.permanent = True
        return redirect("/", code=303)

    def same_origin_write():
        return (request.headers.get("Origin") == origin and request.headers.get("X-Account-Request") == "1"
                and request.mimetype == "application/json")

    @app.post("/api/account/logout")
    def logout():
        if not same_origin_write():
            return jsonify(error="Invalid sign-out request."), 403
        token = browser_token()
        if token:
            if not same_session(context_id(token), request.headers.get("X-Workspace-Context")):
                return jsonify(error="Your account changed. Refresh this tab."), 409
            with store.transaction() as db:
                store.revoke(db, token)
        for key in list(session):
            if key.startswith("_state_google_workspace_"):
                store.delete(key)
        session.clear()
        return jsonify(authenticated=False)

    @app.route("/api/account/library", methods=["GET", "POST"])
    def library():
        writing = request.method == "POST"
        if writing and not same_origin_write():
            return jsonify(error="Invalid library request."), 403
        token = browser_token()
        if not token:
            return jsonify(error="Sign in to use your library."), 401
        try:
            with store.transaction() as db:
                identity = store.identity(db, token, lock=writing)
                if not identity:
                    return jsonify(error="Sign in to use your library."), 401
                context = context_id(token)
                supplied = request.headers.get("X-Workspace-Context")
                if (writing or supplied is not None) and not same_session(context, supplied):
                    return jsonify(error="Your account changed. Refresh this tab."), 409
                if not writing:
                    return jsonify(**store.library(db, identity["id"]), context=context, workspace="hosted")
                action, inputs = library_change(request.get_json(silent=True))
                store.change(db, identity["id"], action, **inputs)
            return jsonify(ok=True)  # only after the transaction committed
        except LibraryProblem as error:
            return jsonify(error=str(error)), error.status

    return app


if __name__ == "__main__":
    if os.environ.get("CAPSTONE_WORKSPACE_MODE") != "loopback":
        raise SystemExit("The development server is loopback-only.")
    create_app().run(host="127.0.0.1", port=8002, debug=False,
                     request_handler=PrivateAccountRequestHandler)
