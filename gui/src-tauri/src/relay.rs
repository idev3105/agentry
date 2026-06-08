// Daemon → frontend relay.
//
// Reads one JSON message per line from the socket and dispatches:
//   - kind=event   → app.emit("daemon:<event_name>", payload)
//   - kind=resp    → fulfill pending oneshot in `socket::Pending`

use tokio::io::AsyncBufReadExt;
use tauri::{AppHandle, Emitter};

use crate::socket::ReadSide;

pub async fn run(read: ReadSide, app: AppHandle) -> anyhow::Result<()> {
    let ReadSide { mut reader, pending } = read;
    let mut line = String::new();

    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            tracing::warn!("daemon closed socket");
            return Ok(());
        }

        let value: serde_json::Value = match serde_json::from_str(line.trim()) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("malformed daemon line: {e} — {}", line.trim());
                continue;
            }
        };

        match value.get("kind").and_then(|k| k.as_str()) {
            Some("event") => emit_event(&app, &value),
            Some("resp") => {
                let id = value.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if let Some(tx) = pending.lock().await.remove(&id) {
                    let _ = tx.send(value);
                } else {
                    tracing::warn!("orphan resp id={id}");
                }
            }
            other => tracing::warn!("unknown kind={:?}", other),
        }
    }
}

fn emit_event(app: &AppHandle, v: &serde_json::Value) {
    let event_name = match v.get("event").and_then(|e| e.as_str()) {
        Some(s) => s,
        None => {
            tracing::warn!("event message missing `event` field: {v}");
            return;
        }
    };
    let topic = format!("daemon:{event_name}");
    if let Err(e) = app.emit(&topic, v.clone()) {
        tracing::warn!("emit({topic}) failed: {e}");
    }
}
