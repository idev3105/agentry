# Remote Control qua Tailscale — INDEX (đọc trước)

> **Cho implementer (junior):** Bộ plan remote gồm 3 phase, làm đúng thứ tự. Khác bộ desktop: phase R1 ĐỤNG backend (daemon Rust) — đọc kỹ "Ràng buộc wire" trước. Mỗi task = 1 commit.

## Mục tiêu tổng

Đưa Agentry điều khiển được từ xa qua Tailscale, theo design `ui-design/remote/` (mobile webapp) + brief `claude-design-remote-server-client-instructions.md`:

- **Server (daemon)**: thêm TCP/WebSocket listener (bind vào Tailscale IP) bridge cùng dispatch với Unix socket; serve static webapp; setting bật/tắt.
- **Server (desktop UI)**: section "Remote Access" trong Settings — toggle, hiện địa chỉ tailnet + QR, trạng thái.
- **Client (webapp)**: port prototype `ui-design/remote/` (vanilla JS, mock) thành webapp thật nói wire protocol qua WebSocket.

## Thứ tự file

| Phase | File | Nội dung | Risk |
|---|---|---|---|
| R1 | `2026-06-12_remote-phase1-daemon-transport.md` | TCP+WS listener, bridge dispatch, serve static, config | **CAO** (backend) |
| R2 | `2026-06-12_remote-phase2-desktop-ui.md` | Settings Remote section (toggle/địa chỉ/QR) | Thấp |
| R3 | `2026-06-12_remote-phase3-webapp.md` | Port prototype → webapp thật (WS client) | Vừa |

## Bối cảnh kỹ thuật (đọc 1 lần)

### Hiện trạng daemon (`daemon/src/`)
- `server.rs`: `UnixListener` tại `~/.agentry/daemon.sock`, JSON-line codec (mỗi dòng 1 message), `dispatch()` xử lý `Cmd` → `build_resp()`, events broadcast qua `tokio::sync::broadcast`.
- `agent_output` filter theo focused session per-connection (`focus_session`).
- Cargo deps daemon: tokio, serde, rusqlite, portable-pty... **CHƯA có** axum/hyper/tungstenite — R1 sẽ thêm.
- Wire protocol: `crates/wire/src/lib.rs`, WIRE_VERSION=1. Client nào cũng nói cùng JSON-line đó.

### Quyết định kiến trúc (đã chốt — không bàn lại trong khi implement)
1. **WebSocket bridge, không đổi wire**: WS mỗi text-frame = 1 JSON-line message, dispatch chung code path với Unix socket. KHÔNG thêm Cmd/Event mới trừ khi plan ghi rõ.
2. **Bind Tailscale IP only** (tìm interface `100.64.0.0/10` CGNAT range) — KHÔNG bind `0.0.0.0` (lộ LAN). Không tìm thấy Tailscale IP → từ chối bật, báo lỗi.
3. **Auth = tailnet membership** (theo brief Tailscale): không token, không pairing. Vào được tailnet = tin.
4. **Webapp static** build sẵn vào `daemon` (serve từ thư mục cấu hình hoặc embed) — phase R3 dùng vanilla JS như prototype (KHÔNG SvelteKit SSR — tránh phức tạp).
5. **Toggle remote** = setting persist (SQLite settings table) + lệnh wire mới `set_remote_access {enabled}` + `get_remote_status` (đây là wire change DUY NHẤT — 4 files sync, xem AGENTS.md).

### Baseline (2026-06-12)
- `cargo clippy` (qua `mise run check`): xanh trên main. Đo lại trước khi bắt đầu R1: `cd /Users/idev/Documents/projects/agentry && git stash -u 2>/dev/null; mise run check; git stash pop 2>/dev/null`.
- `pnpm check` (gui): 0 errors, 1 warning pre-existing (node types).

### Phạm vi nghiêm ngặt toàn bộ remote plan
- KHÔNG đổi behavior Unix socket hiện có (desktop GUI không được vỡ).
- KHÔNG đụng `gui/src-tauri/` trừ khi plan ghi rõ.
- KHÔNG thêm pairing/token/login UI (Tailscale lo danh tính — brief đã chốt).
- Webapp R3: chỉ tạo file MỚI dưới `daemon/static/` (hoặc đường dẫn plan chỉ định) — không sửa GUI desktop.
- Wire change duy nhất được phép: `SetRemoteAccess`/`GetRemoteStatus` + resp tương ứng (R1 ghi chi tiết 4 files).

### Design tham chiếu
- `ui-design/remote/index.html` + `app.js` + `style.css` — prototype mobile (mock). `app.js` có chú thích wire vocabulary chuẩn.
- `.hermes/plans/claude-design-remote-server-client-instructions.md` — brief 2 phía.
- Flow tạo session kế thừa project filter: xem `app.js` `sheetProject()` (dòng 351-356) — giữ đúng hành vi này.

### Lưu ý độ khó thật (cho người review plan)
R1 là backend Rust thật sự: tokio + WS handshake + bridge broadcast. Junior cần pair/review sát. Nếu junior chưa từng viết tokio service: cân nhắc senior làm R1, junior làm R2+R3.

