import type { R9StatusResp } from '$lib/types';
import { r9Status, r9Start, r9Stop, r9OpenDashboard } from '$lib/ipc';

export interface R9State extends R9StatusResp {
	busy: boolean;
	lastError: string | null;
}

function initialState(): R9State {
	return {
		resolved: 'missing',
		running: false,
		pid: null,
		port: 20128,
		busy: false,
		lastError: null,
	};
}

function createR9Store() {
	let state = $state(initialState());
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	const POLL_INTERVAL_MS = 2000;

	async function poll() {
		try {
			const fresh = await r9Status();
			state = {
				...fresh,
				busy: state.busy,
				lastError: null,
			};
		} catch (e) {
			state.lastError = e instanceof Error ? e.message : String(e);
		}
	}

	function startPolling() {
		if (pollTimer) return;
		poll();
		pollTimer = setInterval(poll, POLL_INTERVAL_MS);
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	async function start() {
		state.busy = true;
		state.lastError = null;
		try {
			const r = await r9Start();
			state = { ...state, ...r, busy: false };
		} catch (e) {
			state.lastError = e instanceof Error ? e.message : String(e);
			state.busy = false;
		}
	}

	async function stop() {
		state.busy = true;
		state.lastError = null;
		try {
			const r = await r9Stop();
			state = { ...state, ...r, busy: false };
		} catch (e) {
			state.lastError = e instanceof Error ? e.message : String(e);
			state.busy = false;
		}
	}

	async function openDashboard() {
		state.lastError = null;
		try {
			await r9OpenDashboard();
		} catch (e) {
			state.lastError = e instanceof Error ? e.message : String(e);
		}
	}

	return {
		get status() {
			return state;
		},
		get busy() {
			return state.busy;
		},
		get lastError() {
			return state.lastError;
		},
		startPolling,
		stopPolling,
		start,
		stop,
		openDashboard,
	};
}

export const r9 = createR9Store();
