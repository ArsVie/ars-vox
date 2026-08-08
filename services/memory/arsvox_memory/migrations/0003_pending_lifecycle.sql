-- H5 (GATE-2.5): extend pending_actions.status CHECK to include the
-- explicit execution lifecycle — pending -> approved -> executing ->
-- executed | failed (plus cancelled/expired/superseded as before).
--
-- SQLite cannot ALTER a CHECK constraint, so rebuild the table
-- (data-preserving) and recreate the dependent index. 0001's CREATE
-- TABLE IF NOT EXISTS keeps the old constraint on fresh databases; this
-- migration replaces it for both fresh and pre-existing databases.

BEGIN;

CREATE TABLE pending_actions_new (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  tool TEXT NOT NULL,
  args_json TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','executing','executed','failed','cancelled','expired','superseded')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  resolved_at TEXT
);

INSERT INTO pending_actions_new (
  id, run_id, tool, args_json, title, detail, status, created_at, expires_at, resolved_at
)
SELECT id, run_id, tool, args_json, title, detail, status, created_at, expires_at, resolved_at
FROM pending_actions;

DROP TABLE pending_actions;

ALTER TABLE pending_actions_new RENAME TO pending_actions;

CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_actions(status, expires_at);

COMMIT;
