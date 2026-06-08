//! Filesystem watcher to capture codex CLI's session id from
//! ~/.codex/sessions/YYYY/MM/DD/rollout-...-<uuid>.jsonl on spawn.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use notify::{RecommendedWatcher, RecursiveMode, Watcher, EventKind};
use regex::Regex;
use tokio::sync::mpsc;

/// Spawn a tokio task that watches the codex sessions dir for the current day
/// and resolves with the captured UUID, or None on timeout.
///
/// `spawn_ts`: instant before we spawned codex. We ignore files created earlier
/// to avoid matching unrelated rollouts.
pub async fn capture_codex_session_id(
    spawn_ts: SystemTime,
    timeout: Duration,
) -> Option<String> {
    // Path: ~/.codex/sessions/<Y>/<M>/<D>/
    let now = chrono::Local::now();
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home)
        .join(".codex")
        .join("sessions")
        .join(now.format("%Y").to_string())
        .join(now.format("%m").to_string())
        .join(now.format("%d").to_string());

    // Codex creates this dir on first run; pre-create so we can watch it.
    let _ = std::fs::create_dir_all(&dir);

    let (tx, mut rx) = mpsc::unbounded_channel::<PathBuf>();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, EventKind::Create(_)) {
                for p in ev.paths {
                    let _ = tx.send(p);
                }
            }
        }
    }).ok()?;
    watcher.watch(&dir, RecursiveMode::NonRecursive).ok()?;

    let re = Regex::new(r"rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$").ok()?;

    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let remain = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remain.is_zero() { return None; }
        match tokio::time::timeout(remain, rx.recv()).await {
            Ok(Some(path)) => {
                // Filter by mtime to avoid stale rollouts.
                if let Ok(meta) = std::fs::metadata(&path) {
                    if let Ok(modified) = meta.modified() {
                        if modified + Duration::from_secs(2) < spawn_ts {
                            continue;
                        }
                    }
                }
                let name = path.file_name()?.to_string_lossy().to_string();
                if let Some(cap) = re.captures(&name) {
                    return Some(cap.get(1)?.as_str().to_string());
                }
            }
            _ => return None,
        }
    }
}