# Remote Phase R1 — Daemon transport: WebSocket trên Tailscale (Junior Edition*)

> *R1 đụng backend tokio — nếu chưa quen async Rust, làm cùng senior. Đọc `2026-06-12_remote-INDEX.md` trước. Mỗi task = 1 commit. Sau mỗi task: `mise run check` xanh + desktop GUI vẫn chạy (`mise run dev`).

**Goal:** Daemon nghe thêm WebSocket trên Tailscale IP (cùng wire protocol JSON-line với Unix socket), serve webapp static, có lệnh wire bật/tắt + đọc trạng thái remote.

**Tech:** tokio, tokio-tungstenite (WS), axum KHÔNG dùng (giữ deps mỏng — tự handle HTTP upgrade bằng tungstenite + serve static bằng hyper-lite? KHÔNG — xem T1.2: dùng `axum` cho gọn, 1 dep kéo theo hyper/tower nhưng tiết kiệm nhiều code tay).

**Quyết định dep (đã chốt):** thêm `axum` (ws feature) + `tower-http` (ServeDir) + `local-ip-address` (tìm Tailscale IP). Lý do: axum WS + static serving ổn định, ít code hơn tự viết HTTP/upgrade; tradeoff binary lớn hơn chấp nhận được.

---

## Task R1.1 — Wire: thêm SetRemoteAccess / GetRemoteStatus (4 FILES SYNC)

**Risk:** medium · **Time:** ~1h

⚠️ **Đây là wire-protocol change — 4 files PHẢI đổi cùng nhau** (AGENTS.md): `crates/wire/src/lib.rs`, `daemon/src/server.rs` (dispatch — làm ở R1.5), `gui/src/lib/types.ts`, `gui/src/lib/ipc.ts`. KHÔNG bump WIRE_VERSION (thêm variant mới không breaking — client cũ không gửi cmd mới).

**Files:**
- Modify: `crates/wire/src/lib.rs`
- Modify: `gui/src/lib/types.ts`
- Modify: `gui/src/lib/ipc.ts`

### R1.1.1 — wire lib.rs

Thêm vào enum `Cmd` (sau `SetDefaultProfile(SetDefaultProfileCmd),` dòng ~62):

```rust
    // Remote access
    SetRemoteAccess(SetRemoteAccessCmd),
    GetRemoteStatus,
```

Thêm struct (cạnh `SetDefaultProfileCmd` dòng ~174-177):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetRemoteAccessCmd {
    pub enabled: bool,
}
```

> serde tag `cmd` + `rename_all = "snake_case"` tự sinh `set_remote_access` / `get_remote_status` — không cần attribute thêm.

### R1.1.2 — gui types.ts

Thêm type (cạnh `Settings`):

```ts
export interface RemoteStatus {
	enabled: boolean;
	listening: boolean;
	address: string | null;   // "100.x.y.z:4517" when listening
	hostname: string | null;  // tailnet machine name if resolvable
	error: string | null;     // why listening failed (e.g. no tailscale iface)
}
```

### R1.1.3 — gui ipc.ts

Thêm wrappers (theo pattern `sendCmd` hiện có — đọc hàm `getSettings` làm mẫu):

```ts
export async function setRemoteAccess(enabled: boolean): Promise<void> {
	await sendCmd({ cmd: 'set_remote_access', enabled });
}

export async function getRemoteStatus(): Promise<RemoteStatus> {
	const r = await sendCmd({ cmd: 'get_remote_status' });
	return r.remote as RemoteStatus;
}
```

> Đọc `sendCmd` + 1 wrapper có resp (vd `listProjects` lấy `r.projects`) để khớp shape unwrap thật. Import `RemoteStatus` từ types.

### Verify
```bash
cargo check -p agentry-wire && cd gui && pnpm check
```
Expected: xanh cả hai. **If fail:** thiếu `#[derive(...)]`; TS import thiếu.

### Commit
```bash
git add crates/wire/src/lib.rs gui/src/lib/types.ts gui/src/lib/ipc.ts && git commit -m "feat(wire): set_remote_access + get_remote_status commands"
```

---

## Task R1.2 — Cargo deps + module remote.rs skeleton

**Risk:** low · **Time:** ~30m

**Files:**
- Modify: `daemon/Cargo.toml`
- Create: `daemon/src/remote.rs`
- Modify: `daemon/src/main.rs` (thêm `mod remote;`)

### R1.2.1 — Cargo.toml

Thêm vào `[dependencies]` của `daemon/Cargo.toml`:

```toml
axum         = { version = "0.7", features = ["ws"] }
tower-http   = { version = "0.5", features = ["fs"] }
local-ip-address = "0.6"
```

Chạy `cargo check -p agentry-daemon` để xác nhận version compile được — nếu conflict, dùng version mới nhất tương thích (cargo sẽ gợi ý).

### R1.2.2 — remote.rs skeleton

```rust
//! Remote access transport: WebSocket bridge over the Tailscale interface.
//! Speaks the same JSON-line wire protocol as the Unix socket — one WS text
//! frame == one line. Serves the static remote webapp at /.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

pub const REMOTE_PORT: u16 = 4517;

/// Find this machine's Tailscale IPv4 (CGNAT range 100.64.0.0/10).
/// Returns None when Tailscale isn't up on any interface.
pub fn tailscale_ipv4() -> Option<Ipv4Addr> {
    let ifaces = local_ip_address::list_afinet_netifas().ok()?;
    ifaces.into_iter().find_map(|(_name, ip)| match ip {
        IpAddr::V4(v4) if is_cgnat(v4) => Some(v4),
        _ => None,
    })
}

fn is_cgnat(ip: Ipv4Addr) -> bool {
    // 100.64.0.0/10 → first octet 100, second octet 64..=127
    ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1])
}

pub fn remote_addr() -> Option<SocketAddr> {
    tailscale_ipv4().map(|ip| SocketAddr::new(IpAddr::V4(ip), REMOTE_PORT))
}
```

> Unit test nhanh để verify: 100.64.0.1 → true, 100.127.255.255 → true, 100.128.0.1 → false, 192.168.1.1 → false.

### R1.2.3 — main.rs

```rust
mod remote;
```

### Verify
```bash
cargo check -p agentry-daemon
```
**If fail:** version conflict deps → `cargo tree -i <crate>` xem ai kéo; đổi version theo gợi ý cargo.

### Commit
```bash
git add daemon/Cargo.toml daemon/src/remote.rs daemon/src/main.rs Cargo.lock && git commit -m "feat(daemon): remote module skeleton + tailscale ip detection"
```

---

## Task R1.3 — Tách connection handling dùng chung cho Unix socket + WS

**Risk:** HIGH · **Time:** ~3h · **Đây là task khó nhất R1**

**Vấn đề:** `Server::handle_connection` (server.rs:50-134) nhận `UnixStream` cụ thể. WS connection không phải stream byte mà là frame-based. Cách rẻ nhất KHÔNG phải generic hoá stream — mà tách phần "xử lý 1 dòng JSON → resp line" + "filter event per-connection" ra hàm public, để WS handler gọi lại.

**Approach:** thêm 2 hàm public vào `impl Server`:
1. `pub async fn handle_line(&self, line: &str, focused: &Arc<RwLock<Option<String>>>) -> Option<String>` — parse 1 dòng, version check, dispatch, trả resp line (logic = thân vòng reader hiện tại, server.rs:103-129).
2. `pub fn subscribe_events(&self) -> EventRx` + `pub fn event_passes(event: &Event, focused: &Option<String>) -> bool` — logic filter agent_output (server.rs:73-79) tách thành hàm tĩnh để WS writer dùng.

**Files:**
- Modify: `daemon/src/server.rs`

### R1.3.1 — Tách filter event

**Before** (server.rs:73-79, trong writer task):
```rust
                        if let Event::AgentOutput(ref ao) = event {
                            let f = focused_for_writer.read().await;
                            match f.as_ref() {
                                Some(sid) if sid == &ao.session_id => {}
                                _ => continue,
                            }
                        }
```

**After:** thêm hàm vào `impl Server` (sau `event_sender`):
```rust
    /// Per-connection event filter: agent_output only goes to the connection
    /// focused on that session; every other event goes to everyone.
    pub fn event_passes(event: &Event, focused: &Option<String>) -> bool {
        if let Event::AgentOutput(ao) = event {
            matches!(focused.as_ref(), Some(sid) if sid == &ao.session_id)
        } else {
            true
        }
    }

    pub fn subscribe_events(&self) -> EventRx {
        self.event_tx.subscribe()
    }
```
Và thay block trong writer task bằng:
```rust
                        {
                            let f = focused_for_writer.read().await;
                            if !Self::event_passes(&event, &f) { continue; }
                        }
```
(Xoá `#[allow(dead_code)]` trên `EventRx` nếu giờ được dùng.)

### R1.3.2 — Tách handle_line

**Before** (server.rs:103-129 — thân vòng reader, từ `let msg = match serde_json::from_str...` đến `let _ = w.write_all(resp_msg.as_bytes()).await;`).

**After:** thêm method:
```rust
    /// Process one JSON-line message; returns the response line (with trailing \n)
    /// or None for non-cmd messages.
    pub async fn handle_line(
        self: &Arc<Self>,
        line: &str,
        focused: &Arc<RwLock<Option<String>>>,
    ) -> Option<String> {
        let msg = match serde_json::from_str::<Message>(line.trim()) {
            Ok(m) => m,
            Err(e) => {
                return Some(format!(
                    "{}\n",
                    serde_json::json!({"v":1,"kind":"resp","id":"?","ok":false,"error":format!("parse_error: {e}")})
                ));
            }
        };
        let Message::Cmd(envelope) = msg else { return None; };
        if envelope.v > WIRE_VERSION {
            return Some(format!(
                "{}\n",
                serde_json::json!({"v":1,"kind":"resp","id":envelope.id,"ok":false,"error":"unsupported_version"})
            ));
        }
        let id = envelope.id.clone();
        let resp = self.dispatch(envelope, focused).await;
        Some(build_resp(&id, resp))
    }
```
Rồi rút gọn vòng reader trong `handle_connection` thành:
```rust
        loop {
            line.clear();
            let n = reader.read_line(&mut line).await?;
            if n == 0 { break; }
            if let Some(resp) = self.handle_line(&line, &focused_session).await {
                let mut w = write_half.lock().await;
                let _ = w.write_all(resp.as_bytes()).await;
            }
        }
```

> **Foot-gun:** `build_resp` đã append `\n`? Đọc `build_resp` (server.rs:465) xác nhận — nếu nó CHƯA append newline thì `handle_line` phải tự thêm, và nhánh Unix giữ nguyên hành vi cũ. Đừng để double-newline.

### Verify
```bash
mise run check && mise run dev
```
Manual: desktop GUI hoạt động y nguyên (list project, start session, gõ input, kill). Đây là refactor thuần — zero behavior change.
**If fail:** sai chữ ký `self: &Arc<Self>` vs `&self` — `dispatch` cần `&self`, giữ nguyên; mismatch newline → so output `mise run cli -- <cmd>` trước/sau refactor.

### Commit
```bash
git add daemon/src/server.rs && git commit -m "refactor(daemon): extract handle_line + event_passes for transport reuse"
```

---

## Task R1.4 — WS server trong remote.rs (axum router + bridge)

**Risk:** HIGH · **Time:** ~3h

**Files:**
- Modify: `daemon/src/remote.rs`

### R1.4.1 — Router + listener có thể tắt/bật

Thêm vào `remote.rs`:

```rust
use std::sync::Arc;
use axum::{
    extract::{ws::{Message as WsMessage, WebSocket}, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use tokio::sync::{watch, RwLock};
use tower_http::services::ServeDir;

use crate::server::Server;

pub struct RemoteHandle {
    shutdown_tx: watch::Sender<bool>,
    pub addr: std::net::SocketAddr,
}

/// Start the remote listener. Returns a handle used to stop it.
pub async fn start(server: Arc<Server>, static_dir: std::path::PathBuf) -> anyhow::Result<RemoteHandle> {
    let addr = remote_addr().ok_or_else(|| anyhow::anyhow!("tailscale interface not found"))?;
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .fallback_service(ServeDir::new(static_dir))
        .with_state(server);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("remote listening on http://{addr}");

    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move { let _ = shutdown_rx.changed().await; })
            .await
            .ok();
    });

    Ok(RemoteHandle { shutdown_tx, addr })
}

impl RemoteHandle {
    pub fn stop(&self) { let _ = self.shutdown_tx.send(true); }
}

async fn ws_handler(ws: WebSocketUpgrade, State(server): State<Arc<Server>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, server))
}
```

### R1.4.2 — handle_ws: bridge frame ↔ JSON-line

```rust
async fn handle_ws(socket: WebSocket, server: Arc<Server>) {
    use futures::{SinkExt, StreamExt};
    let (mut tx, mut rx) = socket.split();

    let focused: Arc<RwLock<Option<String>>> = Arc::new(RwLock::new(None));
    let mut event_rx = server.subscribe_events();
    let focused_for_writer = focused.clone();

    // outgoing: daemon events → WS text frames
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<String>(64);
    let event_out = out_tx.clone();
    let writer = tokio::spawn(async move {
        while let Some(line) = out_rx.recv().await {
            if tx.send(WsMessage::Text(line)).await.is_err() { break; }
        }
    });
    let event_task = tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(event) => {
                    {
                        let f = focused_for_writer.read().await;
                        if !crate::server::Server::event_passes(&event, &f) { continue; }
                    }
                    let Ok(s) = serde_json::to_string(&agentry_wire::Message::Event(event)) else { continue };
                    if event_out.send(s).await.is_err() { break; }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });

    // incoming: WS text frames → handle_line → resp frame
    while let Some(Ok(msg)) = rx.next().await {
        if let WsMessage::Text(line) = msg {
            if let Some(resp) = server.handle_line(&line, &focused).await {
                if out_tx.send(resp.trim_end().to_string()).await.is_err() { break; }
            }
        }
    }

    writer.abort();
    event_task.abort();
}
```

> **Foot-guns:**
> - `futures` crate đã trong deps daemon (Cargo.toml dòng 21) — `use futures::{SinkExt, StreamExt}` OK.
> - WS frame KHÔNG cần `\n` — `trim_end()` resp trước khi gửi.
> - Event task + writer task phải abort khi conn đóng — như `writer_task.abort()` của Unix path.
> - mpsc 64: backpressure đơn giản; nếu client chậm → drop conn (send err → break) thay vì OOM.

### Verify
```bash
mise run check
```
Compile sạch là đạt — chưa chạy được vì chưa wire vào main (R1.5).

### Commit
```bash
git add daemon/src/remote.rs && git commit -m "feat(daemon): axum ws bridge + static serving for remote clients"
```

---

## Task R1.5 — Dispatch set_remote_access / get_remote_status + lifecycle

**Risk:** HIGH · **Time:** ~2h

**Mục tiêu:** Daemon giữ `Option<RemoteHandle>`, bật/tắt qua cmd, persist enabled vào settings, trả status.

**Files:**
- Modify: `daemon/src/server.rs` (state + dispatch 2 cmd mới)
- Modify: `daemon/src/store.rs` (persist remote_enabled — nếu chưa có settings KV thì thêm)
- Modify: `daemon/src/migrations.sql` (nếu cần cột/bảng settings)

**Đọc trước:** `daemon/src/store.rs` xem có bảng `settings` KV chưa (grep `settings`); `daemon/src/migrations.sql` schema. Nếu đã có cơ chế settings (max_concurrent... đang đọc từ đâu?) thì tái dùng; nếu hardcode thì thêm 1 KV `remote_enabled`.

### R1.5.1 — State trong Server

`Server` cần giữ remote handle. Vì `dispatch` là `&self`, dùng interior mutability:

**Before** (server.rs:17-27):
```rust
pub struct Server {
    store: Arc<Store>,
    sessions: Arc<SessionManager>,
    event_tx: EventTx,
}

impl Server {
    pub fn new(store: Arc<Store>, sessions: Arc<SessionManager>) -> Self {
        let (event_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        Server { store, sessions, event_tx }
    }
```

**After:**
```rust
pub struct Server {
    store: Arc<Store>,
    sessions: Arc<SessionManager>,
    event_tx: EventTx,
    remote: tokio::sync::Mutex<Option<crate::remote::RemoteHandle>>,
    static_dir: std::path::PathBuf,
}

impl Server {
    pub fn new(store: Arc<Store>, sessions: Arc<SessionManager>, static_dir: std::path::PathBuf) -> Self {
        let (event_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        Server { store, sessions, event_tx, remote: tokio::sync::Mutex::new(None), static_dir }
    }
```

> `Server::new` đổi chữ ký → cập nhật caller trong `main.rs` (truyền `static_dir`, vd `~/.agentry/webapp` hoặc đường dẫn build webapp R3). Grep `Server::new` tìm caller.

### R1.5.2 — enable/disable helper

Thêm method:
```rust
    pub async fn enable_remote(self: &Arc<Self>) -> Result<(), String> {
        let mut guard = self.remote.lock().await;
        if guard.is_some() { return Ok(()); } // already on
        let handle = crate::remote::start(self.clone(), self.static_dir.clone())
            .await.map_err(|e| e.to_string())?;
        *guard = Some(handle);
        Ok(())
    }

    pub async fn disable_remote(&self) {
        let mut guard = self.remote.lock().await;
        if let Some(h) = guard.take() { h.stop(); }
    }

    pub async fn remote_status_json(&self) -> serde_json::Value {
        let guard = self.remote.lock().await;
        let enabled = self.store.get_remote_enabled().unwrap_or(false);
        match guard.as_ref() {
            Some(h) => serde_json::json!({
                "enabled": enabled, "listening": true,
                "address": h.addr.to_string(),
                "hostname": hostname_opt(),
                "error": serde_json::Value::Null,
            }),
            None => serde_json::json!({
                "enabled": enabled, "listening": false,
                "address": serde_json::Value::Null,
                "hostname": hostname_opt(),
                "error": if crate::remote::remote_addr().is_none() {
                    serde_json::json!("tailscale interface not found")
                } else {
                    serde_json::Value::Null   // null khi không có lỗi
                },
            }),
        }
    }
```
Thêm helper tự do cuối file:
```rust
fn hostname_opt() -> Option<String> {
    std::process::Command::new("hostname").output().ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
```
> Đơn giản hoá nhánh error trong `remote_status_json` cho đúng kiểu (đoạn `error` ở None khá rối — viết lại cho rõ: nếu `remote_addr().is_none()` → `"tailscale interface not found"`, ngược lại `null`). Junior dọn lại cho compile + clippy sạch.

### R1.5.3 — dispatch 2 cmd

Thêm vào `match envelope.cmd` (cạnh `Cmd::GetSettings`):
```rust
            Cmd::SetRemoteAccess(c) => {
                self.store.set_remote_enabled(c.enabled).map_err(|e| e.to_string())?;
                if c.enabled {
                    self.enable_remote().await?;
                } else {
                    self.disable_remote().await;
                }
                Ok(self.remote_status_json().await)
            }

            Cmd::GetRemoteStatus => {
                Ok(self.remote_status_json().await)
            }
```
> ⚠️ `dispatch` hiện nhận `&self` (server.rs:136). `enable_remote` cần `self: &Arc<Self>`. → đổi signature `dispatch` thành `self: &Arc<Self>` HOẶC gọi qua một `Arc` clone. Cách sạch: đổi `dispatch(&self,...)` → `dispatch(self: &Arc<Self>, ...)` và cập nhật call site `self.dispatch(...)` trong `handle_line` (đã là `&Arc<Self>` ở R1.3 — khớp). Kiểm tra mọi call.

### R1.5.4 — store: persist remote_enabled

Trong `store.rs` thêm (theo pattern các getter khác — đọc 1 hàm settings có sẵn để bắt chước SQL):
```rust
    pub fn get_remote_enabled(&self) -> rusqlite::Result<bool> {
        // store as KV in settings table; default false
        // ... SELECT value FROM settings WHERE key='remote_enabled'
    }
    pub fn set_remote_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        // INSERT OR REPLACE INTO settings(key,value) VALUES('remote_enabled', ?)
    }
```
> Nếu CHƯA có bảng `settings` KV: thêm vào `migrations.sql`: `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`. Đọc migrations.sql xem schema hiện tại trước.

### R1.5.5 — Bật lại remote khi khởi động nếu enabled

Trong `main.rs` `run_daemon`, sau khi tạo Server + trước `listen`: nếu `store.get_remote_enabled()` → `server.enable_remote().await` (log lỗi nếu tailnet chưa sẵn, KHÔNG crash daemon).

### Verify
```bash
mise run check
mise run dev
# trong app desktop (sau R2) hoặc qua CLI:
mise run cli -- get_remote_status     # nếu CLI hỗ trợ; nếu không, test bằng webapp R3
```
Manual (cần Tailscale chạy trên máy): bật remote → `curl http://<tailscale-ip>:4517/` trả HTML (hoặc 404 ServeDir nếu static_dir trống — chấp nhận tới R3); `get_remote_status` trả `listening:true,address`.
**If fail:** `dispatch` signature mismatch (`&self` vs `&Arc<Self>`) — sửa đồng bộ; bind lỗi `address in use` → port 4517 đang dùng; tailnet không có → status `error:"tailscale interface not found"` (đúng, không phải bug).

### Commit
```bash
git add daemon/src/server.rs daemon/src/store.rs daemon/src/migrations.sql daemon/src/main.rs && git commit -m "feat(daemon): remote access lifecycle + persisted toggle"
```

---

## Verify toàn Phase R1 (trước PR)

```bash
cd /Users/idev/Documents/projects/agentry
git stash -u 2>/dev/null; cargo clean -p agentry-daemon; mise run check; git stash pop 2>/dev/null
```
Checklist:
- [ ] `mise run check` xanh (clippy -D warnings + svelte-check)
- [ ] Desktop GUI hoạt động y nguyên qua Unix socket (refactor R1.3 không vỡ gì)
- [ ] Tailscale ON: bật remote → TcpListener bind `100.x:4517`, `curl` được
- [ ] Tailscale OFF: bật remote → status `error: tailscale interface not found`, daemon KHÔNG crash
- [ ] Tắt remote → listener dừng (`curl` fail), Unix socket vẫn chạy
- [ ] Restart daemon với remote_enabled=true → tự bật lại (hoặc log lỗi nếu tailnet chưa sẵn)

---

## Phạm vi nghiêm ngặt — KHÔNG làm
- KHÔNG đổi hành vi Unix socket (desktop không được vỡ) — R1.3 là refactor tương đương.
- KHÔNG bump WIRE_VERSION (chỉ thêm variant).
- KHÔNG bind `0.0.0.0` — chỉ Tailscale IP.
- KHÔNG thêm auth/token (Tailscale lo).
- File ngoài `Files:` mỗi task → revert.

## Troubleshooting
| Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|
| `dispatch` không gọi được `enable_remote` | `&self` vs `&Arc<Self>` | Đổi `dispatch` thành `self: &Arc<Self>`, sửa mọi call site. |
| Double newline trên Unix resp | `build_resp` đã có `\n` + thêm lần nữa | Đọc `build_resp`; chỉ thêm `\n` nếu nó chưa có. |
| `axum::serve` không tồn tại | axum < 0.7 | Dùng axum 0.7+; với 0.6 API khác (`Server::bind`). |
| WS connect nhưng không nhận event | event_task abort sớm / filter sai | Kiểm tra `event_passes` + focused chưa set (await `focus` cmd trước). |
| bind `Address already in use` | port 4517 bận / remote bật 2 lần | `enable_remote` guard `is_some()`; đổi port nếu cần. |
| Tailscale IP không tìm thấy dù đang chạy | iface name khác / IPv6 only | `local_ip_address::list_afinet_netifas()` log ra; nới `is_cgnat`. |
| clippy fail `remote_status_json` error branch | nhánh error viết rối | Viết lại rõ ràng `if remote_addr().is_none() {...} else {null}`. |


