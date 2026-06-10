# Terminal View Stability — Implementation Plan (Junior Edition)

> **For implementer:** Đọc hết phần "Onboarding" trước khi bắt đầu Task 1. Mỗi task = 1 commit, theo đúng thứ tự (T1 → T7), KHÔNG nhảy task. Sau mỗi task: `mise run check` phải xanh, GUI phải chạy được.

**Goal:** Khiến terminal view (xterm.js + daemon PTY) ổn định: không lẫn output giữa session, không mất/đảo bytes khi switch tab hoặc reload GUI, kích thước PTY khớp viewport ngay từ ký tự đầu, throughput PTY cao không gây lock thrash.

**Tech stack:** Rust (tokio, portable-pty, rusqlite), Svelte 5 runes, xterm.js, Tauri v2, JSON-line protocol qua Unix socket.

---

# Onboarding (đọc trước, ~15 phút)

## Đọc theo thứ tự

1. `CLAUDE.md` — kiến trúc, lệnh `mise`, foot-guns.
2. `AGENTS.md` — wire-protocol invariants (4 files đổi cùng nhau).
3. `crates/wire/src/lib.rs` — wire types (source of truth).
4. `docs/wire-protocol.md` — semantic của mỗi cmd/event (§2.4 nói rõ `agent_output` PHẢI filter theo focused — hiện chưa đúng).
5. `daemon/src/session.rs` — PTY spawn, ring buffer (đọc kỹ hàm `do_spawn`).
6. `daemon/src/server.rs` — dispatch + writer task per-connection (`_focused_clone` ở dòng ~54 là nơi cần sửa).
7. `gui/src/lib/components/TerminalView.svelte` — xterm wrapper.
8. `gui/src/routes/+page.svelte` — `pickSession`, listener `onAgentOutput`.

## Quy ước

- **Comments mới viết tiếng Anh.** Đừng đổi tiếng Việt sẵn có trong `docs/`.
- **KHÔNG bump `WIRE_VERSION`.** Mọi field mới đều `Option<T>` + `#[serde(default)]`. Daemon vẫn parse được client cũ; client mới gửi tới daemon cũ thì server ignore field thừa.
- **4 file đổi cùng nhau khi wire đổi** (xem `AGENTS.md`):
  1. `crates/wire/src/lib.rs`
  2. `daemon/src/server.rs` (dispatch nếu thêm Cmd/Resp variant)
  3. `gui/src/lib/types.ts`
  4. `gui/src/lib/ipc.ts`
- **Commit per task.** Commit message theo conventional: `fix(...)`, `feat(...)`, `perf(...)`.

## Lệnh thường dùng

```bash
mise run check    # clippy + svelte-check, PHẢI xanh trước khi commit
mise run kill     # khi daemon/socket/DB wedged
mise run reset    # kill + xoá DB (mất projects/profiles/sessions)
mise run dev      # full loop: daemon + Tauri GUI
mise run cli -- list_projects     # gọi daemon thủ công qua socket
```

GUI dev: cửa sổ Tauri sẽ mở; mở DevTools (Cmd/Ctrl+Shift+I trên Linux build, hoặc click chuột phải → Inspect) để xem console + Tauri event stream.

## Các bug phải sửa (priority order)

| # | Bug | Task |
|---|-----|------|
| 1 | Race: live `agent_output` xen vào giữa replay `readBuffer` khi switch session → terminal hiển thị bytes mới TRƯỚC bytes cũ | T1 |
| 2 | `read_buffer(from_seq=0, n=4096)` lấy 4096 chunks ĐẦU TIÊN trong ring → sau khi ring evict, replay là history cũ, không phải state hiện tại | T2 |
| 3 | Daemon broadcast `agent_output` cho mọi connection bất chấp focused session → tốn băng thông + comment `_focused_clone` trong `server.rs:54` đã thừa nhận | T3 |
| 4 | PTY luôn `openpty(rows: 24, cols: 80)` → agent TUI render 80×24 lúc khởi động, SIGWINCH sau đó không reflow retroactively → user thấy giao diện cắt cụt vài giây đầu | T4 |
| 5 | Khi `pickSession`, resize được gửi qua `ResizeObserver` async sau `readBuffer` → PTY có thể nhận size đúng SAU khi replay xong → TUI vẽ vào cỡ cũ | T5 |
| 6 | Reader PTY giữ `RwLock<HashMap<...>>` write lock cho mỗi chunk (~4KB) → contention với `read_buffer`/`send_input`/`resize`/activity timer | T6 |
| 7 | Regression sweep: sau T3, sidebar đếm unread cần lấy từ `session_activity.unread_seq` thay vì từ `agent_output` | T7 |

---

# Task 1: Frontend — chặn live `agent_output` xen vào replay buffer

**Risk:** thấp (chỉ frontend, không đụng wire).
**Time:** ~30 phút.

## Vấn đề cụ thể

Hiện tại `pickSession` trong `+page.svelte:230-260`:

```
1. termRef.clear()
2. ui.update(focusedSessionId = id)
3. await focusSession(id)       ← daemon cmd, ~1-5ms
4. await readBuffer(id, 0, 4096) ← daemon cmd, ~5-50ms phụ thuộc size
5. for each entry: termRef.write(...)
```

Cùng lúc, listener `onAgentOutput` thấy `e.session_id === $ui.focusedSessionId` (đã set ở bước 2) → `termRef.write(b64decode(...))`. Nếu agent đang phun output, bytes mới có thể write GIỮA bước 4 và 5, hoặc XEN GIỮA các entry — thứ tự bị phá → terminal hiện garbage.

## Approach

Thêm một cờ `replayingSessionId` + một queue per-session. Trong khi `replayingSessionId === id`, live chunks cho session đó được PUSH vào queue thay vì write trực tiếp. Sau replay, flush queue rồi clear cờ.

## Files

- Modify: `gui/src/routes/+page.svelte`

## Changes

### 1.1 Khai báo state mới

Tìm dòng `let termRef: TerminalView | undefined = $state();` (dòng 49). Thêm NGAY DƯỚI:

```ts
// While we're replaying the ring buffer for a freshly-picked session,
// queue live agent_output for that same session id and flush AFTER replay
// completes. Without this, the live writer races readBuffer: bytes that
// arrive between `focusSession` and `readBuffer` resolving get written
// BEFORE the older buffered chunks, scrambling the TUI.
let replayingSessionId: string | null = $state(null);
const pendingChunks: Map<string, Uint8Array[]> = new Map();
```

### 1.2 Sửa listener `onAgentOutput`

Tìm `await onAgentOutput((e) => {` (dòng ~154).

**Trước:**
```ts
if (e.session_id !== $ui.focusedSessionId) {
    updateSession(e.session_id, { unread: ($sessions.get(e.session_id)?.unread ?? 0) + 1 });
    return;
}
termRef?.write(b64decode(e.data_b64));
```

**Sau:**
```ts
if (e.session_id !== $ui.focusedSessionId) {
    updateSession(e.session_id, { unread: ($sessions.get(e.session_id)?.unread ?? 0) + 1 });
    return;
}
const bytes = b64decode(e.data_b64);
if (replayingSessionId === e.session_id) {
    let q = pendingChunks.get(e.session_id);
    if (!q) { q = []; pendingChunks.set(e.session_id, q); }
    q.push(bytes);
    return;
}
termRef?.write(bytes);
```

### 1.3 Sửa `pickSession` — set/clear cờ, flush queue trong `finally`

Thay TOÀN BỘ hàm `pickSession`:

```ts
async function pickSession(id: string) {
    // Clear synchronously BEFORE switching focus so the user never sees
    // stale content from the previous session flash through.
    termRef?.clear();
    ui.update((u) => ({ ...u, focusedSessionId: id, view: 'terminal' }));
    updateSession(id, { unread: 0 });

    // Arm the replay gate. Any agent_output that arrives between now and
    // the finally block gets queued instead of written.
    replayingSessionId = id;
    pendingChunks.set(id, []);

    try {
        await focusSession(id);
        const s = $sessions.get(id);
        if (s && (s.status === 'finished' || s.status === 'failed')) {
            const reason = s.failReason ? ` — ${s.failReason}` : '';
            const label = s.status === 'failed' ? 'failed' : 'ended';
            termRef?.write(
                new TextEncoder().encode(`\x1b[2m[Session ${label}${reason}]\x1b[0m\r\n`)
            );
            return;
        }
        const entries = await readBuffer(id, 0, 4096);
        for (const e of entries) termRef?.write(b64decode(e.data_b64));
    } catch (e) {
        console.error('focus failed:', e);
    } finally {
        // Flush queued live chunks for the session we just picked.
        // Only flush if user hasn't switched away in the meantime —
        // otherwise we'd write bytes for the wrong session into termRef.
        const queued = pendingChunks.get(id) ?? [];
        if ($ui.focusedSessionId === id) {
            for (const chunk of queued) termRef?.write(chunk);
        }
        pendingChunks.delete(id);
        if (replayingSessionId === id) replayingSessionId = null;
    }
}
```

## Verify

```bash
mise run check       # PHẢI xanh
mise run kill
mise run dev
```

Manual:
1. Setup wizard → tạo project + claude profile.
2. Start session A → gõ `for i in $(seq 1 1000); do echo "A line $i"; sleep 0.001; done` (qua `claude` hoặc bypass bằng shell profile). Output phun nhanh.
3. Tạo session B song song → gõ output tương tự.
4. Switch tới-lui A ↔ B 5 lần trong khi cả hai vẫn phun output.

**Expected:** Mỗi lần switch, terminal hiển thị history rồi tiếp tục output mới — KHÔNG bao giờ thấy "B line ..." trong tab A hoặc thứ tự bị đảo (line 500 trước line 400).

**If fail:** mở DevTools console, kiểm tra `replayingSessionId` có bị reset đúng không. Đảm bảo `finally` chạy ngay cả khi `readBuffer` throw.

## Commit

```bash
git add gui/src/routes/+page.svelte
git commit -m "fix(gui): queue live agent_output during ring-buffer replay to prevent reorder"
```

---

# Task 2: `read_buffer` lấy tail thay vì head

**Risk:** trung bình (đụng wire, nhưng field optional).
**Time:** ~45 phút.

## Vấn đề cụ thể

`session.rs:56-67`:
```rust
handle.ring.iter()
    .filter(|c| c.seq >= from_seq)
    .take(n as usize)
```

Với `from_seq=0, n=4096`: trả 4096 chunks ĐẦU TIÊN còn sót trong ring. Ring evict từ FRONT (`pop_front()` khi quá `RING_BUFFER_BYTES = 2MB`), nên 4096 đầu = chunks cũ nhất còn lại. Nếu session đã chạy lâu, đó KHÔNG phải state hiện tại của TUI.

## Approach

Thêm field `tail: Option<u32>` vào `ReadBufferCmd`. Khi `Some(t)`, daemon trả `t` chunks CUỐI CÙNG (ignore `from_seq`/`n`). Frontend dùng `tail=4096` khi replay.

## Files

- Modify: `crates/wire/src/lib.rs`
- Modify: `daemon/src/session.rs`
- Modify: `daemon/src/server.rs`
- Modify: `gui/src/lib/ipc.ts`
- Modify: `gui/src/lib/types.ts` (nếu có type cho ReadBufferCmd — kiểm tra, hiện chưa có)
- Modify: `gui/src/routes/+page.svelte` (call site)

## Changes

### 2.1 Wire: thêm field

`crates/wire/src/lib.rs` — tìm `pub struct ReadBufferCmd` (dòng 149-154). Thay bằng:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadBufferCmd {
    pub session_id: String,
    pub from_seq: u64,
    pub n: u32,
    /// If set, return the last `tail` chunks in the ring buffer and ignore
    /// from_seq/n. Used by the GUI to reconstruct current TUI state after
    /// reconnect or session switch — head-of-ring would be stale history.
    #[serde(default)]
    pub tail: Option<u32>,
}
```

### 2.2 Daemon: implement tail mode

`daemon/src/session.rs` — thay TOÀN BỘ `read_buffer`:

```rust
pub async fn read_buffer(
    &self,
    session_id: &str,
    from_seq: u64,
    n: u32,
    tail: Option<u32>,
) -> Vec<serde_json::Value> {
    let sessions = self.sessions.read().await;
    let Some(handle) = sessions.get(session_id) else { return vec![] };

    let chunks: Vec<&BufferChunk> = match tail {
        Some(t) => {
            let total = handle.ring.len();
            let skip = total.saturating_sub(t as usize);
            handle.ring.iter().skip(skip).collect()
        }
        None => handle.ring.iter()
            .filter(|c| c.seq >= from_seq)
            .take(n as usize)
            .collect(),
    };

    chunks.into_iter().map(|c| serde_json::json!({
        "seq": c.seq,
        "data_b64": base64::engine::general_purpose::STANDARD.encode(&c.data),
    })).collect()
}
```

### 2.3 Daemon dispatch: pass tail

`daemon/src/server.rs` — tìm `Cmd::ReadBuffer(c) =>` (dòng ~289). Thay:

```rust
Cmd::ReadBuffer(c) => {
    let entries = self.sessions.read_buffer(&c.session_id, c.from_seq, c.n, c.tail).await;
    Ok(serde_json::json!({"ok":true, "entries": entries}))
}
```

### 2.4 Frontend wrapper

`gui/src/lib/ipc.ts` — tìm `export async function readBuffer` (dòng 127). Thay:

```ts
export async function readBuffer(
    sessionId: string,
    fromSeq = 0,
    n = 1024,
    tail?: number
) {
    const r = await rpc({
        cmd: 'read_buffer',
        session_id: sessionId,
        from_seq: fromSeq,
        n,
        tail: tail ?? null,
    });
    return (r.entries as { seq: number; data_b64: string }[]) ?? [];
}
```

### 2.5 Frontend call site

`gui/src/routes/+page.svelte` — trong `pickSession` (sau khi áp T1). Thay:

```ts
const entries = await readBuffer(id, 0, 4096);
```

Thành:

```ts
// Pull the LAST 4096 chunks from the ring buffer, not the first.
// With from_seq=0 the daemon returns head-of-ring, which is the oldest
// surviving history after eviction — not the current TUI state.
const entries = await readBuffer(id, 0, 0, 4096);
```

### 2.6 (Optional) Types mirror

Hiện `gui/src/lib/types.ts` không có struct `ReadBufferCmd` (chỉ có Events). Không cần thêm.

## Verify

```bash
mise run check
mise run kill
mise run dev
```

Manual:
1. Start session, gõ vào shell/agent một command in HƠN 2MB output (vd `cat /usr/share/dict/words` lặp lại, hoặc `find / 2>/dev/null`).
2. Đợi đến khi output dừng. Switch sang session khác rồi quay lại.

**Expected:** Terminal hiển thị **phần cuối** output (gần prompt hiện tại) — KHÔNG phải dòng đầu của `cat`.

**Verify daemon-side:** chạy thử qua CLI:
```bash
mise run cli -- '{"v":1,"kind":"cmd","id":"x","cmd":"read_buffer","session_id":"<SID>","from_seq":0,"n":0,"tail":10}'
```
Phải thấy 10 entries với `seq` cao nhất trong ring (không phải `seq=0..9`).

## Commit

```bash
git add crates/wire/src/lib.rs daemon/src/session.rs daemon/src/server.rs \
        gui/src/lib/ipc.ts gui/src/routes/+page.svelte
git commit -m "fix(buffer): add tail mode to read_buffer for current-state replay"
```

---

# Task 3: Daemon — filter `agent_output` per-connection

**Risk:** cao (đổi semantic event, có thể regress sidebar unread).
**Time:** ~1.5h.

## Vấn đề cụ thể

`daemon/src/server.rs:53-54`:
```rust
let focused_session: Arc<RwLock<Option<String>>> = Arc::new(RwLock::new(None));
let _focused_clone = focused_session.clone();   // ← unused, comment nói "TODO"
```

Writer task ở dòng 57-75 send MỌI event tới client, bao gồm `agent_output` của session khác. Frontend phải tự lọc, lãng phí băng thông Tauri IPC + tạo race với T1.

`docs/wire-protocol.md` §2.4 nói rõ: `agent_output` (full byte-stream, nặng) **chỉ stream cho session_id đang focus**.

## Approach

Trong writer task của mỗi connection: nếu event là `AgentOutput`, đọc `focused_session.read()` — nếu khớp `session_id` thì gửi, không thì skip. Mọi event khác (started/activity/finished/failed/project_created) vẫn gửi cho mọi connection.

## Side-effect: sidebar unread

Hiện tại unread đếm bằng cách count `agent_output` events cho session không-focus (xem `+page.svelte:168-170`). Sau T3, các event đó KHÔNG còn tới → unread sẽ không tăng. Phải bù bằng `SessionActivityEvent.unread_seq` (đã có sẵn trong wire — xem `wire/lib.rs:213`).

Cách: lưu `lastSeenSeq` per session. Khi nhận `session_activity` cho session không-focus với `unread_seq > lastSeenSeq`, tăng `unread` theo delta. Khi focus session, reset `lastSeenSeq = unread_seq, unread = 0`.

## Files

- Modify: `daemon/src/server.rs`
- Modify: `gui/src/lib/types.ts` (thêm field `lastSeenSeq` vào `SessionState`)
- Modify: `gui/src/lib/stores/sessions.ts` (default value)
- Modify: `gui/src/routes/+page.svelte` (listener `onSessionActivity` + `onAgentOutput`, `pickSession`)
- Modify: `gui/src/lib/components/SessionSidebar.svelte` (kiểm tra, có thể không cần đổi vì chỉ đọc `s.unread`)

## Changes

### 3.1 Daemon writer task

`daemon/src/server.rs:47-116` — thay TOÀN BỘ `handle_connection`:

```rust
async fn handle_connection(self: Arc<Self>, stream: UnixStream) -> anyhow::Result<()> {
    let (read_half, write_half) = stream.into_split();
    let write_half = Arc::new(tokio::sync::Mutex::new(write_half));

    let event_rx = self.event_tx.subscribe();
    let focused_session: Arc<RwLock<Option<String>>> = Arc::new(RwLock::new(None));
    let write_clone = write_half.clone();
    let focused_for_writer = focused_session.clone();

    // Writer task — receives broadcast events, filters agent_output by
    // this connection's focused session, sends the rest verbatim.
    let writer_task = tokio::spawn(async move {
        let mut rx = event_rx;
        loop {
            match rx.recv().await {
                Ok(event) => {
                    // Per docs/wire-protocol.md §2.4, agent_output is
                    // streamed ONLY to the connection whose focused session
                    // matches. Every other event (session_started,
                    // session_activity, session_finished, session_failed,
                    // project_created) goes to every connection — the
                    // sidebar needs them to render badges/state for
                    // non-focused sessions.
                    if let Event::AgentOutput(ref ao) = event {
                        let f = focused_for_writer.read().await;
                        match f.as_ref() {
                            Some(sid) if sid == &ao.session_id => {}
                            _ => continue,
                        }
                    }
                    let line = match serde_json::to_string(&Message::Event(event)) {
                        Ok(mut s) => { s.push('\n'); s }
                        Err(_) => continue,
                    };
                    let mut w = write_clone.lock().await;
                    if w.write_all(line.as_bytes()).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Reader task — parses cmds, dispatches, writes resp.
    let mut reader = BufReader::new(read_half);
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 { break; }

        let msg = match serde_json::from_str::<Message>(line.trim()) {
            Ok(m) => m,
            Err(e) => {
                let resp = serde_json::json!({"v":1,"kind":"resp","id":"?","ok":false,"error":format!("parse_error: {e}")});
                let mut w = write_half.lock().await;
                let _ = w.write_all(format!("{resp}\n").as_bytes()).await;
                continue;
            }
        };

        let Message::Cmd(envelope) = msg else { continue; };

        if envelope.v > WIRE_VERSION {
            let resp = serde_json::json!({"v":1,"kind":"resp","id":envelope.id,"ok":false,"error":"unsupported_version"});
            let mut w = write_half.lock().await;
            let _ = w.write_all(format!("{resp}\n").as_bytes()).await;
            continue;
        }

        let id = envelope.id.clone();
        let resp = self.dispatch(envelope, &focused_session).await;
        let resp_msg = build_resp(&id, resp);
        let mut w = write_half.lock().await;
        let _ = w.write_all(resp_msg.as_bytes()).await;
    }

    writer_task.abort();
    Ok(())
}
```

Lưu ý: biến `_focused_clone` cũ đã bị xoá; `focused_for_writer` thay thế và được dùng thật.

### 3.2 Frontend types

`gui/src/lib/types.ts:52-63` — thêm field `lastSeenSeq`:

```ts
export interface SessionState {
    id: string;
    projectId: string;
    profileId: string;
    agent: string;
    title: string;
    cwd: string;
    status: SessionStatus;
    activity: ActivityState | null;
    unread: number;
    /** Monotonic seq counter from session_activity.unread_seq; used to
     *  derive unread badge deltas when this session is not focused. */
    lastSeenSeq: number;
    failReason: string | null;
}
```

### 3.3 Default value cho lastSeenSeq

`gui/src/routes/+page.svelte` — mọi chỗ `upsertSession({...})` (3 chỗ: trong `bootstrap` dòng ~79, trong `onSessionStarted` dòng ~126, có thể nơi khác — search `upsertSession(`). Thêm `lastSeenSeq: 0` vào object.

### 3.4 Sửa `onAgentOutput` — bỏ tự-đếm unread

`+page.svelte` listener `onAgentOutput`. Thay TOÀN BỘ (giữ thay đổi T1):

```ts
await onAgentOutput((e) => {
    const cur = $sessions.get(e.session_id);
    if (cur && (cur.status === 'starting' || cur.status === 'queued')) {
        updateSession(e.session_id, { status: 'running' });
    }
    if (cur && (cur.status === 'finished' || cur.status === 'failed')) {
        return;
    }
    // Daemon now filters agent_output per-connection by focused session
    // (server.rs writer task). The guard below is defense-in-depth in case
    // a Focus cmd is still in-flight when an event races in.
    if (e.session_id !== $ui.focusedSessionId) return;

    const bytes = b64decode(e.data_b64);
    if (replayingSessionId === e.session_id) {
        let q = pendingChunks.get(e.session_id);
        if (!q) { q = []; pendingChunks.set(e.session_id, q); }
        q.push(bytes);
        return;
    }
    termRef?.write(bytes);
});
```

### 3.5 Sửa `onSessionActivity` — derive unread

Thay TOÀN BỘ listener:

```ts
await onSessionActivity((e) => {
    const cur = $sessions.get(e.session_id);
    // Ignore late activity ticks for a session the user already killed —
    // flipping `activity` would resurrect "working" labels on a Past row.
    if (cur && (cur.status === 'finished' || cur.status === 'failed')) return;

    const patch: Partial<SessionState> = { activity: e.state };
    if (cur && cur.status === 'starting') patch.status = 'running';

    if (e.session_id === $ui.focusedSessionId) {
        // Focused: catch the seq up but don't accumulate unread.
        patch.unread = 0;
        patch.lastSeenSeq = e.unread_seq;
    } else if (cur) {
        // Non-focused: bump unread by the seq delta. Bounded so a long
        // backlog after reconnect doesn't render "9999+" badges.
        const prev = cur.lastSeenSeq ?? 0;
        const delta = Math.max(0, e.unread_seq - prev);
        if (delta > 0) {
            patch.unread = Math.min(999, cur.unread + delta);
            patch.lastSeenSeq = e.unread_seq;
        }
    }
    updateSession(e.session_id, patch);
});
```

Import `SessionState` từ `$lib/types` ở đầu file nếu chưa có.

### 3.6 `pickSession` reset lastSeenSeq

Trong `pickSession`, ngay sau `updateSession(id, { unread: 0 });`:

```ts
updateSession(id, { unread: 0, lastSeenSeq: $sessions.get(id)?.lastSeenSeq ?? 0 });
```

(Không cần thay đổi gì khác — `onSessionActivity` sẽ tự cập nhật `lastSeenSeq` khi tick tiếp theo.)

### 3.7 SessionSidebar — kiểm tra

`gui/src/lib/components/SessionSidebar.svelte:218`:
```svelte
{#if s.unread > 0 && $ui.focusedSessionId !== s.id}
    <span ...>{s.unread > 99 ? "99+" : s.unread}</span>
{/if}
```
Logic này dựa thuần vào `s.unread` — KHÔNG cần đổi. Chỉ verify nó vẫn render đúng.

## Verify

```bash
mise run check
mise run kill
mise run dev
```

Manual:
1. Start 2 sessions A, B. Focus A.
2. Trong B (qua resume hoặc khởi tạo trước rồi switch): cho phun output.
3. Quan sát sidebar: badge B tăng dần (1, 2, 3... mỗi ~1s vì `session_activity` tick 1s).
4. Mở DevTools Network/Event panel: KHÔNG thấy `daemon:agent_output` cho B khi A đang focus. (Tauri events không hiện trong Network — kiểm tra bằng cách thêm `console.log` tạm trong `onAgentOutput`.)
5. Switch sang B → badge clear → replay tail buffer chính xác (T2 đã đảm bảo).

**Edge case:** session vừa start (chưa có activity tick nào) — `unread` sẽ là 0 cho đến tick đầu tiên (~1s). Acceptable.

**If sidebar không update:** check `lastSeenSeq` được khởi tạo 0 trong mọi `upsertSession`. Nếu `undefined`, biểu thức `e.unread_seq - prev` sẽ là NaN.

## Commit

```bash
git add daemon/src/server.rs gui/src/lib/types.ts gui/src/routes/+page.svelte
git commit -m "fix(daemon): filter agent_output per-connection by focused session; derive unread from activity seq"
```

---

# Task 4: PTY mở với cols/rows từ client

**Risk:** trung bình (wire change, ảnh hưởng spawn path).
**Time:** ~1h.

## Vấn đề cụ thể

`session.rs:191-193`:
```rust
let pair = match pty_system.openpty(portable_pty::PtySize {
    rows: 24, cols: 80, pixel_width: 0, pixel_height: 0,
}) {
```

Agent CLI (Claude Code, codex) đọc `$COLUMNS`/`$LINES` hoặc TIOCGWINSZ ngay khi start → render full TUI vào 80×24. SIGWINCH đến sau (vài chục ms) thường KHÔNG khiến TUI redraw — chỉ recompute cho output tương lai. User thấy giao diện cắt cụt cho đến khi gõ command tiếp theo.

## Approach

Thêm `cols`/`rows` optional vào `StartSessionCmd` (và `ResumeSessionCmd` để đối xứng). Daemon dùng giá trị này khi `openpty`, fallback 24×80 nếu null.

Frontend: thời điểm gọi `startSession`, xterm có thể chưa mount (wizard mở khi click "New session" → terminal chưa có termRef cho session đó). Giải pháp: dùng size của xterm hiện tại (nếu có termRef), fallback `window.innerWidth / charWidth` ước lượng, hoặc cứ truyền null → daemon dùng 24×80 → frontend sẽ resize ngay khi terminal mount (`scheduleFit` tự chạy + `resize` cmd qua existing flow).

Plan: ưu tiên termRef.size() nếu có; nếu không, không gửi cols/rows (giữ behavior cũ, không regress).

## Files

- Modify: `crates/wire/src/lib.rs`
- Modify: `daemon/src/server.rs`
- Modify: `daemon/src/session.rs`
- Modify: `gui/src/lib/ipc.ts`
- Modify: `gui/src/lib/components/TerminalView.svelte`
- Modify: `gui/src/routes/+page.svelte` (truyền size khi có)
- Modify: `gui/src/lib/components/SetupWizard.svelte`, `SessionSidebar.svelte`, `CommandPalette.svelte` (3 call site của `startSession`)

## Changes

### 4.1 Wire

`crates/wire/src/lib.rs` — `StartSessionCmd` (dòng 102-108):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartSessionCmd {
    pub project_id: String,
    pub profile_id: String,
    pub cwd: Option<String>,
    pub initial_input: Option<String>,
    #[serde(default)]
    pub cols: Option<u16>,
    #[serde(default)]
    pub rows: Option<u16>,
}
```

Tương tự `ResumeSessionCmd` (dòng 110-113):
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeSessionCmd {
    pub session_id: String,
    #[serde(default)]
    pub cols: Option<u16>,
    #[serde(default)]
    pub rows: Option<u16>,
}
```

### 4.2 Daemon — propagate

`daemon/src/session.rs`:

Đổi signature `spawn`:
```rust
pub async fn spawn(
    self: Arc<Self>,
    session_id: String,
    profile: DbProfile,
    cwd: String,
    initial_input: Option<String>,
    initial_size: Option<(u16, u16)>,   // (cols, rows)
    store: Arc<Store>,
    event_tx: EventTx,
) -> anyhow::Result<()> {
    let argv = build_argv(&profile, None);
    let env_pairs = parse_env(&profile.env);
    store.update_session_status(&session_id, "running")?;
    store.set_setting("dummy", "dummy").ok();
    self.do_spawn(session_id, argv, env_pairs, cwd, initial_input, None, initial_size, store, event_tx, profile.start_script).await
}
```

Đổi signature `spawn_resume` tương tự, thêm `initial_size: Option<(u16, u16)>` và pass xuống `do_spawn`.

Đổi signature `do_spawn` — thêm `initial_size: Option<(u16, u16)>` vào argument list (đặt sau `agent_session_id_preset`):

```rust
async fn do_spawn(
    self: Arc<Self>,
    session_id: String,
    argv: Vec<String>,
    env_pairs: Vec<(String, String)>,
    cwd: String,
    initial_input: Option<String>,
    agent_session_id_preset: Option<String>,
    initial_size: Option<(u16, u16)>,
    store: Arc<Store>,
    event_tx: EventTx,
    start_script: Option<String>,
) -> anyhow::Result<()> {
```

Trong `do_spawn`, ngay trước `std::thread::spawn(move || {`, capture giá trị:

```rust
let (init_cols, init_rows) = initial_size.unwrap_or((80, 24));
```

Pass vào closure (capture by value tự động qua move).

Trong closure, đổi `openpty`:
```rust
let pair = match pty_system.openpty(portable_pty::PtySize {
    rows: init_rows,
    cols: init_cols,
    pixel_width: 0,
    pixel_height: 0,
}) {
```

### 4.3 Daemon dispatch — pass cols/rows

`daemon/src/server.rs` — `Cmd::StartSession(c) =>`. Tìm dòng `let _ = sessions.spawn(...)` (~dòng 246). Thay:

```rust
let initial_size = match (c.cols, c.rows) {
    (Some(c), Some(r)) => Some((c, r)),
    _ => None,
};
// ... bên trong tokio::spawn:
let _ = sessions.spawn(sid, profile_clone, cwd, initial_input, initial_size, store, event_tx).await;
```

(Lưu ý `initial_input` đã capture bằng `c.initial_input` ở dòng 244; thêm `let initial_size = ...` trước `tokio::spawn`.)

Tương tự cho `Cmd::ResumeSession(c) =>` (~dòng 311):
```rust
let initial_size = match (c.cols, c.rows) {
    (Some(c), Some(r)) => Some((c, r)),
    _ => None,
};
// ... bên trong tokio::spawn:
let _ = sessions.spawn_resume(sid, profile, cwd, resume_from, initial_size, store, event_tx).await;
```

### 4.4 Frontend — TerminalView getter

`gui/src/lib/components/TerminalView.svelte` — thêm export sau hàm `clear()`:

```ts
export function size(): { cols: number; rows: number } | null {
    if (!term || term.cols <= 0 || term.rows <= 0) return null;
    return { cols: term.cols, rows: term.rows };
}
```

### 4.5 Frontend — ipc wrapper

`gui/src/lib/ipc.ts:66-80`:

```ts
export async function startSession(
    projectId: string,
    profileId: string,
    cwd?: string,
    initialInput?: string,
    cols?: number,
    rows?: number,
): Promise<{ session_id: string; status: string }> {
    const r = await rpc({
        cmd: 'start_session',
        project_id: projectId,
        profile_id: profileId,
        cwd: cwd ?? null,
        initial_input: initialInput ?? null,
        cols: cols ?? null,
        rows: rows ?? null,
    });
    return r as { ok: true; session_id: string; status: string };
}
```

Tương tự `resumeSession` (dòng 112):
```ts
export async function resumeSession(
    sessionId: string,
    cols?: number,
    rows?: number,
): Promise<{ session_id: string; status: string }> {
    const r = await rpc({
        cmd: 'resume_session',
        session_id: sessionId,
        cols: cols ?? null,
        rows: rows ?? null,
    });
    return r as { ok: true; session_id: string; status: string };
}
```

### 4.6 Call sites — pass size

Có 3 call site `startSession` (đã grep):

1. `gui/src/lib/components/SetupWizard.svelte:111` — wizard mở khi chưa có terminal pane → termRef chưa tồn tại → KHÔNG truyền size, để daemon dùng default 80×24. Resize sau khi mount sẽ điều chỉnh.

2. `gui/src/lib/components/CommandPalette.svelte:93` — tương tự, có thể chưa có termRef hoặc của session khác. Để mặc định.

3. `gui/src/lib/components/SessionSidebar.svelte:75` — New session button. Cùng project, có thể có termRef nếu user đang focus session. Để mặc định cho đơn giản.

Vậy không cần truyền cols/rows trong các call site frontend hiện tại. **Lý do giữ wire field:** tương lai khi GUI biết size trước khi spawn (vd full-screen mode), hoặc CLI client muốn spawn với size đúng.

→ Bỏ qua thay đổi 3 file Svelte này. CHỈ thay đổi wire + daemon + ipc wrapper signature (backward-compatible).

### 4.7 (Quan trọng) Resize ngay sau mount cho new session

`+page.svelte` listener `onSessionStarted` (dòng ~125). Sau khi `upsertSession({...})` và `pickSession(e.session_id)`, terminal sẽ clear + replay. Nhưng PTY vẫn 80×24. Cần gửi resize ngay khi `pickSession` xong.

→ **Việc này thuộc T5** (next task). Skip ở đây.

## Verify

```bash
mise run check
mise run kill
mise run reset    # đảm bảo DB fresh, tránh sessions cũ
mise run dev
```

Manual:
1. Maximize cửa sổ Tauri trước khi setup.
2. Tạo project + claude profile → start session.
3. Quan sát ngay khi `claude` boot: TUI render — **vẫn cắt 80 cột** (vì wizard không truyền size).

→ Đây là expected behavior cho T4 standalone. T5 sẽ sửa nốt: sau khi terminal mount, resize cmd đẩy lên ngay → TUI re-render. Hoặc nếu muốn fix triệt để ngay T4, hardcode `cols/rows` từ `window.innerWidth / 8` ở wizard — nhưng dễ sai. Để T5 lo.

**Verify ngược (backward compat):** CLI cũ KHÔNG gửi cols/rows → daemon vẫn parse OK + fallback 80×24:
```bash
mise run cli -- '{"v":1,"kind":"cmd","id":"x","cmd":"start_session","project_id":"<PID>","profile_id":"<PRID>"}'
```

## Commit

```bash
git add crates/wire/src/lib.rs daemon/src/server.rs daemon/src/session.rs gui/src/lib/ipc.ts gui/src/lib/components/TerminalView.svelte
git commit -m "feat(session): accept optional cols/rows in start_session/resume_session"
```

---

# Task 5: Frontend — gửi `resize` trước `read_buffer` khi pickSession

**Risk:** thấp.
**Time:** ~30 phút.

## Vấn đề cụ thể

Khi switch session, `pickSession` gọi `focusSession` → `readBuffer` → write entries. Trong khoảng đó, PTY của session đó vẫn dùng size cũ (size lúc spawn, hoặc size lần resize cuối). Sau khi user thấy nội dung, ResizeObserver mới fit và gửi `resize` → TUI redraw lần 2 → flicker.

## Approach

Sau `focusSession`, gọi xterm `ensureFit` (đồng bộ với rAF), rồi gửi `resize` cmd với cols/rows hiện tại, AWAIT, rồi mới `readBuffer`.

## Files

- Modify: `gui/src/lib/components/TerminalView.svelte`
- Modify: `gui/src/routes/+page.svelte`

## Changes

### 5.1 TerminalView — `ensureFit`

`gui/src/lib/components/TerminalView.svelte`. Sau hàm `scheduleFit`, thêm:

```ts
// Force a synchronous fit and wait one rAF for layout to commit, then
// return the resulting xterm dimensions. Used by callers that need to
// push the PTY size to the daemon BEFORE replaying the ring buffer.
export async function ensureFit(): Promise<{ cols: number; rows: number } | null> {
    if (!fitAddon || !term) return null;
    syncSize();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    syncSize();
    if (term.cols <= 0 || term.rows <= 0) return null;
    return { cols: term.cols, rows: term.rows };
}
```

### 5.2 `+page.svelte` — gọi resize trước readBuffer

Trong `pickSession` (đã có thay đổi T1+T2), trước dòng `const entries = await readBuffer(id, 0, 0, 4096);`, thêm:

```ts
// Push the current xterm viewport to the PTY BEFORE we ask for the
// ring buffer. The PTY's pre-existing size may be 80x24 (initial spawn)
// or a stale value from a previous focus on a different window. Without
// this, the agent TUI re-renders into the wrong geometry and flickers
// when ResizeObserver eventually catches up.
const sz = await termRef?.ensureFit();
if (sz) {
    try {
        await resize(id, sz.cols, sz.rows);
    } catch (err) {
        console.warn('pre-replay resize failed (non-fatal):', err);
    }
}
```

Import `resize` từ `$lib/ipc` (kiểm tra dòng import trên cùng — hiện có `resize` không? Hiện tại `+page.svelte` import từ `$lib/ipc` nhưng KHÔNG có `resize`. Thêm vào import block):

```ts
import {
    listProjects,
    listProfiles,
    listSessions,
    getSettings,
    sendInput,
    focusSession,
    readBuffer,
    killSession,
    startSession,
    resize,            // ← thêm dòng này
    sendCmd,
    onProjectCreated,
    onSessionStarted,
    onAgentOutput,
    onSessionActivity,
    onSessionFinished,
    onSessionFailed,
    onDaemonConnected,
    onBootstrapError
} from '$lib/ipc';
```

## Verify

```bash
mise run check
mise run kill
mise run dev
```

Manual:
1. Start session A trong cửa sổ to → TUI render rộng.
2. Thu nhỏ cửa sổ (kéo edge phải vào, hoặc Cmd+Minus zoom out OS-level).
3. Start session B → wizard không biết size, daemon spawn 80×24 → TUI B mặc định cắt.
4. Switch sang B: **trong cùng một frame** terminal phải resize PTY rồi mới hiện nội dung → TUI B reflow ngay, không flicker.
5. Switch về A: A đã chạy rồi, PTY của A vẫn cỡ to (size lúc spawn). Nhưng cửa sổ giờ nhỏ. → `pickSession` gửi resize trước replay → TUI A vẽ vào cỡ nhỏ → OK.

**If terminal trống sau switch:** ensureFit có thể trả null vì container chưa visible. Check `containerEl.clientWidth/Height` trong `syncSize`.

## Commit

```bash
git add gui/src/lib/components/TerminalView.svelte gui/src/routes/+page.svelte
git commit -m "fix(gui): resize PTY to current viewport before replaying ring buffer"
```

---

# Task 6: Daemon — split per-session state khỏi `RwLock<HashMap>`

**Risk:** cao (đụng hot path PTY reader, dễ deadlock nếu sai).
**Time:** ~2h.

## Vấn đề cụ thể

Trong PTY reader loop (`session.rs:339-374`), mỗi chunk PTY (~4KB) trigger:
```rust
rt_read.block_on(async {
    let mut sessions = sessions_arc.write().await;   // ← write lock toàn map
    if let Some(h) = sessions.get_mut(&session_id_clone) {
        h.ring.push_back(...);
        h.ring_bytes += ...;
        while h.ring_bytes > RING_BUFFER_BYTES { ... }
        h.last_output_at = ...;
        h.activity = ...;
    }
});
```

Cùng `RwLock<HashMap>` này phục vụ:
- `read_buffer` (read lock per call)
- `send_input` (read lock per call)
- `resize` (read lock per call)
- `kill` (read lock per call)
- Activity timer (write lock 1s/session)
- Insert session (write lock on spawn)
- Remove session (write lock on exit)

PTY reader giữ write lock → MỌI thao tác khác trên map phải đợi. Với TUI agent phun output (Claude Code render heavy), throughput PTY có thể 100+ chunks/s → write lock thrash.

## Approach

Split `SessionHandle` thành:
- Outer (`RwLock<HashMap<String, SessionHandle>>`): channels (`input_tx`, `resize_tx`, `kill_tx`) — read-only sau khi insert.
- Inner (`Arc<std::sync::Mutex<SessionInner>>`): hot state (ring, activity, last_output_at) — mỗi session một mutex riêng, contention chỉ trong cùng session.

PTY reader clone `Arc<Mutex<SessionInner>>` MỘT LẦN trước loop, sau đó mỗi chunk lock inner ngắn, KHÔNG touch outer map.

`read_buffer` cần `inner.lock()` — vẫn block reader nếu trùng session, nhưng chỉ vài µs cho việc clone vec ref.

## Files

- Modify: `daemon/src/session.rs`

(Không cần đổi `Cargo.toml` — dùng `std::sync::Mutex` từ stdlib, không cần `parking_lot`.)

## Changes

### 6.1 Sửa struct definitions

`daemon/src/session.rs` đầu file:

```rust
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, RwLock};
use agentry_wire::*;
use base64::Engine;

use crate::store::{Store, DbProfile};
use crate::server::EventTx;

const RING_BUFFER_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct BufferChunk {
    pub seq: u64,
    pub data: Vec<u8>,
}

/// Hot per-session state. Locked separately so the PTY reader's per-chunk
/// updates don't fight read_buffer/send_input/resize on the outer map.
struct SessionInner {
    activity: ActivityState,
    last_output_at: std::time::Instant,
    ring: VecDeque<BufferChunk>,
    ring_bytes: usize,
}

struct SessionHandle {
    input_tx: mpsc::UnboundedSender<Vec<u8>>,
    resize_tx: mpsc::UnboundedSender<(u16, u16)>,
    kill_tx: mpsc::UnboundedSender<()>,
    inner: Arc<Mutex<SessionInner>>,
}
```

### 6.2 Insert: khởi tạo inner

`do_spawn`, chỗ insert handle (dòng 165-176):

```rust
let inner = Arc::new(Mutex::new(SessionInner {
    activity: ActivityState::Working,
    last_output_at: std::time::Instant::now(),
    ring: VecDeque::new(),
    ring_bytes: 0,
}));

{
    let mut sessions = self.sessions.write().await;
    sessions.insert(session_id.clone(), SessionHandle {
        input_tx,
        resize_tx,
        kill_tx,
        inner: inner.clone(),
    });
}
```

### 6.3 Reader loop — lock inner

`do_spawn` closure. Trước `std::thread::spawn(move || {`, capture `inner_for_reader`:

```rust
let inner_for_reader = inner.clone();
```

(Biến `inner` đã được clone vào HashMap ở §6.2; clone tiếp cho reader thread.)

Bên trong closure, thay block `rt_read.block_on(async { ... sessions_arc.write() ... })` (dòng ~349-365) bằng:

```rust
// Hot path: lock ONLY this session's inner, never the outer map.
{
    let mut g = inner_for_reader.lock().unwrap();
    let chunk_len = chunk.len();
    g.ring.push_back(BufferChunk { seq, data: chunk.clone() });
    g.ring_bytes += chunk_len;
    while g.ring_bytes > RING_BUFFER_BYTES {
        if let Some(old) = g.ring.pop_front() {
            g.ring_bytes -= old.data.len();
        } else { break; }
    }
    g.last_output_at = std::time::Instant::now();
    g.activity = ActivityState::Working;
}
```

`sessions_arc` clone vẫn cần cho final cleanup (remove khi exit) — giữ nguyên. Loại bỏ `rt_read` call ở hot path. Cuối closure, đoạn `sessions_arc.write().await.remove(...)` vẫn giữ nguyên (chạy 1 lần khi session kết thúc).

### 6.4 `read_buffer` — clone Arc, lock inner

Thay TOÀN BỘ `read_buffer` (sau khi đã có thay đổi T2):

```rust
pub async fn read_buffer(
    &self,
    session_id: &str,
    from_seq: u64,
    n: u32,
    tail: Option<u32>,
) -> Vec<serde_json::Value> {
    // Outer read lock briefly to grab the inner Arc, then drop it.
    let inner = {
        let sessions = self.sessions.read().await;
        let Some(handle) = sessions.get(session_id) else { return vec![] };
        handle.inner.clone()
    };
    let g = inner.lock().unwrap();
    let chunks: Vec<&BufferChunk> = match tail {
        Some(t) => {
            let total = g.ring.len();
            let skip = total.saturating_sub(t as usize);
            g.ring.iter().skip(skip).collect()
        }
        None => g.ring.iter()
            .filter(|c| c.seq >= from_seq)
            .take(n as usize)
            .collect(),
    };
    chunks.into_iter().map(|c| serde_json::json!({
        "seq": c.seq,
        "data_b64": base64::engine::general_purpose::STANDARD.encode(&c.data),
    })).collect()
}
```

### 6.5 `get_activity` — clone Arc, lock inner

```rust
pub fn get_activity(&self, session_id: &str) -> Option<String> {
    tokio::task::block_in_place(|| {
        let inner = {
            let sessions = futures::executor::block_on(self.sessions.read());
            sessions.get(session_id).map(|h| h.inner.clone())?
        };
        let g = inner.lock().ok()?;
        Some(match g.activity {
            ActivityState::Working => "working".to_string(),
            ActivityState::Idle => "idle".to_string(),
            ActivityState::AwaitingInput => "awaiting_input".to_string(),
        })
    })
}
```

### 6.6 Activity timer — dùng inner

Trong `do_spawn`, đoạn cuối (dòng ~397-436), capture `inner_for_timer`:

```rust
let inner_for_timer = inner.clone();
let sessions_arc2 = self.sessions.clone();
let session_id2 = session_id.clone();
let event_tx2 = event_tx.clone();
let idle_threshold = store.get_settings_all().map(|s| s.idle_threshold_s).unwrap_or(10);
let awaiting_threshold = store.get_settings_all().map(|s| s.awaiting_threshold_s).unwrap_or(30);

tokio::spawn(async move {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
    loop {
        interval.tick().await;

        // Check liveness via outer map (read lock, cheap). If session was
        // removed (PTY exited), break.
        {
            let sessions = sessions_arc2.read().await;
            if !sessions.contains_key(&session_id2) { break; }
        }

        let (new_activity, unread_seq) = {
            let mut g = inner_for_timer.lock().unwrap();
            let elapsed = g.last_output_at.elapsed().as_secs();
            let na = if elapsed >= awaiting_threshold as u64 {
                ActivityState::AwaitingInput
            } else if elapsed >= idle_threshold as u64 {
                ActivityState::Idle
            } else {
                ActivityState::Working
            };
            g.activity = na.clone();
            let seq = g.ring.back().map(|c| c.seq).unwrap_or(0);
            (na, seq)
        };

        let _ = event_tx2.send(Event::SessionActivity(SessionActivityEvent {
            v: WIRE_VERSION,
            session_id: session_id2.clone(),
            state: new_activity,
            unread_seq,
            ts: chrono_now(),
        }));
    }
});
```

### 6.7 Foot-gun nhắc nhở

- KHÔNG gọi `inner.lock()` từ trong async context và giữ qua `await` — `std::sync::MutexGuard: !Send`. Pattern an toàn: lock trong block `{ }`, copy ra giá trị, drop guard trước khi `await`.
- KHÔNG lock 2 inner cùng lúc (không có usecase, nhưng tránh deadlock).
- `inner.lock().unwrap()` — panic chỉ xảy ra nếu mutex poisoned (panic trong holder). Cho session daemon dài-hạn, có thể đáng dùng `try_lock` + log, nhưng tạm thời `unwrap` đủ.

## Verify

```bash
mise run check    # PHẢI xanh, đặc biệt clippy lưu ý await-holding-lock
mise run kill
mise run dev
```

Manual:
1. Start session, chạy lệnh phun nhiều output (`find / 2>/dev/null | head -10000` hoặc `yes | head -100000`).
2. Quan sát: terminal mượt, activity dot vẫn cập nhật ~1s, `Cmd+Shift+K` kill vẫn nhanh.
3. Stress test: 4 session đồng thời mỗi cái phun output. Switch giữa chúng — vẫn responsive.

**Performance check (qualitative):**
- Trước T6: switch session lag rõ khi 1 trong các session đang phun output.
- Sau T6: switch session mượt bất kể tải.

**If panics:** `mutex poisoned` — log sẽ ghi panic trước đó. Xem `~/.agentry/daemon.log`.

**If deadlock:** kiểm tra mọi `inner.lock()` không bị `await` giữ qua. Có thể test bằng cách thêm timeout vào `read_buffer`.

## Commit

```bash
git add daemon/src/session.rs
git commit -m "perf(session): split hot per-session state into Arc<Mutex<>> to eliminate RwLock thrash"
```

---

# Task 7: Regression sweep + cleanup

**Risk:** thấp.
**Time:** ~30 phút.

## Mục đích

Sau khi T3 đổi nguồn unread sang `session_activity.unread_seq`, xem lại có chỗ nào còn rely vào `agent_output` cross-session để cập nhật state không. Cleanup dead code (`_focused_clone` đã xoá ở T3).

## Checklist

### 7.1 Đọc các component liên quan

```
read_file gui/src/lib/components/SessionSidebar.svelte
read_file gui/src/lib/components/Inspector.svelte
read_file gui/src/lib/components/CommandPalette.svelte
read_file gui/src/lib/components/ActivityBar.svelte
read_file gui/src/lib/views/OverviewView.svelte
```

Tìm bất kỳ nơi nào đọc `agent_output` qua store hoặc tự sub event. Nếu có, cập nhật để dùng `unread`/`activity` từ `SessionState`.

### 7.2 Verify end-to-end

```bash
mise run check
mise run kill
mise run reset
mise run dev
```

Kịch bản full:

1. Setup wizard → tạo project + claude profile.
2. Start session A → gõ prompt → output dài.
3. Start session B trong cùng project.
4. Switch tới-lui A ↔ B 10 lần. Mỗi lần content phải hợp lệ, không lẫn.
5. Resize cửa sổ Tauri từ to → nhỏ → to. TUI reflow trong < 200ms mỗi lần.
6. Đóng GUI (Cmd+W). Daemon vẫn chạy (check `~/.agentry/daemon.pid`).
7. Mở lại GUI (`mise run dev` hoặc `pnpm tauri:dev` trong `gui/`). Session vẫn đang chạy → switch vào → terminal hiển thị **state hiện tại** của TUI (T2).
8. `Cmd+Shift+K` kill session A → A chuyển sang Past placeholder ngay, B không ảnh hưởng.
9. Stress: chạy lệnh phun output dài trong A và B đồng thời. Switch — vẫn responsive (T6).

### 7.3 Xoá dead code

Tìm và xoá:
- `_focused_clone` trong `daemon/src/server.rs` (đã xoá ở T3, double-check).
- `_focused_session` nếu còn unused (kiểm tra warning clippy).
- Bất kỳ comment `TODO: filter agent_output by focused session` (đã làm).

### 7.4 Cập nhật docs

`docs/wire-protocol.md` §2.4 hiện đã đúng với code sau T3 — verify, không sửa.

`CLAUDE.md` "Known foot-guns" — thêm dòng (giữ tiếng Anh):

```markdown
- **`SessionHandle::inner` is std::sync::Mutex.** Hot per-session state (ring, activity) lives in `Arc<Mutex<SessionInner>>` separate from the outer `RwLock<HashMap>`. NEVER hold an `inner.lock()` guard across `.await` — `MutexGuard: !Send`. Lock in a block, copy out the data, drop the guard, then await.
```

## Commit

```bash
git add CLAUDE.md daemon/src/server.rs
git commit -m "docs+chore: document SessionInner locking discipline; remove dead _focused_clone"
```

---

# Hoàn thành — verification cuối cùng

```bash
mise run kill
mise run reset
mise run check    # xanh
mise run dev
```

Bật DevTools, theo dõi console — không có warning Svelte/TS, không có error Tauri.

Kịch bản từ §7.2 — chạy lại lần cuối. Tất cả 9 bước phải pass.

# Phụ lục: troubleshooting nhanh

## "rpc timeout" sau khi thay đổi daemon

Daemon panic hoặc deadlock. Check:
```bash
tail -100 ~/.agentry/daemon.log
mise run kill
mise run dev
```

## svelte-check fail với `Property 'lastSeenSeq' missing`

Một `upsertSession({...})` chưa thêm `lastSeenSeq: 0`. Grep:
```
search_files "upsertSession\(" path="gui/src"
```

## Clippy warning `await_holding_lock`

T6 sai pattern. Lock `inner` ngoài, copy ra, drop guard, rồi `await`. KHÔNG `await` khi đang giữ `MutexGuard`.

## Terminal vẫn lẫn output sau T1-T3

Check `replayingSessionId` reset trong `finally` đúng không. Mở DevTools, thêm `console.log('flush', id, queued.length)` tạm trong `finally` để xác nhận.

## Resize không có hiệu lực

PTY có thể không nhận SIGWINCH nếu agent CLI ignore. Test bằng cách quan sát `claude` resize: maximize cửa sổ → claude phải reflow. Nếu không, vấn đề là agent CLI, không phải code agentry.

## Build error `the trait bound 'Option<u16>: Default'`

Wire field thiếu `#[serde(default)]`. Recheck T2 §2.1 và T4 §4.1.
