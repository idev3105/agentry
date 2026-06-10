import { writable } from 'svelte/store';

export type View = 'terminal' | 'profiles' | 'settings' | 'overview' | 'r9';

export interface UiState {
	activeProjectId: string | null;
	focusedSessionId: string | null;
	view: View;
	paletteOpen: boolean;
	onboardingOpen: boolean;
}

export const ui = writable<UiState>({
	activeProjectId: null,
	focusedSessionId: null,
	view: 'terminal',
	paletteOpen: false,
	onboardingOpen: false
});

export function setView(view: View) {
	ui.update((u) => ({ ...u, view }));
}
export function togglePalette() {
	ui.update((u) => ({ ...u, paletteOpen: !u.paletteOpen }));
}
export function openPalette() {
	ui.update((u) => ({ ...u, paletteOpen: true }));
}
export function closePalette() {
	ui.update((u) => ({ ...u, paletteOpen: false }));
}
export function openOnboarding() {
	ui.update((u) => ({ ...u, onboardingOpen: true }));
}
export function closeOnboarding() {
	ui.update((u) => ({ ...u, onboardingOpen: false }));
}
