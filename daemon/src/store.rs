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
        // Block deletion while ANY session references this profile — not just
        // active ones. Finished/failed sessions can still be resumed, and
        // resume needs the profile to rebuild the agent's argv. Deleting it
        // would orphan those rows (FK is not enforced) → "unknown_profile".
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE profile_id=?1",
            params![id],
            |r| r.get(0),
        )?;
        if count > 0 {
            anyhow::bail!("profile_in_use");
        }
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
        title: &str, cwd: &str, resolved_argv: &str,
        status: &str, ts: &str, parent_session_id: Option<&str>,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, project_id, profile_id, title, cwd, resolved_argv, status, created_at, parent_session_id)\n             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, project_id, profile_id, title, cwd, resolved_argv, status, ts, parent_session_id],
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

    pub fn list_sessions(&self, project_id: &str) -> anyhow::Result<Vec<DbSession>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, profile_id, title, cwd, resolved_argv, pid, status, exit_code,
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
                pid: row.get(6)?,
                status: row.get(7)?,
                exit_code: row.get(8)?,
                agent_session_id: row.get(9)?,
                agent_session_name: row.get(10)?,
                parent_session_id: row.get(11)?,
                fail_reason: row.get(12)?,
                created_at: row.get(13)?,
                finished_at: row.get(14)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_session(&self, id: &str) -> anyhow::Result<Option<DbSession>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, profile_id, title, cwd, resolved_argv, pid, status, exit_code,
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
                pid: row.get(6)?,
                status: row.get(7)?,
                exit_code: row.get(8)?,
                agent_session_id: row.get(9)?,
                agent_session_name: row.get(10)?,
                parent_session_id: row.get(11)?,
                fail_reason: row.get(12)?,
                created_at: row.get(13)?,
                finished_at: row.get(14)?,
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
