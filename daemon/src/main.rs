mod store;
mod pid;
mod server;
mod session;
mod profile;
#[cfg(unix)]
mod codex_watch;
#[cfg(unix)]
mod opencode_capture;

use std::sync::Arc;

#[cfg(unix)]
mod unix_impl {
    use super::*;
    use crate::store::Store;
    use crate::session::SessionManager;
    use crate::server::Server;
    // ... rest of the content remains same ...


    pub async fn run() -> anyhow::Result<()> {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let agentry_dir = format!("{home}/.agentry");
        std::fs::create_dir_all(&agentry_dir)?;

        let sock_path = format!("{agentry_dir}/daemon.sock");
        let db_path = format!("{agentry_dir}/daemon.db");

        if pid::is_running(&agentry_dir) {
            eprintln!("agentry-daemon already running");
            std::process::exit(1);
        }

        let store = Arc::new(Store::open(&db_path)?);
        let sessions = SessionManager::new();
        let server = Arc::new(Server::new(store, sessions));

        pid::write(&agentry_dir, std::process::id())?;

        let agentry_dir_clone = agentry_dir.clone();
        ctrlc::set_handler(move || {
            pid::cleanup(&agentry_dir_clone);
            std::process::exit(0);
        }).ok();

        eprintln!("agentry-daemon listening on {sock_path}");
        server.listen(&sock_path).await?;

        pid::cleanup(&agentry_dir);
        Ok(())
    }
}

#[cfg(windows)]
mod windows_impl {
    pub async fn run() -> anyhow::Result<()> {
        eprintln!("agentry-daemon: Unix sockets are required and not supported on Windows yet");
        std::process::exit(1);
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    #[cfg(unix)]
    { unix_impl::run().await }
    #[cfg(windows)]
    { windows_impl::run().await }
}
