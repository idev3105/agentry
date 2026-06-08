# Tech Stack & Architecture Decisions

## Stack

- Desktop app, Ubuntu Linux.
- UI: **Tauri v2 + SvelteKit** (static adapter, Tailwind + shadcn-svelte). Terminal stream **xterm.js + xterm-addon-fit**.
- **Tách lõi/UI:** một **daemon Rust** sống lâu — PTY (`portable-pty`), vòng đời tiến trình (setsid detach), ring buffer output mỗi session, SQLite. GUI là client mỏng (Tauri Rust shim + Svelte frontend) nối qua Unix socket. Session sống sót qua restart app — đóng cửa sổ GUI KHÔNG kill daemon.
- **Persistence:** SQLite (WAL) — sessions, messages.
- **Daemon ngôn ngữ: Rust.** Lý do: cùng toolchain với Tauri shim (một `cargo build`), share types wire protocol trực tiếp, `portable-pty` (WezTerm) production-grade, không cần thêm toolchain.

## Scope hiện tại

1. **Tập trung quản lý multiple agent session** trước. Pipeline/workflow orchestration là backlog (xem `backlog-pipeline.md`).
2. **Sessions được tổ chức theo project.** Project = một thư mục trên disk. User quản lý nhiều project cùng lúc qua tab bar.
3. **Không có git worktree isolation** trong giai đoạn này. Agent chạy trong thư mục project.
4. **Wire protocol + GUI skeleton** là deliverable đầu tiên: daemon mock → GUI tab bar + 3-pane hiển thị sessions theo project, switch focus, **gõ input vào agent**, xem terminal output.
5. **UI component library: shadcn-svelte** (Tailwind-first, dark theme, copy-paste model).
6. **App là interactive manager, KHÔNG phải log viewer.** Ba trụ UX cốt lõi: (a) user gõ trực tiếp vào agent qua stdin, (b) thấy trạng thái mọi session cùng lúc qua tín hiệu ở sidebar, (c) resume được session đã kết thúc.

## Cấu trúc thư mục

```
agentry/
 ├── daemon/              # Rust daemon (xem daemon.md)
 │   └── src/
 ├── gui/
 │   ├── src-tauri/       # Tauri Rust shim (xem ux.md §4.2)
 │   └── src/             # Svelte frontend (xem ux.md §4.3)
 └── Cargo.toml           # workspace: [daemon, gui/src-tauri]
```

## Cargo dependencies (daemon)

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

## Svelte stack (frontend)

- SvelteKit static adapter
- Tailwind CSS + **shadcn-svelte**
- xterm.js + xterm-addon-fit + xterm-addon-search
