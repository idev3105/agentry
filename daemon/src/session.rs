use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use agentry_wire::*;
use base64::Engine;

use crate::store::{Store, DbProfile};
use crate::server::EventTx;

const RING_BUFFER_BYTES: usize = 2 * 1024 * 1024; // 2 MB default

#[derive(Debug, Clone)]
pub struct BufferChunk {
    pub seq: u64,
    pub data: Vec<u8>,
}

struct SessionHandle {
    // PTY write side — send bytes to stdin
    input_tx: mpsc::UnboundedSender<Vec<u8>>,
    // PTY resize channel
    resize_tx: mpsc::UnboundedSender<(u16, u16)>,
    // Kill signal
    kill_tx: mpsc::UnboundedSender<()>,
    // Activity state (runtime only)
    activity: ActivityState,
    last_output_at: std::time::Instant,
    // Ring buffer
    ring: VecDeque<BufferChunk>,
    ring_bytes: usize,
}

pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, SessionHandle>>>,
}

impl SessionManager {
    pub fn new() -> Arc<Self> {
        Arc::new(SessionManager {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    pub fn get_activity(&self, session_id: &str) -> Option<String> {
        // Sync read — returns activity label if running
        tokio::task::block_in_place(|| {
            let sessions = futures::executor::block_on(self.sessions.read());
            sessions.get(session_id).map(|h| match h.activity {
                ActivityState::Working => "working".to_string(),
                ActivityState::Idle => "idle".to_string(),
                ActivityState::AwaitingInput => "awaiting_input".to_string(),
            })
        })
    }

    pub async fn read_buffer(
        &self,
        session_id: &str,
        from_seq: u64,
        n: u32,
        tail: Option<u32>,
    ) -> Vec<serde_json::Value> {
        let sessions = self.sessions.read().await;
        let Some(handle) = sessions.get(session_id) else { return vec![] };

        let chunks: Vec<&BufferChunk> = match tail {
            Some(t) => {
                let total = handle.ring.len();
                let skip = total.saturating_sub(t as usize);
                handle.ring.iter().skip(skip).collect()
            }
            None => handle.ring.iter()
                .filter(|c| c.seq >= from_seq)
                .take(n as usize)
                .collect(),
        };

        chunks.into_iter().map(|c| serde_json::json!({
            "seq": c.seq,
            "data_b64": base64::engine::general_purpose::STANDARD.encode(&c.data),
        })).collect()
    }

    pub async fn send_input(&self, session_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let sessions = self.sessions.read().await;
        let handle = sessions.get(session_id).ok_or_else(|| anyhow::anyhow!("unknown_session"))?;
        handle.input_tx.send(data.to_vec()).ok();
        Ok(())
    }

    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        let sessions = self.sessions.read().await;
        let handle = sessions.get(session_id).ok_or_else(|| anyhow::anyhow!("unknown_session"))?;
        handle.resize_tx.send((cols, rows)).ok();
        Ok(())
    }

    pub async fn kill(&self, session_id: &str) {
        let sessions = self.sessions.read().await;
        if let Some(handle) = sessions.get(session_id) {
            handle.kill_tx.send(()).ok();
        }
    }

    /// Spawn a fresh session
    pub async fn spawn(
        self: Arc<Self>,
        session_id: String,
        profile: DbProfile,
        cwd: String,
        initial_input: Option<String>,
        initial_size: Option<(u16, u16)>,
        store: Arc<Store>,
        event_tx: EventTx,
    ) -> anyhow::Result<()> {
        let argv = build_argv(&profile, None);
        let env_pairs = parse_env(&profile.env);
        store.update_session_status(&session_id, "running")?;
        store.set_setting("dummy", "dummy").ok();
        self.do_spawn(session_id, argv, env_pairs, cwd, initial_input, None, initial_size, store, event_tx, profile.start_script).await
    }

    /// Spawn a resume session (pass agent_session_id to `--resume`)
    pub async fn spawn_resume(
        self: Arc<Self>,
        session_id: String,
        profile: DbProfile,
        cwd: String,
        agent_session_id: Option<String>,
        initial_size: Option<(u16, u16)>,
        store: Arc<Store>,
        event_tx: EventTx,
    ) -> anyhow::Result<()> {
        let argv = build_argv(&profile, agent_session_id.as_deref());
        let env_pairs = parse_env(&profile.env);
        store.update_session_status(&session_id, "running")?;
        self.do_spawn(session_id, argv, env_pairs, cwd, None, None, initial_size, store, event_tx, profile.start_script).await
    }

    async fn do_spawn(
        self: Arc<Self>,
        session_id: String,
        argv: Vec<String>,
        env_pairs: Vec<(String, String)>,
        cwd: String,
        initial_input: Option<String>,
        agent_session_id_preset: Option<String>, // for claude_code pre-generated UUID
        initial_size: Option<(u16, u16)>,
        store: Arc<Store>,
        event_tx: EventTx,
        start_script: Option<String>,
    ) -> anyhow::Result<()> {
        // Run start_script if present (blocking in thread)
        if let Some(script) = start_script {
            let script_cwd = cwd.clone();
            let exit = tokio::task::spawn_blocking(move || {
                std::process::Command::new("sh")
                    .arg("-c")
                    .arg(&script)
                    .current_dir(&script_cwd)
                    .status()
            }).await??;
            if !exit.success() {
                let code = exit.code().unwrap_or(1);
                let ts = chrono_now();
                store.fail_session(&session_id, code, "start_script failed", &ts)?;
                let _ = event_tx.send(Event::SessionFailed(SessionFailedEvent {
                    v: WIRE_VERSION,
                    session_id: session_id.clone(),
                    reason: "start_script failed".to_string(),
                    exit_code: code,
                    ts,
                }));
                return Ok(());
            }
        }

        let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<(u16, u16)>();
        let (kill_tx, mut kill_rx) = mpsc::unbounded_channel::<()>();

        // Insert handle BEFORE spawning PTY so Focus can queue events
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), SessionHandle {
                input_tx,
                resize_tx,
                kill_tx,
                activity: ActivityState::Working,
                last_output_at: std::time::Instant::now(),
                ring: VecDeque::new(),
                ring_bytes: 0,
            });
        }

        // Spawn the PTY in a blocking thread (portable-pty uses blocking reads)
        let session_id_clone = session_id.clone();
        let sessions_arc = self.sessions.clone();
        let event_tx_clone = event_tx.clone();
        let store_clone = store.clone();
        let cwd_clone = cwd.clone();
        // Capture tokio handle in async context — `Handle::current()` panics inside std::thread::spawn.
        let rt_handle = tokio::runtime::Handle::current();
        let (init_cols, init_rows) = initial_size.unwrap_or((80, 24));

        std::thread::spawn(move || {
            let rt = rt_handle;

            let pty_system = portable_pty::native_pty_system();
            let pair = match pty_system.openpty(portable_pty::PtySize {
                rows: init_rows,
                cols: init_cols,
                pixel_width: 0,
                pixel_height: 0,
            }) {
                Ok(p) => p,
                Err(e) => {
                    let ts = chrono_now();
                    let _ = store_clone.fail_session(&session_id_clone, -1, &e.to_string(), &ts);
                    let _ = event_tx_clone.send(Event::SessionFailed(SessionFailedEvent {
                        v: WIRE_VERSION, session_id: session_id_clone, reason: e.to_string(),
                        exit_code: -1, ts,
                    }));
                    return;
                }
            };

            // Build command
            let mut cmd = portable_pty::CommandBuilder::new(&argv[0]);
            for arg in &argv[1..] { cmd.arg(arg); }
            cmd.cwd(&cwd_clone);
            for (k, v) in &env_pairs { cmd.env(k, v); }

            // For claude_code, store agent_session_id from argv (pre-generated UUID)
            // Find --session-id in argv
            if let Some(pos) = argv.iter().position(|a| a == "--session-id") {
                if let Some(sid) = argv.get(pos + 1) {
                    let _ = store_clone.set_agent_session_id(&session_id_clone, sid);
                }
            }

            let mut child = match pair.slave.spawn_command(cmd) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[session {}] spawn failed: {}", session_id_clone, e);
                    let ts = chrono_now();
                    let _ = store_clone.fail_session(&session_id_clone, -1, &e.to_string(), &ts);
                    let _ = event_tx_clone.send(Event::SessionFailed(SessionFailedEvent {
                        v: WIRE_VERSION, session_id: session_id_clone, reason: e.to_string(),
                        exit_code: -1, ts,
                    }));
                    return;
                }
            };

            let pid = child.process_id().unwrap_or(0);
            let _ = rt.block_on(async { store_clone.update_session_pid(&session_id_clone, pid) });
            eprintln!("[session {}] spawned pid={} argv={:?}", session_id_clone, pid, argv);

            // Mark session running in store now that PTY is up.
            let _ = store_clone.update_session_status(&session_id_clone, "running");

            // Master is needed by writer (take_writer), reader (try_clone_reader), and the
            // resize thread. Wrap it in Arc<Mutex<>> so the resize thread can call resize()
            // while reader/writer hold their own clones.
            let mut pty_writer = pair.master.take_writer().unwrap();
            let mut reader = pair.master.try_clone_reader().unwrap();
            let master = std::sync::Arc::new(std::sync::Mutex::new(pair.master));

            // PTY writer thread
            let _sid_w = session_id_clone.clone();
            let rt_w = rt.clone();
            std::thread::spawn(move || {
                if let Some(init) = initial_input {
                    let _ = pty_writer.write_all(init.as_bytes());
                }
                loop {
                    let data = rt_w.block_on(input_rx.recv());
                    match data {
                        Some(d) => { if pty_writer.write_all(&d).is_err() { break; } }
                        None => break,
                    }
                }
            });

            // PTY resize handler — calls portable_pty resize(), which sends SIGWINCH to the child.
            let master_resize = master.clone();
            let sid_r = session_id_clone.clone();
            let rt_r = rt.clone();
            std::thread::spawn(move || {
                loop {
                    match rt_r.block_on(resize_rx.recv()) {
                        Some((cols, rows)) => {
                            let size = portable_pty::PtySize {
                                rows,
                                cols,
                                pixel_width: 0,
                                pixel_height: 0,
                            };
                            if let Ok(m) = master_resize.lock() {
                                if let Err(e) = m.resize(size) {
                                    eprintln!("[session {sid_r}] resize failed: {e}");
                                }
                            }
                        }
                        None => break,
                    }
                }
            });

            // Kill watcher — blocks on kill_rx.recv() and signals the child's
            // entire process group the moment a kill arrives. SIGTERM first so
            // well-behaved agents can clean up; if the group is still alive
            // after 250ms, SIGKILL. Either signal closes the PTY (once every
            // descendant releases the slave fd), which unparks the blocking
            // reader below with EOF; the post-loop path then runs
            // finish_session() within milliseconds.
            //
            // We deliberately target the process *group* (-pid), not just pid:
            // agent CLIs (Node.js claude, etc.) can fork subprocesses that
            // keep the PTY slave open. Killing only the leader leaves orphans
            // re-parented to init still holding the slave, so the daemon's
            // master read blocks forever and SessionFinished never fires.
            // portable-pty puts the child in its own session via setsid, so
            // pgid == pid and a negative-pid signal hits the whole tree.
            //
            // portable-pty's clone_killer() on Unix only sends SIGHUP to the
            // single pid, so we bypass it and use nix directly.
            let sid_k = session_id_clone.clone();
            let rt_k = rt.clone();
            let kill_pid = pid;
            std::thread::spawn(move || {
                if rt_k.block_on(kill_rx.recv()).is_none() {
                    return; // handle dropped — child already exited
                }
                if kill_pid == 0 {
                    return;
                }
                use nix::sys::signal::{kill, Signal};
                use nix::unistd::Pid;
                // Negative pid → signal the process group with that pgid.
                let pgrp = Pid::from_raw(-(kill_pid as i32));
                if let Err(e) = kill(pgrp, Signal::SIGTERM) {
                    eprintln!("[session {sid_k}] SIGTERM pgrp failed: {e}");
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
                // Probe the leader; ESRCH = the group is gone.
                let leader = Pid::from_raw(kill_pid as i32);
                if kill(leader, None).is_ok() {
                    if let Err(e) = kill(pgrp, Signal::SIGKILL) {
                        eprintln!("[session {sid_k}] SIGKILL pgrp failed: {e}");
                    }
                }
            });

            // PTY reader — blocking; one read per chunk
            let mut buf = vec![0u8; 4096];
            let mut seq: u64 = 0;
            let rt_read = rt;

            loop {
                let n = match reader.read(&mut buf) {
                    Ok(0) => break, // EOF (process exit OR killer.kill())
                    Ok(n) => n,
                    Err(_) => break,
                };

                let chunk = buf[..n].to_vec();
                let b64 = base64::engine::general_purpose::STANDARD.encode(&chunk);

                // Append to ring buffer
                rt_read.block_on(async {
                    let mut sessions = sessions_arc.write().await;
                    if let Some(h) = sessions.get_mut(&session_id_clone) {
                        let chunk_len = chunk.len();
                        h.ring.push_back(BufferChunk { seq, data: chunk.clone() });
                        h.ring_bytes += chunk_len;
                        // Evict old chunks if over budget
                        while h.ring_bytes > RING_BUFFER_BYTES {
                            if let Some(old) = h.ring.pop_front() {
                                h.ring_bytes -= old.data.len();
                            } else { break; }
                        }
                        h.last_output_at = std::time::Instant::now();
                        h.activity = ActivityState::Working;
                    }
                });

                let _ = event_tx_clone.send(Event::AgentOutput(AgentOutputEvent {
                    v: WIRE_VERSION,
                    session_id: session_id_clone.clone(),
                    seq,
                    data_b64: b64,
                }));
                seq += 1;
            }

            // Child exited. Once we've successfully spawned the PTY, treat any
            // exit as "finished" — non-zero exit codes (user pressed Ctrl-D /
            // SIGTERM from kill, agent CLI's own quit code, etc.) are normal
            // termination, not an error condition the UI should flag in red.
            let exit_code = child.wait().map(|s| {
                if s.success() { 0i32 } else { s.exit_code() as i32 }
            }).unwrap_or(-1);

            let ts = chrono_now();
            let _ = store_clone.finish_session(&session_id_clone, exit_code, &ts);
            let _ = event_tx_clone.send(Event::SessionFinished(SessionFinishedEvent {
                v: WIRE_VERSION, session_id: session_id_clone.clone(), exit_code, ts,
            }));

            // Remove from live sessions
            rt_read.block_on(async {
                sessions_arc.write().await.remove(&session_id_clone);
            });
        });

        // Activity timer — 1s tick per session
        let sessions_arc2 = self.sessions.clone();
        let session_id2 = session_id.clone();
        let event_tx2 = event_tx.clone();
        let idle_threshold = store.get_settings_all().map(|s| s.idle_threshold_s).unwrap_or(10);
        let awaiting_threshold = store.get_settings_all().map(|s| s.awaiting_threshold_s).unwrap_or(30);

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
            let mut unread_seq: u64 = 0;
            loop {
                interval.tick().await;
                let mut sessions = sessions_arc2.write().await;
                let Some(h) = sessions.get_mut(&session_id2) else { break };

                let elapsed = h.last_output_at.elapsed().as_secs();
                let new_activity = if elapsed >= awaiting_threshold as u64 {
                    ActivityState::AwaitingInput
                } else if elapsed >= idle_threshold as u64 {
                    ActivityState::Idle
                } else {
                    ActivityState::Working
                };

                // Get current max seq
                if let Some(last) = h.ring.back() {
                    unread_seq = last.seq;
                }

                h.activity = new_activity.clone();
                drop(sessions);

                let _ = event_tx2.send(Event::SessionActivity(SessionActivityEvent {
                    v: WIRE_VERSION,
                    session_id: session_id2.clone(),
                    state: new_activity,
                    unread_seq,
                    ts: chrono_now(),
                }));
            }
        });

        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn build_argv(profile: &DbProfile, resume_id: Option<&str>) -> Vec<String> {
    let binary = match profile.agent_type.as_str() {
        "claude_code" => "claude",
        "open_code" => "opencode",
        "codex" => "codex",
        other => other,
    };

    let params: Vec<serde_json::Value> = serde_json::from_str(&profile.params).unwrap_or_default();
    let mut argv = vec![binary.to_string()];

    // For claude_code: pre-generate session id
    if profile.agent_type == "claude_code" {
        if let Some(rid) = resume_id {
            argv.push("--resume".to_string());
            argv.push(rid.to_string());
        } else {
            let uuid = uuid::Uuid::new_v4().to_string();
            argv.push("--session-id".to_string());
            argv.push(uuid);
        }
    } else if profile.agent_type == "codex" {
        if let Some(rid) = resume_id {
            argv.push("resume".to_string());
            argv.push(rid.to_string());
        }
    } else if profile.agent_type == "open_code" {
        if let Some(rid) = resume_id {
            argv.push("run".to_string());
            argv.push("-i".to_string());
            argv.push("-s".to_string());
            argv.push(rid.to_string());
        }
    }

    // Add profile params
    for p in params {
        if let Some(flag) = p["flag"].as_str() {
            argv.push(flag.to_string());
            if let Some(val) = p["value"].as_str() {
                argv.push(val.to_string());
            }
        }
    }

    argv
}

fn parse_env(env_json: &str) -> Vec<(String, String)> {
    let pairs: Vec<serde_json::Value> = serde_json::from_str(env_json).unwrap_or_default();
    pairs.into_iter().filter_map(|e| {
        let k = e["key"].as_str()?.to_string();
        let v = e["value"].as_str()?.to_string();
        Some((k, v))
    }).collect()
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{}", d.as_secs())
}

use std::io::Read;
use std::io::Write;
