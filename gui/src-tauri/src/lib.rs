pub mod daemon;
pub mod socket;
pub mod relay;

use std::sync::Arc;
use tauri::Manager;

use crate::socket::Connection;

// State injected into Tauri commands.
struct AppState {
    conn: Arc<tokio::sync::Mutex<Option<Connection>>>,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        conn: Arc::new(tokio::sync::Mutex::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![send_cmd, focus_session])
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
