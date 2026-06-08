//! Capture opencode session id by diffing `opencode session list` before/after spawn.

use std::collections::HashMap;
use std::time::Duration;
use tokio::process::Command;

/// Returns map: id -> title.
pub async fn snapshot() -> HashMap<String, String> {
    let out = Command::new("opencode")
        .arg("session")
        .arg("list")
        .output()
        .await;
    let mut map = HashMap::new();
    let Ok(o) = out else { return map };
    if !o.status.success() { return map }
    let stdout = String::from_utf8_lossy(&o.stdout);
    for line in stdout.lines() {
        // Expect rows like: "ses_xxx   <title>   <updated>"
        // Split on 2+ whitespace; first column = id, second = title.
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 { continue }
        let id = parts[0];
        if !id.starts_with("ses_") { continue }
        // Reconstruct title minus the timestamp tail (best-effort).
        let title = parts[1..parts.len().saturating_sub(1)].join(" ");
        map.insert(id.to_string(), title);
    }
    map
}

/// Poll until a new id appears, or timeout.
pub async fn capture_new(
    before: HashMap<String, String>,
    timeout: Duration,
) -> Option<(String, Option<String>)> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if tokio::time::Instant::now() >= deadline { return None }
        tokio::time::sleep(Duration::from_millis(200)).await;
        let after = snapshot().await;
        // Find ids in `after` not in `before`.
        let new_ids: Vec<&String> = after.keys().filter(|k| !before.contains_key(*k)).collect();
        if let Some(id) = new_ids.first() {
            let title = after.get(*id).cloned().filter(|s| !s.is_empty());
            return Some(((*id).clone(), title));
        }
    }
}