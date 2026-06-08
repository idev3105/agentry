# Wire Protocol

JSON-line hai chiều qua Unix socket (`~/.agentry/daemon.sock`).

Tauri Rust shim là **client duy nhất** của socket. Svelte frontend chỉ thấy Tauri `invoke`/`listen` API. Wire format độc lập với UI — nếu sau này thêm CLI client hay web client, daemon không đổi gì.

Mỗi message là một JSON object trên một dòng, kết thúc bằng `\n`.

## 2.1 Daemon → Client (events, push)

```jsonc
// Project được tạo
{"v":1, "kind":"event", "event":"project_created",
 "project_id":"P1", "name":"My App", "path":"/home/user/myapp", "ts":"..."}

// Session bắt đầu chạy (status có thể "queued" nếu vượt giới hạn)
{"v":1, "kind":"event", "event":"session_started",
 "session_id":"S1", "project_id":"P1", "agent":"claude", "title":"claude · #1",
 "cwd":"/home/user/myapp", "pid":12345, "status":"running", "ts":"..."}

// Output từ PTY (CHỈ session đang focus) — raw bytes base64
{"v":1, "kind":"event", "event":"agent_output",
 "session_id":"S1", "seq":42, "data_b64":"G1szMm0+IC4uLg=="}

// Activity (MỌI session, throttle ~1/s) — để sidebar hiện chấm/badge/unread
{"v":1, "kind":"event", "event":"session_activity",
 "session_id":"S1", "state":"awaiting_input", "unread_seq":128, "ts":"..."}

// Session kết thúc
{"v":1, "kind":"event", "event":"session_finished",
 "session_id":"S1", "exit_code":0, "ts":"..."}

// Session thất bại (reason = tail stderr ngắn, hiện ở inspector)
{"v":1, "kind":"event", "event":"session_failed",
 "session_id":"S1", "reason":"command not found: opencode", "exit_code":127, "ts":"..."}
```

## 2.2 Client → Daemon (commands, RPC có id)

```jsonc
// --- Project commands ---

// Tạo project mới
{"v":1, "kind":"cmd", "id":"c1", "cmd":"create_project",
 "path":"/home/user/myapp", "name":"My App"}

// Liệt kê tất cả projects
{"v":1, "kind":"cmd", "id":"c2", "cmd":"list_projects"}

// Xóa project (không xóa thư mục, chỉ xóa khỏi DB; reject nếu có session running)
{"v":1, "kind":"cmd", "id":"c3", "cmd":"remove_project", "project_id":"P1"}

// --- Agent profile commands ---

// Tạo profile
{"v":1, "kind":"cmd", "id":"c4", "cmd":"create_profile",
 "name":"Claude Opus", "agent_type":"claude_code",
 "params":[{"flag":"--model","value":"claude-opus-4-8"}],
 "env":[{"key":"ANTHROPIC_API_KEY","value":"sk-ant-..."}],
 "start_script":"source .venv/bin/activate\n"}

// Cập nhật profile
{"v":1, "kind":"cmd", "id":"c5", "cmd":"update_profile",
 "profile_id":"PR1", "name":"Claude Opus fast",
 "params":[{"flag":"--model","value":"claude-sonnet-4-6"}],
 "env":[{"key":"ANTHROPIC_API_KEY","value":"sk-ant-..."}],
 "start_script":null}

// Xóa profile (reject nếu có session đang dùng profile này)
{"v":1, "kind":"cmd", "id":"c6", "cmd":"delete_profile", "profile_id":"PR1"}

// Liệt kê tất cả profiles
{"v":1, "kind":"cmd", "id":"c7", "cmd":"list_profiles"}

// --- Session commands ---

// Bắt đầu session mới. Tùy chọn: cwd (override subdir), initial_input (gõ message đầu sau spawn)
{"v":1, "kind":"cmd", "id":"c8", "cmd":"start_session",
 "project_id":"P1", "profile_id":"PR1", "cwd":"/home/user/myapp/sub", "initial_input":"fix the bug\n"}

// Resume session đã kết thúc (tạo session mới nối tiếp agent_session_id)
{"v":1, "kind":"cmd", "id":"c8b", "cmd":"resume_session", "session_id":"S1"}

// Kill session (hoặc huỷ session đang QUEUED)
{"v":1, "kind":"cmd", "id":"c9", "cmd":"kill_session", "session_id":"S1"}

// Gửi input (phím gõ) xuống PTY stdin
{"v":1, "kind":"cmd", "id":"c9b", "cmd":"send_input", "session_id":"S1", "data":"y\n"}

// Báo kích thước terminal xuống PTY (SIGWINCH)
{"v":1, "kind":"cmd", "id":"c9c", "cmd":"resize", "session_id":"S1", "cols":120, "rows":40}

// Đặt tên session
{"v":1, "kind":"cmd", "id":"c9d", "cmd":"rename_session", "session_id":"S1", "title":"refactor auth"}

// Đổi session đang focus (chỉ session này nhận agent_output)
{"v":1, "kind":"cmd", "id":"c10", "cmd":"focus", "session_id":"S1"}

// Đọc ring buffer (scrollback) — trả raw bytes base64
{"v":1, "kind":"cmd", "id":"c11", "cmd":"read_buffer",
 "session_id":"S1", "from_seq":0, "n":200}

// Liệt kê sessions của một project
{"v":1, "kind":"cmd", "id":"c12", "cmd":"list_sessions", "project_id":"P1"}

// --- Settings commands ---

// Lấy settings
{"v":1, "kind":"cmd", "id":"c13", "cmd":"get_settings"}

// Đổi default profile
{"v":1, "kind":"cmd", "id":"c14", "cmd":"set_default_profile", "profile_id":"PR2"}
```

## 2.3 Daemon → Client (responses)

```jsonc
{"v":1, "kind":"resp", "id":"c8", "ok":true, "session_id":"S1", "status":"running"}
{"v":1, "kind":"resp", "id":"c8", "ok":true, "session_id":"S9", "status":"queued"}
{"v":1, "kind":"resp", "id":"c2", "ok":true}
// read_buffer: chunk raw bytes base64
{"v":1, "kind":"resp", "id":"c11", "ok":true,
 "entries":[{"seq":0,"data_b64":"..."},{"seq":1,"data_b64":"..."}]}
// list_sessions: kèm title, activity state, unread
{"v":1, "kind":"resp", "id":"c12", "ok":true,
 "sessions":[{"id":"S1","title":"claude · #1","agent":"claude","status":"running","activity":"working","cwd":"..."}]}
{"v":1, "kind":"resp", "id":"c8", "ok":false, "error":"unknown_profile"}
```

## 2.4 Subscribe model

- Khi connect, shim nhận tất cả events trừ `agent_output` — gồm `session_activity` cho **mọi** session. Nhờ đó sidebar luôn biết trạng thái/badge/unread của mọi session dù chỉ mở một terminal.
- `agent_output` (full byte-stream, nặng) chỉ stream cho `session_id` đang focus. User chuyển focus → shim gửi `focus` mới; daemon đẩy phần buffer còn thiếu (qua `read_buffer`) rồi tiếp tục stream live.
- Một connection = một focused session tại một thời điểm (mô hình **"1 terminal + tín hiệu"**) — đánh đổi có chủ đích: full output chỉ cho 1 session để tiết kiệm băng thông, mọi session khác vẫn "thấy được" qua `session_activity` nhẹ.
- `send_input` / `resize` áp cho session chỉ định trong cmd (thường là session đang focus).

**Versioning:** `v:1`. Server reject `v` cao hơn với `error: unsupported_version`.
