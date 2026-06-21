import { writable } from 'svelte/store';

export type View = 'terminal' | 'projects' | 'profiles' | 'settings' | 'overview' | 'r9';

export interface UiState {
	activeProjectId: string | null;
	focusedSessionId: string | null;
	view: View;
	paletteOpen: boolean;
	onboardingOpen: boolean;
	sidebarCollapsed: boolean;
	inspectorCollapsed: boolean;
}

function loadBool(key: string): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(key) === '1';
}

function saveBool(key: string, val: boolean) {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(key, val ? '1' : '0');
}

export const ui = writable<UiState>({
	activeProjectId: null,
	focusedSessionId: null,
	view: 'terminal',
	paletteOpen: false,
	onboardingOpen: false,
	sidebarCollapsed: loadBool('ui:sidebarCollapsed'),
	inspectorCollapsed: loadBool('ui:inspectorCollapsed')
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
export function toggleSidebar() {
	ui.update((u) => {
		const next = !u.sidebarCollapsed;
		saveBool('ui:sidebarCollapsed', next);
		return { ...u, sidebarCollapsed: next };
	});
}
export function toggleInspector() {
	ui.update((u) => {
		const next = !u.inspectorCollapsed;
		saveBool('ui:inspectorCollapsed', next);
		return { ...u, inspectorCollapsed: next };
	});
}
