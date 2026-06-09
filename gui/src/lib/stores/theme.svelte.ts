const KEY = 'agentry:theme';
export type Theme = 'gruvbox' | 'one-dark';

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

export const theme = createTheme();
