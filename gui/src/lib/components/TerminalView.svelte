<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { resize as resizeCmd } from '$lib/ipc';

let { sessionId, onInput, ctl = $bindable<{findNext:(q:string)=>void; findPrev:(q:string)=>void} | null>(null) }: {
    sessionId: string | null;
    onInput: (data: string) => void;
    ctl?: { findNext: (q: string) => void; findPrev: (q: string) => void } | null;
} = $props();

	let containerEl: HTMLDivElement;
	let term: Terminal | null = null;
	let fitAddon: FitAddon | null = null;
	let rafId = 0;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	function syncSize() {
		if (!fitAddon || !term || !sessionId) return;
		// Never fit against a collapsed container — that locks the terminal to
		// xterm's 80×24 default and leaves it that size once layout settles.
		if (!containerEl || containerEl.clientWidth === 0 || containerEl.clientHeight === 0) return;
		try {
			fitAddon.fit();
		} catch {
			return;
		}
		// Send geometry to daemon so PTY matches; ignore failure when not connected.
		resizeCmd(sessionId, term.cols, term.rows).catch(() => {});
	}

	// Fit only after layout is committed. A single rAF can still race the
	// webview's layout/paint; a double rAF plus a short trailing timeout
	// guarantees the container has its final width before we measure.
	function scheduleFit() {
		cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(() => {
			rafId = requestAnimationFrame(syncSize);
		});
		clearTimeout(settleTimer);
		settleTimer = setTimeout(syncSize, 120);
	}

	onMount(() => {
		term = new Terminal({
			theme: {
				background:    '#282828',
				foreground:    '#ebdbb2',
				cursor:        '#fabd2f',
				cursorAccent:  '#282828',
				selectionBackground: '#504945',
				black:         '#282828',
				red:           '#cc241d',
				green:         '#98971a',
				yellow:        '#d79921',
				blue:          '#458588',
				magenta:       '#b16286',
				cyan:          '#689d6a',
				white:         '#a89984',
				brightBlack:   '#928374',
				brightRed:     '#fb4934',
				brightGreen:   '#b8bb26',
				brightYellow:  '#fabd2f',
				brightBlue:    '#83a598',
				brightMagenta: '#d3869b',
				brightCyan:    '#8ec07c',
				brightWhite:   '#ebdbb2',
			},
			// Font chain prefers monospace families with better Vietnamese
			// diacritic placement (stacked tones like ấ ầ ữ). Fallback to
			// generic 'monospace' so the user's system pick still works.
			fontFamily:
				'"JetBrains Mono", "Fira Code", "Cascadia Code", "Source Code Pro", "Noto Sans Mono", "DejaVu Sans Mono", "Liberation Mono", monospace',
			fontSize: 13,
			cursorBlink: true,
			// Lets xterm use newer Unicode/IME APIs (composition positioning,
			// width calculations) — needed for cleaner CJK/Vietnamese input.
			allowProposedApi: true,
		});
		fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		const searchAddon = new SearchAddon();
		term.loadAddon(searchAddon);
		ctl = {
			findNext: (q) => searchAddon.findNext(q),
			findPrev: (q) => searchAddon.findPrevious(q)
		};
		term.open(containerEl);

		// Tighten the hidden textarea xterm uses for keyboard + IME input.
		// WebKit/GTK on Linux runs IBus/fcitx through this textarea; turning
		// off browser autocorrect/spellcheck/autocapitalize keeps the IME
		// from getting double-handled, and lang="vi" helps WebKit pick the
		// right composition context for Vietnamese input methods.
		const ta = (term as unknown as { textarea?: HTMLTextAreaElement })
			.textarea;
		if (ta) {
			ta.setAttribute('autocomplete', 'off');
			ta.setAttribute('autocorrect', 'off');
			ta.setAttribute('autocapitalize', 'off');
			ta.setAttribute('spellcheck', 'false');
			ta.setAttribute('lang', 'vi');
		}

		term.onData((data) => onInput(data));

		const ro = new ResizeObserver(() => scheduleFit());
		ro.observe(containerEl);

		scheduleFit();

		return () => {
			ro.disconnect();
			cancelAnimationFrame(rafId);
			clearTimeout(settleTimer);
		};
	});

	// Re-sync geometry whenever the focused session changes — the PTY for the
	// newly-focused session needs to match the current terminal viewport so
	// the agent re-renders into the full pane (instead of the 80×24 default).
	$effect(() => {
		void sessionId;
		scheduleFit();
	});

	onDestroy(() => {
		term?.dispose();
	});

	export function write(data: Uint8Array) {
		term?.write(data);
	}

	export function clear() {
		term?.clear();
		term?.reset();
	}

	export function size(): { cols: number; rows: number } | null {
		if (!term || term.cols <= 0 || term.rows <= 0) return null;
		return { cols: term.cols, rows: term.rows };
	}

	// Force a synchronous fit and wait one rAF for layout to commit, then
	// return the resulting xterm dimensions. Used by callers that need to
	// push the PTY size to the daemon BEFORE replaying the ring buffer.
	export async function ensureFit(): Promise<{ cols: number; rows: number } | null> {
		if (!fitAddon || !term) return null;
		syncSize();
		await new Promise<void>((r) => requestAnimationFrame(() => r()));
		syncSize();
		if (term.cols <= 0 || term.rows <= 0) return null;
		return { cols: term.cols, rows: term.rows };
	}
</script>

<div class="w-full h-full bg-[#282828] p-2 overflow-hidden">
	<div bind:this={containerEl} class="w-full h-full"></div>
</div>
