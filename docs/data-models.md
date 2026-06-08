# Data Models

## 1. Project

Một **project** = một thư mục trên disk. Tạo project = user chọn thư mục (file picker hoặc nhập path). Project không nhất thiết phải là git repo.

Mỗi project có:
- `id`: UUID
- `name`: tên hiển thị (mặc định = tên thư mục, user có thể đổi)
- `path`: absolute path trên disk
- `created_at`, `last_active_at`

Sessions thuộc về một project. `cwd` của session = `path` của project (hoặc subdirectory — user có thể override qua dialog **New session…**, xem `ux.md` §4.3).

## 2. Agent Profile

Một **agent profile** = cấu hình tái sử dụng cho một loại agent. User tạo nhiều profile, mỗi profile có tên để nhận biết. Khi tạo session, user chọn profile thay vì nhập thủ công từng param.

**Agent types được support (v1):**

| Type | Binary | Cách truyền param |
|---|---|---|
| `claude_code` | `claude` | flags: `--model`, `--permission-prompt-tool` ... |
| `open_code` | `opencode` | flags: `--model`, `--provider` ... |
| `codex` | `codex` | flags: `--model`, `--approval-policy` ... |

Mỗi profile có:
- `id`: UUID
- `name`: tên hiển thị, user đặt (vd: "Claude Opus", "Codex fast")
- `agent_type`: `claude_code` | `open_code` | `codex`
- `params`: danh sách `{ flag: String, value: Option<String> }` — các flag truyền vào CLI
- `env`: danh sách `{ key: String, value: String }` — env vars inject vào process khi spawn (vd: `ANTHROPIC_API_KEY`)
- `start_script`: nội dung script chạy trước khi spawn agent — `.sh` trên Unix, `.ps1` trên Windows (tuỳ chọn; để trống = không chạy)
- `created_at`, `updated_at`

**Params** là free-form list of CLI flags. Daemon không validate nội dung — cứ append vào argv khi spawn. Validation là trách nhiệm của agent CLI.

**Env** override/bổ sung vào env của process spawn. Daemon merge: `process env + profile.env` (profile thắng nếu trùng key).

**Start script** chạy trong shell (`sh -c` / `pwsh -Command`) trước khi spawn agent, cùng `cwd` với session. Nếu script exit code ≠ 0, session chuyển sang `FAILED` ngay (không spawn agent). Dùng để setup venv, export thêm biến, kiểm tra điều kiện,...

Ví dụ profile "Claude Opus focused":
```
agent_type: claude_code
params:
  - flag: --model,         value: claude-opus-4-8
  - flag: --permission-prompt-tool, value: computer_use__bash_execute
env:
  - key: ANTHROPIC_API_KEY, value: sk-ant-...
start_script: |
  source .venv/bin/activate
```

Ví dụ profile "Codex auto":
```
agent_type: codex
params:
  - flag: --model,           value: o4-mini
  - flag: --approval-policy, value: auto
env:
  - key: OPENAI_API_KEY, value: sk-...
```

## 3. Session

Một **session** = một lần chạy agent (theo một profile) trong một project.

```
Session states (persist trong DB):
  QUEUED    → chờ slot (vượt max_concurrent_sessions)
  STARTING  → agent process đang khởi động
  RUNNING   → agent đang chạy, PTY đọc output
  FINISHED  → exit code 0
  FAILED    → exit code ≠ 0 hoặc PTY chết bất thường

Activity sub-state (chỉ khi RUNNING — runtime, KHÔNG persist; xem session-lifecycle.md):
  working        → có output trong < idle_threshold_s (mặc định 10s)
  idle           → im output ≥ idle_threshold_s (agent có thể đang nghĩ)
  awaiting_input → im output ≥ awaiting_threshold_s (mặc định 30s) → badge "● cần bạn"
```

Mỗi session có:
- `id`: UUID
- `project_id`: project mà session thuộc về
- `profile_id`: agent profile được dùng
- `cwd`: thư mục làm việc (thường = project.path)
- `pid`: PID của process agent
- `resolved_argv`: JSON array — argv thực sự đã spawn (để audit/debug)
- `status`: trạng thái hiện tại
- `exit_code`: khi kết thúc
- `title`: tên hiển thị, user đổi được (mặc định auto: `"{agent} · #{n}"`)
- `parent_session_id`: nếu session này resume từ session khác
- `fail_reason`: tail stderr / lý do FAILED (hiện ở inspector)
- `created_at`, `finished_at`

## 4. Session ID capture & resume

Mỗi agent CLI lưu session theo cách khác nhau. Daemon phải capture `agent_session_id` để sau này user có thể resume.

### Claude Code (`claude`)

**Capture:** Daemon **pre-generate UUID** trước khi spawn → truyền vào `--session-id <uuid>`. Session ID đã biết trước khi process start — không cần parse output.

```
argv = ["claude", "--session-id", "<daemon-generated-uuid>", ...profile.params]
```

**Resume:** `claude --resume <uuid>`

**Session ID format:** UUID v4 (`43ebd981-22a5-4bf5-adc9-06d6e4ebf79d`)

---

### OpenCode (`opencode`)

**Capture (list-diff):** Spawn `opencode` interactive **TUI gốc** (KHÔNG ép `--format json`, để user thấy UI đẹp). Ngay trước spawn, daemon snapshot `opencode session list` → tập ID cũ. Sau spawn, poll lại list (~200ms/lần trong ~3s) → ID mới xuất hiện chính là của session này:

```
before = set(opencode session list)   # ngay trước spawn
spawn opencode (interactive)
after  = set(opencode session list)    # poll tới khi xuất hiện ID mới
agent_session_id = (after − before) mới nhất theo Updated
```

Để list-diff đơn trị, daemon **serialize spawn opencode** (một lúc chỉ spawn 1 opencode). *Cần verify khi code:* nếu opencode ghi file session ở thư mục watch được, ưu tiên watch như codex (chắc hơn poll).

**Resume:** `opencode run -i -s <sessionID>` hoặc `opencode -s <sessionID>`

**Session ID format:** `ses_<hex>` (vd: `ses_169f6bf52ffe8Aj39ixkey7xIi`)

---

### Codex (`codex`)

**Capture:** Codex ghi file session ngay lúc spawn tại:
```
~/.codex/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-<UUID>.jsonl
```

Daemon watch thư mục `~/.codex/sessions/<YYYY>/<MM>/<DD>/` cho file `.jsonl` mới được tạo sau spawn time → extract UUID từ tên file.

**Resume:** `codex resume <UUID>`

**Session ID format:** UUID v7 (`019e9164-ceee-77c3-aba7-d8c9161a0e4c`)

---

**Tóm tắt strategy:**

| Agent | Khi nào biết ID | Cách capture |
|---|---|---|
| `claude_code` | Trước spawn | Daemon pre-generate UUID → `--session-id <uuid>` |
| `open_code` | Vài trăm ms sau spawn | Diff `opencode session list` trước/sau spawn (TUI gốc) |
| `codex` | Ngay khi spawn | Watch `~/.codex/sessions/` → extract UUID từ filename |

## 5. Schema SQLite

```sql
CREATE TABLE projects (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  path           TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL,
  last_active_at TEXT
);

CREATE TABLE agent_profiles (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  agent_type   TEXT NOT NULL CHECK(agent_type IN ('claude_code','open_code','codex')),
  params       TEXT NOT NULL DEFAULT '[]',  -- JSON: [{flag, value|null}]
  env          TEXT NOT NULL DEFAULT '[]',  -- JSON: [{key, value}]
  start_script TEXT,                        -- sh/ps1 content; NULL = không chạy
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id),
  profile_id        TEXT NOT NULL REFERENCES agent_profiles(id),
  title             TEXT,                -- tên hiển thị; user đổi được. Default "{agent} · #{n}"
  cwd               TEXT NOT NULL,
  resolved_argv     TEXT NOT NULL,       -- JSON array: argv thực sự đã spawn
  pid               INTEGER,
  status            TEXT NOT NULL,       -- 'queued'|'starting'|'running'|'finished'|'failed'
  exit_code         INTEGER,
  agent_session_id  TEXT,               -- ID do agent CLI cấp (để resume)
  agent_session_name TEXT,              -- tên hiển thị do agent CLI cấp (nếu có)
  parent_session_id TEXT REFERENCES sessions(id),  -- nếu resume từ session khác
  fail_reason       TEXT,                -- tail stderr / lý do FAILED
  created_at        TEXT NOT NULL,
  finished_at       TEXT
);

-- Ring buffer sống trong memory. Persist ~256 KB cuối (raw bytes) để resume hiển thị.
CREATE TABLE session_tail (
  session_id TEXT REFERENCES sessions(id),
  seq        INTEGER NOT NULL,
  bytes      BLOB NOT NULL,            -- raw PTY chunk (không phải "dòng")
  PRIMARY KEY (session_id, seq)
);

-- User preferences (key-value, một row mỗi key)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Giá trị mặc định lúc init:
-- INSERT INTO settings VALUES ('default_profile_id', '<id profile claude_code đầu tiên>');
-- INSERT INTO settings VALUES ('max_concurrent_sessions', '8');
-- INSERT INTO settings VALUES ('idle_threshold_s', '10');
-- INSERT INTO settings VALUES ('awaiting_threshold_s', '30');
-- INSERT INTO settings VALUES ('ring_buffer_bytes', '2097152');
```
