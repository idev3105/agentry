use std::sync::Arc;
#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{broadcast, RwLock};
use agentry_wire::*;

use crate::store::{Store, DbProfile};
use crate::session::SessionManager;

const BROADCAST_CAPACITY: usize = 512;

pub type EventTx = broadcast::Sender<Event>;
#[allow(dead_code)]
pub type EventRx = broadcast::Receiver<Event>;

// ── Built-in profiles ──────────────────────────────────────────────────────
// Three immutable "default" profiles, one per agent type.  They are always
// returned by ListProfiles and cannot be deleted or edited.  They carry no
// params / env / start_script so the agent runs with its own defaults.

const BUILTIN_CLAUDE: &str = "__default_claude_code__";
const BUILTIN_CODEX:  &str = "__default_codex__";
const BUILTIN_OC:     &str = "__default_open_code__";
const BUILTIN_HERMES: &str = "__default_hermes__";

fn is_builtin_profile(id: &str) -> bool {
    matches!(id, "__default_claude_code__" | "__default_codex__" | "__default_open_code__" | "__default_hermes__")
}

fn builtin_to_db_profile(id: &str) -> Option<DbProfile> {
    let (name, agent_type) = match id {
        "__default_claude_code__" => ("Claude Code", "claude_code"),
        "__default_codex__"       => ("Codex",       "codex"),
        "__default_open_code__"   => ("OpenCode",    "open_code"),
        "__default_hermes__"      => ("Hermes",      "hermes"),
        _ => return None,
    };
    Some(DbProfile {
        id: id.to_string(),
        name: name.to_string(),
        agent_type: agent_type.to_string(),
        params: "[]".to_string(),
        env: "[]".to_string(),
        start_script: None,
    })
}

fn builtin_profiles_json() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "id": BUILTIN_CLAUDE, "name": "Claude Code", "agent_type": "claude_code",
            "params": [], "env": [], "start_script": null, "is_builtin": true,
        }),
        serde_json::json!({
            "id": BUILTIN_CODEX, "name": "Codex", "agent_type": "codex",
            "params": [], "env": [], "start_script": null, "is_builtin": true,
        }),
        serde_json::json!({
            "id": BUILTIN_OC, "name": "OpenCode", "agent_type": "open_code",
            "params": [], "env": [], "start_script": null, "is_builtin": true,
        }),
        serde_json::json!({
            "id": BUILTIN_HERMES, "name": "Hermes", "agent_type": "hermes",
            "params": [], "env": [], "start_script": null, "is_builtin": true,
        }),
    ]
}

pub struct Server {
    store: Arc<Store>,
    sessions: Arc<SessionManager>,
    event_tx: EventTx,
    remote_enabled_tx: tokio::sync::watch::Sender<bool>,
}

impl Server {
    pub fn new(store: Arc<Store>, sessions: Arc<SessionManager>) -> Self {
        let (event_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        let initial = store.get_setting("remote_enabled")
            .ok().flatten()
            .map(|v| v != "false" && v != "0")
            .unwrap_or(true);
        let (remote_enabled_tx, _) = tokio::sync::watch::channel(initial);
        Server { store, sessions, event_tx, remote_enabled_tx }
    }

    pub fn remote_enabled_rx(&self) -> tokio::sync::watch::Receiver<bool> {
        self.remote_enabled_tx.subscribe()
    }

    /// Expose store + sessions + event_tx for the agent hook server.
    #[cfg(all(unix, not(target_os = "android")))]
    pub fn hook_resources(
        &self,
    ) -> (Arc<crate::store::Store>, Arc<crate::session::SessionManager>, EventTx) {
        (self.store.clone(), self.sessions.clone(), self.event_tx.clone())
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

    pub fn subscribe_events(&self) -> EventRx {
        self.event_tx.subscribe()
    }

    pub async fn dispatch(
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
                if is_builtin_profile(&c.profile_id) {
                    return Err("Built-in default profiles cannot be edited.".to_string());
                }
                let agent_type_str_opt = c.agent_type.as_ref().map(agent_type_str);
                let params_json = c.params.as_ref().map(|p| serde_json::to_string(p).unwrap());
                let env_json = c.env.as_ref().map(|e| serde_json::to_string(e).unwrap());
                self.store.update_profile(
                    &c.profile_id,
                    c.name.as_deref(),
                    agent_type_str_opt,
                    params_json.as_deref(),
                    env_json.as_deref(),
                    Some(c.start_script.as_deref()),
                    &now,
                ).map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::DeleteProfile(c) => {
                if is_builtin_profile(&c.profile_id) {
                    return Err("Built-in default profiles cannot be deleted.".to_string());
                }
                self.store.delete_profile(&c.profile_id).map_err(|e| e.to_string())?;
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::ListProfiles => {
                let mut profiles = self.store.list_profiles().map_err(|e| e.to_string())?;
                let mut out: Vec<serde_json::Value> = profiles.drain(..).map(|p| {
                    serde_json::json!({
                        "id": p.id, "name": p.name, "agent_type": p.agent_type,
                        "params": serde_json::from_str::<serde_json::Value>(&p.params).unwrap_or_default(),
                        "env": serde_json::from_str::<serde_json::Value>(&p.env).unwrap_or_default(),
                        "start_script": p.start_script,
                        "is_builtin": false,
                    })
                }).collect();
                // Prepend the 3 immutable built-in profiles (one per agent type).
                // They are always present so the user can start a session without
                // having to create a profile first.
                let builtins = builtin_profiles_json();
                out.splice(0..0, builtins);
                Ok(serde_json::json!({"ok":true, "profiles": out}))
            }

            // ── Sessions ──────────────────────────────────────────────────

            Cmd::StartSession(c) => {
                let settings = self.store.get_settings_all().map_err(|e| e.to_string())?;
                // Builtin profiles are not in DB — resolve them in-memory.
                let profile = if is_builtin_profile(&c.profile_id) {
                    builtin_to_db_profile(&c.profile_id)
                        .ok_or_else(|| "unknown_profile".to_string())?
                } else {
                    self.store.get_profile(&c.profile_id)
                        .map_err(|e| e.to_string())?
                        .ok_or_else(|| "Profile đã bị xóa — không thể start session mới với profile này. Tạo profile mới hoặc dùng Resume.".to_string())?
                };

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
                    &title, &cwd, "[]", &agent, status, &now, None,
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
                    agent_session_id: None,
                    agent_session_name: None,
                });
                let _ = self.event_tx.send(event);

                if status == "starting" {
                    let initial_size = match (c.cols, c.rows) {
                        (Some(c), Some(r)) => Some((c, r)),
                        _ => None,
                    };
                    let sessions = self.sessions.clone();
                    let store = self.store.clone();
                    let event_tx = self.event_tx.clone();
                    let sid = session_id.clone();
                    let profile_clone = profile;
                    let initial_input = c.initial_input;
                    tokio::spawn(async move {
                        #[cfg(all(unix, not(target_os = "android")))]
                        let _ = sessions.spawn(sid, profile_clone, cwd, initial_input, initial_size, store, event_tx).await;
                        #[cfg(not(all(unix, not(target_os = "android"))))]
                        eprintln!("[session {}] spawn not supported on this platform", sid);
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
                        "agent": agent_display_name(&s.agent_type),
                        "status": s.status,
                        "activity": activity,
                        "cwd": s.cwd,
                        "agent_session_id": s.agent_session_id,
                        "agent_session_name": s.agent_session_name,
                    })
                }).collect();
                Ok(serde_json::json!({"ok":true, "sessions": sessions}))
            }

            Cmd::ListTrackedFiles(c) => {
                let files: Vec<serde_json::Value> = self
                    .store
                    .list_tracked_files(&c.session_id)
                    .map_err(|e| e.to_string())?
                    .into_iter()
                    .map(|f| {
                        serde_json::json!({
                            "path": f.path,
                            "name": f.name,
                            "tool": f.tool,
                            "ts": f.created_at,
                        })
                    })
                    .collect();
                Ok(serde_json::json!({"ok":true, "files": files}))
            }

            Cmd::ListSessionEvents(c) => {
                let events: Vec<serde_json::Value> = self
                    .store
                    .list_session_events(&c.session_id)
                    .map_err(|e| e.to_string())?
                    .into_iter()
                    .map(|e| {
                        serde_json::json!({
                            "name": e.name,
                            "detail": e.detail,
                            "ts": e.created_at,
                        })
                    })
                    .collect();
                Ok(serde_json::json!({"ok":true, "events": events}))
            }

            Cmd::ResumeSession(c) => {
                let original = self.store.get_session(&c.session_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "unknown_session".to_string())?;

                // Refuse if it's still active — there's nothing to resume.
                if matches!(original.status.as_str(), "running" | "starting" | "queued") {
                    return Err("session_already_active".to_string());
                }

                let profile = if is_builtin_profile(&original.profile_id) {
                    builtin_to_db_profile(&original.profile_id)
                        .ok_or_else(|| "unknown_profile".to_string())?
                } else { match self.store.get_profile(&original.profile_id)
                    .map_err(|e| e.to_string())?
                {
                    Some(p) => p,
                    None => {
                        // Profile was deleted out from under this session (legacy
                        // orphan rows created before delete_profile blocked it).
                        // Rebuild a minimal profile from the argv we snapshotted
                        // at create time so resume still works. Custom
                        // params/env/start_script are lost — best effort.
                        let argv: Vec<String> = serde_json::from_str(&original.resolved_argv)
                            .map_err(|_| "unknown_profile".to_string())?;
                        let bin = argv.first().map(String::as_str).unwrap_or("");
                        let agent_type = match bin {
                            "claude" => "claude_code",
                            "opencode" => "open_code",
                            "codex" => "codex",
                            "hermes" => "hermes",
                            _ => return Err("unknown_profile".to_string()),
                        }.to_string();
                        DbProfile {
                            id: original.profile_id.clone(),
                            name: format!("{} (deleted profile)", agent_type),
                            agent_type,
                            params: "[]".to_string(),
                            env: "[]".to_string(),
                            start_script: None,
                        }
                    }
                } };

                // Resume only works when we know the agent's own session id.
                // Today only claude_code captures it (via pre-generated UUID
                // passed as --session-id). For opencode/codex we can't pass
                // -s/resume <id>, so spawning would just start a fresh,
                // unrelated session — pretending to resume. Refuse loudly
                // instead so the UI surfaces the limitation.
                if profile.agent_type != "claude_code" && original.agent_session_id.is_none() {
                    return Err("Session này không có agent_session_id (capture timeout). Không resume được.".to_string());
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
                    agent_session_id: original.agent_session_id.clone(),
                    agent_session_name: original.agent_session_name.clone(),
                });
                let _ = self.event_tx.send(event);

                if status == "starting" {
                    let initial_size = match (c.cols, c.rows) {
                        (Some(c), Some(r)) => Some((c, r)),
                        _ => None,
                    };
                    let sessions = self.sessions.clone();
                    let store = self.store.clone();
                    let event_tx = self.event_tx.clone();
                    let sid = c.session_id.clone();
                    let resume_from = original.agent_session_id;
                    let cwd = original.cwd;
                    tokio::spawn(async move {
                        #[cfg(all(unix, not(target_os = "android")))]
                        let _ = sessions.spawn_resume(sid, profile, cwd, resume_from, initial_size, store, event_tx).await;
                        #[cfg(not(all(unix, not(target_os = "android"))))]
                        eprintln!("[session {}] spawn_resume not supported on this platform", sid);
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

            Cmd::SetRemoteEnabled(c) => {
                let val = if c.enabled { "true" } else { "false" };
                self.store.set_setting("remote_enabled", val)
                    .map_err(|e| e.to_string())?;
                let _ = self.remote_enabled_tx.send(c.enabled);
                Ok(serde_json::json!({"ok":true}))
            }

            Cmd::GetRemoteStatus => {
                let enabled = *self.remote_enabled_tx.borrow();
                if !enabled {
                    return Ok(serde_json::json!({
                        "ok": true,
                        "listening": false,
                        "address": null,
                        "error": null,
                        "enabled": false,
                    }));
                }
                let (listening, address, error) = match crate::remote::remote_info() {
                    Some((_bind, display)) => (true, Some(display), None),
                    None => (false, None, Some("tailscale interface not found".to_string())),
                };
                Ok(serde_json::json!({
                    "ok": true,
                    "listening": listening,
                    "address": address,
                    "error": error,
                    "enabled": true,
                }))
            }

            Cmd::CheckIntegrations => {
                let integrations = crate::integrations::check_all();
                Ok(serde_json::json!({ "ok": true, "integrations": integrations }))
            }

            Cmd::InstallIntegration(c) => {
                match crate::integrations::install(&c.agent) {
                    Ok(status) => Ok(serde_json::json!({ "ok": true, "integration": status })),
                    Err(e) => Err(e),
                }
            }

            Cmd::ListDir(c) => {
                let roots = allowed_roots(&self.store);
                let entries = crate::fs_access::list_dir(
                    &c.path,
                    roots.iter().map(String::as_str),
                )?;
                Ok(serde_json::json!({ "ok": true, "entries": entries }))
            }

            Cmd::ReadFile(c) => {
                let roots = allowed_roots(&self.store);
                let content = crate::fs_access::read_file(
                    &c.path,
                    c.max_bytes,
                    roots.iter().map(String::as_str),
                )?;
                Ok(serde_json::json!({ "ok": true, "file": content }))
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Collect every directory the GUI is allowed to browse: each project path
/// plus each session's cwd. Used as the allow-list for fs_access guard.
fn allowed_roots(store: &std::sync::Arc<Store>) -> Vec<String> {
    let mut roots: Vec<String> = Vec::new();
    if let Ok(projects) = store.list_projects() {
        for p in projects {
            roots.push(p.path);
        }
    }
    // Session cwds may sit outside the project path (user picked a subdir or
    // a different folder at launch); include them so those files are viewable.
    if let Ok(cwds) = store.all_session_cwds() {
        roots.extend(cwds);
    }
    roots
}

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
        AgentType::Hermes => "hermes",
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
    let obj = match result {
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
