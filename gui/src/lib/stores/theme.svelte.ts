const KEY = 'agentry:theme';
export type Theme = 'dark' | 'light';

function createTheme() {
	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
	// migrate old gruvbox/one-dark → dark
	const valid: Theme[] = ['dark', 'light'];
	const initial: Theme = valid.includes(saved as Theme) ? (saved as Theme) : 'dark';
	let cur = $state<Theme>(initial);

	// Sync document on module init (browser only) so the persisted theme
	// takes effect immediately without waiting for a set() call.
	if (typeof document !== 'undefined') {
		document.documentElement.dataset.theme = initial;
	}

	return {
		get value() { return cur; },
		set(t: Theme) {
			cur = t;
			if (typeof document !== 'undefined') document.documentElement.dataset.theme = t;
			if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, t);
		}
	};
}

export const theme = createTheme();
