const KEY = 'agentry:theme';
export type Theme = 'gruvbox' | 'one-dark';

function createTheme() {
	let cur = $state<Theme>((localStorage.getItem(KEY) as Theme) ?? 'gruvbox');
	$effect(() => { document.documentElement.dataset.theme = cur; localStorage.setItem(KEY, cur); });
	return {
		get value() { return cur; },
		set(t: Theme) { cur = t; }
	};
}

export const theme = createTheme();
