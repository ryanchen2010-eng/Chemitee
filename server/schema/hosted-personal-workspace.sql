-- Migration 001. Run explicitly against a NEW dedicated workspace database.
-- Never run against the local SQLite library or either existing Beta.
BEGIN;

CREATE SCHEMA workspace;
REVOKE ALL ON SCHEMA workspace FROM PUBLIC;
SET LOCAL search_path TO workspace, pg_catalog;

CREATE TABLE workspace_schema_version (version INTEGER PRIMARY KEY CHECK (version = 1));
INSERT INTO workspace_schema_version VALUES (1);

CREATE TABLE workspace_accounts (
    id UUID PRIMARY KEY,
    google_sub VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The browser receives a random opaque token; only its SHA-256 digest is stored.
CREATE TABLE workspace_sessions (
    token_hash BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    account_id UUID NOT NULL REFERENCES workspace_accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (expires_at > created_at)
);
CREATE INDEX workspace_sessions_account ON workspace_sessions (account_id);
CREATE INDEX workspace_sessions_expiry ON workspace_sessions (expires_at);

-- Authlib stores pending PKCE/nonce data here, not in browser cookies.
-- Retrieving a state deletes it atomically, even across processes.
CREATE TABLE workspace_oauth_states (
    key_hash BYTEA PRIMARY KEY CHECK (octet_length(key_hash) = 32),
    data TEXT NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 8192),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX workspace_oauth_states_expiry ON workspace_oauth_states (expires_at);

CREATE TABLE workspace_folders (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES workspace_accounts(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, id)
);

CREATE TABLE workspace_molecules (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES workspace_accounts(id) ON DELETE CASCADE,
    folder_id UUID,
    name VARCHAR(120) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    molfile TEXT NOT NULL CHECK (length(molfile) BETWEEN 1 AND 200000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id, folder_id) REFERENCES workspace_folders(account_id, id) ON DELETE RESTRICT
);
CREATE INDEX workspace_folders_owner ON workspace_folders (account_id, name, id);
CREATE INDEX workspace_molecules_owner_folder ON workspace_molecules (account_id, folder_id, name, id);

-- USD millionths reserved before a provider call, shared by every V3 worker.
CREATE TABLE workspace_ai_monthly_budget (
    month_start DATE PRIMARY KEY,
    reserved_microusd INTEGER NOT NULL CHECK (reserved_microusd BETWEEN 0 AND 10000000)
);

-- Deleting a folder requires a transaction: first set folder_id = NULL for
-- that account and folder, then delete the folder with the same owner filter.
COMMIT;
