import { writable, get } from 'svelte/store';
import type { SessionState } from '$lib/types';
import { ui } from './ui';

export const sessions = writable<Map<string, SessionState>>(new Map());

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
		status: opts?.failReason ? 'failed' : 'finished',
		activity: null,
		...(opts?.failReason ? { failReason: opts.failReason } : {})
	});
	const u = get(ui);
	if (u.focusedSessionId === id) {
		ui.update((s) => ({ ...s, focusedSessionId: null }));
	}
}
