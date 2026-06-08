# Session Lifecycle

## Ring buffer output

Output PTY là **byte-stream ANSI** (cursor movement, repaint của TUI), **KHÔNG phải log theo dòng** → ring buffer lưu raw bytes, không tách "dòng".

Mỗi session giữ một ring buffer (circular buffer):
- Kích thước: ~2 MB raw bytes mỗi session (cấu hình `ring_buffer_bytes`)
- Mỗi entry: `{ seq: u64, bytes: Vec<u8> }` — một chunk đọc từ PTY; `seq` tăng đơn điệu để client đồng bộ vị trí
- Trên wire `bytes` mã hóa **base64** (JSON không tải raw bytes an toàn)
- GUI dùng `read_buffer(session_id, from_seq, n)` rồi feed thẳng chunk vào xterm.js theo thứ tự seq để dựng lại màn hình
- **Replay-from-middle có artifact:** với TUI repaint, đọc từ giữa buffer có thể lệch hình → an toàn nhất là replay từ chunk đầu còn giữ. Nếu agent dùng alt-screen thì scrollback giới hạn — chấp nhận ở v1.
- `agent_output` push real-time chỉ tới session đang focus; trạng thái mọi session khác đi qua `session_activity` nhẹ (xem `wire-protocol.md` §2.1)

## Session activity & idle heuristic

Để dashboard "thấy mọi session" mà không phải stream full output của tất cả, daemon tính một **activity state** nhẹ cho mỗi session RUNNING và đẩy `session_activity` (throttle ~1/s) cho mọi connection.

Mỗi session theo dõi `last_output_at`. Timer tick ~1s suy ra state:
- `working`        → `now − last_output_at < idle_threshold_s` (mặc định 10s)
- `idle`           → im ≥ `idle_threshold_s`
- `awaiting_input` → im ≥ `awaiting_threshold_s` (mặc định 30s) → sidebar badge "● cần bạn"

Đây là **heuristic** — không phân biệt chắc "đang nghĩ" với "đang chờ gõ", chỉ đủ để nhắc user con nào có thể cần chú ý. Khi state đổi (hoặc có output mới sau lúc idle), đẩy `session_activity` kèm `unread_seq` (seq mới nhất) để sidebar tính số chunk chưa đọc cho session không focus.

## Resume sau restart daemon

Ba tình huống khi load session ở trạng thái `RUNNING`:

1. **PID còn sống** (daemon restart, agent vẫn chạy nhờ setsid) → attach lại PTY, tiếp tục đọc output. Không đổi trạng thái.
2. **PID đã chết, có output trong ring buffer** → chuyển sang `FINISHED` hoặc `FAILED` dựa theo exit code đã lưu. Hiển thị output đã capture.
3. **PID đã chết, không có thông tin exit** → `FAILED` với reason `daemon_restart_lost`.

## Spawn argv resolver

**Spawn session (fresh):**
```
binary = agent_type_to_binary(profile.agent_type)
  -- claude_code → "claude"
  -- open_code   → "opencode"
  -- codex       → "codex"

argv = [binary]

// Claude Code: pre-inject session ID trước cả profile params
if profile.agent_type == claude_code:
    agent_id = uuid::new_v4().to_string()
    argv.push("--session-id")
    argv.push(agent_id)
    session.agent_session_id = agent_id  -- biết trước khi spawn

// OpenCode: interactive TUI gốc (KHÔNG --format json) — snapshot list để diff sau spawn
if profile.agent_type == open_code:
    snapshot_before = opencode_session_list()

for param in profile.params:
    argv.push(param.flag)
    if let Some(val) = param.value: argv.push(val)

session.resolved_argv = argv  -- lưu để audit

// Start script (nếu có): chạy trước spawn agent
if let Some(script) = profile.start_script:
    tmp = mktemp("/tmp/agentry-start-XXXXXX.sh")  -- hoặc .ps1 trên Windows
    write script → tmp
    exit_code = run_blocking("sh", ["-c", tmp], cwd=session.cwd, env=merged_env)
    delete tmp
    if exit_code != 0: session → FAILED, return  -- không spawn agent

// Merge env: process env + profile.env (profile thắng nếu trùng key)
merged_env = current_process_env + profile.env

spawn PTY với argv, cwd = session.cwd, env = merged_env
if initial_input: write initial_input vào PTY stdin sau khi RUNNING

// Sau spawn (capture agent_session_id):
// - codex:     watch ~/.codex/sessions/<date>/ cho .jsonl mới → UUID từ filename
// - open_code: poll opencode_session_list(), lấy ID mới so với snapshot_before
// → store.update_agent_session_id(session.id, agent_session_id)
```

**Resume session** (tạo session mới, `parent_session_id` = session cũ, kế thừa `agent_session_id`):
```
claude_code: ["claude", "--resume", <agent_session_id>, ...profile.params]
open_code:   ["opencode", "run", "-i", "-s", <agent_session_id>, ...profile.params]
codex:       ["codex", "resume", <agent_session_id>, ...profile.params]
```

## Concurrency

- `max_concurrent_sessions` (mặc định **8**) — giới hạn số agent chạy đồng thời.
- Vượt giới hạn: session mới vào trạng thái **`QUEUED`** thay vì reject. Khi một session RUNNING kết thúc (FINISHED/FAILED/killed), daemon tự lấy session `QUEUED` cũ nhất → STARTING.
- `start_session` trả `ok:true` kèm `status:"queued"` để UI hiện "đang chờ slot". User huỷ queue bằng `kill_session` như thường.
- Resume cũng đi qua cùng hàng đợi (tính vào giới hạn).
