const KEY = 'agentry:theme';
const ACCENT_KEY = 'agentry:accent';
export type Theme = 'dark' | 'light';
export type Accent = 'default' | 'teal' | 'violet' | 'amber';

function createTheme() {
	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
	// migrate old gruvbox/one-dark → dark
	const valid: Theme[] = ['dark', 'light'];
	const initial: Theme = valid.includes(saved as Theme) ? (saved as Theme) : 'dark';
	let cur = $state<Theme>(initial);

	return {
		get value() { return cur; },
		set(t: Theme) {
			cur = t;
			if (typeof document !== 'undefined') document.documentElement.dataset.theme = t;
			if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, t);
		}
	};
}

function createAccent() {
	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(ACCENT_KEY) : null;
	let cur = $state<Accent>((saved as Accent) ?? 'default');

	return {
		get value() { return cur; },
		set(a: Accent) {
			cur = a;
			if (typeof document !== 'undefined') {
				if (a === 'default') delete document.documentElement.dataset.accent;
				else document.documentElement.dataset.accent = a;
			}
			if (typeof localStorage !== 'undefined') localStorage.setItem(ACCENT_KEY, a);
		}
	};
}

export const theme = createTheme();
export const accent = createAccent();
