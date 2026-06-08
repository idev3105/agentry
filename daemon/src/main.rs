mod store;
mod pid;
mod server;
mod session;
mod profile;

use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let agentry_dir = format!("{home}/.agentry");
    std::fs::create_dir_all(&agentry_dir)?;

    let sock_path = format!("{agentry_dir}/daemon.sock");
    let db_path = format!("{agentry_dir}/daemon.db");

    // Single-instance: check if already running
    if pid::is_running(&agentry_dir) {
        eprintln!("agentry-daemon already running");
        std::process::exit(1);
    }

    let store = Arc::new(store::Store::open(&db_path)?);
    let sessions = session::SessionManager::new();
    let server = Arc::new(server::Server::new(store, sessions));

    // Write PID after setup
    pid::write(&agentry_dir, std::process::id())?;

    // Cleanup on exit
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
