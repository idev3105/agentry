import { writable } from 'svelte/store';

export type View = 'terminal' | 'profiles' | 'settings' | 'overview' | 'r9';

export interface UiState {
	activeProjectId: string | null;
	focusedSessionId: string | null;
	view: View;
	paletteOpen: boolean;
	wizardOpen: boolean;
}

export const ui = writable<UiState>({
	activeProjectId: null,
	focusedSessionId: null,
	view: 'terminal',
	paletteOpen: false,
	wizardOpen: false
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
export function openWizard() {
	ui.update((u) => ({ ...u, wizardOpen: true }));
}
export function closeWizard() {
	ui.update((u) => ({ ...u, wizardOpen: false }));
}
