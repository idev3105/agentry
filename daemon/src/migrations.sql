CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  path           TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL,
  last_active_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  agent_type   TEXT NOT NULL CHECK(agent_type IN ('claude_code','open_code','codex')),
  params       TEXT NOT NULL DEFAULT '[]',
  env          TEXT NOT NULL DEFAULT '[]',
  start_script TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id),
  -- No FK to agent_profiles(id): built-in default profiles live in-memory
  -- only (see server.rs builtin_to_db_profile) and have no DB row, so a FK
  -- here would reject every session started with a built-in profile.
  profile_id        TEXT NOT NULL,
  title             TEXT,
  cwd               TEXT NOT NULL,
  resolved_argv     TEXT NOT NULL,
  agent_type        TEXT NOT NULL DEFAULT '',
  pid               INTEGER,
  status            TEXT NOT NULL,
  exit_code         INTEGER,
  agent_session_id  TEXT,
  agent_session_name TEXT,
  parent_session_id TEXT REFERENCES sessions(id),
  fail_reason       TEXT,
  created_at        TEXT NOT NULL,
  finished_at       TEXT
);

CREATE TABLE IF NOT EXISTS session_tail (
  session_id TEXT REFERENCES sessions(id),
  seq        INTEGER NOT NULL,
  bytes      BLOB NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Every file written/edited by a tool, reported via agent hook tool-use events.
-- Deduped per session by path via the UNIQUE constraint.
CREATE TABLE IF NOT EXISTS tracked_files (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  path       TEXT NOT NULL,
  name       TEXT NOT NULL,
  tool       TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, path)
);

-- Per-session event log captured from agent hooks (every event, with a short
-- detail snippet). Used by the Inspector "Timeline" tab.
CREATE TABLE IF NOT EXISTS session_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  name       TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_events_sid ON session_events(session_id, id);
