//! Lightweight Unix-socket server for agent integration hooks.
//!
//! Agents (claude, opencode, codex) call back via `~/.agentry/agent-hook.sock`
//! using simple newline-delimited JSON-RPC (no wire-version negotiation):
//!
//!   {"id":"...","method":"pane.report_agent_session","params":{
//!     "pane_id":"<session_id>","source":"agentry:claude","agent":"claude",
//!     "seq":1718000000000000,"agent_session_id":"<uuid>"}}
//!
//!   {"id":"...","method":"pane.report_agent","params":{
//!     "pane_id":"<session_id>","source":"agentry:claude","agent":"claude",
//!     "seq":...,"state":"working"|"idle"|"blocked"}}
//!
//!   {"id":"...","method":"pane.release_agent","params":{
//!     "pane_id":"<session_id>","source":"agentry:claude","agent":"claude","seq":...}}
//!
//! The server replies {"ok":true} on success and {"ok":false,"error":"..."} on
//! failure. Connections are short-lived fire-and-forget; scripts don't retry.

use std::path::PathBuf;
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use agentry_wire::{
    ActivityState, AgentSessionCapturedEvent, Event, FileTrackedEvent,
    SessionActivityEvent, SessionEventLoggedEvent, WIRE_VERSION,
};

use crate::server::EventTx;
use crate::session::SessionManager;
use crate::store::Store;

pub async fn run(
    store: Arc<Store>,
    sessions: Arc<SessionManager>,
    event_tx: EventTx,
    sock_path: PathBuf,
) -> anyhow::Result<()> {
    let _ = std::fs::remove_file(&sock_path);
    let listener = UnixListener::bind(&sock_path)?;
    tracing::info!("agent hook server listening on {}", sock_path.display());

    loop {
        let (stream, _) = listener.accept().await?;
        let store = store.clone();
        let sessions = sessions.clone();
        let event_tx = event_tx.clone();
        tokio::spawn(async move {
            if let Err(e) = handle(stream, store, sessions, event_tx).await {
                tracing::warn!("agent hook error: {e}");
            }
        });
    }
}

async fn handle(
    stream: UnixStream,
    store: Arc<Store>,
    sessions: Arc<SessionManager>,
    event_tx: EventTx,
) -> anyhow::Result<()> {
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);
    let mut line = String::new();

    reader.read_line(&mut line).await?;
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let msg: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(e) => {
            let r = serde_json::json!({"ok":false,"error":format!("parse_error: {e}")});
            let _ = write_half.write_all(format!("{r}\n").as_bytes()).await;
            return Ok(());
        }
    };

    let id = msg["id"].as_str().unwrap_or("?").to_string();
    let method = msg["method"].as_str().unwrap_or("").to_string();
    let params = &msg["params"];

    let result = dispatch(&method, params, &store, &sessions, &event_tx).await;
    let resp = match result {
        Ok(()) => serde_json::json!({"ok":true}),
        Err(e) => serde_json::json!({"ok":false,"error":e}),
    };
    // Include the request id in the response so callers can correlate if needed.
    let mut resp_obj = resp;
    resp_obj["id"] = serde_json::Value::String(id);
    let _ = write_half
        .write_all(format!("{resp_obj}\n").as_bytes())
        .await;
    Ok(())
}

async fn dispatch(
    method: &str,
    params: &serde_json::Value,
    store: &Arc<Store>,
    sessions: &Arc<SessionManager>,
    event_tx: &EventTx,
) -> Result<(), String> {
    let pane_id = params["pane_id"]
        .as_str()
        .ok_or("missing pane_id")?
        .to_string();

    match method {
        // ── Report agent session id (e.g. claude --session-id, opencode session.created) ──
        "pane.report_agent_session" => {
            let agent_session_id = params["agent_session_id"]
                .as_str()
                .ok_or("missing agent_session_id")?
                .to_string();
            if agent_session_id.is_empty() {
                return Err("empty agent_session_id".into());
            }
            let agent_session_name = params["agent_session_name"].as_str().map(str::to_string);

            store
                .set_agent_session_id(&pane_id, &agent_session_id)
                .map_err(|e| e.to_string())?;
            if let Some(ref name) = agent_session_name {
                store
                    .set_agent_session_name(&pane_id, name)
                    .map_err(|e| e.to_string())?;
            }

            let _ = event_tx.send(Event::AgentSessionCaptured(AgentSessionCapturedEvent {
                v: WIRE_VERSION,
                session_id: pane_id,
                agent_session_id,
                agent_session_name,
                ts: chrono_now(),
            }));
            Ok(())
        }

        // ── Report agent state (working / idle / blocked) ─────────────────
        "pane.report_agent" => {
            let state_str = params["state"].as_str().ok_or("missing state")?;
            let activity = parse_activity(state_str)?;

            let unread_seq = sessions
                .set_activity(&pane_id, activity.clone())
                .await
                .unwrap_or(0);

            let _ = event_tx.send(Event::SessionActivity(SessionActivityEvent {
                v: WIRE_VERSION,
                session_id: pane_id,
                state: activity,
                unread_seq,
                ts: chrono_now(),
            }));
            Ok(())
        }

        // ── Report a file touched by a tool (Write/Edit/...) ──────────────
        // The daemon records every reported file path, deduped per session.
        // Surfaces in the Inspector "Files" tab (searchable).
        "pane.report_file" => {
            let path = params["path"].as_str().ok_or("missing path")?.to_string();
            if path.is_empty() {
                return Err("empty path".into());
            }
            let name = path
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or(&path)
                .to_string();
            let tool = params["tool"].as_str().map(str::to_string);
            let ts = chrono_now();

            let inserted = store
                .insert_tracked_file(&pane_id, &path, &name, tool.as_deref(), &ts)
                .map_err(|e| e.to_string())?;
            // Only emit the event when a brand-new path was recorded so the UI
            // never lists the same file twice.
            if inserted {
                let _ = event_tx.send(Event::FileTracked(FileTrackedEvent {
                    v: WIRE_VERSION,
                    session_id: pane_id,
                    path,
                    name,
                    tool,
                    ts,
                }));
            }
            Ok(())
        }

        // ── Log a raw agent event (name + short detail) for the timeline ──
        "pane.report_event" => {
            let name = params["name"].as_str().ok_or("missing name")?.to_string();
            if name.is_empty() {
                return Err("empty name".into());
            }
            let detail = params["detail"].as_str().map(str::to_string);
            let ts = chrono_now();

            store
                .insert_session_event(&pane_id, &name, detail.as_deref(), &ts)
                .map_err(|e| e.to_string())?;

            let _ = event_tx.send(Event::SessionEventLogged(SessionEventLoggedEvent {
                v: WIRE_VERSION,
                session_id: pane_id,
                name,
                detail,
                ts,
            }));
            Ok(())
        }

        // ── Agent process exited / session deleted ────────────────────────
        "pane.release_agent" => {
            // Nothing to forcibly kill here — just clear the in-memory activity
            // to idle so the UI doesn't show "working" forever for a dead agent.
            let unread_seq = sessions
                .set_activity(&pane_id, ActivityState::Idle)
                .await
                .unwrap_or(0);
            let _ = event_tx.send(Event::SessionActivity(SessionActivityEvent {
                v: WIRE_VERSION,
                session_id: pane_id,
                state: ActivityState::Idle,
                unread_seq,
                ts: chrono_now(),
            }));
            Ok(())
        }

        other => Err(format!("unknown method: {other}")),
    }
}

fn parse_activity(s: &str) -> Result<ActivityState, String> {
    match s.to_ascii_lowercase().as_str() {
        "working" | "active" | "busy" | "pending" | "running" | "streaming" => {
            Ok(ActivityState::Working)
        }
        "idle" => Ok(ActivityState::Idle),
        "blocked" | "awaiting" | "awaiting_input" => Ok(ActivityState::AwaitingInput),
        other => Err(format!("unknown state: {other}")),
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", d.as_secs())
}
