<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { Terminal } from "@xterm/xterm";
    import { FitAddon } from "@xterm/addon-fit";
    import { SearchAddon } from "@xterm/addon-search";
    import { Unicode11Addon } from "@xterm/addon-unicode11";
    import { WebLinksAddon } from "@xterm/addon-web-links";
    import "@xterm/xterm/css/xterm.css";
    import { openUrl, openPath } from "@tauri-apps/plugin-opener";
    import { homeDir } from "@tauri-apps/api/path";
    import { resize as resizeCmd } from "$lib/ipc";
    import { setTermSize } from "$lib/stores/termsize";
    import { theme } from "$lib/stores/theme.svelte";
    import { zoom } from "$lib/stores/font.svelte";
    import { toasts } from "$lib/stores/toasts.svelte";

    const FONT_KEY = "agentry:term:fontsize";
    function loadFont(): number {
        return Number(localStorage.getItem(FONT_KEY) ?? "13") || 13;
    }

    let {
        sessionId,
        cwd = null,
        onInput,
        ctl = $bindable<{
            findNext: (q: string) => void;
            findPrev: (q: string) => void;
        } | null>(null),
    }: {
        sessionId: string | null;
        /** Working dir of the focused session, used to resolve relative file
         * links clicked in the terminal. Null for past/unknown sessions. */
        cwd?: string | null;
        onInput: (data: string) => void;
        ctl?: {
            findNext: (q: string) => void;
            findPrev: (q: string) => void;
        } | null;
    } = $props();

    // $HOME resolved once on mount (Tauri path API is async). Used to expand
    // ~-rooted paths clicked in the terminal. Stays null if the lookup fails.
    let home: string | null = null;

    // Resolve a path captured from terminal output into something the OS opener
    // can act on: expand a leading ~ to $HOME, and join bare relative paths
    // onto the session cwd. Absolute paths pass through untouched. Returns null
    // when a relative path has no anchor (no cwd / no home).
    function resolveFilePath(p: string): string | null {
        if (p.startsWith("/")) return p;
        if (p.startsWith("~/") || p === "~") {
            return home ? p.replace(/^~/, home) : null;
        }
        if (!cwd) return null;
        const rel = p.replace(/^\.\//, "");
        return cwd.replace(/\/+$/, "") + "/" + rel;
    }

    // --- wrap-aware link matching --------------------------------------------
    // The naive "read one buffer line, regex it, use match.index as the column"
    // approach is why file links were flaky: paths that WRAP across rows got cut
    // off, and match.index (a JS string index) drifts from the on-screen CELL
    // column whenever a wide glyph (CJK/emoji/box-drawing — common in TUIs) is
    // present. These two helpers are ported from xterm's own WebLinksAddon so
    // file links share the exact logic that makes URL links reliable.

    // Collect the full logical line that row `row` belongs to by walking into
    // preceding/following wrapped rows. Returns the joined strings plus the
    // index of the first row, so callers can map back to (x, y) cells.
    function windowedLineStrings(row: number, t: Terminal): [string[], number] {
        const buf = t.buffer.active;
        let line = buf.getLine(row);
        let topRow = row;
        let bottomRow = row;
        let acc = 0;
        const out: string[] = [];
        if (!line) return [out, topRow];
        let s = line.translateToString(true);
        if (line.isWrapped && s[0] !== " ") {
            for (
                ;
                (line = buf.getLine(--topRow)) &&
                acc < 2048 &&
                ((s = line.translateToString(true)),
                (acc += s.length),
                out.push(s),
                line.isWrapped && s.indexOf(" ") === -1);
            );
            out.reverse();
        }
        out.push(buf.getLine(row)!.translateToString(true));
        for (
            acc = 0;
            (line = buf.getLine(++bottomRow)) &&
            line.isWrapped &&
            acc < 2048 &&
            ((s = line.translateToString(true)),
            (acc += s.length),
            out.push(s),
            s.indexOf(" ") === -1);
        );
        return [out, topRow];
    }

    // Map a JS string index within the joined logical line to a buffer cell
    // (row, col), accounting for wide glyphs and wrap boundaries. Returns
    // [-1,-1] if it falls off the end. Mirrors xterm's _mapStrIdx.
    function mapStrIdx(
        t: Terminal,
        startRow: number,
        startCol: number,
        strIdx: number,
    ): [number, number] {
        const buf = t.buffer.active;
        const cell = buf.getNullCell();
        let row = startRow;
        let col = startCol;
        while (strIdx) {
            const line = buf.getLine(row);
            if (!line) return [-1, -1];
            for (let i = col; i < line.length; ++i) {
                line.getCell(i, cell);
                const chars = cell.getChars();
                if (cell.getWidth()) {
                    strIdx -= chars.length || 1;
                    if (i === line.length - 1 && chars === "") {
                        const next = buf.getLine(row + 1);
                        if (next && next.isWrapped) {
                            next.getCell(0, cell);
                            if (cell.getWidth() === 2) strIdx += 1;
                        }
                    }
                }
                if (strIdx < 0) return [row, i];
            }
            row++;
            col = 0;
        }
        return [row, col];
    }

    let containerEl: HTMLDivElement;
    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let rafId = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    function syncSize() {
        if (!fitAddon || !term || !sessionId) return;
        // Never fit against a collapsed container — that locks the terminal to
        // xterm's 80×24 default and leaves it that size once layout settles.
        if (
            !containerEl ||
            containerEl.clientWidth === 0 ||
            containerEl.clientHeight === 0
        )
            return;
        try {
            fitAddon.fit();
        } catch {
            return;
        }
        // Publish geometry so session-start call sites can spawn the PTY at the
        // real size (avoids the 80×24 spawn → reflow that covers the input).
        setTermSize(term.cols, term.rows);
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
        // Resolve $HOME once so ~-paths clicked later expand without an await
        // in the click path. Failure is non-fatal: ~-links just won't open.
        homeDir()
            .then((h) => (home = h))
            .catch(() => {});

        term = new Terminal({
            theme: THEMES[theme.value],
            // Font chain prefers monospace families with better Vietnamese
            // diacritic placement (stacked tones like ấ ầ ữ). Fallback to
            // generic 'monospace' so the user's system pick still works.
            fontFamily:
                '"JetBrains Mono", "Fira Code", "Cascadia Code", "Source Code Pro", "Noto Sans Mono", "DejaVu Sans Mono", "Liberation Mono", monospace',
            fontSize: loadFont(),
            cursorBlink: true,
            // Larger scrollback so long non-alt-screen output (build logs,
            // streamed agent text) isn't evicted too early. TUIs use the
            // alt-screen so this only costs memory for line-mode output.
            scrollback: 10000,
            // TUIs pick their own fg/bg per cell; xterm's auto-contrast
            // adjustment rewrites those colors and breaks themes (dimmed
            // text, low-contrast palettes). 1 = never adjust, render the
            // exact colors the program asked for.
            minimumContrastRatio: 1,
            // Lets xterm use newer Unicode/IME APIs (composition positioning,
            // width calculations) — needed for cleaner CJK/Vietnamese input
            // and required by the Unicode11 width provider below.
            allowProposedApi: true,
        });
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        const searchAddon = new SearchAddon();
        term.loadAddon(searchAddon);
        // Unicode 11 width tables: correct cell width for box-drawing,
        // emoji, and CJK/wide glyphs that TUIs use for borders and layout.
        // Without this, xterm's built-in V6 tables mis-measure wide chars
        // and the TUI's columns/frames drift out of alignment.
        const unicode11 = new Unicode11Addon();
        term.loadAddon(unicode11);
        term.unicode.activeVersion = "11";

        // Web links: detect http(s):// URLs and open them in the OS browser via
        // the Tauri opener plugin (NOT the webview — we never navigate the app
        // away from itself). Click handler swallows the default and routes
        // through openUrl so the URL opens externally.
        term.loadAddon(
            new WebLinksAddon((event, uri) => {
                if (!event.ctrlKey && !event.metaKey) return;
                event.preventDefault();
                openUrl(uri).catch((err) =>
                    toasts.error("Could not open URL", `${uri}: ${err}`),
                );
            }),
        );

        // File links: a custom LinkProvider — we can't reuse WebLinksAddon here
        // because its matcher hard-rejects anything `new URL()` won't parse, so
        // bare paths never register. We match a path regex over the FULL logical
        // line (wrap-joined) and translate string offsets to cells via the
        // helpers above, which is what fixes the "detects sometimes" behaviour.
        //
        // Matched shapes (relative needs ≥1 slash so bare words aren't links):
        //   /abs/path   ~/in/home   ./rel   rel/with/slash.ext   path:line:col
        const FILE_RE =
            /(?:~\/|\.{1,2}\/|\/)?[\w.\-]+(?:\/[\w.\-]+)+(?::\d+(?::\d+)?)?/g;
        const tref = term;
        term.registerLinkProvider({
            provideLinks(row, cb) {
                const [strings, topRow] = windowedLineStrings(row - 1, tref);
                const joined = strings.join("");
                if (!joined) return cb(undefined);
                const links = [];
                let m: RegExpExecArray | null;
                FILE_RE.lastIndex = 0;
                while ((m = FILE_RE.exec(joined)) !== null) {
                    const raw = m[0];
                    // URLs are owned by the WebLinksAddon above.
                    if (/^[a-z]+:\/\//i.test(raw)) continue;
                    const path = raw.replace(/:\d+(?::\d+)?$/, "");
                    const resolved = resolveFilePath(path);
                    if (!resolved) continue;
                    const [sy, sx] = mapStrIdx(tref, topRow, 0, m.index);
                    const [ey, ex] = mapStrIdx(tref, sy, sx, raw.length);
                    if (sy < 0 || sx < 0 || ey < 0 || ex < 0) continue;
                    links.push({
                        // xterm ranges are 1-based; end x is inclusive so it is
                        // the column of the last cell, not one past it.
                        range: {
                            start: { x: sx + 1, y: sy + 1 },
                            end: { x: ex, y: ey + 1 },
                        },
                        text: raw,
                        activate: (e: MouseEvent) => {
                            // Only open on Ctrl/Cmd+click so a plain click can
                            // still place the cursor / select text normally.
                            if (!e.ctrlKey && !e.metaKey) return;
                            openPath(resolved).catch((err) =>
                                toasts.error(
                                    "Could not open file",
                                    `${resolved}: ${err}`,
                                ),
                            );
                        },
                    });
                }
                cb(links.length ? links : undefined);
            },
        });

        ctl = {
            findNext: (q) => searchAddon.findNext(q),
            findPrev: (q) => searchAddon.findPrevious(q),
        };
        term.open(containerEl);

        // NOTE: deliberately NOT loading the WebGL/canvas renderer here.
        // xterm's GPU/canvas renderers raster glyphs to a bitmap; under the
        // app's CSS `zoom` (app.css → html{zoom:var(--app-zoom)}) the browser
        // scales that bitmap and text goes blurry. WebKitGTK (Tauri/Linux)
        // also mis-handles devicePixelRatio for WebGL, blurring even at
        // zoom=1. The DOM renderer draws real text that stays crisp at any
        // zoom, which matters more here than the GPU repaint speed.

        // Tighten the hidden textarea xterm uses for keyboard + IME input.
        // WebKit/GTK on Linux runs IBus/fcitx through this textarea; turning
        // off browser autocorrect/spellcheck/autocapitalize keeps the IME
        // from getting double-handled, and lang="vi" helps WebKit pick the
        // right composition context for Vietnamese input methods.
        const ta = (term as unknown as { textarea?: HTMLTextAreaElement })
            .textarea;
        if (ta) {
            ta.setAttribute("autocomplete", "off");
            ta.setAttribute("autocorrect", "off");
            ta.setAttribute("autocapitalize", "off");
            ta.setAttribute("spellcheck", "false");
            ta.setAttribute("lang", "vi");
        }

        // IME duplicate-input guard (WebKitGTK + fcitx/ibus Telex).
        //
        // On WebKitGTK, finishing a Vietnamese composition emits the composed
        // text through xterm TWICE for the same keystroke:
        //   1. the textarea `input` (inputType="insertText", composed=true) path —
        //      xterm's `(!e.composed || !_keyDownSeen)` guard passes because IME
        //      input has no preceding keydown, so it triggerDataEvent()s.
        //   2. CompositionHelper.compositionend → setTimeout(0) → triggerDataEvent()
        //      of the same composed substring.
        // Both surface via onData as identical chunks a few ms apart, so a word
        // like "việt" lands as "việtviệt". There is no xterm option to disable
        // one path, so we drop the redundant emit ourselves — but ONLY inside the
        // short window around a real composition end, to avoid eating legitimate
        // fast double-typing (e.g. "aa", paste, key-repeat).
        let imeWindowUntil = 0;
        let imeLastData = "";
        if (ta) {
            ta.addEventListener("compositionend", () => {
                // Cover both the synchronous input-path emit and the deferred
                // setTimeout(0) compositionend emit.
                imeWindowUntil = performance.now() + 80;
                imeLastData = "";
            });
        }

        term.onData((data) => {
            const now = performance.now();
            if (now <= imeWindowUntil) {
                // Within the composition-finalize window: a chunk identical to the
                // previous one is the duplicate emit — swallow it exactly once.
                if (data === imeLastData) {
                    imeLastData = "";
                    return;
                }
                imeLastData = data;
            } else {
                imeLastData = "";
            }
            onInput(data);
        });

        // Auto-copy selection on mouse release (xterm renders the selection
        // into its own layer, so we listen on the terminal element). Copying on
        // `mouseup` instead of `onSelectionChange` avoids hammering the
        // clipboard while the drag is still in progress, and skips the
        // keyboard-driven selection churn that fires during normal output.
        const onMouseUp = () => {
            if (!term || !term.hasSelection()) return;
            const text = term.getSelection();
            if (!text) return;
            navigator.clipboard
                ?.writeText(text)
                .then(() => toasts.success("Copied"))
                .catch(() => toasts.error("Copy failed"));
        };
        containerEl.addEventListener("mouseup", onMouseUp);

        const ro = new ResizeObserver(() => scheduleFit());
        ro.observe(containerEl);

        scheduleFit();

        return () => {
            containerEl.removeEventListener("mouseup", onMouseUp);
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
        // CSS `zoom` changes don't alter clientHeight, so the ResizeObserver
        // never fires on Ctrl +/-/0 — refit explicitly when zoom changes.
        void zoom.value;
        scheduleFit();
    });

    const THEMES = {
        gruvbox: {
            background: "#282828",
            foreground: "#ebdbb2",
            cursor: "#fabd2f",
            cursorAccent: "#282828",
            selectionBackground: "#504945",
            black: "#282828",
            red: "#cc241d",
            green: "#98971a",
            yellow: "#d79921",
            blue: "#458588",
            magenta: "#b16286",
            cyan: "#689d6a",
            white: "#a89984",
            brightBlack: "#928374",
            brightRed: "#fb4934",
            brightGreen: "#b8bb26",
            brightYellow: "#fabd2f",
            brightBlue: "#83a598",
            brightMagenta: "#d3869b",
            brightCyan: "#8ec07c",
            brightWhite: "#ebdbb2",
        },
        "one-dark": {
            background: "#282c34",
            foreground: "#abb2bf",
            cursor: "#e06c75",
            cursorAccent: "#282c34",
            selectionBackground: "#3a3f4b",
            black: "#282c34",
            red: "#e06c75",
            green: "#98c379",
            yellow: "#e5c07b",
            blue: "#61afef",
            magenta: "#c678dd",
            cyan: "#56b6c2",
            white: "#abb2bf",
            brightBlack: "#5c6370",
            brightRed: "#e06c75",
            brightGreen: "#98c379",
            brightYellow: "#e5c07b",
            brightBlue: "#61afef",
            brightMagenta: "#c678dd",
            brightCyan: "#56b6c2",
            brightWhite: "#fff",
        },
        dark: {
            background: "#09090b",
            foreground: "#fafafa",
            cursor: "#fafafa",
            cursorAccent: "#09090b",
            selectionBackground: "#27272a",
            black: "#18181b",
            red: "#ef4444",
            green: "#22c55e",
            yellow: "#eab308",
            blue: "#3b82f6",
            magenta: "#8b5cf6",
            cyan: "#2dd4bf",
            white: "#a1a1aa",
            brightBlack: "#71717a",
            brightRed: "#f87171",
            brightGreen: "#4ade80",
            brightYellow: "#facc15",
            brightBlue: "#60a5fa",
            brightMagenta: "#a78bfa",
            brightCyan: "#5eead4",
            brightWhite: "#fafafa",
        },
        light: {
            background: "#ffffff",
            foreground: "#09090b",
            cursor: "#09090b",
            cursorAccent: "#ffffff",
            selectionBackground: "#e4e4e7",
            black: "#09090b",
            red: "#dc2626",
            green: "#16a34a",
            yellow: "#ca8a04",
            blue: "#2563eb",
            magenta: "#7c3aed",
            cyan: "#0d9488",
            white: "#71717a",
            brightBlack: "#52525b",
            brightRed: "#ef4444",
            brightGreen: "#22c55e",
            brightYellow: "#eab308",
            brightBlue: "#3b82f6",
            brightMagenta: "#8b5cf6",
            brightCyan: "#14b8a6",
            brightWhite: "#18181b",
        },
    };

    $effect(() => {
        if (!term) return;
        term.options.theme = THEMES[theme.value];
    });

    let writeQueue: Uint8Array[] = [];
    let flushRaf = 0;

    export function writeBatched(data: Uint8Array) {
        writeQueue.push(data);
        if (flushRaf) return;
        flushRaf = requestAnimationFrame(() => {
            flushRaf = 0;
            if (!term || writeQueue.length === 0) return;
            let total = 0;
            for (const c of writeQueue) total += c.length;
            const merged = new Uint8Array(total);
            let off = 0;
            for (const c of writeQueue) { merged.set(c, off); off += c.length; }
            writeQueue = [];
            term.write(merged);
        });
    }

    onDestroy(() => {
        if (flushRaf) cancelAnimationFrame(flushRaf);
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
    export async function ensureFit(): Promise<{
        cols: number;
        rows: number;
    } | null> {
        if (!fitAddon || !term) return null;
        syncSize();
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        syncSize();
        if (term.cols <= 0 || term.rows <= 0) return null;
        return { cols: term.cols, rows: term.rows };
    }
</script>

<div
    class="w-full h-full p-2 overflow-hidden"
    style="background:{THEMES[theme.value].background}"
>
    <div bind:this={containerEl} class="w-full h-full"></div>
</div>
