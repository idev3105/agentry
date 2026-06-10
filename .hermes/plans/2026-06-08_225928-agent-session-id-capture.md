# Plan: Capture & Resume `agent_session_id` cho Claude Code, OpenCode, Codex (Junior Edition)

> **Cho người implement:** Đọc HẾT phần "Onboarding" trước khi bắt đầu Task 1. Mỗi task = 1 commit, theo đúng thứ tự (T1 → T7). KHÔNG nhảy task. Sau mỗi task: `mise run check` phải xanh, GUI phải chạy được. Nếu bí: xem **Troubleshooting** ở cuối.

**Goal:** Daemon capture được `agent_session_id` (và `agent_session_name` nếu có) cho cả 3 agent CLI (`claude_code`, `open_code`, `codex`), persist vào DB, expose qua wire/GUI để user resume đúng session gốc.

**Architecture:** Mỗi agent có chiến lược capture khác nhau (xem `docs/data-models.md` §4). Chỉ `claude_code` đã hoạt động (pre-generate UUID). `codex` watch filesystem, `open_code` diff `session list`. Plan này hiện thực hai cái còn lại + clean up code đường claude + đưa session id/name lên UI.

**Tech Stack:** Rust (tokio, rusqlite, portable-pty, notify), Svelte 5 runes, Tauri 2, JSON-line wire protocol.

---

## Onboarding (đọc 15 phút trước Task 1)

### Reading order

Đọc theo thứ tự dưới đây — file sau giả định bạn đã đọc file trước:

1. `CLAUDE.md` — kiến trúc tổng + foot-guns (BẮT BUỘC).
2. `AGENTS.md` — quy tắc thay đổi wire protocol (4 file PHẢI sửa cùng).
3. `docs/data-models.md` §4 "Session ID capture & resume" — chiến lược cho 3 agent.
4. `daemon/src/session.rs` (toàn bộ) — biết PTY spawn flow, đặc biệt `do_spawn` và `build_argv`.
5. `daemon/src/store.rs` quanh `set_agent_session_id` (dòng ~250) và `DbSession` (dòng ~390).
6. `daemon/src/server.rs` quanh `dispatch()` cho `start_session`/`resume_session`.
7. `crates/wire/src/lib.rs` — đặc biệt `SessionStartedEvent`, `SessionInfo`, `Cmd`, `Event`.
8. `gui/src/lib/types.ts` + `gui/src/lib/ipc.ts` — TS mirror.

### Conventions BẮT BUỘC

- **Comment code mới: tiếng Anh.** Comment trong file đã có sẵn tiếng Việt → giữ tiếng Việt. `docs/*.md`: tiếng Việt.
- **Wire protocol đổi → 4 file đổi cùng commit:** `crates/wire/src/lib.rs`, `daemon/src/server.rs`, `gui/src/lib/types.ts`, `gui/src/lib/ipc.ts`. Quên 1 cái → runtime im lặng vỡ.
- **`agent_type` có 2 encoding** (xem `CLAUDE.md` foot-gun): wire dùng `claude_code`/`open_code`/`codex` (snake_case); `SessionInfo.agent` là display name `claude`/`opencode`/`codex`. Đừng nhầm.
- **Đừng đọc PTY trong async.** `portable-pty` blocking → phải `std::thread::spawn`, capture `tokio::runtime::Handle::current()` TRƯỚC khi vào thread.
- **`MutexGuard: !Send` qua `.await`.** Lock `inner` xong → copy data ra → drop guard → mới `.await`.
- **`WIRE_VERSION` chỉ bump khi breaking.** Plan này CHỈ thêm field optional/event mới → KHÔNG bump.

### Common commands

| Lệnh | Để làm gì |
|---|---|
| `mise run check` | clippy `-D warnings` + svelte-check. CHẠY SAU MỖI TASK. |
| `mise run dev` | Bật full loop daemon + Tauri để verify thủ công. |
| `mise run kill` | Diệt daemon/GUI khi treo. |
| `mise run reset` | `kill` + xoá `~/.agentry/daemon.db*`. Dùng khi schema đổi. |
| `mise run cli -- list_sessions <project_id>` | Drive socket trực tiếp để debug. |

### Bug → Task map

| # | Vấn đề | Task |
|---|---|---|
| 1 | Schema có cột `agent_session_name` nhưng store.rs không đọc/ghi | T1 |
| 2 | `SessionInfo` không expose `agent_session_id`/`name` → GUI mù | T2 |
| 3 | `claude_code` capture đặt sai chỗ (trong PTY thread, không cần await store) | T3 |
| 4 | `codex` không capture session id | T4 |
| 5 | `open_code` không capture session id | T5 |
| 6 | Resume `codex`/`open_code` lặng lẽ no-op khi `agent_session_id` NULL | T6 |
| 7 | GUI không hiển thị id/name, không có nút copy | T7 |

---

## Task 1 — Persist `agent_session_name` trong store

**Risk:** low · **Time:** ~30 min

### Vấn đề cụ thể

Schema (`daemon/src/migrations.sql` dòng 31) có cột `agent_session_name TEXT` nhưng `daemon/src/store.rs` chỉ đọc/ghi `agent_session_id`. Hệ quả: dù T4/T5 capture được tên session (vd OpenCode title), không có chỗ nào lưu.

### Approach

Thêm field `agent_session_name: Option<String>` vào `DbSession`, mở rộng SELECT/UPDATE, thêm setter `set_agent_session_name`. KHÔNG đụng wire/GUI ở task này — chỉ DB layer.

### Files

- Modify: `daemon/src/store.rs`

### Changes

#### 1.1 Thêm field vào `DbSession` struct

**Trong `daemon/src/store.rs`**, tìm `pub struct DbSession {` (dòng ~390), thêm field sau `agent_session_id`:

**Before:**
```rust
pub agent_session_id: Option<String>,
pub parent_session_id: Option<String>,
```

**After:**
```rust
pub agent_session_id: Option<String>,
pub agent_session_name: Option<String>,
pub parent_session_id: Option<String>,
```

#### 1.2 Cập nhật `list_sessions` SELECT

**Trong `list_sessions` (dòng ~258-283):**

**Before:**
```rust
"SELECT id, project_id, profile_id, title, cwd, resolved_argv, pid, status, exit_code,
        agent_session_id, parent_session_id, fail_reason, created_at, finished_at
 FROM sessions WHERE project_id=?1 ORDER BY created_at"
```

**After:**
```rust
"SELECT id, project_id, profile_id, title, cwd, resolved_argv, pid, status, exit_code,
        agent_session_id, agent_session_name, parent_session_id, fail_reason, created_at, finished_at
 FROM sessions WHERE project_id=?1 ORDER BY created_at"
```

Trong `query_map` block, dịch các index lên 1 từ vị trí 10 trở đi:

**Before:**
```rust
agent_session_id: row.get(9)?,
parent_session_id: row.get(10)?,
fail_reason: row.get(11)?,
created_at: row.get(12)?,
finished_at: row.get(13)?,
```

**After:**
```rust
agent_session_id: row.get(9)?,
agent_session_name: row.get(10)?,
parent_session_id: row.get(11)?,
fail_reason: row.get(12)?,
created_at: row.get(13)?,
finished_at: row.get(14)?,
```

#### 1.3 Cập nhật `get_session` (dòng ~286-310)

Áp dụng đúng pattern 1.2: thêm `agent_session_name` vào SELECT + `row.get(10)?` + dịch index.

#### 1.4 Thêm setter

**Sau `set_agent_session_id` (dòng ~256), thêm:**

```rust
pub fn set_agent_session_name(&self, id: &str, name: &str) -> anyhow::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
        "UPDATE sessions SET agent_session_name=?1 WHERE id=?2",
        params![name, id],
    )?;
    Ok(())
}
```

### Verify

```bash
mise run check
```
Expected: ✅ xanh, không warning mới.

```bash
mise run reset && mise run dev
# Tạo 1 session bất kỳ → kill → mise run cli -- list_sessions <project_id>
```
Expected: response JSON có session bình thường (chưa có `agent_session_name` ở wire — đó là T2).

**If fail:** `column "agent_session_name" does not exist` → bạn quên `mise run reset`. Schema đã có cột này, nhưng nếu DB cũ tạo trước khi cột được thêm sẽ thiếu. Đây là codebase chưa có migration runtime → reset là cách đúng.

### Commit

```bash
git add daemon/src/store.rs
git commit -m "feat(store): expose agent_session_name field + setter"
```

---

## Task 2 — Thêm `agent_session_id`/`name` vào wire & expose qua `list_sessions`

**Risk:** medium · **Time:** ~1h

### Vấn đề cụ thể

`SessionInfo` (`crates/wire/src/lib.rs` dòng 371) chỉ có `id`, `title`, `agent`, `status`, `activity`, `cwd`. GUI mù, không biết agent CLI cấp ID gì → không hiển thị, không cho copy. Resume flow ở `server.rs` dòng 397 lấy `agent_session_id` từ `Store::get_session`, nên backend đã có sẵn — chỉ cần expose.

### Approach

Thêm 2 field optional vào `SessionInfo` + `SessionStartedEvent`. Backwards compat: `Option<String>` + `#[serde(default, skip_serializing_if = "Option::is_none")]` → client cũ không vỡ. Đây là LÝ DO không bump `WIRE_VERSION`.

### Files

- Modify: `crates/wire/src/lib.rs`
- Modify: `daemon/src/server.rs` — `dispatch()` cho `list_sessions` + emit `session_started`
- Modify: `gui/src/lib/types.ts`
- Modify: `gui/src/lib/ipc.ts` (chỉ check, có thể không đổi nếu generic)

### Changes

#### 2.1 `crates/wire/src/lib.rs` — `SessionInfo`

**Before (dòng 370-378):**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub agent: String,
    pub status: SessionStatus,
    pub activity: Option<ActivityState>,
    pub cwd: String,
}
```

**After:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub agent: String,
    pub status: SessionStatus,
    pub activity: Option<ActivityState>,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_session_name: Option<String>,
}
```

#### 2.2 `crates/wire/src/lib.rs` — `SessionStartedEvent`

Tìm `pub struct SessionStartedEvent` (~dòng 202). Thêm 2 field optional cuối struct, cùng pattern 2.1.

#### 2.3 `daemon/src/server.rs` — fill khi build response

Tìm chỗ `dispatch()` xử lý `Cmd::ListSessions` (grep `list_sessions`). Trong block map từ `DbSession` → `SessionInfo`, thêm:

```rust
SessionInfo {
    // ...các field cũ giữ nguyên...
    agent_session_id: db.agent_session_id.clone(),
    agent_session_name: db.agent_session_name.clone(),
}
```

Tương tự khi build `SessionStartedEvent` (grep `SessionStartedEvent {`): mới start thì id chưa có → để `None`. Sau khi T3-T5 capture xong sẽ emit event riêng (T6) — task này CHỈ thêm field.

#### 2.4 `gui/src/lib/types.ts` — mirror

Tìm `interface SessionInfo` / `type SessionInfo`, thêm 2 field optional:

```ts
agent_session_id?: string | null;
agent_session_name?: string | null;
```

Tương tự `SessionStartedEvent`.

#### 2.5 `gui/src/lib/ipc.ts`

Mở file → grep `list_sessions`/`SessionInfo`. Nếu chỉ pass-through generic → KHÔNG cần đổi. Nếu có cast/destructure cụ thể → thêm field tương ứng.

### Verify

```bash
mise run check
```
Expected: ✅ — clippy + svelte-check xanh.

```bash
mise run reset && mise run dev
# Tạo 1 claude_code session → đóng GUI → mở lại → mở DevTools (Cmd+Opt+I)
# trong console: chạy `await window.__TAURI__.core.invoke('send_cmd', { cmd: { ... list_sessions cmd ... } })`
```
Expected: response trả về có field `agent_session_id: "<uuid>"` cho claude_code, `null` cho 2 cái còn lại (chưa capture — T4/T5).

**If fail:**
- `unknown field "agent_session_id"` ở client → bạn quên 2.4.
- clippy `unused field` ở server.rs → đảm bảo bạn dùng `db.agent_session_id` (clone), không phải shadow biến.

### Commit

```bash
git add crates/wire/src/lib.rs daemon/src/server.rs gui/src/lib/types.ts gui/src/lib/ipc.ts
git commit -m "feat(wire): expose agent_session_id/name in SessionInfo + SessionStarted"
```

---

## Task 3 — Refactor capture cho `claude_code` + thêm helper emit event

**Risk:** low · **Time:** ~45 min

### Vấn đề cụ thể

Trong `daemon/src/session.rs` dòng 249-253, capture claude_code đang chạy **bên trong PTY thread**, ngay sau spawn:

```rust
if let Some(pos) = argv.iter().position(|a| a == "--session-id") {
    if let Some(sid) = argv.get(pos + 1) {
        let _ = store_clone.set_agent_session_id(&session_id_clone, sid);
    }
}
```

Hai vấn đề:
1. UUID đã biết từ TRƯỚC khi spawn (sinh ở `build_argv`), không cần đợi vào thread mới chạy.
2. Không emit event nào → GUI không biết ID có sẵn → phải `list_sessions` mới thấy.

### Approach

- Trả `agent_session_id` ra ngoài từ `build_argv` (đổi return type → `(Vec<String>, Option<String>)`).
- Trong `do_spawn`: persist DB + emit `Event::AgentSessionCaptured` ngay sau khi insert handle, TRƯỚC khi spawn PTY.
- Thêm `Event::AgentSessionCaptured` mới (xem 3.1).

### Files

- Modify: `crates/wire/src/lib.rs` — thêm event variant + struct.
- Modify: `daemon/src/server.rs` — không cần đổi nhiều (event tự fan-out qua broadcast).
- Modify: `daemon/src/session.rs` — refactor `build_argv` + capture sớm.
- Modify: `gui/src/lib/types.ts` + `gui/src/lib/ipc.ts` — mirror event.

### Changes

#### 3.1 Wire: thêm event mới

**Trong `crates/wire/src/lib.rs`, `enum Event` (dòng 183), thêm variant:**

```rust
AgentSessionCaptured(AgentSessionCapturedEvent),
```

(snake_case `serde` tag là mặc định nên `agent_session_captured`.)

**Thêm struct (đặt cạnh các *Event khác, vd sau `SessionStartedEvent`):**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionCapturedEvent {
    pub v: u32,
    pub session_id: String,                       // daemon-side session id
    pub agent_session_id: String,                 // ID do agent CLI cấp
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_session_name: Option<String>,
    pub ts: String,
}
```

#### 3.2 `build_argv` trả về cặp

**Trong `daemon/src/session.rs` dòng 479:**

**Before:**
```rust
fn build_argv(profile: &DbProfile, resume_id: Option<&str>) -> Vec<String> {
```

**After:**
```rust
/// Returns (argv, pre_generated_agent_session_id).
/// Only `claude_code` pre-generates; the others return None and rely on
/// post-spawn capture (T4/T5).
fn build_argv(profile: &DbProfile, resume_id: Option<&str>) -> (Vec<String>, Option<String>) {
```

Cuối hàm (dòng ~524): đổi `argv` → `(argv, captured_id)` với `captured_id` set khi tạo UUID mới ở nhánh `claude_code` (KHÔNG set khi `--resume`, vì đã có sẵn trong DB).

**Trong block `if profile.agent_type == "claude_code"` (dòng 491-499):**

**Before:**
```rust
if let Some(rid) = resume_id {
    argv.push("--resume".to_string());
    argv.push(rid.to_string());
} else {
    let uuid = uuid::Uuid::new_v4().to_string();
    argv.push("--session-id".to_string());
    argv.push(uuid);
}
```

**After:**
```rust
let mut captured: Option<String> = None;
if let Some(rid) = resume_id {
    argv.push("--resume".to_string());
    argv.push(rid.to_string());
} else {
    let uuid = uuid::Uuid::new_v4().to_string();
    argv.push("--session-id".to_string());
    argv.push(uuid.clone());
    captured = Some(uuid);
}
```

(Khai báo `let mut captured: Option<String> = None;` ngay đầu function, ngoài if/else, để các nhánh khác cũng có thể `None` cleanly.)

Cuối hàm: `(argv, captured)`.

#### 3.3 Cập nhật call sites trong `session.rs`

**Trong `spawn` (dòng 125):**

**Before:**
```rust
let argv = build_argv(&profile, None);
```

**After:**
```rust
let (argv, captured_id) = build_argv(&profile, None);
```

Tương tự trong `spawn_resume` (dòng 143). Resume thì `captured_id` luôn `None` — fine.

**Truyền vào `do_spawn`:** Đổi signature thêm param `captured_id: Option<String>`. Bỏ param cũ `agent_session_id_preset` (đang để hardcode `None` ở dòng 129/146 → unused).

**Trong `do_spawn`, NGAY SAU block `sessions.insert(...)` (dòng ~206):**

```rust
if let Some(aid) = captured_id.as_deref() {
    let _ = store.set_agent_session_id(&session_id, aid);
    let _ = event_tx.send(Event::AgentSessionCaptured(AgentSessionCapturedEvent {
        v: WIRE_VERSION,
        session_id: session_id.clone(),
        agent_session_id: aid.to_string(),
        agent_session_name: None,
        ts: chrono_now(),
    }));
}
```

#### 3.4 Xoá block capture cũ trong PTY thread

**Trong `do_spawn`, dòng 247-253, XOÁ:**

```rust
// For claude_code, store agent_session_id from argv (pre-generated UUID)
// Find --session-id in argv
if let Some(pos) = argv.iter().position(|a| a == "--session-id") {
    if let Some(sid) = argv.get(pos + 1) {
        let _ = store_clone.set_agent_session_id(&session_id_clone, sid);
    }
}
```

Đã chuyển ra ngoài 3.3.

#### 3.5 GUI mirror

**`gui/src/lib/types.ts`:** thêm interface `AgentSessionCapturedEvent` y hệt struct ở 3.1, và thêm vào union `Event`:

```ts
| { kind: 'agent_session_captured'; data: AgentSessionCapturedEvent }
```

(Match đúng pattern các event hiện hữu; mở `types.ts` đối chiếu.)

**`gui/src/lib/ipc.ts`:** thêm helper listen:

```ts
export function onAgentSessionCaptured(cb: (e: AgentSessionCapturedEvent) => void) {
    return listen<AgentSessionCapturedEvent>('daemon:agent_session_captured', (msg) => cb(msg.payload));
}
```

(Tên topic = `daemon:` + serde tag snake_case — xem `gui/src-tauri/src/relay.rs` để confirm format.)

### Verify

```bash
mise run check
```
Expected: ✅. Nếu clippy báo `unused variable: captured_id` ở `spawn_resume` → để `let (argv, _captured_id) = ...` — đúng vì resume không capture mới.

```bash
mise run reset && mise run dev
# Bật DevTools, listen sự kiện:
#   window.__TAURI__.event.listen('daemon:agent_session_captured', e => console.log(e))
# Tạo claude_code session
```
Expected: console log ngay lập tức (trước khi PTY in chữ đầu tiên) với UUID.

**If fail:**
- Event không tới GUI → check `gui/src-tauri/src/relay.rs` xem có whitelist event name không (thường là pass-through theo serde tag).
- `Send` error: `event_tx.send` trong async block phải dùng `event_tx.send(...).ok()` không qua `.await`.

### Commit

```bash
git add crates/wire/src/lib.rs daemon/src/session.rs gui/src/lib/types.ts gui/src/lib/ipc.ts
git commit -m "refactor(claude_code): hoist session-id capture out of PTY thread + emit event"
```

---

## Task 4 — Capture `codex` session id qua filesystem watch

**Risk:** medium · **Time:** ~2h

### Vấn đề cụ thể

Codex CLI ghi rollout file ngay khi spawn:
```
~/.codex/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-<UUID>.jsonl
```
Daemon hiện không capture → `agent_session_id` luôn NULL → resume nhánh `codex` (`session.rs` dòng 500-504) không bao giờ chạy nhánh `Some(rid)` → user không resume được.

### Approach

Dùng crate `notify` watch thư mục theo ngày spawn. Logic:
1. Trước spawn: nhớ `spawn_ts = SystemTime::now()`, tính path `~/.codex/sessions/<Y>/<M>/<D>/`. **Tạo dir nếu chưa có** (codex tự tạo nhưng watch lúc dir chưa tồn tại sẽ fail).
2. Spawn watcher trong tokio task. On `Create` event, regex match `rollout-.*-([0-9a-f-]{36})\.jsonl$`. Filter mtime > spawn_ts - 2s.
3. UUID đầu tiên match → call `store.set_agent_session_id` + emit `AgentSessionCaptured` + `watcher.shutdown()`.
4. Timeout: 10s. Nếu hết time chưa thấy → log warn, KHÔNG fail session (agent vẫn dùng được, chỉ không resume được).

### Files

- Modify: `daemon/Cargo.toml` — thêm `notify = "6"` (hoặc check version đã có).
- Create: `daemon/src/codex_watch.rs` — module mới.
- Modify: `daemon/src/main.rs` (hoặc `lib.rs` nếu daemon là lib) — `mod codex_watch;`.
- Modify: `daemon/src/session.rs` — gọi watcher trong `do_spawn`.

### Changes

#### 4.1 Cargo

**`daemon/Cargo.toml`** trong `[dependencies]`:

```toml
notify = "6"
regex = "1"
```

(Check xem có sẵn không trước khi add.)

#### 4.2 `daemon/src/codex_watch.rs` (file mới)

```rust
//! Filesystem watcher to capture codex CLI's session id from
//! ~/.codex/sessions/YYYY/MM/DD/rollout-...-<uuid>.jsonl on spawn.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use notify::{RecommendedWatcher, RecursiveMode, Watcher, EventKind};
use regex::Regex;
use tokio::sync::mpsc;

/// Spawn a tokio task that watches the codex sessions dir for the current day
/// and resolves with the captured UUID, or None on timeout.
///
/// `spawn_ts`: instant before we spawned codex. We ignore files created earlier
/// to avoid matching unrelated rollouts.
pub async fn capture_codex_session_id(
    spawn_ts: SystemTime,
    timeout: Duration,
) -> Option<String> {
    // Path: ~/.codex/sessions/<Y>/<M>/<D>/
    let now = chrono::Local::now();
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home)
        .join(".codex")
        .join("sessions")
        .join(now.format("%Y").to_string())
        .join(now.format("%m").to_string())
        .join(now.format("%d").to_string());

    // Codex creates this dir on first run; pre-create so we can watch it.
    let _ = std::fs::create_dir_all(&dir);

    let (tx, mut rx) = mpsc::unbounded_channel::<PathBuf>();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, EventKind::Create(_)) {
                for p in ev.paths {
                    let _ = tx.send(p);
                }
            }
        }
    }).ok()?;
    watcher.watch(&dir, RecursiveMode::NonRecursive).ok()?;

    let re = Regex::new(r"rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$").ok()?;

    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let remain = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remain.is_zero() { return None; }
        match tokio::time::timeout(remain, rx.recv()).await {
            Ok(Some(path)) => {
                // Filter by mtime to avoid stale rollouts.
                if let Ok(meta) = std::fs::metadata(&path) {
                    if let Ok(modified) = meta.modified() {
                        if modified + Duration::from_secs(2) < spawn_ts {
                            continue;
                        }
                    }
                }
                let name = path.file_name()?.to_string_lossy().to_string();
                if let Some(cap) = re.captures(&name) {
                    return Some(cap.get(1)?.as_str().to_string());
                }
            }
            _ => return None,
        }
    }
}
```

> **Foot-gun:** Nếu spawn xảy ra ngay TRƯỚC nửa đêm, codex có thể ghi sang ngày mới. Để tối giản, chấp nhận miss trường hợp này (rất hiếm). Không xử lý — KHÔNG đáng phức tạp watch nhiều ngày.

#### 4.3 Mount module

**`daemon/src/main.rs`** thêm:
```rust
mod codex_watch;
```

#### 4.4 Trigger watcher trong `do_spawn`

**`daemon/src/session.rs`** trong `do_spawn`, sau khi insert handle (cùng chỗ với 3.3 nhưng nhánh khác):

```rust
// Post-spawn capture cho codex.
if argv.first().map(|s| s.as_str()) == Some("codex")
    && captured_id.is_none()                        // không phải resume
    && !argv.iter().any(|a| a == "resume")          // CLI không nhận id sẵn
{
    let store_c = store.clone();
    let event_tx_c = event_tx.clone();
    let sid_c = session_id.clone();
    tokio::spawn(async move {
        let spawn_ts = std::time::SystemTime::now();
        if let Some(aid) = crate::codex_watch::capture_codex_session_id(
            spawn_ts,
            std::time::Duration::from_secs(10),
        ).await {
            let _ = store_c.set_agent_session_id(&sid_c, &aid);
            let _ = event_tx_c.send(Event::AgentSessionCaptured(AgentSessionCapturedEvent {
                v: WIRE_VERSION,
                session_id: sid_c,
                agent_session_id: aid,
                agent_session_name: None,
                ts: chrono_now(),
            }));
        } else {
            eprintln!("[codex] timeout capturing session id");
        }
    });
}
```

> **Foot-gun:** `argv.first()` ở đây check binary name — không phải `agent_type`. Codex profile có thể đi qua `start_script` đổi binary; nếu junior gặp edge case này, dựa vào `profile.agent_type == "codex"` an toàn hơn. **Truyền `agent_type: String` vào `do_spawn`** (signature thêm 1 param) thay vì sniff argv.

### Verify

```bash
mise run check
```

```bash
# Cài codex CLI nếu chưa có (theo hướng dẫn upstream).
mise run reset && mise run dev
# Tạo profile codex, start session.
# Chờ <10s → DevTools console (đã listen daemon:agent_session_captured) phải in UUID.
ls -t ~/.codex/sessions/$(date +%Y/%m/%d)/ | head -3
```
Expected: rollout file mới + UUID trong filename khớp với event payload.

**If fail:**
- Không có event sau 10s → kiểm tra `~/.codex/sessions/` có file thật không. Codex version cũ có thể dùng path khác → cập nhật path trong `codex_watch.rs`.
- `Permission denied` khi `create_dir_all` → bỏ qua bằng `let _` (đã làm) → watcher fail im lặng → log warn từ `watcher.watch()`. Đảm bảo HOME đúng.
- `notify` 6 vs 5 API khác (`recommended_watcher` callback signature) → đối chiếu version bạn cài thực tế.

### Commit

```bash
git add daemon/Cargo.toml daemon/src/codex_watch.rs daemon/src/main.rs daemon/src/session.rs
git commit -m "feat(codex): capture agent_session_id via fs watch"
```

---

## Task 5 — Capture `open_code` session id qua list-diff

**Risk:** medium · **Time:** ~2h

### Vấn đề cụ thể

`opencode` không hỗ trợ pre-set session id và không có file ổn định để watch. Cách duy nhất nắm được là **diff `opencode session list`** trước/sau spawn (xem `docs/data-models.md` §4 OpenCode).

### Approach

1. **Trước spawn:** chạy `opencode session list` → parse stdout → `before: HashSet<String>` (id format `ses_<hex>`).
2. Spawn opencode (PTY chạy bình thường ở thread khác).
3. Trong tokio task: poll `opencode session list` mỗi 200ms. Sau 200ms đầu tiên, `after - before` thường có 1 phần tử mới → đó là id.
4. Ngoài id, parse luôn **title** (cột thứ 2 hoặc 3 của output, tuỳ format) → set `agent_session_name`.
5. Timeout 5s. Sau timeout: log warn, không fail.

> **Concurrency rule:** Daemon **serialize spawn opencode** — chỉ 1 lúc 1 cái — để diff đơn trị. Nếu user trigger 2 opencode session đồng thời → cái thứ 2 chờ. Dùng `tokio::sync::Mutex` global trong `SessionManager`.

### Files

- Create: `daemon/src/opencode_capture.rs`.
- Modify: `daemon/src/main.rs` — `mod opencode_capture;`.
- Modify: `daemon/src/session.rs` — Mutex serialize + trigger.

### Changes

#### 5.1 Module mới `daemon/src/opencode_capture.rs`

```rust
//! Capture opencode session id by diffing `opencode session list` before/after spawn.

use std::collections::HashMap;
use std::time::Duration;
use tokio::process::Command;

/// Returns map: id -> title.
pub async fn snapshot() -> HashMap<String, String> {
    let out = Command::new("opencode")
        .arg("session")
        .arg("list")
        .output()
        .await;
    let mut map = HashMap::new();
    let Ok(o) = out else { return map };
    if !o.status.success() { return map }
    let stdout = String::from_utf8_lossy(&o.stdout);
    for line in stdout.lines() {
        // Expect rows like: "ses_xxx   <title>   <updated>"
        // Split on 2+ whitespace; first column = id, second = title.
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 { continue }
        let id = parts[0];
        if !id.starts_with("ses_") { continue }
        // Reconstruct title minus the timestamp tail (best-effort).
        let title = parts[1..parts.len().saturating_sub(1)].join(" ");
        map.insert(id.to_string(), title);
    }
    map
}

/// Poll until a new id appears, or timeout.
pub async fn capture_new(
    before: HashMap<String, String>,
    timeout: Duration,
) -> Option<(String, Option<String>)> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if tokio::time::Instant::now() >= deadline { return None }
        tokio::time::sleep(Duration::from_millis(200)).await;
        let after = snapshot().await;
        // Find ids in `after` not in `before`.
        let new_ids: Vec<&String> = after.keys().filter(|k| !before.contains_key(*k)).collect();
        if let Some(id) = new_ids.first() {
            let title = after.get(*id).cloned().filter(|s| !s.is_empty());
            return Some(((*id).clone(), title));
        }
    }
}
```

> **Foot-gun:** Format stdout của `opencode session list` PHẢI verify khi code (chạy `opencode session list` xem). Nếu nó dùng tab/JSON → parse khác. Đoạn split này là best-effort dựa trên assumption phổ biến — junior chạy thử, điều chỉnh.

#### 5.2 Mount module

**`daemon/src/main.rs`:**
```rust
mod opencode_capture;
```

#### 5.3 Serialize + trigger trong `session.rs`

**Thêm vào `SessionManager` struct:**
```rust
opencode_lock: Arc<tokio::sync::Mutex<()>>,
```

Và trong `new()`:
```rust
opencode_lock: Arc::new(tokio::sync::Mutex::new(())),
```

**Trong `do_spawn`, TRƯỚC khi `std::thread::spawn(move || ...)` (PTY thread):**

```rust
// Opencode capture: serialize spawn + snapshot list before.
let opencode_capture: Option<(_, _)> = if argv.first().map(|s| s.as_str()) == Some("opencode")
    && captured_id.is_none()
    && !argv.iter().any(|a| a == "-s")  // không phải resume
{
    let guard = self.opencode_lock.clone().lock_owned().await;
    let before = crate::opencode_capture::snapshot().await;
    Some((guard, before))
} else {
    None
};
```

**SAU `std::thread::spawn(...)`:**

```rust
if let Some((guard, before)) = opencode_capture {
    let store_c = store.clone();
    let event_tx_c = event_tx.clone();
    let sid_c = session_id.clone();
    tokio::spawn(async move {
        let _hold = guard; // drop khi task xong
        if let Some((aid, name)) = crate::opencode_capture::capture_new(
            before,
            std::time::Duration::from_secs(5),
        ).await {
            let _ = store_c.set_agent_session_id(&sid_c, &aid);
            if let Some(ref n) = name {
                let _ = store_c.set_agent_session_name(&sid_c, n);
            }
            let _ = event_tx_c.send(Event::AgentSessionCaptured(AgentSessionCapturedEvent {
                v: WIRE_VERSION,
                session_id: sid_c,
                agent_session_id: aid,
                agent_session_name: name,
                ts: chrono_now(),
            }));
        } else {
            eprintln!("[opencode] timeout capturing session id");
        }
    });
}
```

> **Foot-gun:** `lock_owned().await` PHẢI ở async context (trong `do_spawn`, OK). Drop guard mới cho session opencode kế tiếp chạy. Không hold qua PTY thread (PTY là `std::thread::spawn`, lifetime khác).

### Verify

```bash
mise run check
```

```bash
# Cài opencode CLI.
opencode session list   # confirm format stdout
mise run reset && mise run dev
# Tạo 2 opencode session liên tiếp (cách nhau ~2s) → cả 2 phải có id khác nhau, title khác nhau.
```
Expected: 2 event `agent_session_captured` đến lần lượt; KHÔNG hoán id.

**If fail:**
- 2 session capture cùng id → Mutex không hoạt động (chưa hold đủ lâu) → tăng debounce hoặc check `lock_owned` đúng cách.
- Capture nhầm id của user’s pre-existing session → check `before` snapshot có rỗng không khi DB user đã có session từ trước.
- Format stdout khác giả định → in `stdout` ra log, sửa parser.

### Commit

```bash
git add daemon/Cargo.toml daemon/src/opencode_capture.rs daemon/src/main.rs daemon/src/session.rs
git commit -m "feat(opencode): capture agent_session_id via session-list diff"
```

---

## Task 6 — Resume guards & UX safety

**Risk:** low · **Time:** ~30 min

### Vấn đề cụ thể

Sau T4/T5, một số session vẫn có `agent_session_id = NULL` (timeout capture). Khi user bấm "Resume", `server.rs` dòng 397 lấy `resume_from = original.agent_session_id` (= None) → `spawn_resume` được gọi với `None` → `build_argv` cho opencode/codex KHÔNG chèn flag resume → CLI start session MỚI thay vì resume → user mất context, im lặng.

Hiện tại `server.rs` dòng 350 đã có check: `if profile.agent_type != "claude_code" && original.agent_session_id.is_none()`. Cần verify nó **trả về error rõ ràng**, không silent.

### Approach

- Dispatch `resume_session`: nếu `agent_session_id` thiếu, trả về `Resp` với `error: "agent_session_id_missing"` + `message`. GUI hiển thị toast "Session này không thể resume — id không capture được".
- GUI: ẩn nút Resume khi `agent_session_id == null` cho `open_code`/`codex`, show tooltip giải thích.

### Files

- Modify: `daemon/src/server.rs` — đảm bảo error path đúng.
- Modify: `gui/src/lib/components/SessionSidebar.svelte` (hoặc nơi nút Resume) — disable + tooltip.

### Changes

#### 6.1 Server

Tìm dòng `if profile.agent_type != "claude_code" && original.agent_session_id.is_none()` (~350). Đảm bảo:

```rust
if profile.agent_type != "claude_code" && original.agent_session_id.is_none() {
    return Ok(serde_json::json!({
        "v": WIRE_VERSION,
        "kind": "resp",
        "id": req_id,
        "error": "agent_session_id_missing",
        "message": "Session này không có agent_session_id (capture timeout). Không resume được."
    }));
}
```

(Khớp pattern `build_resp` hiện tại — đối chiếu format các error response khác trong file.)

#### 6.2 GUI

**`gui/src/lib/components/SessionSidebar.svelte`** (hoặc Inspector) — chỗ render nút Resume:

```svelte
{#if session.status === 'finished' || session.status === 'failed'}
  <button
    disabled={session.agent !== 'claude' && !session.agent_session_id}
    title={session.agent !== 'claude' && !session.agent_session_id
      ? 'Session này không capture được id — không resume được'
      : 'Resume'}
    onclick={() => resume(session.id)}
  >Resume</button>
{/if}
```

### Verify

```bash
mise run check
```

```bash
mise run dev
# Manual: tạo opencode session → kill ngay (chưa kịp capture) → check Resume button disabled.
# Nếu lỡ click qua API → response phải có error rõ.
```

### Commit

```bash
git add daemon/src/server.rs gui/src/lib/components/SessionSidebar.svelte
git commit -m "feat(resume): guard against missing agent_session_id"
```

---

## Task 7 — Hiển thị id/name + nút Copy trong Inspector

**Risk:** low · **Time:** ~45 min

### Vấn đề cụ thể

User không thấy được agent session id/name → không debug được, không paste vào CLI thủ công.

### Files

- Modify: `gui/src/lib/components/Inspector.svelte`
- Modify: `gui/src/lib/stores/sessions.ts` — handle event `agent_session_captured` để update store realtime.

### Changes

#### 7.1 Store handler

**`gui/src/lib/stores/sessions.ts`** — sau khi listen các event hiện hữu, thêm:

```ts
import { onAgentSessionCaptured } from '$lib/ipc';

onAgentSessionCaptured((e) => {
  const s = sessions.find((x) => x.id === e.session_id);
  if (s) {
    s.agent_session_id = e.agent_session_id;
    s.agent_session_name = e.agent_session_name ?? null;
  }
});
```

(Match đúng kiểu store thực tế — Svelte 5 runes `$state`. Nếu sessions là `$state([])`, mutate trực tiếp; nếu là Map/khác → adapt.)

#### 7.2 Inspector UI

**`gui/src/lib/components/Inspector.svelte`** — thêm khối:

```svelte
{#if session.agent_session_id}
  <div class="row">
    <span class="label">Agent ID</span>
    <code>{session.agent_session_id}</code>
    <button onclick={() => navigator.clipboard.writeText(session.agent_session_id!)}>Copy</button>
  </div>
{/if}
{#if session.agent_session_name}
  <div class="row">
    <span class="label">Agent name</span>
    <span>{session.agent_session_name}</span>
  </div>
{/if}
```

(Style theo các row hiện hữu trong file.)

### Verify

```bash
mise run check
mise run dev
```

Expected:
- Tạo claude session → Inspector hiện Agent ID ngay tức thì.
- Tạo codex/opencode → 1-3s sau hiện ID + name (opencode).
- Copy button → clipboard có UUID/ses_xxx.

### Commit

```bash
git add gui/src/lib/components/Inspector.svelte gui/src/lib/stores/sessions.ts
git commit -m "feat(gui): show agent_session_id/name in Inspector with copy"
```

---

## End-to-end verification

Sau T7, chạy kịch bản full:

1. `mise run reset && mise run dev`
2. Tạo project trỏ đến repo bất kỳ.
3. Tạo 3 profile: claude_code, open_code, codex.
4. Start 1 session mỗi profile.
5. Trong Inspector của từng session:
   - claude → Agent ID hiện tức thì (UUID v4).
   - codex → Agent ID hiện trong 1-3s (UUID v7).
   - opencode → Agent ID + name hiện trong <1s (`ses_<hex>`).
6. `Cmd+K` → kill từng session.
7. Bấm Resume cho từng cái → mỗi cái phải spawn lại CLI với flag `--resume <uuid>` / `resume <uuid>` / `run -i -s <id>` đúng theo agent_type.
8. `cat ~/.agentry/daemon.log` → không có panic, không có warning thừa.

Kiểm tra DB:
```bash
sqlite3 ~/.agentry/daemon.db "SELECT id, agent_session_id, agent_session_name, status FROM sessions;"
```
Expected: cả 3 hàng có `agent_session_id` non-NULL; opencode hàng có `agent_session_name` non-NULL.

---

## Troubleshooting appendix

| Triệu chứng | Nguyên nhân thường gặp | Fix |
|---|---|---|
| `cargo check` báo `cannot find type AgentSessionCapturedEvent` | Quên thêm struct ở wire | Thêm vào `crates/wire/src/lib.rs` (T3.1) |
| GUI không nhận event `agent_session_captured` | Tên topic sai (`daemon:agent_session_captured`) | Verify trong `gui/src-tauri/src/relay.rs` cách map serde tag → topic name |
| Codex capture timeout | Path `~/.codex/sessions/...` khác version | `ls -la ~/.codex/` xem layout thực tế, sửa trong `codex_watch.rs` |
| Opencode capture nhận id sai | 2 session spawn song song | Verify Mutex `opencode_lock` được hold đủ — KHÔNG drop trước `capture_new` xong |
| Schema lỗi `no such column: agent_session_name` | DB cũ, schema chưa update | `mise run reset` |
| `MutexGuard !Send` lỗi compile trong T5 | Hold guard qua `.await` không đúng cách | Dùng `tokio::sync::Mutex` (đã làm), KHÔNG `std::sync::Mutex` |
| Resume opencode/codex spawn session MỚI | `agent_session_id` NULL trong DB | T6 phải hiển thị nút disabled — nếu vẫn click được, check guard server.rs |
| `notify` callback không fire | Watch dir chưa tồn tại lúc `watch()` gọi | Đã `create_dir_all` ở T4.2; check return của `watch()` |
| `cargo clippy` `unused captured_id` | Spawn_resume không dùng | Đổi thành `_captured_id` hoặc destructure `(argv, _)` |
| Tauri event không relay | Event mới chưa whitelist trong `relay.rs` | Thêm match arm cho `Event::AgentSessionCaptured` |

---

## Notes cho người review

- **WIRE_VERSION không bump** vì tất cả thay đổi là field optional + event mới (additive). Client cũ skip event lạ là fine.
- **Migration runtime chưa có trong codebase** — junior phải dặn user `mise run reset` khi pull về. Ghi chú này trong PR description.
- **Nếu codex/opencode upstream đổi format** (path, stdout layout) → fix trong `codex_watch.rs` / `opencode_capture.rs`, không lan ra wire/GUI.

