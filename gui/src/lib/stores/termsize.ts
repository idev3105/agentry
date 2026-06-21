// Last fitted xterm geometry, published by TerminalView.syncSize().
//
// Why this exists: PTYs spawn at portable_pty's 80×24 fallback when the
// `start_session` cmd carries no cols/rows. The agent's TUI then renders at
// 24 rows and only reflows once the post-focus resize lands — leaving the
// input line covered / pushed off-screen on first paint. Call sites that
// start a session read this value so the daemon can openpty() at the real
// size from the start, avoiding the reflow entirely.
//
// Plain mutable module (not a rune store): consumers only need the latest
// value synchronously at the moment they call startSession — no reactivity.

let cols = 0;
let rows = 0;

export function setTermSize(c: number, r: number): void {
    if (c > 0 && r > 0) {
        cols = c;
        rows = r;
    }
}

/** Latest known terminal geometry, or null if never fitted yet. */
export function getTermSize(): { cols: number; rows: number } | null {
    if (cols > 0 && rows > 0) return { cols, rows };
    return null;
}
