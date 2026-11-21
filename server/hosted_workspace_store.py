"""PostgreSQL storage for the separate hosted workspace; no SQLite access."""
from contextlib import contextmanager
from hashlib import sha256
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row


class LibraryProblem(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


def digest(value):
    return sha256(value.encode("utf-8")).digest()


class HostedWorkspaceStore:
    def __init__(self, dsn):
        self.dsn = dsn

    @contextmanager
    def transaction(self):
        with psycopg.connect(self.dsn, connect_timeout=3, row_factory=dict_row) as db:
            db.execute("SET LOCAL search_path TO pg_catalog, workspace")
            db.execute("SET LOCAL statement_timeout TO '5s'")
            yield db

    def ready(self):
        with self.transaction() as db:
            return db.execute("SELECT version FROM workspace_schema_version WHERE version = 1").fetchone() is not None

    def reserve_support(self, mode):
        # Conservative estimates for the fixed Luna model and a single low-quality
        # 1024px Flare image. Retain reservations for ambiguous provider failures.
        reserved = {"text": 5_000, "image": 250_000}[mode]
        with self.transaction() as db:
            row = db.execute("""
                INSERT INTO workspace_ai_monthly_budget (month_start, reserved_microusd)
                VALUES (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Toronto')::date, %s)
                ON CONFLICT (month_start) DO UPDATE
                SET reserved_microusd = workspace_ai_monthly_budget.reserved_microusd + EXCLUDED.reserved_microusd
                WHERE workspace_ai_monthly_budget.reserved_microusd + EXCLUDED.reserved_microusd <= 10000000
                RETURNING reserved_microusd
            """, (reserved,)).fetchone()
        return row is not None

    # Cache interface for Authlib. Each entry is consumed at most once.
    def set(self, key, value, timeout):
        with self.transaction() as db:
            db.execute("DELETE FROM workspace_oauth_states WHERE expires_at <= CURRENT_TIMESTAMP")
            db.execute("""INSERT INTO workspace_oauth_states VALUES
                          (%s, %s, CURRENT_TIMESTAMP + %s * INTERVAL '1 second')""",
                       (digest(key), value, min(timeout, 600)))

    def get(self, key):
        with self.transaction() as db:
            row = db.execute("""DELETE FROM workspace_oauth_states WHERE key_hash = %s
                                RETURNING data, expires_at > CURRENT_TIMESTAMP AS valid""",
                             (digest(key),)).fetchone()
            return row["data"] if row and row["valid"] else None

    def delete(self, key):
        with self.transaction() as db:
            db.execute("DELETE FROM workspace_oauth_states WHERE key_hash = %s", (digest(key),))

    def login(self, sub, name, token, previous):
        with self.transaction() as db:
            account = db.execute("""INSERT INTO workspace_accounts (id, google_sub, display_name)
                      VALUES (%s, %s, %s) ON CONFLICT (google_sub) DO UPDATE
                      SET display_name = EXCLUDED.display_name RETURNING id""", (uuid4(), sub, name)).fetchone()
            db.execute("DELETE FROM workspace_sessions WHERE expires_at <= CURRENT_TIMESTAMP")
            if previous:
                self.revoke(db, previous)
            db.execute("""INSERT INTO workspace_sessions (token_hash, account_id, expires_at)
                          VALUES (%s, %s, CURRENT_TIMESTAMP + INTERVAL '7 days')""",
                       (digest(token), account["id"]))

    @staticmethod
    def revoke(db, token):
        db.execute("DELETE FROM workspace_sessions WHERE token_hash = %s", (digest(token),))

    @staticmethod
    def identity(db, token, *, lock=False):
        if not token:
            return None
        # Writers hold a lock on the live session until commit so logout and
        # writes are ordered. Lock the account first, matching login's order.
        if lock:
            db.execute("""SELECT a.id FROM workspace_accounts a JOIN workspace_sessions s
                          ON a.id = s.account_id WHERE s.token_hash = %s
                          AND s.expires_at > CURRENT_TIMESTAMP FOR UPDATE OF a""", (digest(token),))
        query = """SELECT a.id, a.display_name FROM workspace_accounts a JOIN workspace_sessions s
                   ON a.id = s.account_id WHERE s.token_hash = %s AND s.expires_at > CURRENT_TIMESTAMP"""
        if lock:
            query += " FOR SHARE OF s"
        return db.execute(query, (digest(token),)).fetchone()

    @staticmethod
    def library(db, owner):
        # One statement gives folders and molecules a consistent snapshot.
        return db.execute("""SELECT
            (SELECT COALESCE(json_agg(f), '[]'::json) FROM
             (SELECT id, name FROM workspace_folders WHERE account_id = %s ORDER BY name, id) f) AS folders,
            (SELECT COALESCE(json_agg(m), '[]'::json) FROM
             (SELECT id, name, molfile, folder_id AS folder FROM workspace_molecules
              WHERE account_id = %s ORDER BY name, id) m) AS molecules""", (owner, owner)).fetchone()

    @staticmethod
    def change(db, owner, action, *, item_id=None, folder=None, name=None, molfile=None):
        if action in {"save_molecule", "move_molecule"} and folder is not None:
            if not db.execute("SELECT 1 FROM workspace_folders WHERE account_id = %s AND id = %s",
                              (owner, folder)).fetchone():
                raise LibraryProblem("Folder not found.", 404)
        if action == "create_folder":
            if db.execute("SELECT count(*) AS n FROM workspace_folders WHERE account_id = %s", (owner,)).fetchone()["n"] >= 100:
                raise LibraryProblem("Your library has reached its folder limit.", 409)
            db.execute("INSERT INTO workspace_folders (id, account_id, name) VALUES (%s, %s, %s)", (uuid4(), owner, name))
            return
        if action == "save_molecule":
            size = db.execute("""SELECT count(*) AS n, COALESCE(sum(octet_length(molfile)), 0) AS bytes
                                 FROM workspace_molecules WHERE account_id = %s""", (owner,)).fetchone()
            if size["n"] >= 100 or size["bytes"] + len(molfile.encode("utf-8")) > 5_000_000:
                raise LibraryProblem("Your library has reached its storage limit.", 409)
            db.execute("""INSERT INTO workspace_molecules (id, account_id, folder_id, name, molfile)
                          VALUES (%s, %s, %s, %s, %s)""", (uuid4(), owner, folder, name, molfile))
            return
        if action == "delete_folder":
            db.execute("""UPDATE workspace_molecules SET folder_id = NULL, updated_at = CURRENT_TIMESTAMP
                          WHERE account_id = %s AND folder_id = %s""", (owner, item_id))
        statements = {
            "rename_folder": ("UPDATE workspace_folders SET name = %s WHERE account_id = %s AND id = %s", (name,)),
            "rename_molecule": ("UPDATE workspace_molecules SET name = %s, updated_at = CURRENT_TIMESTAMP WHERE account_id = %s AND id = %s", (name,)),
            "move_molecule": ("UPDATE workspace_molecules SET folder_id = %s, updated_at = CURRENT_TIMESTAMP WHERE account_id = %s AND id = %s", (folder,)),
            "delete_folder": ("DELETE FROM workspace_folders WHERE account_id = %s AND id = %s", ()),
            "delete_molecule": ("DELETE FROM workspace_molecules WHERE account_id = %s AND id = %s", ()),
        }
        query, values = statements[action]
        if not db.execute(query, (*values, owner, item_id)).rowcount:
            raise LibraryProblem("Item not found.", 404)
