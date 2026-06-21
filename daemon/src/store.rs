use rusqlite::{Connection, params};
use agentry_wire::{ProjectInfo, GetSettingsResp};

pub struct Store {
    conn: std::sync::Mutex<Connection>,
}

#[allow(dead_code)]
impl Store {
    pub fn open(path: &str) -> anyhow::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let store = Store { conn: std::sync::Mutex::new(conn) };
        store.migrate()?;
        store.cleanup_zombies()?;
        Ok(store)
    }

    /// On daemon startup, any session left in a non-terminal state belongs
    /// to a previous run that crashed or was killed. Mark them failed so the
    /// UI doesn't show them as active forever.
    fn cleanup_zombies(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE sessions
                SET status='failed', fail_reason='daemon restarted', exit_code=-1
              WHERE status IN ('running','starting','queued')",
            [],
        )?;
        if n > 0 {
            eprintln!("cleanup: marked {n} zombie session(s) as failed");
        }
        Ok(())
    }

    fn migrate(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(include_str!("migrations.sql"))?;
        drop(conn);
        self.migrate_drop_profile_fk()?;
        self.migrate_add_session_agent_type()?;
        Ok(())
    }

    /// Older DBs predate `sessions.agent_type`. `CREATE TABLE IF NOT EXISTS`
    /// won't add a column to an existing table, so ALTER it in and backfill
    /// from the binary name in `resolved_argv` (best effort — rows created
    /// before argv was snapshotted carry '[]' and stay '').
    fn migrate_add_session_agent_type(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        let has_col: bool = {
            let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            let mut found = false;
            for name in rows {
                if name? == "agent_type" {
                    found = true;
                    break;
                }
            }
            found
        };
        if has_col {
            return Ok(());
        }
        conn.execute_batch(
            "ALTER TABLE sessions ADD COLUMN agent_type TEXT NOT NULL DEFAULT '';",
        )?;
        // Backfill from the argv binary so existing past sessions show the
        // right brand. Maps binary name → wire agent_type.
        for (bin, wire) in [("claude", "claude_code"), ("opencode", "open_code"), ("codex", "codex")] {
            conn.execute(
                "UPDATE sessions SET agent_type=?1
                   WHERE agent_type='' AND resolved_argv LIKE ?2",
                params![wire, format!("[\"{bin}\"%")],
            )?;
        }
        eprintln!("migrate: added sessions.agent_type column");
        Ok(())
    }

    /// Older DBs created `sessions.profile_id` with a FK to `agent_profiles(id)`.
    /// Built-in default profiles live in-memory only (no DB row), so that FK
    /// rejects every session started with a built-in profile
    /// ("FOREIGN KEY constraint failed"). `CREATE TABLE IF NOT EXISTS` can't
    /// drop a constraint, so rebuild the table once for existing DBs.
    fn migrate_drop_profile_fk(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        // Does sessions still carry a FK referencing agent_profiles?
        let has_profile_fk: bool = {
            let mut stmt = conn.prepare("PRAGMA foreign_key_list(sessions)")?;
            let rows = stmt.query_map([], |row| {
                // columns: id, seq, table, from, to, on_update, on_delete, match
                let table: String = row.get(2)?;
                Ok(table)
            })?;
            let mut found = false;
            for t in rows {
                if t? == "agent_profiles" {
                    found = true;
                    break;
                }
            }
            found
        };
        if !has_profile_fk {
            return Ok(());
        }

        // SQLite table rebuild. foreign_keys must be OFF during the swap and
        // cannot be toggled inside a transaction, so disable it first.
        conn.execute_batch("PRAGMA foreign_keys=OFF;")?;
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE sessions_new (
               id                TEXT PRIMARY KEY,
               project_id        TEXT NOT NULL REFERENCES projects(id),
               profile_id        TEXT NOT NULL,
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
             INSERT INTO sessions_new
               SELECT id, project_id, profile_id, title, cwd, resolved_argv,
                      pid, status, exit_code, agent_session_id, agent_session_name,
                      parent_session_id, fail_reason, created_at, finished_at
               FROM sessions;
             DROP TABLE sessions;
             ALTER TABLE sessions_new RENAME TO sessions;
             COMMIT;",
        )?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        eprintln!("migrate: dropped sessions.profile_id FK to agent_profiles");
        Ok(())
    }

    // ── Projects ──────────────────────────────────────────────────────────────

    pub fn create_project(&self, id: &str, name: &str, path: &str, ts: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, path, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, path, ts],
        )?;
        Ok(())
    }

    pub fn list_projects(&self) -> anyhow::Result<Vec<ProjectInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, path FROM projects ORDER BY created_at")?;
        let rows = stmt.query_map([], |row| {
            Ok(ProjectInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn remove_project(&self, project_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE project_id=?1 AND status IN ('running','starting','queued')",
            params![project_id],
            |r| r.get(0),
        )?;
        if count > 0 {
            anyhow::bail!("active_sessions");
        }
        conn.execute("DELETE FROM projects WHERE id=?1", params![project_id])?;
        Ok(())
    }

    // ── Profiles ──────────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn create_profile(
        &self, id: &str, name: &str, agent_type: &str,
        params_json: &str, env_json: &str, start_script: Option<&str>, ts: &str,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO agent_profiles (id, name, agent_type, params, env, start_script, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![id, name, agent_type, params_json, env_json, start_script, ts],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_profile(
        &self, id: &str,
        name: Option<&str>, agent_type: Option<&str>,
        params_json: Option<&str>, env_json: Option<&str>,
        start_script: Option<Option<&str>>, ts: &str,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        if let Some(n) = name {
            conn.execute("UPDATE agent_profiles SET name=?1, updated_at=?2 WHERE id=?3", params![n, ts, id])?;
        }
        if let Some(at) = agent_type {
            conn.execute("UPDATE agent_profiles SET agent_type=?1, updated_at=?2 WHERE id=?3", params![at, ts, id])?;
        }
        if let Some(p) = params_json {
            conn.execute("UPDATE agent_profiles SET params=?1, updated_at=?2 WHERE id=?3", params![p, ts, id])?;
        }
        if let Some(e) = env_json {
            conn.execute("UPDATE agent_profiles SET env=?1, updated_at=?2 WHERE id=?3", params![e, ts, id])?;
        }
        if let Some(s) = start_script {
            conn.execute("UPDATE agent_profiles SET start_script=?1, updated_at=?2 WHERE id=?3", params![s, ts, id])?;
        }
        Ok(())
    }

    pub fn delete_profile(&self, id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        // Block deletion only while a session is ACTIVE (running/starting/
        // queued) — killing the profile out from under a live PTY would orphan
        // a process we can't rebuild argv for. Terminal sessions (done/failed/
        // exited) are safe: resume rebuilds a minimal profile from the
        // snapshotted resolved_argv (see server.rs resume fallback). Deleting
        // the profile only forfeits custom env/start_script on resume — an
        // accepted best-effort trade-off, not a hard dependency.
        let active: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sessions \
             WHERE profile_id=?1 AND status IN ('running','starting','queued')",
            params![id],
            |r| r.get(0),
        )?;
        if active > 0 {
            anyhow::bail!("profile_in_use");
        }
        // FK (sessions.profile_id) is enforced (PRAGMA foreign_keys=ON), and
        // the column is NOT NULL so we can't orphan-null it. Cascade-delete the
        // terminal sessions that reference this profile — and their session_tail
        // children — before dropping the profile. parent_session_id self-FK is
        // also nulled for any resume children pointing at deleted rows.
        conn.execute(
            "DELETE FROM session_tail WHERE session_id IN \
             (SELECT id FROM sessions WHERE profile_id=?1)",
            params![id],
        )?;
        conn.execute(
            "DELETE FROM tracked_files WHERE session_id IN \
             (SELECT id FROM sessions WHERE profile_id=?1)",
            params![id],
        )?;
        conn.execute(
            "DELETE FROM session_events WHERE session_id IN \
             (SELECT id FROM sessions WHERE profile_id=?1)",
            params![id],
        )?;
        conn.execute(
            "UPDATE sessions SET parent_session_id=NULL WHERE parent_session_id IN \
             (SELECT id FROM sessions WHERE profile_id=?1)",
            params![id],
        )?;
        conn.execute("DELETE FROM sessions WHERE profile_id=?1", params![id])?;
        conn.execute("DELETE FROM agent_profiles WHERE id=?1", params![id])?;
        Ok(())
    }

    pub fn list_profiles(&self) -> anyhow::Result<Vec<DbProfile>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, agent_type, params, env, start_script FROM agent_profiles ORDER BY created_at"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(DbProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                agent_type: row.get(2)?,
                params: row.get(3)?,
                env: row.get(4)?,
                start_script: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_profile(&self, id: &str) -> anyhow::Result<Option<DbProfile>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, agent_type, params, env, start_script FROM agent_profiles WHERE id=?1"
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(DbProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                agent_type: row.get(2)?,
                params: row.get(3)?,
                env: row.get(4)?,
                start_script: row.get(5)?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    // ── Sessions ──────────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn create_session(
        &self, id: &str, project_id: &str, profile_id: &str,
        title: &str, cwd: &str, resolved_argv: &str, agent_type: &str,
        status: &str, ts: &str, parent_session_id: Option<&str>,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, project_id, profile_id, title, cwd, resolved_argv, agent_type, status, created_at, parent_session_id)\n             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![id, project_id, profile_id, title, cwd, resolved_argv, agent_type, status, ts, parent_session_id],
        )?;
        Ok(())
    }

    pub fn update_session_status(&self, id: &str, status: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE sessions SET status=?1 WHERE id=?2", params![status, id])?;
        Ok(())
    }

    pub fn update_session_pid(&self, id: &str, pid: u32) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE sessions SET pid=?1 WHERE id=?2", params![pid, id])?;
        Ok(())
    }

    pub fn finish_session(&self, id: &str, exit_code: i32, ts: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET status='finished', exit_code=?1, finished_at=?2 WHERE id=?3",
            params![exit_code, ts, id],
        )?;
        Ok(())
    }

    pub fn fail_session(&self, id: &str, exit_code: i32, reason: &str, ts: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET status='failed', exit_code=?1, fail_reason=?2, finished_at=?3 WHERE id=?4",
            params![exit_code, reason, ts, id],
        )?;
        Ok(())
    }

    pub fn rename_session(&self, id: &str, title: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE sessions SET title=?1 WHERE id=?2", params![title, id])?;
        Ok(())
    }

    /// Flip a finished/failed session back to an active state for resume.
    /// Clears terminal fields (exit_code, fail_reason, finished_at) and stamps
    /// a fresh created_at so the row sorts as freshly active.
    pub fn reactivate_session(&self, id: &str, status: &str, ts: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions
                SET status=?1, exit_code=NULL, fail_reason=NULL,
                    finished_at=NULL, pid=NULL, created_at=?2
              WHERE id=?3",
            params![status, ts, id],
        )?;
        Ok(())
    }

    pub fn delete_session(&self, id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        // Drop session_tail rows first (FK), null out resume children's
        // parent_session_id so the self-FK on sessions doesn't block delete.
        // Caller is responsible for killing the PTY before delete; if the
        // reader thread races with us and tries to finish_session() after
        // the row is gone, the UPDATE simply no-ops.
        conn.execute("DELETE FROM session_tail WHERE session_id=?1", params![id]).ok();
        conn.execute("DELETE FROM tracked_files WHERE session_id=?1", params![id]).ok();
        conn.execute("DELETE FROM session_events WHERE session_id=?1", params![id]).ok();
        conn.execute(
            "UPDATE sessions SET parent_session_id=NULL WHERE parent_session_id=?1",
            params![id],
        ).ok();
        conn.execute("DELETE FROM sessions WHERE id=?1", params![id])?;
        Ok(())
    }

    pub fn set_agent_session_id(&self, id: &str, agent_session_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE sessions SET agent_session_id=?1 WHERE id=?2", params![agent_session_id, id])?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn set_agent_session_name(&self, id: &str, name: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE sessions SET agent_session_name=?1 WHERE id=?2", params![name, id])?;
        Ok(())
    }

    /// Insert a detected plan file, deduped per session by path. Returns true
    /// if a new row was inserted, false if the path was already recorded.
    pub fn insert_tracked_file(
        &self,
        session_id: &str,
        path: &str,
        name: &str,
        tool: Option<&str>,
        created_at: &str,
    ) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "INSERT OR IGNORE INTO tracked_files (session_id, path, name, tool, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![session_id, path, name, tool, created_at],
        )?;
        Ok(n > 0)
    }

    pub fn insert_session_event(
        &self,
        session_id: &str,
        name: &str,
        detail: Option<&str>,
        created_at: &str,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO session_events (session_id, name, detail, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![session_id, name, detail, created_at],
        )?;
        Ok(())
    }

    pub fn list_session_events(&self, session_id: &str) -> anyhow::Result<Vec<DbSessionEvent>> {
        let conn = self.conn.lock().unwrap();
        // Last 500 events, returned oldest-first for chronological display.
        let mut stmt = conn.prepare(
            "SELECT name, detail, created_at FROM (
                 SELECT id, name, detail, created_at
                 FROM session_events WHERE session_id=?1
                 ORDER BY id DESC LIMIT 500
             ) ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok(DbSessionEvent {
                name: row.get(0)?,
                detail: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Distinct cwds across all sessions — used to widen the explorer allow-list.
    pub fn all_session_cwds(&self) -> anyhow::Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT DISTINCT cwd FROM sessions")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.flatten().collect())
    }

    pub fn list_tracked_files(&self, session_id: &str) -> anyhow::Result<Vec<DbTrackedFile>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT path, name, tool, created_at
             FROM tracked_files WHERE session_id=?1 ORDER BY created_at",
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok(DbTrackedFile {
                path: row.get(0)?,
                name: row.get(1)?,
                tool: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn list_sessions(&self, project_id: &str) -> anyhow::Result<Vec<DbSession>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, profile_id, title, cwd, resolved_argv, agent_type, pid, status, exit_code,
                    agent_session_id, agent_session_name, parent_session_id, fail_reason, created_at, finished_at
             FROM sessions WHERE project_id=?1 ORDER BY created_at"
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(DbSession {
                id: row.get(0)?,
                project_id: row.get(1)?,
                profile_id: row.get(2)?,
                title: row.get(3)?,
                cwd: row.get(4)?,
                resolved_argv: row.get(5)?,
                agent_type: row.get(6)?,
                pid: row.get(7)?,
                status: row.get(8)?,
                exit_code: row.get(9)?,
                agent_session_id: row.get(10)?,
                agent_session_name: row.get(11)?,
                parent_session_id: row.get(12)?,
                fail_reason: row.get(13)?,
                created_at: row.get(14)?,
                finished_at: row.get(15)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_session(&self, id: &str) -> anyhow::Result<Option<DbSession>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, profile_id, title, cwd, resolved_argv, agent_type, pid, status, exit_code,
                    agent_session_id, agent_session_name, parent_session_id, fail_reason, created_at, finished_at
             FROM sessions WHERE id=?1"
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(DbSession {
                id: row.get(0)?,
                project_id: row.get(1)?,
                profile_id: row.get(2)?,
                title: row.get(3)?,
                cwd: row.get(4)?,
                resolved_argv: row.get(5)?,
                agent_type: row.get(6)?,
                pid: row.get(7)?,
                status: row.get(8)?,
                exit_code: row.get(9)?,
                agent_session_id: row.get(10)?,
                agent_session_name: row.get(11)?,
                parent_session_id: row.get(12)?,
                fail_reason: row.get(13)?,
                created_at: row.get(14)?,
                finished_at: row.get(15)?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn count_running_sessions(&self) -> anyhow::Result<i64> {
        let conn = self.conn.lock().unwrap();
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE status IN ('running','starting')",
            [],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    pub fn get_next_queued_session(&self) -> anyhow::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id FROM sessions WHERE status='queued' ORDER BY created_at LIMIT 1")?;
        let mut rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    pub fn get_setting(&self, key: &str) -> anyhow::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key=?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_settings_all(&self) -> anyhow::Result<GetSettingsResp> {
        Ok(GetSettingsResp {
            default_profile_id: self.get_setting("default_profile_id")?,
            max_concurrent_sessions: self.get_setting("max_concurrent_sessions")?
                .and_then(|v| v.parse().ok()).unwrap_or(8),
            idle_threshold_s: self.get_setting("idle_threshold_s")?
                .and_then(|v| v.parse().ok()).unwrap_or(10),
            awaiting_threshold_s: self.get_setting("awaiting_threshold_s")?
                .and_then(|v| v.parse().ok()).unwrap_or(30),
            ring_buffer_bytes: self.get_setting("ring_buffer_bytes")?
                .and_then(|v| v.parse().ok()).unwrap_or(2097152),
            remote_enabled: self.get_setting("remote_enabled")?
                .map(|v| v != "false" && v != "0").unwrap_or(true),
        })
    }

    pub fn session_count_for_project(&self, project_id: &str) -> anyhow::Result<i64> {
        let conn = self.conn.lock().unwrap();
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE project_id=?1",
            params![project_id],
            |r| r.get(0),
        )?;
        Ok(n)
    }
}

// ── DB row types ─────────────────────────────────────────────────────────────

pub struct DbProfile {
    pub id: String,
    pub name: String,
    pub agent_type: String,
    pub params: String,
    pub env: String,
    pub start_script: Option<String>,
}

#[allow(dead_code)]
pub struct DbSession {
    pub id: String,
    pub project_id: String,
    pub profile_id: String,
    pub title: Option<String>,
    pub cwd: String,
    pub resolved_argv: String,
    pub agent_type: String,
    pub pid: Option<i64>,
    pub status: String,
    pub exit_code: Option<i32>,
    pub agent_session_id: Option<String>,
    pub agent_session_name: Option<String>,
    pub parent_session_id: Option<String>,
    pub fail_reason: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

pub struct DbTrackedFile {
    pub path: String,
    pub name: String,
    pub tool: Option<String>,
    pub created_at: String,
}

pub struct DbSessionEvent {
    pub name: String,
    pub detail: Option<String>,
    pub created_at: String,
}
