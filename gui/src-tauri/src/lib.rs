pub mod daemon;
pub mod socket;
pub mod relay;
pub mod r9;

use std::sync::Arc;
use tauri::Manager;

use crate::socket::Connection;

// State injected into Tauri commands.
struct AppState {
    conn: Arc<tokio::sync::Mutex<Option<Connection>>>,
    r9: r9::R9Slot,
    r9_resolved: r9::R9Resolved,
}

#[tauri::command]
async fn send_cmd(
    cmd: serde_json::Value,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let conn = {
        let guard = state.conn.lock().await;
        guard.clone().ok_or_else(|| "daemon not connected".to_string())?
    };

    // Wrap user payload into a CmdEnvelope: {v,id,kind:"cmd", ...cmd}
    let id = uuid::Uuid::new_v4().to_string();
    let mut envelope = match cmd {
        serde_json::Value::Object(map) => map,
        _ => return Err("cmd must be an object".into()),
    };
    envelope.insert("v".into(), serde_json::json!(agentry_wire::WIRE_VERSION));
    envelope.insert("id".into(), serde_json::json!(id));
    envelope.insert("kind".into(), serde_json::json!("cmd"));

    let line = serde_json::to_string(&envelope)
        .map_err(|e| format!("encode error: {e}"))?;

    let resp = conn
        .rpc(id, line)
        .await
        .map_err(|e| format!("rpc error: {e}"))?;

    Ok(resp)
}

#[tauri::command]
async fn focus_session(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let cmd = serde_json::json!({
        "cmd": "focus",
        "session_id": session_id,
    });
    send_cmd(cmd, state).await
}

// ── 9Router lifecycle commands ────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct R9StatusResp {
    resolved: String,
    running: bool,
    pid: Option<u32>,
    port: u16,
}

#[tauri::command]
async fn r9_status(state: tauri::State<'_, AppState>) -> Result<R9StatusResp, String> {
    let r9 = state.r9.lock().await;
    let running = matches!(*r9, r9::R9State::Running { .. }) || r9::port_open().await;
    let pid = match &*r9 {
        r9::R9State::Running { pid, .. } => Some(*pid),
        _ => r9::pid_on_port().await,
    };
    Ok(R9StatusResp {
        resolved: state.r9_resolved.label().to_string(),
        running,
        pid,
        port: r9::R9_PORT,
    })
}

#[tauri::command]
async fn r9_start(state: tauri::State<'_, AppState>) -> Result<R9StatusResp, String> {
    // First, check under lock if already running
    {
        let r9 = state.r9.lock().await;
        if let r9::R9State::Running { pid, .. } = *r9 {
            return Ok(R9StatusResp {
                resolved: state.r9_resolved.label().to_string(),
                running: true,
                pid: Some(pid),
                port: r9::R9_PORT,
            });
        }
    }

    // Check if port is open (without lock)
    if r9::port_open().await {
        // Port is open, try to adopt
        if let Some(pid) = r9::pid_on_port().await {
            // Lock to update state
            let mut r9 = state.r9.lock().await;
            // Double-check state in case it changed
            if let r9::R9State::Stopped = *r9 {
                *r9 = r9::R9State::Running {
                    child: None,
                    pid,
                    started_at: std::time::SystemTime::now(),
                };
            }
            // Return status
            return Ok(R9StatusResp {
                resolved: state.r9_resolved.label().to_string(),
                running: true,
                pid: Some(pid),
                port: r9::R9_PORT,
            });
        }
    }

    // Not running and port not open (or we couldn't get pid). Try to spawn.
    let resolved = &state.r9_resolved;
    let label = resolved.label();
    let mut cmd = resolved
        .build_cmd()
        .ok_or_else(|| "9router not installed. Run `npm i -g 9router` first.".to_string())?;

    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    let mut child = cmd.spawn().map_err(|e| format!("spawn {label} failed: {e}"))?;
    let pid = child.id().ok_or_else(|| "failed to get child pid".to_string())?;

    // Wait up to 3 s for port to open
    use tokio::time::{sleep, Duration};
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    loop {
        if r9::port_open().await {
            break;
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill().await;
            return Err("9router failed to listen on port 20128 within 3 s".to_string());
        }
        sleep(Duration::from_millis(300)).await;
    }

    // Now we have a running process. Lock and update state.
    let mut r9 = state.r9.lock().await;
    *r9 = r9::R9State::Running {
        child: Some(child),
        pid,
        started_at: std::time::SystemTime::now(),
    };

    Ok(R9StatusResp {
        resolved: label.to_string(),
        running: true,
        pid: Some(pid),
        port: r9::R9_PORT,
    })
}

#[tauri::command]
async fn r9_stop(state: tauri::State<'_, AppState>) -> Result<R9StatusResp, String> {
    // Probe port before lock so we don't hold lock across async
    let maybe_port_pid = r9::pid_on_port().await;

    let pid_to_kill: Option<u32>;
    let child_to_kill: Option<tokio::process::Child>;
    {
        let mut guard = state.r9.lock().await;
        match &mut *guard {
            r9::R9State::Running { pid, child, .. } => {
                pid_to_kill = Some(*pid);
                child_to_kill = child.take();
                *guard = r9::R9State::Stopped;
            }
            _ => {
                pid_to_kill = None;
                child_to_kill = None;
            }
        }
    }

    let pid = pid_to_kill.or(maybe_port_pid);

    if let Some(mut child) = child_to_kill {
        let _ = child.kill().await;
    }

    if let Some(pid) = pid {
        let _ = r9::kill_pid(pid).await;
    }

    Ok(R9StatusResp {
        resolved: state.r9_resolved.label().to_string(),
        running: false,
        pid: None,
        port: r9::R9_PORT,
    })
}

/// Enumerate font families installed on the host system, sorted and
/// deduplicated. Used by the GUI font picker so users can choose any
/// installed font instead of a fixed preset list. Best-effort: returns an
/// empty list rather than erroring if the platform source is unavailable.
#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    use font_kit::source::SystemSource;
    let source = SystemSource::new();
    let mut names = match source.all_families() {
        Ok(n) => n,
        Err(e) => {
            tracing::warn!("font enumeration failed: {e}");
            return Vec::new();
        }
    };
    names.sort_by_key(|s| s.to_lowercase());
    names.dedup();
    names
}

#[tauri::command]
async fn r9_open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(r9::R9_DASHBOARD_URL, None::<&str>)
        .map_err(|e| format!("failed to open dashboard: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        conn: Arc::new(tokio::sync::Mutex::new(None)),
        r9: Arc::new(tokio::sync::Mutex::new(r9::R9State::default())),
        r9_resolved: r9::R9Resolved::detect(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            send_cmd,
            focus_session,
            r9_status,
            r9_start,
            r9_stop,
            r9_open_dashboard,
            list_system_fonts
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let state: tauri::State<'_, AppState> = app.state();
            let conn_slot = state.conn.clone();

            // Spawn daemon-attach + socket-read on Tauri's tokio runtime.
            tauri::async_runtime::spawn(async move {
                if let Err(e) = bootstrap(handle.clone(), conn_slot).await {
                    tracing::error!("daemon bootstrap failed: {e:#}");
                    let _ = handle.emit("daemon:bootstrap_error", e.to_string());
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn bootstrap(
    app: tauri::AppHandle,
    conn_slot: Arc<tokio::sync::Mutex<Option<Connection>>>,
) -> anyhow::Result<()> {
    let handle = daemon::ensure_running().await?;
    let (conn, read) = socket::connect(&handle.sock_path).await?;

    *conn_slot.lock().await = Some(conn);

    let _ = app.emit("daemon:connected", serde_json::json!({
        "sock_path": handle.sock_path,
    }));

    relay::run(read, app).await?;
    Ok(())
}

use tauri::Emitter;
