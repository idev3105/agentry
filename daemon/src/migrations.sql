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
  profile_id        TEXT NOT NULL REFERENCES agent_profiles(id),
  title             TEXT,
  cwd               TEXT NOT NULL,
  resolved_argv     TEXT NOT NULL,
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
