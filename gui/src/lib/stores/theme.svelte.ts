const KEY = 'agentry:theme';
const ACCENT_KEY = 'agentry:accent';
export type Theme = 'gruvbox' | 'one-dark' | 'dark' | 'light';
export type Accent = 'default' | 'teal' | 'violet' | 'amber';

function createTheme() {
	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
	let cur = $state<Theme>((saved as Theme) ?? 'gruvbox');

	// $effect.root() creates its own owner — safe to call at module level in .svelte.ts
	$effect.root(() => {
		$effect(() => {
			if (typeof document !== 'undefined') {
				document.documentElement.dataset.theme = cur;
			}
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(KEY, cur);
			}
		});
	});

	return {
		get value() { return cur; },
		set(t: Theme) { cur = t; }
	};
}

function createAccent() {
	const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(ACCENT_KEY) : null;
	let cur = $state<Accent>((saved as Accent) ?? 'default');

	$effect.root(() => {
		$effect(() => {
			if (typeof document !== 'undefined') {
				// xoá attr khi 'default' — tránh để rác `data-accent="default"` trên DOM
				if (cur === 'default') {
					delete document.documentElement.dataset.accent;
				} else {
					document.documentElement.dataset.accent = cur;
				}
			}
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem(ACCENT_KEY, cur);
			}
		});
	});

	return {
		get value() { return cur; },
		set(a: Accent) { cur = a; }
	};
}

export const theme = createTheme();
export const accent = createAccent();
