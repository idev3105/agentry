use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::SystemTime;

use tokio::process::{Child, Command};
use tokio::sync::Mutex;

pub const R9_PORT: u16 = 20128;
pub const R9_DASHBOARD_URL: &str = "http://localhost:20128/dashboard";

#[derive(Debug, Clone)]
pub enum R9Resolved {
    Direct(PathBuf),
    ViaNpx(PathBuf),
    Missing,
}

impl R9Resolved {
    pub fn detect() -> Self {
        if let Some(p) = which::which("9router").ok() {
            return R9Resolved::Direct(p);
        }
        if let Some(p) = which::which("npx").ok() {
            return R9Resolved::ViaNpx(p);
        }
        R9Resolved::Missing
    }

    pub fn label(&self) -> &'static str {
        match self {
            R9Resolved::Direct(_) => "9router",
            R9Resolved::ViaNpx(_) => "npx 9router",
            R9Resolved::Missing => "missing",
        }
    }

    pub fn build_cmd(&self) -> Option<Command> {
        match self {
            R9Resolved::Direct(p) => {
                let mut c = Command::new(p);
                c.kill_on_drop(false);
                Some(c)
            }
            R9Resolved::ViaNpx(p) => {
                let mut c = Command::new(p);
                c.arg("9router").kill_on_drop(false);
                Some(c)
            }
            R9Resolved::Missing => None,
        }
    }
}

#[derive(Debug)]
pub enum R9State {
    Stopped,
    Running {
        child: Option<Child>,
        pid: u32,
        started_at: SystemTime,
    },
}

impl Default for R9State {
    fn default() -> Self {
        R9State::Stopped
    }
}

pub type R9Slot = Arc<Mutex<R9State>>;

pub async fn port_open() -> bool {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};
    matches!(
        timeout(
            Duration::from_millis(200),
            TcpStream::connect(("127.0.0.1", R9_PORT)),
        )
        .await,
        Ok(Ok(_))
    )
}

pub async fn pid_on_port() -> Option<u32> {
    let out = Command::new("lsof")
        .args(["-t", "-iTCP:20128", "-sTCP:LISTEN"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    s.lines().next()?.trim().parse::<u32>().ok()
}

pub async fn kill_pid(pid: u32) -> anyhow::Result<()> {
    use tokio::time::{sleep, Duration};
    let _ = Command::new("kill")
        .arg(pid.to_string())
        .status()
        .await?;
    sleep(Duration::from_millis(2000)).await;
    if pid_still_alive(pid) {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status()
            .await?;
    }
    Ok(())
}

fn pid_still_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
