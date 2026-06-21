import { writable, get } from "svelte/store";
import type { SessionState } from "$lib/types";
import { ui } from "./ui";

export const sessions = writable<Map<string, SessionState>>(new Map());

/** Count of user-initiated starts (New session / duplicate / restart) that are
 *  still waiting for their session_started event. We can't key on session_id
 *  because the daemon may broadcast session_started BEFORE the start_session
 *  RPC response (which carries the id) reaches us — so we register intent up
 *  front, then consume one credit per fresh session_started. Resume does NOT
 *  register here. */
let pendingFocusCount = 0;

/** Call right when the user triggers a new start, before awaiting the RPC. */
export function markPendingFocus() {
  pendingFocusCount++;
}

/** Consume one pending-focus credit. Returns true if the just-started session
 *  should steal focus. */
export function takePendingFocus(): boolean {
  if (pendingFocusCount > 0) {
    pendingFocusCount--;
    return true;
  }
  return false;
}

export function upsertSession(s: SessionState) {
  sessions.update((m) => {
    m.set(s.id, s);
    return m;
  });
}

export function getSession(id: string): SessionState | undefined {
  return get(sessions).get(id);
}

export function updateSession(id: string, patch: Partial<SessionState>) {
  sessions.update((m) => {
    const s = m.get(id);
    if (s) m.set(id, { ...s, ...patch });
    return m;
  });
}

/** Mark a running/queued session as finishing immediately (UI side) and
 *  unfocus it if it was focused. Use to avoid the 1-2s lag between user
 *  pressing Kill and the daemon emitting session_finished. */
export function markSessionEnding(id: string, opts?: { failReason?: string }) {
  updateSession(id, {
    status: opts?.failReason ? "failed" : "finished",
    activity: null,
    ...(opts?.failReason ? { failReason: opts.failReason } : {}),
  });
  const u = get(ui);
  if (u.focusedSessionId === id) {
    ui.update((s) => ({ ...s, focusedSessionId: null }));
  }
}
