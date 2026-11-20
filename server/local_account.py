"""Local-only Google sign-in preview. Not a production account server.

This isolated loopback service never changes the trial gate or stores provider
tokens. Authlib performs OAuth state, nonce, PKCE and ID-token verification.
"""
from __future__ import annotations

import os
import secrets
import hashlib
import sqlite3
import stat
import time
import uuid
from pathlib import Path
from contextlib import closing
from datetime import timedelta
from flask import Flask, jsonify, redirect, request, session
from werkzeug.serving import WSGIRequestHandler

ORIGIN = 'http://127.0.0.1:5173'
CALLBACK = ORIGIN + '/api/account/callback'


class PrivateAccountRequestHandler(WSGIRequestHandler):
    """Suppress request access logs: OAuth callbacks contain codes and state."""

    def log_request(self, code='-', size='-'):
        pass


def _failure_category(error):
    """Return only fixed categories; never return provider text or credentials."""
    try:
        from authlib.integrations.base_client.errors import MismatchingStateError, OAuthError
        from authlib.jose.errors import JoseError
        from authlib.oauth2.rfc6749.errors import OAuth2Error
        from requests.exceptions import RequestException
    except ImportError:
        return 'unexpected'
    if isinstance(error, MismatchingStateError) or (type(error) is RuntimeError and str(error) == 'Missing state value'):
        return 'state'
    if isinstance(error, RequestException):
        return 'network'
    if isinstance(error, JoseError):
        return 'identity'
    if isinstance(error, (OAuthError, OAuth2Error)):
        return {'access_denied': 'cancelled', 'invalid_client': 'credentials',
                'invalid_grant': 'grant'}.get(getattr(error, 'error', None), 'provider')
    return 'unexpected'


def create_local_account_app(config=None):
    settings = dict(config or {})
    client_id = settings.get('client_id', os.getenv('CAPSTONE_GOOGLE_CLIENT_ID', '')).strip()
    client_secret = settings.get('client_secret', os.getenv('CAPSTONE_GOOGLE_CLIENT_SECRET', '')).strip()
    key = settings.get('session_secret', os.getenv('CAPSTONE_ACCOUNT_SESSION_SECRET', '')).strip()
    enabled = settings.get('enabled', os.getenv('CAPSTONE_LOCAL_ACCOUNTS_ENABLED') == '1')
    # A persistent secret is deliberately required: never silently use a weak
    # or generated session secret when the developer expects sessions to last.
    configured = bool(enabled and client_id and client_secret and len(key) >= 32 and len(set(key)) >= 12)
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = 220_000
    directory = Path(settings.get('storage_dir', Path(__file__).resolve().parent.parent / '.local-accounts'))

    def database():
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise PermissionError('Account storage directory must be private and owned by the current user.')
        path = directory / 'workspace.sqlite3'
        # Create with private permissions from the outset, including on a permissive umask.
        fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        file_info = os.fstat(fd)
        if not stat.S_ISREG(file_info.st_mode) or file_info.st_uid != os.getuid() or file_info.st_mode & 0o077:
            os.close(fd)
            raise PermissionError('Account database must be private and owned by the current user.')
        os.close(fd)
        db = sqlite3.connect(path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys = ON')
        db.executescript('''
            CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS molecules (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, molfile TEXT NOT NULL, folder TEXT);
        ''')
        return db

    def token_hash(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def current_user():
        token = session.get('session_token')
        if not configured or not isinstance(token, str):
            return None
        with closing(database()) as db:
            row = db.execute('SELECT owner, name, email FROM sessions WHERE token = ? AND expires > ?',
                             (token_hash(token), int(time.time()))).fetchone()
            return dict(row) if row else None

    def valid_name(value):
        return isinstance(value, str) and 1 <= len(value.strip()) <= 120 and '\x00' not in value
    app.config.update(SECRET_KEY=key if configured else secrets.token_hex(32),
                      SESSION_COOKIE_NAME='capstone_local_account', SESSION_COOKIE_HTTPONLY=True,
                      SESSION_COOKIE_SAMESITE='Lax', SESSION_COOKIE_SECURE=False,
                      SESSION_COOKIE_PATH='/api/account', PERMANENT_SESSION_LIFETIME=timedelta(days=7),
                      SESSION_REFRESH_EACH_REQUEST=False, TRUSTED_HOSTS=['127.0.0.1'])
    oauth_client = settings.get('oauth_client')
    if configured and oauth_client is None:
        try:
            from authlib.integrations.flask_client import OAuth
            oauth = OAuth(app)
            oauth_client = oauth.register(name='google', client_id=client_id, client_secret=client_secret,
                server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
                client_kwargs={'scope': 'openid email profile', 'code_challenge_method': 'S256'})
        except ImportError:
            configured = False

    @app.after_request
    def no_cache(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        return response

    @app.get('/api/account/session')
    def status():
        identity = current_user()
        user = {'id': identity['owner'], 'name': identity['name'], 'email': identity['email']} if identity else None
        response = {'configured': configured, 'authenticated': bool(user)}
        if user:
            response['user'] = user
        return jsonify(response)

    @app.get('/api/account/login')
    def login():
        if not configured:
            return jsonify(error='Local Google sign-in is not configured.'), 503
        try:
            return oauth_client.authorize_redirect(CALLBACK)
        except Exception as error:
            category = _failure_category(error)
            # Only a fixed category is logged; never exception text or callback URL.
            app.logger.warning('Google sign-in failed: %s', category)
            return jsonify(error='Google sign-in could not be started.'), 503

    @app.get('/api/account/callback')
    def callback():
        if not configured:
            return jsonify(error='Local Google sign-in is not configured.'), 503
        try:
            token = oauth_client.authorize_access_token()
            claims = token.get('userinfo')
            # Authlib only sets userinfo after verified OIDC signature and nonce.
            if not isinstance(claims, dict) or not isinstance(claims.get('sub'), str) or not claims['sub']:
                raise ValueError('Missing verified identity')
            old_token = session.get('session_token')
            token = secrets.token_urlsafe(32)
            with closing(database()) as db, db:
                if isinstance(old_token, str):
                    db.execute('DELETE FROM sessions WHERE token = ?', (token_hash(old_token),))
                db.execute('DELETE FROM sessions WHERE expires <= ?', (int(time.time()),))
                db.execute('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)', (token_hash(token), claims['sub'],
                           str(claims.get('name', 'Google user'))[:200], str(claims.get('email', ''))[:254], int(time.time()) + 7 * 86400))
            session.clear()
            session['session_token'] = token
            session.permanent = True
            return redirect('/', code=303)
        except Exception as error:
            category = _failure_category(error)
            app.logger.warning('Google sign-in failed: %s', category)
            # Failed callback attempts must not sign out an existing user.
            # Drop pending OAuth state without touching the account session.
            for name in list(session):
                if name.startswith('_state_google_'):
                    session.pop(name, None)
            return redirect('/?account_error=' + category, code=303)

    @app.post('/api/account/logout')
    def logout():
        if request.headers.get('Origin') != ORIGIN or request.headers.get('X-Account-Request') != '1' or not request.is_json:
            return jsonify(error='Invalid sign-out request.'), 403
        token = session.get('session_token')
        if isinstance(token, str):
            with closing(database()) as db, db:
                db.execute('DELETE FROM sessions WHERE token = ?', (token_hash(token),))
        session.clear()
        return jsonify(authenticated=False)

    @app.route('/api/account/library', methods=['GET', 'POST'])
    def library():
        user = current_user()
        if not user:
            return jsonify(error='Sign in to use your library.'), 401
        if request.method == 'POST' and (request.headers.get('Origin') != ORIGIN or request.headers.get('X-Account-Request') != '1' or not request.is_json):
            return jsonify(error='Invalid request.'), 403
        owner = user['owner']
        with closing(database()) as db, db:
            if request.method == 'GET':
                folders = [dict(r) for r in db.execute('SELECT id, name FROM folders WHERE owner = ? ORDER BY name', (owner,))]
                molecules = [dict(r) for r in db.execute('SELECT id, name, molfile, folder FROM molecules WHERE owner = ? ORDER BY name', (owner,))]
                return jsonify(folders=folders, molecules=molecules)
            body = request.get_json(silent=True)
            if not isinstance(body, dict):
                return jsonify(error='Invalid request.'), 400
            action = body.get('action')
            item_id = body.get('id')
            name = body.get('name')
            if action == 'create_folder' and valid_name(name):
                db.execute('INSERT INTO folders VALUES (?, ?, ?)', (uuid.uuid4().hex, owner, name.strip()))
            elif action == 'save_molecule' and valid_name(name) and isinstance(body.get('molfile'), str) and 1 <= len(body['molfile']) <= 200000 and '\x00' not in body['molfile']:
                folder = body.get('folder')
                if folder is not None and (not isinstance(folder, str) or not db.execute('SELECT 1 FROM folders WHERE id = ? AND owner = ?', (folder, owner)).fetchone()):
                    return jsonify(error='Folder not found.'), 404
                db.execute('INSERT INTO molecules VALUES (?, ?, ?, ?, ?)', (uuid.uuid4().hex, owner, name.strip(), body['molfile'], folder))
            elif action in ('rename_folder', 'rename_molecule') and isinstance(item_id, str) and valid_name(name):
                table = 'folders' if action == 'rename_folder' else 'molecules'
                if not db.execute(f'UPDATE {table} SET name = ? WHERE id = ? AND owner = ?', (name.strip(), item_id, owner)).rowcount:
                    return jsonify(error='Item not found.'), 404
            elif action == 'move_molecule' and isinstance(item_id, str):
                folder = body.get('folder')
                if folder is not None and (not isinstance(folder, str) or not db.execute('SELECT 1 FROM folders WHERE id = ? AND owner = ?', (folder, owner)).fetchone()):
                    return jsonify(error='Folder not found.'), 404
                if not db.execute('UPDATE molecules SET folder = ? WHERE id = ? AND owner = ?', (folder, item_id, owner)).rowcount:
                    return jsonify(error='Item not found.'), 404
            elif action in ('delete_folder', 'delete_molecule') and isinstance(item_id, str):
                table = 'folders' if action == 'delete_folder' else 'molecules'
                if not db.execute(f'DELETE FROM {table} WHERE id = ? AND owner = ?', (item_id, owner)).rowcount:
                    return jsonify(error='Item not found.'), 404
                if action == 'delete_folder':
                    db.execute('UPDATE molecules SET folder = NULL WHERE folder = ? AND owner = ?', (item_id, owner))
            else:
                return jsonify(error='Invalid library request.'), 400
            return jsonify(ok=True)

    return app


if __name__ == '__main__':
    # Explicitly bound to loopback. Never use as a public deployment server.
    create_local_account_app().run(host='127.0.0.1', port=8001, debug=False,
                                   request_handler=PrivateAccountRequestHandler)
