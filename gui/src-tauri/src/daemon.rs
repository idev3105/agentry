// Spawn-or-attach the `agentry-daemon` Unix-socket service.
//
// Strategy:
//   1) Read $HOME/.agentry/daemon.pid.
//   2) If PID alive (kill -0):
//        - if socket already there  → attach
//        - else                     → wait briefly (maybe still binding); if it
//          never appears, kill the stale process and spawn fresh.
//   3) Otherwise spawn the daemon binary detached, then poll up to ~3s for
//      the socket to appear.
//
// Resolution order for the daemon binary:
//   AGENTRY_DAEMON_BIN env var → ./target/debug/agentry-daemon (dev)
//   → ./target/release/agentry-daemon → "agentry-daemon" on PATH.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub struct DaemonHandle {
    pub sock_path: String,
    pub agentry_dir: String,
}

pub async fn ensure_running() -> anyhow::Result<DaemonHandle> {
    let home = std::env::var("HOME")?;
    let agentry_dir = format!("{home}/.agentry");
    std::fs::create_dir_all(&agentry_dir)?;

    let sock_path = format!("{agentry_dir}/daemon.sock");
    let pid_path = format!("{agentry_dir}/daemon.pid");

    // Already-running case.
    if let Some(pid) = read_pid(&pid_path) {
        if alive(pid) {
            // Wait briefly for socket — daemon may be mid-startup.
            if Path::new(&sock_path).exists() || wait_for_socket(&sock_path, 1500).await {
                tracing::info!("attaching to existing daemon at {sock_path}");
                return Ok(DaemonHandle { sock_path, agentry_dir });
            }
            // PID alive but socket never showed up → daemon is stuck/wedged.
            tracing::warn!("daemon pid {pid} alive but no socket; killing it");
            unsafe {
                kill(pid, 15); // SIGTERM
            }
            // Give it a moment to release the pidfile.
            for _ in 0..20 {
                if !alive(pid) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            if alive(pid) {
                unsafe {
                    kill(pid, 9); // SIGKILL
                }
            }
        }
    }

    // Stale pid/socket — clean and spawn.
    let _ = std::fs::remove_file(&sock_path);
    let _ = std::fs::remove_file(&pid_path);

    let bin = resolve_daemon_bin()?;
    tracing::info!("spawning agentry-daemon: {}", bin.display());

    let log_path = format!("{agentry_dir}/daemon.log");
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let log2 = log.try_clone()?;

    Command::new(&bin)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log2))
        .spawn()
        .map_err(|e| anyhow::anyhow!("failed to spawn {}: {e}", bin.display()))?;

    if wait_for_socket(&sock_path, 3000).await {
        tracing::info!("daemon socket ready: {sock_path}");
        return Ok(DaemonHandle { sock_path, agentry_dir });
    }

    anyhow::bail!("daemon did not create socket within 3s; see {log_path}");
}

async fn wait_for_socket(sock_path: &str, timeout_ms: u64) -> bool {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    while Instant::now() < deadline {
        if Path::new(sock_path).exists() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

fn read_pid(pid_path: &str) -> Option<i32> {
    std::fs::read_to_string(pid_path).ok()?.trim().parse().ok()
}

fn alive(pid: i32) -> bool {
    // kill -0 signal probe; ESRCH means dead.
    unsafe { kill(pid, 0) == 0 }
}

extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

fn resolve_daemon_bin() -> anyhow::Result<PathBuf> {
    if let Ok(p) = std::env::var("AGENTRY_DAEMON_BIN") {
        return Ok(PathBuf::from(p));
    }

    // current_exe is .../target/debug/agentry-gui — daemon sits next to it.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["agentry-daemon", "agentry-daemon.exe"] {
                let p = dir.join(name);
                if p.exists() {
                    return Ok(p);
                }
            }
        }
    }

    // Dev fallback: cwd's target/{debug,release}/agentry-daemon.
    let cwd = std::env::current_dir()?;
    for rel in ["target/debug/agentry-daemon", "target/release/agentry-daemon"] {
        let p = cwd.join(rel);
        if p.exists() {
            return Ok(p);
        }
        // workspace one level up (gui/src-tauri → workspace root)
        let up = cwd.join("..").join("..").join(rel);
        if up.exists() {
            return Ok(up);
        }
    }

    Ok(PathBuf::from("agentry-daemon"))
}
