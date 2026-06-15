import { writable } from 'svelte/store';
import type { Settings } from '$lib/types';

const DENSITY_KEY = 'agentry:density';
function loadDensity(): 'comfortable' | 'compact' {
	try { return (localStorage.getItem(DENSITY_KEY) as 'comfortable' | 'compact') ?? 'comfortable'; }
	catch { return 'comfortable'; }
}

function saveDensity(d: 'comfortable' | 'compact') {
	try { localStorage.setItem(DENSITY_KEY, d); } catch {}
}

export type Density = 'comfortable' | 'compact';

export const density = writable<Density>(loadDensity());

density.subscribe(v => {
  saveDensity(v);
  if (typeof document !== 'undefined') document.documentElement.dataset.density = v;
});

export const settings = writable<Settings>({
	defaultProfileId: null,
	maxConcurrentSessions: 8,
	idleThresholdS: 10,
	awaitingThresholdS: 30,
	ringBufferBytes: 2097152
});
