# Remote Phase R3 — Webapp client thật (Junior Edition)

> Đọc `2026-06-12_remote-INDEX.md` + R1 trước. Yêu cầu R1 merge (daemon serve static + /ws). Prototype `ui-design/remote/` là design đích — port nguyên HTML/CSS, thay mock data bằng WS client thật.

**Goal:** Webapp tĩnh (vanilla JS như prototype) đặt tại `daemon/static/`, nói wire protocol JSON qua WebSocket `/ws`, đủ flow: xem session các project, mở session đọc output, gửi input/quick-keys, kill, tạo session (kế thừa project filter), trạng thái mất kết nối.

**Nguồn copy:** `ui-design/remote/index.html` (253 dòng), `style.css`, `app.js` (562 dòng — mock). HTML/CSS giữ ~nguyên; `app.js` viết lại phần data thành WS.

---

## Task R3.1 — Copy static + wire client core

**Risk:** medium · **Time:** ~3h

**Files:**
- Create: `daemon/static/index.html` (copy từ `ui-design/remote/index.html`)
- Create: `daemon/static/style.css` (copy từ `ui-design/remote/style.css`)
- Create: `daemon/static/wire.js` (MỚI — WS client)
- Create: `daemon/static/app.js` (port từ prototype, bỏ mock)

### R3.1.1 — wire.js: WS client + req/resp + events

```js
/* Wire client: JSON-line protocol over WebSocket. One frame = one message. */
'use strict';
const WIRE_V = 1;

export function connectWire(url, { onEvent, onOpen, onClose }) {
  const ws = new WebSocket(url);
  const pending = new Map(); // id -> {resolve, reject}
  let seq = 0;

  ws.onopen = () => onOpen?.();
  ws.onclose = () => { for (const p of pending.values()) p.reject(new Error('closed')); pending.clear(); onClose?.(); };
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.kind === 'resp') {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error)); }
    } else if (msg.kind === 'event') {
      onEvent?.(msg);
    }
  };

  function cmd(payload) {
    return new Promise((resolve, reject) => {
      const id = 'w' + (++seq);
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ kind: 'cmd', v: WIRE_V, id, ...payload }));
    });
  }
  return { cmd, close: () => ws.close(), get readyState() { return ws.readyState; } };
}
```

> Đối chiếu envelope với `crates/wire/src/lib.rs`: `Message` tag = `kind`, Cmd flatten với tag `cmd`, Resp flatten — kiểm tra shape resp thật bằng cách chạy daemon + `websocat ws://IP:4517/ws` gửi `{"kind":"cmd","v":1,"id":"1","cmd":"list_projects"}` xem JSON về. ĐỪNG đoán field — daemon là source of truth.

### R3.1.2 — app.js: thay mock bằng wire

Port từ prototype, giữ nguyên: view routing, render fns, filter chips, sheet flow (`sheetProject()` kế thừa filter — dòng 351-356 prototype), quick-keys, conn states UI. Thay:

| Mock (prototype) | Thật |
|---|---|
| `PROJECTS`/`PROFILES`/`SESSIONS` arrays | `list_projects` + `list_profiles` + `list_sessions{project_id}` per project khi boot |
| `startSession()` setTimeout giả | `cmd start_session{project_id,profile_id,initial_input}` |
| `sendToSession()` log push | `cmd send_input{session_id,data}` (text + `\r` cho Enter; quick-keys: y/n/1/2 = text, Enter=`\r`, Esc=`\x1b`, Up=`\x1b[A`, Down=`\x1b[B`, CtrlC=`\x03`) |
| `killSession()` | `cmd kill_session{session_id}` |
| terminal log array render | `cmd focus{session_id}` + `read_buffer{tail:N}` (base64 decode) + nhận `agent_output` event append; render text-only: strip ANSI (regex `/\x1b\[[0-9;]*[A-Za-z]/g`) — KHÔNG cần xterm.js trên mobile |
| `setConn()` simulate | WS onclose → state `daemon-down` + auto-retry exponential (1s→2s→5s, max 15s); reconnect → re-list + re-focus |
| activity/unread tự bịa | `session_activity{state,unread_seq}` events |

Boot: `connectWire('ws://' + location.host + '/ws', ...)` — cùng host vì daemon serve cả static lẫn /ws.

### Verify
```bash
mise run check   # không đụng Rust nhưng chạy cho chắc
mise run dev     # daemon chạy, bật remote (R2 UI hoặc sửa DB tay)
# Trên máy khác/điện thoại cùng tailnet: mở http://<tailscale-ip>:4517/
```
Manual checklist:
- [ ] Home list session thật từ daemon, đúng group Needs you/Running/Recent
- [ ] Mở session → output tail hiện (text), output mới stream về
- [ ] Gõ y + Enter → agent nhận (xem desktop GUI cùng lúc)
- [ ] Kill → session finished cả 2 nơi
- [ ] New session: đang lọc project X → sheet không hỏi project
- [ ] Tắt wifi điện thoại → banner mất kết nối + data đóng băng; bật lại → tự reconnect

### Commit
```bash
git add daemon/static/ && git commit -m "feat(remote): static webapp speaking wire over websocket"
```

