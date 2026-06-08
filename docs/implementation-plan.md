# Implementation Plan

> Plan chi tiết để build Agentry từ docs. Bổ sung cho `roadmap.md` (3 phase) bằng milestone + thứ tự build module + ghi chú kỹ thuật.

## Quyết định nền (đã chốt)

1. **Linux-first** — đúng `tech-stack.md`. `start_script` chỉ chạy `.sh`; Windows/`.ps1` để backlog.
2. **Wire crate dùng chung** — tách `crates/wire/` thay vì để `wire.rs` trong daemon. Daemon + Tauri shim cùng `use agentry_wire::*` → một nguồn sự thật cho protocol.
3. **CLI test client** — `crates/cli/` gửi JSON-line vào socket để test daemon trước khi có GUI.

## Toolchain (mise)

Đã pin trong `mise.toml`: `rust=stable` (1.96), `node=24` (LTS), `pnpm=11`. Cài bằng `mise install`.

**System libs cho Tauri v2 (Ubuntu, không quản qua mise):**
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Thứ tự build module daemon

```
crates/wire   → Cmd/Event/Resp enums + JSON-line codec + version check (nền cho mọi thứ)
store.rs      → SQLite WAL, migrations, CRUD
pid.rs        → PID + socket file ~/.agentry/
profile.rs    → agent_type→binary, argv resolver, merge env, start_script runner
session.rs    → PTY spawn, ring buffer, send_input/resize, activity timer, ID capture
server.rs     → UnixListener, accept loop, dispatch, broadcast events
main.rs       → ráp lại
```

---

## Milestones

### Phase 0 — Scaffold

**M0 — Workspace build được, app rỗng mở được**
- [x] `mise.toml` + `mise install`
- [ ] apt system libs cho Tauri
- [ ] `Cargo.toml` workspace: `daemon/`, `gui/src-tauri/`, `crates/wire/`, `crates/cli/`
- [ ] Tauri v2 + SvelteKit (static adapter) init trong `gui/`
- [ ] Tailwind + shadcn-svelte init; cài component theo `ux.md §4.5`
- [ ] `crates/wire`: `Cmd`/`Event`/`Resp` enums (serde) + codec + version check

### Phase 1 — Protocol + GUI skeleton

**M1 — Daemon CRUD slice** (test bằng CLI, chưa cần PTY)
- `store.rs`: SQLite WAL, migrations nhúng, CRUD projects/profiles/sessions/settings
- `pid.rs`: PID + socket file dưới `~/.agentry/`
- `server.rs`: accept loop, reader/writer task mỗi connection, `broadcast` channel, bảng dispatch
- Dispatch: `create/list/remove_project`, `create/update/delete/list_profile`, `get_settings`, `set_default_profile`
- `crates/cli`: gửi cmd JSON-line, in resp/event
- ✅ Milestone: CLI `create_project` → DB có row → `list_projects` trả về

**M2 — GUI shell trên daemon thật**
- Shim: `daemon.rs` (spawn/attach), `socket.rs` (async loop), `relay.rs` (cmd/event ↔ `app.emit`)
- Svelte: stores (`projects/profiles/settings/ui`), `ipc.ts`, layout 3-pane `Resizable`, tab bar, Settings `Sheet` tạo/sửa profile (kèm `env` + `start_script`)
- ✅ Milestone: tạo project + profile từ GUI, lưu thật, reload vẫn còn

**M3 — Mock session trong GUI**
- Daemon mock `session_started` + `agent_output` (base64) định kỳ
- `TerminalView.svelte` (xterm.js + FitAddon); sidebar badge; inspector
- ✅ Milestone: thấy session list + output chạy + gõ (mock)

### Phase 2 — PTY thật / interactive

**M4 — Spawn PTY + stream**
- `profile.rs`: argv resolver (fresh), merge env, chạy `start_script` (tmpfile → `sh -c`, fail → FAILED)
- `session.rs`: spawn `portable-pty`, **thread blocking đọc PTY → mpsc → broadcast**, ring buffer `VecDeque<{seq,bytes}>` theo byte budget
- `send_input`, `resize`, `focus`, `read_buffer`, `start_session` (cwd/initial_input), `kill_session`
- ✅ Milestone: chạy & gõ thật vào `claude`; đổi focus replay buffer

**M5 — Activity + kết thúc**
- Timer ~1s → `session_activity` (working/idle/awaiting_input) cho mọi session
- `session_finished`/`session_failed` (+ `fail_reason` tail stderr), `rename_session`
- ✅ Milestone: sidebar badge "● cần bạn"; đóng GUI agent vẫn chạy

**M6 — Capture ID + resume**
- claude (pre-gen UUID), codex (`notify` watch `~/.codex/sessions/`), opencode (serialize spawn + poll list-diff)
- `resume_session` + `parent_session_id` chain
- ✅ Milestone: resume được cả 3 agent

**M7 — Recovery sau restart daemon** (3 tình huống `session-lifecycle.md`)

### Phase 3 — Polish

**M8**
- Auto-queue `QUEUED` khi vượt `max_concurrent_sessions`
- Secret redaction (giá trị `profile.env` đã biết + regex sliding-window)
- Persist tail ~256KB vào `session_tail`
- Error handling (daemon crash, version mismatch, `Sonner` toast) + bundle daemon vào Tauri resources

---

## Ghi chú kỹ thuật

- **PTY đọc blocking:** `portable-pty` reader là blocking `Read` → mỗi session một `std::thread` đọc, forward qua tokio `mpsc` rồi `broadcast`. Đừng đọc PTY trong async task.
- **rusqlite là sync:** bọc `Arc<Mutex<Connection>>` gọi qua `spawn_blocking`, hoặc một connection-actor thread. App single-daemon, concurrency thấp → mutex đủ.
- **Event fan-out:** `tokio::sync::broadcast`. Writer task mỗi connection lọc `agent_output` theo `focus` của connection đó; event khác gửi hết.
- **Wire codec:** envelope 2 tầng (`kind` → `cmd`/`event`). Dùng serde tagged enum + struct bao ngoài giữ `v`/`kind`/`id`. Reject `v` lớn hơn → `unsupported_version`.
- **Tauri v2:** dùng `app.emit()` (v1 là `emit_all`). Tauri CLI lấy qua npm devDep `@tauri-apps/cli`, chạy `pnpm tauri dev`.
- **(Tuỳ chọn) `ts-rs`:** sinh `types.ts` từ struct Rust trong `crates/wire` để frontend không lệch type.
