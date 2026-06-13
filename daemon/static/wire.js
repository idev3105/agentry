/* Wire client — JSON protocol over WebSocket.
   One WS text frame = one JSON message.
   Cmd:   { kind:"cmd",  v:1, id:"w1", cmd:"list_sessions", ...params }
   Resp:  { kind:"resp", v:1, id:"w1", ok:true,  ...data }
          { kind:"resp", v:1, id:"w1", ok:false, error:"..." }
   Event: { kind:"event", v:1, event:"session_started", ... }
*/
'use strict';
export const WIRE_V = 1;

export function connectWire(url, { onEvent, onOpen, onClose } = {}) {
  const ws = new WebSocket(url);
  const pending = new Map(); // id → {resolve, reject}
  let seq = 0;

  ws.onopen  = () => onOpen?.();
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error('closed'));
    pending.clear();
    onClose?.();
  };
  ws.onerror = (e) => console.warn('[wire] ws error', e);
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.kind === 'resp') {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error ?? 'rpc_error'));
      }
    } else if (msg.kind === 'event') {
      onEvent?.(msg);
    }
  };

  function cmd(payload) {
    return new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error('not_connected')); return;
      }
      const id = 'w' + (++seq);
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ kind: 'cmd', v: WIRE_V, id, ...payload }));
    });
  }

  return {
    cmd,
    close: () => ws.close(),
    get readyState() { return ws.readyState; },
  };
}
