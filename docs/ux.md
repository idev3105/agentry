# GUI — Tauri Rust Shim + Svelte Frontend

## 4.1 Cấu trúc thư mục project

```
agentry/
 ├── daemon/              # Rust daemon
 │   └── src/
 ├── gui/
 │   ├── src-tauri/       # Tauri Rust shim
 │   │   ├── src/
 │   │   │   ├── main.rs
 │   │   │   ├── daemon.rs    # spawn/attach daemon, PID file
 │   │   │   ├── socket.rs    # async socket loop, JSON-line codec
 │   │   │   └── relay.rs     # forward cmd/event frontend ↔ socket
 │   │   ├── Cargo.toml
 │   │   └── tauri.conf.json
 │   └── src/             # Svelte frontend
 │       ├── lib/
 │       │   ├── stores/
 │       │   │   └── sessions.ts   # map sessionID → SessionState
 │       │   ├── ipc.ts            # wrap @tauri-apps/api invoke + listen
 │       │   ├── components/
 │       │   │   ├── SessionSidebar.svelte
 │       │   │   ├── TerminalView.svelte   # xterm.js
 │       │   │   └── Inspector.svelte
 │       │   └── types.ts          # mirror wire.rs structs
 │       └── routes/
 └── Cargo.toml           # workspace: [daemon, gui/src-tauri]
```

## 4.2 Tauri Rust shim (relay)

Trách nhiệm tối thiểu — không có business logic:

```rust
// main.rs skeleton
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let sock = daemon::ensure_running().await?;
                let conn = socket::connect(sock).await?;
                relay::run(conn, handle).await
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![send_cmd, focus_session])
        .run(tauri::generate_context!())
        .unwrap();
}
```

`relay::run` chạy 2 tasks:
- Đọc socket → parse JSON-line → `kind=event` thì `app.emit_all("daemon:event_name", payload)`; `kind=resp` thì resolve pending RPC theo `id`.
- Nhận cmd từ frontend → encode JSON-line → ghi socket.

## 4.3 Svelte frontend

**Stores:**
- `projects.ts`: `Map<string, ProjectState>` — `{ id, name, path, sessions: SessionState[] }`
- `sessions.ts`: `Map<string, SessionState>` — `{ id, projectId, profileId, agent, title, cwd, status, activity, unread, failReason }`
  (output KHÔNG giữ ở store dạng `string[]` — feed thẳng vào instance xterm.js của session; chỉ session focus mới có terminal sống)
- `profiles.ts`: `AgentProfile[]` — danh sách profiles của user
- `settings.ts`: `{ defaultProfileId, maxConcurrentSessions, idleThresholdS, awaitingThresholdS }`
- `ui.ts`: `{ activeProjectId: string, focusedSessionId: string }`

**Events từ daemon** (qua `ipc.ts` `listen()`):
- `daemon:project_created` → thêm vào store
- `daemon:session_started` → thêm session vào đúng project (kèm title, status)
- `daemon:agent_output` → base64-decode → `term.write(bytes)` vào xterm của session focus
- `daemon:session_activity` → cập nhật `activity` + `unread` của session (mọi session) → sidebar đổi chấm/badge
- `daemon:session_finished` / `daemon:session_failed` → cập nhật status + `failReason`

**Layout tổng thể:**

```
┌─────────────────────────────────────────────────────────────────┐
│  [My App ×]  [API Service ×]  [+ Add Project]        [⚙ Settings]│  ← Tab bar
├────────────────┬───────────────────────────────┬────────────────┤
│ Session List   │  Terminal (focus)             │  Inspector     │
│ (project hiện) │                               │                │
│ ● claude · #1  │  > Analyzing codebase...      │  S1 · claude   │
│   working      │  > Writing solution...        │  refactor auth │
│ ● cdx · #1  ●3 │  █ (gõ trực tiếp → stdin)     │  Project: /app │
│   ● cần bạn    │                               │  running·idle  │
│ ○ claude · #2  │                               │  argv: claude… │
│   finished     │                               │  [Resume][Kill]│
│ ⏳ codex · #2  │                               │                │
│   queued       │                               │                │
│ [+ New ▾]      │                               │                │
└────────────────┴───────────────────────────────┴────────────────┘
```

- **Tab bar** — mỗi project một tab. Badge số session `running`. Nút `+` tạo project mới. `×` xóa project. Nút `⚙ Settings` góc phải mở Settings pane.
- **Left sidebar** — danh sách sessions. Mỗi dòng: chấm activity (xanh=working, vàng=idle, đỏ "● cần bạn"=awaiting_input), title, badge số chunk chưa đọc nếu không focus, ⏳ nếu queued. Split button `[+ New ▾]`:
  - **Trái `+ New`** → spawn session ngay với default profile.
  - **Phải `▾`** → dropdown profiles (default có ✓) → click = spawn ngay. Cuối dropdown thêm **"New session…"** mở dialog: chọn profile + subdir (cwd override) + initial prompt (tuỳ chọn).
  - Path nhanh spawn ngay; chỉ "New session…" mới hỏi thêm.
  - Dropdown **không** có "New profile…" — quản lý profile là việc của Settings.
- **Center** — `<TerminalView />` xterm.js. `term.onData → send_input` (gõ thẳng vào agent); `FitAddon` + `onResize → resize` báo cols/rows xuống PTY. Khi đổi focus: clear xterm → `read_buffer` decode base64 feed lại → stream live tiếp.
- **Right inspector** — title (đổi tên inline), agent, project, status + activity, `resolved_argv` (+ nút Copy command), `agent_session_id`. Khi FAILED: hiện `fail_reason` (tail stderr). Nút **[Resume]** (finished/failed) và **[Kill]**.

## 4.4 Settings pane — Agent Profiles

Settings mở như một pane overlay (slide-in từ phải, hoặc replace center pane). Có nhiều section; section đầu tiên cần làm: **Agent Profiles**.

**User flow đầy đủ:**

```
First launch
  → App tự tạo profile mặc định: "Claude Code" (agent_type=claude_code, không có params thêm)
  → Set làm default_profile_id

Tạo profile mới
  Settings → Agent Profiles → [+ New Profile]
  → Form: Tên | Agent type (dropdown: Claude Code / OpenCode / Codex)
  → Params builder: danh sách rows [flag] [value] [×], nút [+ Add param]
  → [Save] → profile xuất hiện trong danh sách và trong dropdown split button

Sửa profile
  Settings → Agent Profiles → click profile → form điền sẵn → sửa → [Save]
  (Nếu profile đang được dùng bởi session running: vẫn cho sửa,
   session đang chạy không bị ảnh hưởng vì đã resolve argv rồi)

Xóa profile
  Settings → Agent Profiles → profile → [Delete]
  → Reject nếu profile là default_profile_id (phải đổi default trước)
  → Confirm dialog → xóa

Đổi default profile
  Settings → Agent Profiles → profile → [Set as default]
  → default_profile_id cập nhật → split button dùng profile mới
```

**UI Settings — Agent Profiles:**

```
⚙ Settings
└── Agent Profiles
    ┌─────────────────────────────────────────────────┐
    │ Agent Profiles                    [+ New Profile]│
    ├─────────────────────────────────────────────────┤
    │ ✓ Claude Code        claude_code   [Edit] [···] │  ← default (✓)
    │   Claude Opus        claude_code   [Edit] [···] │
    │   Codex auto         codex         [Edit] [···] │
    │   OpenCode fast      open_code     [Edit] [···] │
    └─────────────────────────────────────────────────┘
    [···] menu: Set as default | Delete
```

## 4.5 UI Components (shadcn-svelte)

### Layout chính

**`Resizable`** cho 3-pane sidebar/terminal/inspector — user kéo rộng hẹp từng pane. Tránh tự code drag logic.

### Mapping component theo vùng UI

**Tab bar (projects)**
- `Tabs` (`TabsList` + `TabsTrigger`) — project tabs
- `Badge` — số session running trên mỗi tab

**Sidebar — session list**
- `ScrollArea` — list session dài
- `Badge` — chấm activity (working/idle/awaiting_input) + unread count
- `Button` + `DropdownMenu` — split button `[+ New ▾]`; dropdown profiles + "New session…"

**New session dialog**
- `Dialog` — modal chọn profile / cwd / initial prompt
- `Select` — chọn profile
- `Input` — cwd override
- `Textarea` — initial prompt

**Terminal (center)**
- xterm.js trực tiếp — không qua shadcn

**Inspector (right)**
- `Input` — inline rename title (click-to-edit)
- `Badge` — status + activity state
- `Button` — Resume, Kill, Copy argv
- `Tooltip` — hover argv đầy đủ khi bị truncate
- `ScrollArea` — nếu fail_reason dài

**Settings pane**
- `Sheet` — slide-in từ phải (đúng pattern cho settings overlay)
- `Table` — danh sách profiles
- `DropdownMenu` — menu `[···]` trên mỗi profile row (Set as default / Delete)
- `AlertDialog` — confirm trước khi xóa profile hoặc kill session
- `Input` + `Select` + `Button` — form tạo/sửa profile (flag/value rows)
- `Form` (shadcn form wrapper + superforms) — validation

**Toàn app**
- `Sonner` — toast: session failed, daemon disconnect, lỗi
- `Skeleton` — loading state khi load session list ban đầu
- `Separator` — dividers trong inspector và settings

### Cài đặt

```bash
npx shadcn-svelte@latest add resizable tabs badge button dropdown-menu
npx shadcn-svelte@latest add dialog select input textarea scroll-area
npx shadcn-svelte@latest add sheet table alert-dialog form tooltip
npx shadcn-svelte@latest add sonner skeleton separator
```

## 4.6 Mock data cho phát triển GUI

Trước khi có daemon thật, Tauri shim có thể trả mock events:

```rust
// Fake session list
fn mock_list_sessions() -> Vec<SessionInfo> {
    vec![
        SessionInfo { id: "S1", agent: "claude", status: "running", cwd: "/home/user/proj" },
        SessionInfo { id: "S2", agent: "codex",  status: "finished", cwd: "/home/user/api" },
    ]
}
// Fake output stream: broadcast một dòng mỗi 200ms
```
