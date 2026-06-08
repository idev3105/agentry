use std::sync::Arc;
use tokio::net::{UnixListener, UnixStream};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{broadcast, RwLock};
use agentry_wire::*;

use crate::store::Store;
use crate::session::SessionManager;

const BROADCAST_CAPACITY: usize = 512;

pub type EventTx = broadcast::Sender<Event>;
pub type EventRx = broadcast::Receiver<Event>;

pub struct Server {
    store: Arc<Store>,
    sessions: Arc<SessionManager>,
    event_tx: EventTx,
}

impl Server {
    pub fn new(store: Arc<Store>, sessions: Arc<SessionManager>) -> Self {
        let (event_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        Server { store, sessions, event_tx }
    }

    pub fn event_sender(&self) -> EventTx {
        self.event_tx.clone()
    }

    pub async fn listen(self: Arc<Self>, sock_path: &str) -> anyhow::Result<()> {
        let _ = std::fs::remove_file(sock_path);
        let listener = UnixListener::bind(sock_path)?;
        tracing::info!("listening on {sock_path}");

        loop {
            let (stream, _) = listener.accept().await?;
            let server = self.clone();
            tokio::spawn(async move {
                if let Err(e) = server.handle_connection(stream).await {
                    tracing::warn!("connection error: {e}");
                }
            });
        }
    }

    async fn handle_connection(self: Arc<Self>, stream: UnixStream) -> anyhow::Result<()> {
        let (read_half, write_half) = stream.into_split();
        let write_half = Arc::new(tokio::sync::Mutex::new(write_half));

        let event_rx = self.event_tx.subscribe();
        let focused_session: Arc<RwLock<Option<String>>> = Arc::new(RwLock::new(None));
        let write_clone = write_half.clone();
        let focused_for_writer = focused_session.clone();

        // Writer task — receives broadcast events, filters agent_output by
        // this connection's focused session, sends the rest verbatim.
        let writer_task = tokio::spawn(async move {
            let mut rx = event_rx;
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        // Per docs/wire-protocol.md §2.4, agent_output is
                        // streamed ONLY to the connection whose focused session
                        // matches. Every other event (session_started,
                        // session_activity, session_finished, session_failed,
                        // project_created) goes to every connection — the
                        // sidebar needs them to render badges/state for
                        // non-focused sessions.
                        if let Event::AgentOutput(ref ao) = event {
                            let f = focused_for_writer.read().await;
                            match f.as_ref() {
                                Some(sid) if sid == &ao.session_id => {}
                                _ => continue,
                            }
                        }
                        let line = match serde_json::to_string(&Message::Event(event)) {
                            Ok(mut s) => { s.push('\n'); s }
                            Err(_) => continue,
                        };
                        let mut w = write_clone.lock().await;
                        if w.write_all(line.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        // Reader task — parses cmds, dispatches, writes resp
        let mut reader = BufReader::new(read_half);
        let mut line = String::new();
        loop {
            line.clear();
            let n = reader.read_line(&mut line).await?;
            if n == 0 { break; }

            let msg = match serde_json::from_str::<Message>(line.trim()) {
                Ok(m) => m,
                Err(e) => {
                    let resp = serde_json::json!({"v":1,"kind":"resp","id":"?","ok":false,"error":format!("parse_error: {e}")});
                    let mut w = write_half.lock().await;
                    let _ = w.write_all(format!("{resp}\n").as_bytes()).await;
                    continue;
                }
            };

            let Message::Cmd(envelope) = msg else {
                continue; // ignore non-cmd messages
            };

            // Version check
            if envelope.v > WIRE_VERSION {
                let resp = serde_json::json!({"v":1,"kind":"resp","id":envelope.id,"ok":false,"error":"unsupported_version"});
                let mut w = write_half.lock().await;
                let _ = w.write_all(format!("{resp}\n").as_bytes()).await;
                continue;
            }

            let id = envelope.id.clone();
            let resp = self.dispatch(envelope, &focused_session).await;
            let resp_msg = build_resp(&id, resp);
            let mut w = write_half.lock().await;
            let _ = w.write_all(resp_msg.as_bytes()).await;
        }

        writer_task.abort();
        Ok(())
    }

    async fn dispatch(
        &self,
        envelope: CmdEnvelope,
        focused: &Arc<RwLock<Option<String>>>,
    ) -> Result<serde_json::Value, String> {
        let now = chrono_now();

        match envelope.cmd {
            // ── Projects ──────────────────────────────────────────────────

            Cmd::CreateProject(c) => {
                let id = new_id();
                self.store.create_project(&id, &c.name, &c.path, &now)
                    .map_err(|e| e.to_string())?;
                let event = Event::ProjectCreated(ProjectCreatedEvent {
                    v: WIRE_VERSION, project_id: id, name: c.name, path: c.path, ts: now,
                });
                let _ = self.event_tx.send(event);
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::ListProjects => {
                let projects = self.store.list_projects().map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true, "projects": projects}))
            }

            Cmd::RemoveProject(c) => {
                self.store.remove_project(&c.project_id).map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true}))
            }

            // ── Profiles ──────────────────────────────────────────────────

            Cmd::CreateProfile(c) => {
                let id = new_id();
                let agent_type_str = agent_type_str(&c.agent_type);
                let params_json = serde_json::to_string(&c.params).unwrap();
                let env_json = serde_json::to_string(&c.env).unwrap();
                self.store.create_profile(&id, &c.name, agent_type_str, &params_json, &env_json, c.start_script.as_deref(), &now)
                    .map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true, "profile_id": id}))
            }

            Cmd::UpdateProfile(c) => {
                let agent_type_str_opt = c.agent_type.as_ref().map(agent_type_str);
                let params_json = c.params.as_ref().map(|p| serde_json::to_string(p).unwrap());
                let env_json = c.env.as_ref().map(|e| serde_json::to_string(e).unwrap());
                self.store.update_profile(
                    &c.profile_id,
                    c.name.as_deref(),
                    agent_type_str_opt.as_deref(),
                    params_json.as_deref(),
                    env_json.as_deref(),
                    Some(c.start_script.as_ref().map(|s| s.as_str())),
                    &now,
                ).map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::DeleteProfile(c) => {
                self.store.delete_profile(&c.profile_id).map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::ListProfiles => {
                let profiles = self.store.list_profiles().map_err(|e| e.to_string())?;
                let out: Vec<serde_json::Value> = profiles.into_iter().map(|p| {
                    serde_json::json!({
                        "id": p.id, "name": p.name, "agent_type": p.agent_type,
                        "params": serde_json::from_str::<serde_json::Value>(&p.params).unwrap_or_default(),
                        "env": serde_json::from_str::<serde_json::Value>(&p.env).unwrap_or_default(),
                        "start_script": p.start_script,
                    })
                }).collect();
                Ok(serde_json::json!({"ok":true, "profiles": out}))
            }

            // ── Sessions ──────────────────────────────────────────────────

            Cmd::StartSession(c) => {
                let settings = self.store.get_settings_all().map_err(|e| e.to_string())?;
                let profile = self.store.get_profile(&c.profile_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "unknown_profile".to_string())?;

                let running = self.store.count_running_sessions().map_err(|e| e.to_string())?;
                let status = if running >= settings.max_concurrent_sessions as i64 {
                    "queued"
                } else {
                    "starting"
                };

                let project = self.store.list_projects().map_err(|e| e.to_string())?
                    .into_iter().find(|p| p.id == c.project_id)
                    .ok_or_else(|| "unknown_project".to_string())?;

                let cwd = c.cwd.unwrap_or_else(|| project.path.clone());
                let n = self.store.session_count_for_project(&c.project_id).unwrap_or(0) + 1;
                let agent = profile.agent_type.clone();
                let title = format!("{} · #{}", agent_display_name(&agent), n);
                let session_id = new_id();

                self.store.create_session(
                    &session_id, &c.project_id, &c.profile_id,
                    &title, &cwd, "[]", status, &now, None,
                ).map_err(|e| e.to_string())?;

                let event = Event::SessionStarted(SessionStartedEvent {
                    v: WIRE_VERSION,
                    session_id: session_id.clone(),
                    project_id: c.project_id,
                    agent: agent_display_name(&agent),
                    title: title.clone(),
                    cwd: cwd.clone(),
                    pid: None,
                    status: if status == "queued" { SessionStatus::Queued } else { SessionStatus::Starting },
                    ts: now,
                });
                let _ = self.event_tx.send(event);

                if status == "starting" {
                    let sessions = self.sessions.clone();
                    let store = self.store.clone();
                    let event_tx = self.event_tx.clone();
                    let sid = session_id.clone();
                    let profile_clone = profile;
                    let initial_input = c.initial_input;
                    tokio::spawn(async move {
                        let _ = sessions.spawn(sid, profile_clone, cwd, initial_input, store, event_tx).await;
                    });
                }

                Ok(serde_json::json!({"ok":true, "session_id": session_id, "status": status}))
            }

            Cmd::KillSession(c) => {
                self.sessions.kill(&c.session_id).await;
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::DeleteSession(c) => {
                // Make sure it's not running first; the store rejects active ones.
                self.sessions.kill(&c.session_id).await;
                self.store.delete_session(&c.session_id)
                    .map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::SendInput(c) => {
                self.sessions.send_input(&c.session_id, c.data.as_bytes()).await
                    .map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::Resize(c) => {
                self.sessions.resize(&c.session_id, c.cols, c.rows).await
                    .map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::RenameSession(c) => {
                self.store.rename_session(&c.session_id, &c.title)
                    .map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::Focus(c) => {
                *focused.write().await = Some(c.session_id.clone());
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::ReadBuffer(c) => {
                let entries = self.sessions.read_buffer(&c.session_id, c.from_seq, c.n, c.tail).await;
                Ok(serde_json::json!({"ok":true, "entries": entries}))
            }

            Cmd::ListSessions(c) => {
                let db_sessions = self.store.list_sessions(&c.project_id)
                    .map_err(|e| e.to_string())?;
                let sessions: Vec<serde_json::Value> = db_sessions.into_iter().map(|s| {
                    let activity = self.sessions.get_activity(&s.id);
                    serde_json::json!({
                        "id": s.id,
                        "title": s.title.unwrap_or_else(|| "session".to_string()),
                        "agent": agent_display_name(&s.resolved_argv),
                        "status": s.status,
                        "activity": activity,
                        "cwd": s.cwd,
                    })
                }).collect();
                Ok(serde_json::json!({"ok":true, "sessions": sessions}))
            }

            Cmd::ResumeSession(c) => {
                let original = self.store.get_session(&c.session_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "unknown_session".to_string())?;

                // Refuse if it's still active — there's nothing to resume.
                if matches!(original.status.as_str(), "running" | "starting" | "queued") {
                    return Err("session_already_active".to_string());
                }

                let profile = self.store.get_profile(&original.profile_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "unknown_profile".to_string())?;

                // Resume only works when we know the agent's own session id.
                // Today only claude_code captures it (via pre-generated UUID
                // passed as --session-id). For opencode/codex we can't pass
                // -s/resume <id>, so spawning would just start a fresh,
                // unrelated session — pretending to resume. Refuse loudly
                // instead so the UI surfaces the limitation.
                if profile.agent_type != "claude_code" && original.agent_session_id.is_none() {
                    return Err(format!(
                        "resume_not_supported_for_agent: {}",
                        agent_display_name(&profile.agent_type)
                    ));
                }

                let settings = self.store.get_settings_all().map_err(|e| e.to_string())?;
                let running = self.store.count_running_sessions().map_err(|e| e.to_string())?;
                let status = if running >= settings.max_concurrent_sessions as i64 { "queued" } else { "starting" };

                let agent = profile.agent_type.clone();
                let title = match &original.title {
                    Some(t) if !t.is_empty() => t.clone(),
                    _ => {
                        let n = self.store.session_count_for_project(&original.project_id).unwrap_or(0) + 1;
                        format!("{} · #{}", agent_display_name(&agent), n)
                    }
                };

                // Reuse the original row: flip status back to active so the
                // sidebar moves it from Past → Active without spawning a duplicate.
                self.store.reactivate_session(&c.session_id, status, &now)
                    .map_err(|e| e.to_string())?;

                let event = Event::SessionStarted(SessionStartedEvent {
                    v: WIRE_VERSION,
                    session_id: c.session_id.clone(),
                    project_id: original.project_id.clone(),
                    agent: agent_display_name(&agent),
                    title,
                    cwd: original.cwd.clone(),
                    pid: None,
                    status: if status == "queued" { SessionStatus::Queued } else { SessionStatus::Starting },
                    ts: now,
                });
                let _ = self.event_tx.send(event);

                if status == "starting" {
                    let sessions = self.sessions.clone();
                    let store = self.store.clone();
                    let event_tx = self.event_tx.clone();
                    let sid = c.session_id.clone();
                    let resume_from = original.agent_session_id;
                    let cwd = original.cwd;
                    tokio::spawn(async move {
                        let _ = sessions.spawn_resume(sid, profile, cwd, resume_from, store, event_tx).await;
                    });
                }

                Ok(serde_json::json!({"ok":true, "session_id": c.session_id, "status": status}))
            }

            // ── Settings ──────────────────────────────────────────────────

            Cmd::GetSettings => {
                let s = self.store.get_settings_all().map_err(|e| e.to_string())?;
                Ok(serde_json::json!({
                    "ok": true,
                    "default_profile_id": s.default_profile_id,
                    "max_concurrent_sessions": s.max_concurrent_sessions,
                    "idle_threshold_s": s.idle_threshold_s,
                    "awaiting_threshold_s": s.awaiting_threshold_s,
                    "ring_buffer_bytes": s.ring_buffer_bytes,
                }))
            }

            Cmd::SetDefaultProfile(c) => {
                self.store.set_setting("default_profile_id", &c.profile_id)
                    .map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true}))
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{}", d.as_secs())
}

fn agent_type_str(at: &AgentType) -> &'static str {
    match at {
        AgentType::ClaudeCode => "claude_code",
        AgentType::OpenCode => "open_code",
        AgentType::Codex => "codex",
    }
}

fn agent_display_name(agent_type: &str) -> String {
    match agent_type {
        "claude_code" => "claude".to_string(),
        "open_code" => "opencode".to_string(),
        "codex" => "codex".to_string(),
        other => other.to_string(),
    }
}

fn build_resp(id: &str, result: Result<serde_json::Value, String>) -> String {
    let mut obj = match result {
        Ok(mut v) => {
            v["v"] = serde_json::json!(WIRE_VERSION);
            v["kind"] = serde_json::json!("resp");
            v["id"] = serde_json::json!(id);
            v
        }
        Err(e) => serde_json::json!({
            "v": WIRE_VERSION, "kind": "resp", "id": id, "ok": false, "error": e
        }),
    };
    let mut s = obj.to_string();
    s.push('\n');
    s
}
