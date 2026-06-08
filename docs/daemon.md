# Daemon Architecture (Rust)

## 3.1 Cấu trúc module

```
daemon/
 ├── src/
 │   ├── main.rs          # entry point: parse args, init store, start server
 │   ├── server.rs        # Unix socket server, accept connections, dispatch
 │   ├── session.rs       # Session struct, PTY spawn, ring buffer, lifecycle
 │   ├── profile.rs       # AgentProfile, AgentType enum, argv resolver
 │   ├── store.rs         # SQLite (rusqlite), migrations
 │   ├── wire.rs          # Msg enum (serde_json), encode/decode JSON-line
 │   └── pid.rs           # PID file: write, check, cleanup
 └── Cargo.toml
```

## 3.2 Luồng chính

```rust
// Simplified
#[tokio::main]
async fn main() {
    pid::write("~/.agentry/daemon.pid");
    let store = Store::open("~/.agentry/daemon.db").await;
    let sessions = SessionManager::new(store.clone());
    let server = Server::new(sessions);
    server.listen("~/.agentry/daemon.sock").await;
}
```

`Server` chạy một task per connection. Mỗi connection có:
- Reader task: đọc JSON-line từ socket → dispatch cmd (gồm `send_input`/`resize` → ghi vào PTY) → ghi resp
- Writer task: nhận events từ broadcast channel → `agent_output` lọc theo focus, các event khác (gồm `session_activity`) gửi hết → ghi socket

`SessionManager` giữ `HashMap<SessionId, Session>`. Mỗi session:
- task đọc PTY output → ghi ring buffer (raw bytes) + broadcast `agent_output`, cập nhật `last_output_at`
- giữ handle PTY master để `send_input` (ghi stdin) và `resize`
- timer ~1s tính activity state → broadcast `session_activity` khi đổi

## 3.3 Dependencies Cargo

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.31", features = ["bundled"] }
portable-pty = "0.8"
uuid = { version = "1", features = ["v4"] }
base64 = "0.22"          # encode agent_output / read_buffer trên wire
notify = "6"             # watch ~/.codex/sessions/ để capture session ID
nix = "0.29"             # setsid detach process
```

## 3.4 PID file & daemon spawn

Path: `~/.agentry/daemon.pid`, `~/.agentry/daemon.sock`.

Tauri shim (`daemon.rs`):
1. Đọc PID file. Nếu tồn tại và `kill -0 <pid>` ok → reuse socket.
2. Nếu không, spawn: `Command::new("agentry-daemon").stdin(Null)...`, setsid, ghi PID.
3. Poll socket file xuất hiện (timeout 5s) → connect.

Daemon khi exit: xóa PID file và socket file.
