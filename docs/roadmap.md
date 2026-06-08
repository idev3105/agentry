# Implementation Roadmap

## Phase 1 — Wire protocol + GUI skeleton

Mốc: GUI connect daemon, hiển thị danh sách session + activity badge, xem output + gõ input (mock).

- Daemon Rust: Unix socket server, JSON-line codec, mock session data
- Tauri shim: spawn daemon, relay cmd/event
- Svelte: 3-pane layout với mock data, xterm.js render output (base64), gõ input mock

## Phase 2 — Session management thật (interactive)

Mốc: chạy & **tương tác** `claude`/`codex`/`opencode` thật trong GUI, đóng mở GUI agent vẫn chạy, resume được.

- `portable-pty`: spawn agent trong PTY thật; `send_input` + `resize` hoạt động (gõ thật vào claude)
- Ring buffer raw bytes + seq; `focus` + `read_buffer` (base64) thật
- `session_activity` + idle heuristic → sidebar badge "● cần bạn"
- `list_sessions`, `start_session` (kèm cwd/initial_input), `kill_session`, `rename_session`
- Capture agent_session_id (3 agent) + `resume_session`
- Resume sau daemon restart (3 tình huống — xem `session-lifecycle.md`)

## Phase 3 — Polish

- Auto-queue (`QUEUED`) khi vượt `max_concurrent_sessions`
- Secret redaction (giá trị đã biết + regex sliding-window)
- Session persistence (tail ~256 KB raw bytes vào SQLite)
- Error handling: daemon crash, PTY hang, version mismatch, surface `fail_reason` ở inspector
- Distribution: bundle daemon binary vào Tauri resources
