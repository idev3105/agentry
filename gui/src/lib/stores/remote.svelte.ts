import { getRemoteStatus } from '$lib/ipc';
import type { RemoteStatus } from '$lib/types';

function createRemote() {
	let status = $state<RemoteStatus>({ listening: false, address: null, error: null });
	let busy = $state(false);
	let lastError = $state<string | null>(null);
	let timer: ReturnType<typeof setInterval> | null = null;

	async function refresh() {
		try {
			status = await getRemoteStatus();
			lastError = null;
		} catch (e) {
			lastError = String(e);
		}
	}

	return {
		get status() { return status; },
		get busy() { return busy; },
		get lastError() { return lastError; },
		refresh,
		startPolling() {
			if (timer) return;
			refresh();
			timer = setInterval(refresh, 5000);
		},
		stopPolling() {
			if (timer) { clearInterval(timer); timer = null; }
		},
	};
}

export const remote = createRemote();
