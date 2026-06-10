# Agentry UI/UX Design Plan — OpenDesign Research + Design System

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Apply a structured design system to Agentry's Svelte 5 + Tauri GUI, informed by OpenDesign research findings.

**Architecture:** Token-based design system via Tailwind v4 `@theme inline`, component library using existing `bits-ui` + `@lucide/svelte`, no external renderer.

**Tech Stack:** Svelte 5 runes, Tailwind v4, bits-ui, @lucide/svelte, xterm.js

---

## ⚠️ OpenDesign Research Findings — CRITICAL

**OpenDesign (by Ceros) is SUNSET as of October 1, 2023.**

- Product at opendesign.dev → redirects, no docs
- GitHub: https://github.com/opendesigndev — code public but abandoned (~9 stars, last commit 2–3 yrs ago)
- **No Svelte support** — only `@opendesign/react` and `@opendesign/universal` (WASM-based)
- What it was: programmatic Figma/AI/PSD/XD → "Octopus" JSON format renderer, NOT a component library
- **Verdict: DO NOT USE OpenDesign.** It is dead, has no Svelte integration, and solves a different problem (design-file rendering, not UI component system).

### What to use instead (for Agentry's use case)

| Need | Recommended |
|---|---|
| Design tokens / CSS vars | Tailwind v4 `@theme inline` (already in use) |
| Accessible primitives | `bits-ui` (already installed) |
| Icons | `@lucide/svelte` (already installed) |
| Design file handoff | Figma (export tokens manually → `app.css`) |
| Component docs | Storybook (optional, Phase 4) |

---

## Current State Audit

### What exists
- `gui/src/app.css` — Gruvbox + One Dark themes via `@theme inline` ✅
- 15 components: ActivityBar, CommandPalette, ConfirmDialog, Inspector, Onboarding, OnboardingTour, ReconnectBanner, SessionSidebar, SessionTabs, SplitPane, TerminalFindBar, TerminalHeader, TerminalView, Toaster, TopBar
- 4 views: OverviewView, ProfilesView, R9DashboardView, SettingsView
- Stores: profiles, projects, r9, sessions, settings, theme, toasts, ui

### UX Audit

**P0 — Blocks daily use:**
- No visual differentiation between agent types (claude_code vs codex vs opencode) — all session rows look identical
- Empty state on fresh install only shows "No project — press ⌘T" in tiny text, no visual onboarding card
- Session kill is keyboard-only (⌘⇧K) — no discoverable button in UI

**P1 — Friction:**
- Keyboard shortcuts not surfaced anywhere in the UI (users must discover by accident or read docs)
- No bulk action for clearing finished/failed sessions (they pile up)
- No visual status indicator for daemon connectivity in activity bar (only TopBar banner)
- Inspector panel has no resize affordance hint (first-time users don't know it's draggable)
- `console.error` used for some user-visible failures (should be toasts)

**P2 — Polish:**
- Agent type badges on session rows use text only — no icon/color differentiation
- Session list density toggle exists but not discoverable (settings only)
- No transition/animation on session status changes (running → finished just snaps)
- TerminalView background doesn't match app background on initial load (flash)

---

## Phase Plan

### Phase 1 — Discoverability (Zero wire-protocol risk)

**Task 1.1 — Agent type visual badges in SessionSidebar**

- File: `gui/src/lib/components/SessionSidebar.svelte`
- Add colored dot + icon per agent type using gruvbox accent colors:
  - `claude_code` → `text-gruvbox-yellow` + brain icon
  - `codex` → `text-gruvbox-green` + code icon  
  - `opencode` → `text-gruvbox-blue` + terminal icon
- Use `agent_display_name()` logic: wire `claude_code` = display `claude`

**Task 1.2 — Kill button in TerminalHeader**

- File: `gui/src/lib/components/TerminalHeader.svelte`
- Add `<button>` with `X` / `square` icon, `text-gruvbox-red` on hover
- Calls same `markSessionEnding` + `killSession` path as keyboard shortcut
- Only visible when `session.status === 'running' || 'starting' || 'queued'`

**Task 1.3 — Keyboard shortcut hints overlay**

- File: `gui/src/lib/components/ActivityBar.svelte` (add `?` button at bottom)
- New component: `gui/src/lib/components/KeyboardHintsPanel.svelte`
- Renders a `bits-ui` Popover with shortcut table (⌘K, ⌘T, ⌘⇧K, ⌘F, ⌘1-9)
- Uses `fmtChord()` from `$lib/utils/cn` for OS-aware display

**Task 1.4 — Empty state card when no project**

- File: `gui/src/routes/+page.svelte` (the `{:else}` branch for no project in sidebar)
- Replace bare text with a proper card matching the "No session focused" card style already in use
- Include: create project button (opens onboarding), icon, descriptive text

---

### Phase 2 — Workflow Speed (New components, low wire risk)

**Task 2.1 — Bulk clear for finished/failed sessions**

- File: `gui/src/lib/components/SessionSidebar.svelte`
- Add "Clear past" button in sidebar footer — only visible when ≥1 finished/failed session exists
- Calls `sendCmd({ cmd: 'delete_session', session_id })` for each terminal session
- Wire check: `delete_session` cmd must exist in `crates/wire/src/lib.rs` — verify before impl; if not, use client-side hide (filter from store) as fallback

**Task 2.2 — Daemon connectivity dot in ActivityBar**

- File: `gui/src/lib/components/ActivityBar.svelte`
- Add pulsing green/red dot at bottom of bar reflecting `connected` state
- Pass `connected` prop down (or import from a runes store if refactored)
- Green = `bg-accent-ok`, Red = `bg-accent-error`, pulse via CSS `animate-pulse`

**Task 2.3 — Session status transition animations**

- File: `gui/src/lib/components/SessionSidebar.svelte`
- Use Svelte `transition:fade` + `transition:fly` for session status badge changes
- Running → finished: fade out spinner, fade in checkmark
- Requires no wire changes

---

### Phase 3 — Power Features (May touch ipc.ts)

**Task 3.1 — Agent type filter in session list**

- File: `gui/src/lib/components/SessionSidebar.svelte`
- Segmented filter bar: All / Active / Past
- Filter by `status` in session list (active = running/starting/queued, past = finished/failed)
- Pure client-side; no wire changes

**Task 3.2 — Session context menu (right-click)**

- Use `bits-ui` ContextMenu primitive
- Options: Rename, Kill (if active), Copy session ID, Copy cwd
- File: `gui/src/lib/components/SessionSidebar.svelte`
- Rename → `sendCmd({ cmd: 'rename_session', ... })` (existing wire cmd)

**Task 3.3 — Typography scale CSS vars**

- File: `gui/src/app.css`
- Add `--font-size-*` vars inside `@theme inline {}` for xs/sm/base/lg
- Ensures density toggle (compact/comfortable/spacious) maps to actual font scale, not just padding

---

### Phase 4 — Polish (Pure cosmetic, a11y audit)

**Task 4.1 — Replace `console.error` user-visible failures with toasts**

- Files: `gui/src/routes/+page.svelte` (bootstrap fn has `console.error`)
- Pattern: `toasts.error('Bootstrap failed', String(e))` — already present in some places, audit all

**Task 4.2 — a11y pass**

- Run `cd gui && pnpm check` → fix any remaining `a11y_*` warnings
- Add `role`, `tabindex`, `aria-label` to interactive non-button divs
- Do NOT add `<!-- svelte-ignore a11y_* -->` — use proper fixes

**Task 4.3 — xterm.js background flash fix**

- File: `gui/src/lib/components/TerminalView.svelte`
- Set container `background: var(--color-background)` before xterm mounts
- Prevents white/gray flash before terminal initializes

---

## Baseline gates

Run before starting:
```bash
cd /Users/idev/Documents/projects/agentry/gui && pnpm check
```

Expected: 0 errors, ≤8 warnings (pre-existing a11y in ProfilesView).

After Phase 4.2 fixes a11y: gate tightens to 0 errors, ≤1 warning.

End of each phase:
```bash
mise run check   # full Rust clippy + svelte-check
```

---

## Files likely to change

| File | Phases |
|---|---|
| `gui/src/lib/components/SessionSidebar.svelte` | 1.1, 2.1, 2.3, 3.1, 3.2 |
| `gui/src/lib/components/ActivityBar.svelte` | 1.3, 2.2 |
| `gui/src/lib/components/TerminalHeader.svelte` | 1.2 |
| `gui/src/routes/+page.svelte` | 1.4, 4.1 |
| `gui/src/app.css` | 3.3 |
| `gui/src/lib/components/TerminalView.svelte` | 4.3 |
| `gui/src/lib/components/KeyboardHintsPanel.svelte` | 1.3 (new file) |

---

## Risks & open questions

1. **Task 2.1 `delete_session`**: wire cmd may not exist — verify in `crates/wire/src/lib.rs` first. If absent, use client-side filter + note as deferred wire work.
2. **Task 2.2 `connected` prop**: currently only in `+page.svelte` scope — may need to lift to a runes store or pass as prop to ActivityBar.
3. **Svelte 5 transitions**: `transition:` directives work on elements in `{#if}` / `{#each}` blocks; test that status badge swap is inside `{#each}` for transition to fire.
4. **bits-ui ContextMenu**: check `bits-ui` v2 API (already v2.18.1 installed) — component may be `ContextMenu.Root` + `ContextMenu.Item` pattern.
