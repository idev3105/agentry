import { writable } from 'svelte/store';
import type { Settings } from '$lib/types';

export const settings = writable<Settings>({
	defaultProfileId: null,
	maxConcurrentSessions: 8,
	idleThresholdS: 10,
	awaitingThresholdS: 30,
	ringBufferBytes: 2097152
});
