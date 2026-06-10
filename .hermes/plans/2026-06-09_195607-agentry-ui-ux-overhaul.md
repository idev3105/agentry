# Agentry GUI — UI/UX Overhaul Implementation Plan

> **For Hermes:** Use `subagent-driven-development` skill to implement this plan task-by-task.

**Goal:** Make the Agentry GUI great and easy to use — clearer first-run flow, faster session switching (tab strip + MRU palette), better feedback (toasts + reconnect banner), accessible action labels, and polished theming.

**Architecture:** Pure frontend changes inside `gui/src/`. No daemon/wire-protocol changes (Phase 5 risks bumping `WIRE_VERSION` — explicitly OUT of scope). Add 2 client-side stores (`toasts`, `mru`, `themeFontPrefs`), one new component family (`Toaster`, `TabStrip`, `OnboardingTour`), and a stable agent-icon util. Keep Svelte 5 runes (`$state` / `$derived`) — no Svelte 4 stores in new code.

**Tech Stack:** Svelte 5 + SvelteKit, Tauri v2, Tailwind v4, `@lucide/svelte`, `@xterm/xterm` (+ `@xterm/addon-search` already in `package.json`), `bits-ui`. No new npm deps.

---

## Bối cảnh & giả định hiện tại

- Wire-protocol (4-file rule from `AGENTS.md`) is NOT touched anywhere in this plan. If a task feels like it needs a new `Cmd`/`Event`, stop and re-scope.
- Frontend lives in `gui/src/`. `gui/src-tauri/` shim is untouched.
- Existing keybindings (`gui/src/lib/utils/keybindings.ts`) — extend, don't rewrite.
- Stores in `gui/src/lib/stores/` use Svelte 4 `writable<T>` (not runes). **New** stores in this plan use runes (`$state`) wrapped in a small object (`r9.svelte.ts` is the existing pattern — copy that).
- Theme: gruvbox colors are hardcoded as Tailwind utilities (`text-gruvbox-yellow`, `bg-gruvbox-green`, …) in many components. Phase 4 introduces CSS-var semantic aliases but keeps the gruvbox palette as the default; do not break existing classnames.
- `docs/` is Vietnamese — keep that style if editing `docs/*.md`. All new code/comments: English.
- `mise run check` runs clippy + svelte-check. **No tests exist** (`AGENTS.md` line: "No automated tests exist"). Verification = `mise run check` + manual `mise run dev` smoke test.

### Baseline (verified at plan-write time, `git status --short` clean except untracked `.claude/ .hermes/ data/`)

| Gate | Command | Baseline |
|---|---|---|
| Rust clippy | `cargo clippy -p agentry-wire -p agentry-daemon -p agentry-cli -- -D warnings` | **0 errors, 0 warnings** (clean) |
| Svelte check | `cd gui && pnpm check` | **0 errors, 8 warnings** (all pre-existing: 7× `a11y_label_has_associated_control` in `ProfilesView.svelte`, 1× missing `node` type def in `tsconfig.json`) |
| Full gate | `mise run check` | green at baseline |

> Pre-existing warnings ARE inside files this plan touches (`ProfilesView.svelte`). Phase 1 Task 1.9 fixes them as a free win. Until then, the gate the implementer enforces after each task is **"0 errors AND ≤8 warnings"** — not "0 warnings". After Task 1.9 lands, raise gate to **"0 errors AND ≤1 warning"** (the `node` types one stays — unrelated to UI).

---

## Phase summary

| Phase | Tasks | Theme | Effort |
|---|---|---|---|
| 1 | 1.1 – 1.10 | Discoverability: labels, empty-state, split-button, agent icons, status badges | 1-2d |
| 2 | 2.1 – 2.8 | Workflow speed: tab strip, toasts, `/`-filter, xterm search, duplicate, clear-done, reconnect, wizard spinner | 2-3d |
| 3 | 3.1 – 3.8 | Power features: MRU palette, terminal header, font-size, theme picker, profile test, onboarding, Copy-as-CLI, confirm-skip | 3-5d |
| 4 | 4.1 – 4.5 | Polish: density, semantic CSS vars, animations, toast wiring cleanup, focus rings | 1-2d |

Each task = one commit. Each commit must pass the gate.

---

# PHASE 1 — Discoverability & Clarity

## Task 1.1: Add agent-icon util

**Objective:** One source of truth mapping `AgentType` → lucide icon + display label + color.

**Files:**
- Create: `gui/src/lib/utils/agent.ts`

**Code:**

```ts
import Bot from '@lucide/svelte/icons/bot';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Code2 from '@lucide/svelte/icons/code-2';
import type { AgentType } from '$lib/types';
import type { Component } from 'svelte';

export interface AgentMeta {
	icon: Component;
	label: string;
	/** Tailwind text color class used in pills / icons. */
	color: string;
}

const META: Record<AgentType, AgentMeta> = {
	claude_code: { icon: Sparkles, label: 'Claude', color: 'text-gruvbox-yellow' },
	codex:       { icon: Bot,      label: 'Codex',  color: 'text-gruvbox-aqua' },
	open_code:   { icon: Code2,    label: 'OpenCode', color: 'text-gruvbox-blue' }
};

export function agentMeta(t: AgentType | string): AgentMeta {
	return META[t as AgentType] ?? { icon: Bot, label: String(t), color: 'text-muted-foreground' };
}
```

**Verify:** `cd gui && pnpm check` → still 0 errors, ≤8 warnings.

**Commit:** `feat(gui): add agentMeta util mapping agent_type → icon/label/color`

---

## Task 1.2: Wizard — text labels on Next / Back / Create buttons

**Objective:** Replace icon-only nav buttons with text + icon. Current icon-only buttons (`<ArrowRight />`, `<Check />`) are unreadable for first-run users.

**Files:**
- Modify: `gui/src/lib/components/SetupWizard.svelte`

**Pseudo-diff (5 buttons total):**

```svelte
<!-- welcome step -->
- <button class="…p-2 rounded bg-primary…" onclick={() => (step = 'folder')}>
-   <ArrowRight size={18} />
- </button>
+ <button class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 text-sm font-medium"
+         onclick={() => (step = 'folder')}>
+   Get started <ArrowRight size={14} />
+ </button>

<!-- folder step: back / next -->
- <button title="Back" class="p-1.5…"><ArrowLeft size={14} /></button>
+ <button class="px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
+         onclick={() => (step = 'welcome')}>
+   <ArrowLeft size={14} /> Back
+ </button>
- <button title="Next" class="p-1.5 …" disabled={…}><ArrowRight size={14} /></button>
+ <button class="px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5 text-sm font-medium"
+         disabled={!folder.trim() || !projectName.trim()}
+         onclick={() => (step = 'agent')}>
+   Next <ArrowRight size={14} />
+ </button>

<!-- agent step: back / Create -->
+ <button class="…inline-flex items-center gap-1.5 text-sm font-medium"
+         onclick={finish}>
+   Create project <ArrowRight size={14} />
+ </button>

<!-- done step: -->
- <button title="Open terminal" class="…"><Terminal size={18} /></button>
+ <button class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 text-sm font-medium"
+         onclick={close}>
+   <Terminal size={14} /> Open terminal
+ </button>
```

**Also:** in `creating` step, add a spinner so it's not a frozen text screen:

```svelte
{:else if step === 'creating'}
  <div class="text-center py-8 space-y-3">
    <Loader2 size={20} class="mx-auto animate-spin text-gruvbox-yellow" />
    <div class="text-sm text-muted-foreground">Creating project & starting session…</div>
  </div>
```

Add `import Loader2 from '@lucide/svelte/icons/loader-2';` at top.

**Verify:** `pnpm check` → 0 errors, ≤8 warnings. Manual: `mise run dev`, click wizard through all 4 steps, confirm labels visible.

**Commit:** `fix(gui): wizard buttons get text labels + creating-step spinner`

---

## Task 1.3: Empty terminal pane — actionable CTA tiles

**Objective:** When no session is focused, show 3 large clickable tiles (New session / Open palette / Browse overview) instead of a tiny ▶ icon.

**Files:**
- Modify: `gui/src/routes/+page.svelte` (look for the `{:else}` branch where `focusedSessionId` is null inside the center pane; current code renders a small button)

**Replacement block** (drop in where the current no-session placeholder lives — find by searching `Select a session` or the small Play button):

```svelte
{#if !$ui.focusedSessionId}
  <div class="flex flex-col items-center justify-center h-full gap-6 p-8 text-center">
    <div>
      <h2 class="text-base font-semibold">No session focused</h2>
      <p class="text-xs text-muted-foreground mt-1">Pick one from the sidebar, or:</p>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl">
      <button class="bg-card border border-border hover:border-gruvbox-yellow rounded-lg p-4 text-left transition-colors group"
              onclick={() => quickStartDefault()}>
        <Plus size={18} class="text-gruvbox-yellow mb-2" />
        <div class="text-sm font-medium">New session</div>
        <div class="text-[11px] text-muted-foreground mt-0.5">Start with default profile</div>
        <kbd class="mt-2 inline-block text-[10px] font-mono text-muted-foreground">{fmtChord(['mod','t'])}</kbd>
      </button>
      <button class="bg-card border border-border hover:border-gruvbox-yellow rounded-lg p-4 text-left transition-colors"
              onclick={() => openPalette()}>
        <Command size={18} class="text-gruvbox-aqua mb-2" />
        <div class="text-sm font-medium">Command palette</div>
        <div class="text-[11px] text-muted-foreground mt-0.5">Switch session, run actions</div>
        <kbd class="mt-2 inline-block text-[10px] font-mono text-muted-foreground">{fmtChord(['mod','k'])}</kbd>
      </button>
      <button class="bg-card border border-border hover:border-gruvbox-yellow rounded-lg p-4 text-left transition-colors"
              onclick={() => setView('overview')}>
        <LayoutGrid size={18} class="text-gruvbox-blue mb-2" />
        <div class="text-sm font-medium">Overview</div>
        <div class="text-[11px] text-muted-foreground mt-0.5">All projects & sessions</div>
      </button>
    </div>
  </div>
{/if}
```

Imports needed at top of `<script>`:

```ts
import Plus from '@lucide/svelte/icons/plus';
import Command from '@lucide/svelte/icons/command';
import LayoutGrid from '@lucide/svelte/icons/layout-grid';
import { openPalette, setView } from '$lib/stores/ui';
import { fmtChord } from '$lib/utils/cn';
import { startSession } from '$lib/ipc';
import { profiles } from '$lib/stores/profiles';
import { settings } from '$lib/stores/settings';
```

`quickStartDefault()` helper (add in script):

```ts
async function quickStartDefault() {
	const projId = $ui.activeProjectId;
	if (!projId) { openWizard(); return; }
	const def = $settings.defaultProfileId
		? $profiles.find(p => p.id === $settings.defaultProfileId)
		: $profiles[0];
	if (!def) { setView('profiles'); return; }
	await startSession(projId, def.id);
}
```

Add `openWizard` to the import from `$lib/stores/ui`.

**Verify:** `pnpm check`. Manual: kill all sessions, see 3 tiles; click each.

**Commit:** `feat(gui): empty-pane CTA tiles for new session / palette / overview`

---

## Task 1.4: ActivityBar — labels under icons + wider rail

**Objective:** Activity bar items show label below icon (like VSCode's secondary bar mode), making discovery instant.

**Files:**
- Modify: `gui/src/lib/components/ActivityBar.svelte`

**Approach:** Widen rail from `w-14` → `w-16`; render each item as 2-row flex (icon + 9px label). Keep tooltip on hover for redundancy.

**Pseudo-diff for the item button** (apply to every nav entry — overview, terminal, profiles, settings, r9):

```svelte
- <button title="Sessions" class="…flex items-center justify-center w-full p-2…">
-   <Terminal size={18} />
- </button>
+ <button title="Sessions"
+         class={cn(
+           'flex flex-col items-center justify-center w-full py-2 gap-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors',
+           $ui.view === 'terminal' && 'text-foreground bg-secondary/60'
+         )}
+         onclick={() => setView('terminal')}>
+   <Terminal size={18} />
+   <span class="text-[9px] leading-tight">Sessions</span>
+ </button>
```

Container width: `class="w-14"` → `class="w-16"`. Adjust any flex children referencing `w-14` if present.

Also update `gui/src/routes/+page.svelte` grid template column for the activity bar if it hardcodes `w-14`/`w-[56px]` (search for `ActivityBar`).

**Verify:** `pnpm check`. Manual: confirm all 5 (overview/terminal/profiles/r9/settings) show labels and active state highlights correctly.

**Commit:** `feat(gui): activity bar shows labels under icons`

---

## Task 1.5: Sidebar — split-button "New session"

**Objective:** Replace bottom `+` icon button with VSCode-style split button: left half spawns with default profile, right half opens a profile-picker popover. Matches `docs/ux.md` §4.3.

**Files:**
- Modify: `gui/src/lib/components/SessionSidebar.svelte` (find the existing `<Plus />` "new session" trigger near the bottom)
- New helper imports from `$lib/stores/profiles`, `$lib/stores/settings`

**Code (drop near bottom of sidebar, replacing existing trigger):**

```svelte
{@const defaultProfile = $settings.defaultProfileId
   ? $profiles.find(p => p.id === $settings.defaultProfileId)
   : $profiles[0]}

<div class="p-2 border-t border-border">
  <div class="flex items-stretch rounded overflow-hidden border border-border">
    <button class="flex-1 px-2 py-1.5 text-xs bg-secondary/40 hover:bg-secondary inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            disabled={!$ui.activeProjectId || !defaultProfile}
            onclick={() => $ui.activeProjectId && defaultProfile && startSession($ui.activeProjectId, defaultProfile.id)}>
      <Plus size={12} />
      New {defaultProfile?.name ?? 'session'}
    </button>
    <button class="px-2 bg-secondary/40 hover:bg-secondary border-l border-border"
            onclick={() => (profileMenuOpen = !profileMenuOpen)}
            aria-label="Choose profile">
      <ChevronDown size={12} />
    </button>
  </div>

  {#if profileMenuOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-40" onclick={() => (profileMenuOpen = false)}></div>
    <div class="absolute bottom-12 left-2 right-2 z-50 bg-card border border-border rounded shadow-lg py-1 max-h-64 overflow-y-auto">
      {#each $profiles as p (p.id)}
        <button class="w-full px-3 py-1.5 text-left text-xs hover:bg-secondary flex items-center gap-2"
                onclick={() => { profileMenuOpen = false; $ui.activeProjectId && startSession($ui.activeProjectId, p.id); }}>
          {@const m = agentMeta(p.agent_type)}
          <m.icon size={12} class={m.color} />
          <span class="flex-1 truncate">{p.name}</span>
          {#if $settings.defaultProfileId === p.id}
            <Check size={12} class="text-gruvbox-yellow" />
          {/if}
        </button>
      {/each}
      <div class="border-t border-border mt-1 pt-1">
        <button class="w-full px-3 py-1.5 text-left text-xs hover:bg-secondary inline-flex items-center gap-2"
                onclick={() => { profileMenuOpen = false; setView('profiles'); }}>
          <Settings size={12} /> Manage profiles…
        </button>
      </div>
    </div>
  {/if}
</div>
```

Script additions:

```ts
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import Check from '@lucide/svelte/icons/check';
import Settings from '@lucide/svelte/icons/settings';
import { profiles } from '$lib/stores/profiles';
import { settings } from '$lib/stores/settings';
import { agentMeta } from '$lib/utils/agent';
import { setView } from '$lib/stores/ui';

let profileMenuOpen = $state(false);
```

Parent `<aside>` may need `class="relative"` so the popover absolute-positions correctly.

**Verify:** `pnpm check`. Manual: click left half → spawns immediately; click ▾ → list shows ✓ on default; clicking item spawns; clicking "Manage profiles…" navigates.

**Commit:** `feat(gui): sidebar split-button new-session with profile picker`

---

## Task 1.6: Sidebar — show agent icon + ⌘1-9 hint on first 9 rows

**Objective:** Each session row shows an agent-type icon (so claude/codex/opencode are visually distinct) and the first 9 rows display a ghost `⌘1` … `⌘9` chord on the right.

**Files:**
- Modify: `gui/src/lib/components/SessionSidebar.svelte`

**Within the session row render loop**, locate where `s.title` is rendered. The loop currently iterates over sessions for the active project; add an `idx` counter so we can index 0-8. If you currently `{#each sessions as s, idx (s.id)}`, perfect; if not, add the index.

**Pseudo-diff inside row:**

```svelte
<!-- existing left side: status dot + title -->
+ {@const m = agentMeta(s.agent)}
+ <m.icon size={11} class={cn('flex-shrink-0', m.color)} />
  <span class="flex-1 truncate">{s.title}</span>
  …
+ {#if idx < 9}
+   <kbd class="ml-1 px-1 py-px text-[9px] font-mono text-muted-foreground/60 group-hover:text-muted-foreground hidden sm:inline">
+     {fmtChord(['mod', String(idx + 1)])}
+   </kbd>
+ {/if}
```

Imports if not present: `import { agentMeta } from '$lib/utils/agent';`, `import { fmtChord } from '$lib/utils/cn';`.

**Verify:** `pnpm check`. Manual: spawn 3 sessions with different agents — confirm 3 distinct icons; first 3 show ⌘1/⌘2/⌘3 on the right.

**Commit:** `feat(gui): sidebar rows show agent icon + numeric chord hint`

---

## Task 1.7: TopBar — always render status badges (zero-state ✓)

**Objective:** Status pills currently hide when count = 0. Render a single "✓ All idle" pill when totals are zero so the bar never looks empty/broken.

**Files:**
- Modify: `gui/src/lib/components/TopBar.svelte`

**Pseudo-diff:** find the block that conditionally renders `working` / `awaiting` / `failed` badges. Wrap with a fallback:

```svelte
{#if stats.working === 0 && stats.awaiting === 0 && stats.failed === 0 && stats.total > 0}
  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-muted-foreground border border-border">
    <Check size={11} class="text-gruvbox-green" /> All idle
  </span>
{:else if stats.total === 0}
  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-muted-foreground">
    No sessions
  </span>
{:else}
  <!-- existing badges block -->
{/if}
```

Recompute `stats` locally if TopBar doesn't already; mirror the derivation from `OverviewView.svelte` lines 13-23.

**Verify:** `pnpm check`. Manual: launch app fresh (no sessions) → "No sessions"; start one and let it idle → "All idle"; cause working/awaiting → original badges show.

**Commit:** `feat(gui): topbar shows status fallback when zero/idle`

---

## Task 1.8: Inspector — always-visible Rename button + F2 shortcut

**Objective:** Rename pencil currently sits next to title at low contrast. Promote to a labeled button under the title; bind `F2` while inspector is focused.

**Files:**
- Modify: `gui/src/lib/components/Inspector.svelte`

**Changes:**

1. Add a Rename row in the action button group (the existing `flex gap-1.5 pt-1` block around line 159):

```svelte
<button title="Rename (F2)"
        class="flex-1 flex items-center justify-center gap-1 p-1.5 rounded bg-secondary hover:bg-secondary/80 text-xs"
        onclick={() => startRename(session!)}>
  <Pencil size={12} /> Rename
</button>
```

2. Remove the lone pencil button next to the title (lines 149-153) — redundant now. Keep the title clickable for rename as a power-user shortcut.

3. F2 shortcut: at top of `<script>` add an effect-based listener scoped to the aside:

```ts
$effect(() => {
	function onKey(e: KeyboardEvent) {
		if (e.key === 'F2' && session && !renaming) {
			e.preventDefault();
			startRename(session);
		}
	}
	window.addEventListener('keydown', onKey);
	return () => window.removeEventListener('keydown', onKey);
});
```

4. Also add **Copy path** next to Open folder (around the working-dir block, line 235-245). Wrap the existing dir display in a flex row with two buttons (Open + Copy):

```svelte
<div class="flex items-center gap-1">
  <button class="flex-1 font-mono text-xs break-all text-left hover:text-gruvbox-yellow inline-flex items-start gap-1.5"
          onclick={() => openCwd(session!.cwd)} title="Open in file manager">
    <FolderOpen size={11} class="mt-0.5 text-muted-foreground flex-shrink-0" />
    <span>{session.cwd}</span>
  </button>
  <button class="p-1 text-muted-foreground hover:text-foreground"
          onclick={() => copy(session!.cwd)} title="Copy path">
    <Copy size={11} />
  </button>
</div>
```

**Verify:** `pnpm check`. Manual: click Rename button → input focuses; press F2 → same; copy cwd → clipboard contains it.

**Commit:** `feat(gui): inspector exposes Rename button + F2 + Copy path`

---

## Task 1.9: Fix pre-existing a11y warnings in ProfilesView

**Objective:** Bring the svelte-check warning baseline from 8 → 1.

**Files:**
- Modify: `gui/src/lib/views/ProfilesView.svelte` (lines 200-233 region — 3× label/textarea pairs)

**Pattern:** wrap textarea inside the `<label>` (Svelte's preferred form association). Pseudo-diff repeated 3 times:

```svelte
- <div>
-   <label class="block text-xs text-muted-foreground mb-1">CLI flags …</label>
-   <textarea bind:value={draftParamsText} … ></textarea>
- </div>
+ <label class="block">
+   <span class="block text-xs text-muted-foreground mb-1">CLI flags …</span>
+   <textarea bind:value={draftParamsText} … ></textarea>
+ </label>
```

Repeat for env vars (line 212) and start script (line 224).

While here, fix the alert() on delete (line 133) — leave as `console.error` for now; Phase 2 Task 2.2 introduces toasts and Task 4.4 swaps console→toast.

**Verify:** `cd gui && pnpm check 2>&1 | tail -5` → expect "0 errors and 1 warning" (the `node` types one).

**Update gate going forward: "0 errors AND ≤1 warning".**

**Commit:** `chore(gui): fix a11y label-control association warnings in ProfilesView`

---

## Task 1.10: Phase 1 verification + smoke test

**Objective:** Confirm Phase 1 PR is shippable.

**Steps:**

1. `cd /Users/idev/Documents/projects/agentry && mise run check` → expect green (0 errors, ≤1 warning).
2. `mise run kill` then `mise run dev` — manual:
   - Fresh DB (`mise run reset` if needed): wizard text labels visible at every step.
   - After wizard: empty pane shows 3 tiles, ⌘T spawns default profile.
   - Sidebar rows: agent icons distinct, ⌘1/⌘2/⌘3 visible.
   - Split-button ▾ shows profile picker with ✓ on default.
   - TopBar shows "No sessions" → "All idle" → activity badges as state changes.
   - Inspector Rename + F2 + Copy path all work.
   - Activity bar labels visible.
3. Take 1 screenshot for the PR description.

**Commit:** none — verification only. Open PR.

---

# PHASE 2 — Workflow Speed

## Task 2.1: Tab strip above terminal pane

**Objective:** Show running sessions of the active project as VSCode-style tabs across the top of the terminal pane. Click switches focus; × kills (with confirm); middle-click closes.

**Files:**
- Create: `gui/src/lib/components/SessionTabs.svelte`
- Modify: `gui/src/routes/+page.svelte` (insert `<SessionTabs />` above `<TerminalView />`)

**Component skeleton:**

```svelte
<script lang="ts">
  import { sessions, markSessionEnding } from '$lib/stores/sessions';
  import { ui } from '$lib/stores/ui';
  import { focusSession, killSession } from '$lib/ipc';
  import { agentMeta } from '$lib/utils/agent';
  import { cn } from '$lib/utils/cn';
  import X from '@lucide/svelte/icons/x';

  let tabs = $derived(
    Array.from($sessions.values())
      .filter(s => s.projectId === $ui.activeProjectId && s.status !== 'finished' && s.status !== 'failed')
      .sort((a, b) => a.title.localeCompare(b.title))
  );

  function switchTo(id: string) {
    ui.update(u => ({ ...u, focusedSessionId: id, view: 'terminal' }));
    focusSession(id).catch(() => {});
  }

  function closeTab(e: MouseEvent, id: string) {
    e.stopPropagation();
    markSessionEnding(id);
    killSession(id).catch(err => markSessionEnding(id, { failReason: `kill failed: ${err}` }));
  }
</script>

{#if tabs.length > 0}
  <div class="flex items-stretch h-8 border-b border-border bg-card overflow-x-auto">
    {#each tabs as s (s.id)}
      {@const m = agentMeta(s.agent)}
      {@const active = $ui.focusedSessionId === s.id}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div role="tab" tabindex="0"
           class={cn(
             'inline-flex items-center gap-1.5 px-3 text-xs cursor-pointer border-r border-border min-w-0 group',
             active ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-secondary/40'
           )}
           onclick={() => switchTo(s.id)}
           onauxclick={(e) => e.button === 1 && closeTab(e, s.id)}>
        <m.icon size={11} class={cn(m.color, 'flex-shrink-0')} />
        <span class="truncate max-w-[140px]">{s.title}</span>
        {#if s.unread > 0 && !active}
          <span class="text-[9px] px-1 rounded bg-gruvbox-yellow text-background font-mono">{s.unread}</span>
        {/if}
        <button class="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-secondary"
                onclick={(e) => closeTab(e, s.id)}
                aria-label="Close session">
          <X size={10} />
        </button>
      </div>
    {/each}
  </div>
{/if}
```

In `+page.svelte` insert above the existing `<TerminalView>` block:

```svelte
<SessionTabs />
<TerminalView … />
```

**Verify:** `pnpm check`. Manual: 2 sessions → 2 tabs; click switches; × closes after kill; middle-click closes; active tab has different bg.

**Commit:** `feat(gui): tab strip above terminal pane`

---

## Task 2.2: Toast system

**Objective:** Global non-blocking notifications. Wire kill/delete/clipboard failures.

**Files:**
- Create: `gui/src/lib/stores/toasts.svelte.ts`
- Create: `gui/src/lib/components/Toaster.svelte`
- Modify: `gui/src/routes/+layout.svelte` (mount `<Toaster />` at root)
- Modify call sites: `Inspector.svelte`, `CommandPalette.svelte`, `ProfilesView.svelte` (delete error)

**Store (runes pattern, mirrors `r9.svelte.ts`):**

```ts
// gui/src/lib/stores/toasts.svelte.ts
export type ToastKind = 'info' | 'success' | 'error';
export interface Toast {
	id: number;
	kind: ToastKind;
	title: string;
	detail?: string;
}

let nextId = 1;

function createToasts() {
	let list = $state<Toast[]>([]);

	function push(t: Omit<Toast, 'id'>, ttlMs = 4500): number {
		const id = nextId++;
		list.push({ ...t, id });
		setTimeout(() => dismiss(id), ttlMs);
		return id;
	}

	function dismiss(id: number) {
		list = list.filter(t => t.id !== id);
	}

	return {
		get list() { return list; },
		info:    (title: string, detail?: string) => push({ kind: 'info', title, detail }),
		success: (title: string, detail?: string) => push({ kind: 'success', title, detail }),
		error:   (title: string, detail?: string) => push({ kind: 'error', title, detail }, 8000),
		dismiss
	};
}

export const toasts = createToasts();
```

**Component:**

```svelte
<!-- gui/src/lib/components/Toaster.svelte -->
<script lang="ts">
  import { toasts } from '$lib/stores/toasts.svelte';
  import { cn } from '$lib/utils/cn';
  import X from '@lucide/svelte/icons/x';
  import CheckCircle from '@lucide/svelte/icons/check-circle-2';
  import XCircle from '@lucide/svelte/icons/x-circle';
  import Info from '@lucide/svelte/icons/info';
</script>

<div class="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm pointer-events-none">
  {#each toasts.list as t (t.id)}
    <div class={cn(
      'pointer-events-auto bg-card border rounded shadow-lg px-3 py-2 text-sm flex items-start gap-2',
      t.kind === 'error' ? 'border-gruvbox-red' :
      t.kind === 'success' ? 'border-gruvbox-green' : 'border-border'
    )}>
      {#if t.kind === 'success'}<CheckCircle size={14} class="text-gruvbox-green flex-shrink-0 mt-0.5" />
      {:else if t.kind === 'error'}<XCircle size={14} class="text-gruvbox-red flex-shrink-0 mt-0.5" />
      {:else}<Info size={14} class="text-muted-foreground flex-shrink-0 mt-0.5" />{/if}
      <div class="flex-1 min-w-0">
        <div class="text-sm">{t.title}</div>
        {#if t.detail}<div class="text-[11px] text-muted-foreground break-words">{t.detail}</div>{/if}
      </div>
      <button class="text-muted-foreground hover:text-foreground" onclick={() => toasts.dismiss(t.id)} aria-label="Dismiss">
        <X size={12} />
      </button>
    </div>
  {/each}
</div>
```

**Layout:** in `gui/src/routes/+layout.svelte` add `import Toaster from '$lib/components/Toaster.svelte';` and render `<Toaster />` after `<slot />` (or `{@render children?.()}` depending on SvelteKit pattern in the file).

**Wire call sites** — replace error-path `console.error` with toast in:

- `Inspector.svelte` line 33 (clipboard fail), line 40 (kill fail), line 68 (delete fail), line 119 (open cwd fail)
- `CommandPalette.svelte` palette kill failure
- `ProfilesView.svelte` line 133 (replace `alert()` → `toasts.error('Delete failed', String(e))`)

**Verify:** `pnpm check`. Manual: trigger a delete on a non-existent ID via dev tools (or break clipboard perms in webview) → toast appears bottom-right, auto-dismisses.

**Commit:** `feat(gui): toast system; wire kill/delete/clipboard failures`

---

## Task 2.3: Sidebar `/` to focus filter

**Objective:** Press `/` anywhere (outside inputs) to focus the existing sidebar filter input.

**Files:**
- Modify: `gui/src/lib/components/SessionSidebar.svelte` (filter input — find by searching for `placeholder="Filter"` or similar)
- If no filter exists yet (check first), add a minimal `<input bind:value={filter}>` and filter the sessions array client-side.

**Approach:** add a `bind:this={filterEl}` and an effect listening for `/`:

```ts
let filterEl: HTMLInputElement | null = $state(null);

$effect(() => {
	function onKey(e: KeyboardEvent) {
		const t = e.target as HTMLElement | null;
		const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
		if (e.key === '/' && !inField) {
			e.preventDefault();
			filterEl?.focus();
			filterEl?.select();
		}
	}
	window.addEventListener('keydown', onKey);
	return () => window.removeEventListener('keydown', onKey);
});
```

Update Settings shortcuts list (`SettingsView.svelte`) — add `{ keys: ['/'], desc: 'Focus session filter' }`.

**Verify:** `pnpm check`. Manual: press `/` → cursor in filter.

**Commit:** `feat(gui): / focuses sidebar filter`

---

## Task 2.4: xterm `find` — ⌘F in terminal pane

**Objective:** `@xterm/addon-search` is already in `package.json`. Wire it: ⌘F opens an inline find bar above the terminal.

**Files:**
- Modify: `gui/src/lib/components/TerminalView.svelte` (load addon, expose `find(query)`)
- Create: `gui/src/lib/components/TerminalFindBar.svelte` (inline UI)
- Modify: `gui/src/routes/+page.svelte` (mount find bar above TerminalView; toggle via ⌘F binding)

**TerminalView changes:**

```ts
import { SearchAddon } from '@xterm/addon-search';
let searchAddon: SearchAddon | null = null;
// in onMount, after fitAddon load:
searchAddon = new SearchAddon();
term.loadAddon(searchAddon);

// expose API
export function findNext(q: string) { searchAddon?.findNext(q); }
export function findPrev(q: string) { searchAddon?.findPrevious(q); }
```

Svelte 5 component API: use `bind:this` from parent to call methods, or hoist methods via a `$state` ref object passed through props.

Simpler — pass a controller in via prop:

```ts
// in +page.svelte
let termCtl = $state<{ findNext: (q:string)=>void; findPrev: (q:string)=>void } | null>(null);

<TerminalView … bind:ctl={termCtl} />
```

In TerminalView:

```ts
let { sessionId, onInput, ctl = $bindable<{findNext:(q:string)=>void; findPrev:(q:string)=>void} | null>(null) } = $props();

onMount(() => {
  // …
  ctl = {
    findNext: (q) => searchAddon?.findNext(q),
    findPrev: (q) => searchAddon?.findPrevious(q)
  };
});
```

**Find bar:**

```svelte
<script lang="ts">
  let { ctl, onClose }: { ctl: {findNext:(q:string)=>void; findPrev:(q:string)=>void} | null; onClose:()=>void } = $props();
  let q = $state('');
  let el: HTMLInputElement | null = $state(null);
  $effect(() => { el?.focus(); });
</script>

<div class="flex items-center gap-2 px-2 py-1 border-b border-border bg-card">
  <input bind:this={el} bind:value={q}
         placeholder="Find in terminal…"
         class="flex-1 bg-input rounded px-2 py-0.5 text-xs border border-border focus:outline-none focus:border-gruvbox-yellow"
         onkeydown={(e) => {
           if (e.key === 'Enter') { e.shiftKey ? ctl?.findPrev(q) : ctl?.findNext(q); }
           else if (e.key === 'Escape') onClose();
         }} />
  <button class="text-xs px-2 py-0.5 rounded hover:bg-secondary" onclick={() => ctl?.findPrev(q)}>↑</button>
  <button class="text-xs px-2 py-0.5 rounded hover:bg-secondary" onclick={() => ctl?.findNext(q)}>↓</button>
  <button class="text-xs px-2 py-0.5 rounded hover:bg-secondary" onclick={onClose}>Esc</button>
</div>
```

In `+page.svelte` add `let findOpen = $state(false);` and a `bindKeys` entry `{ key: 'f', mod: true, handler: () => findOpen = true }`. Render `{#if findOpen}<TerminalFindBar …/>{/if}` above `<TerminalView />` and below `<SessionTabs />`.

Update Settings shortcuts list.

**Verify:** `pnpm check`. Manual: ⌘F → bar appears; type; Enter highlights match in xterm; Shift+Enter previous; Esc closes.

**Commit:** `feat(gui): xterm find bar (⌘F) using @xterm/addon-search`

---

## Task 2.5: Duplicate session action

**Objective:** "Duplicate" spawns a new session with same profile + cwd. Surface in Inspector + Command Palette.

**Files:**
- Modify: `gui/src/lib/components/Inspector.svelte` — add Duplicate button in the action row
- Modify: `gui/src/lib/components/CommandPalette.svelte` — add per-session "Duplicate: {title}" action

**Inspector button** (next to Rename, in the same gap-1.5 flex row):

```svelte
<button title="Duplicate (same profile + cwd)"
        class="flex-1 flex items-center justify-center gap-1 p-1.5 rounded bg-secondary hover:bg-secondary/80 text-xs"
        onclick={() => duplicate(session!)}>
  <Copy size={12} /> Duplicate
</button>
```

Handler:

```ts
import { startSession } from '$lib/ipc';
import { toasts } from '$lib/stores/toasts.svelte';

async function duplicate(s: SessionState) {
	try {
		await startSession(s.projectId, s.profileId);
		toasts.success(`Duplicated ${s.title}`);
	} catch (e) {
		toasts.error('Duplicate failed', String(e));
	}
}
```

> Note: `startSession` currently doesn't accept a cwd override (check `lib/ipc.ts`); session inherits from project. If profile-only duplicate is enough for now, ship that. If users complain, expand the wire protocol in a separate plan — out of scope here.

**Palette** — extend the `Sessions — kill` block (~line 50 of CommandPalette) with:

```ts
for (const s of $sessions.values()) {
	acts.push({
		id: `dup:${s.id}`,
		title: `Duplicate: ${s.title}`,
		subtitle: `New session with profile ${s.profileId.slice(0, 8)}…`,
		category: 'Sessions',
		icon: Copy,
		run: async () => { await startSession(s.projectId, s.profileId); }
	});
}
```

Import `Copy` from `@lucide/svelte/icons/copy`.

**Verify:** `pnpm check`. Manual: click Duplicate in inspector → new session appears in sidebar with same profile.

**Commit:** `feat(gui): duplicate session action (inspector + palette)`

---

## Task 2.6: Sidebar "Clear completed"

**Objective:** Bulk-delete all `finished`/`failed` sessions in the active project with one confirm.

**Files:**
- Modify: `gui/src/lib/components/SessionSidebar.svelte`

**Add** below the split-button block:

```svelte
{@const completed = Array.from($sessions.values()).filter(
   s => s.projectId === $ui.activeProjectId && (s.status === 'finished' || s.status === 'failed')
)}
{#if completed.length > 0}
  <button class="w-full px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/40 text-left inline-flex items-center gap-1.5"
          onclick={() => (clearConfirmOpen = true)}>
    <Trash size={11} /> Clear {completed.length} completed
  </button>
{/if}

<ConfirmDialog open={clearConfirmOpen}
               title="Clear completed"
               message={`Delete ${completed.length} finished/failed session${completed.length === 1 ? '' : 's'}? This cannot be undone.`}
               confirmLabel="Delete all"
               destructive
               onConfirm={async () => {
                 clearConfirmOpen = false;
                 for (const s of completed) {
                   try { await sendCmd({ cmd: 'delete_session', session_id: s.id }); }
                   catch (e) { toasts.error('Delete failed', `${s.title}: ${e}`); }
                 }
                 sessions.update(m => { for (const s of completed) m.delete(s.id); return m; });
                 toasts.success(`Cleared ${completed.length} sessions`);
               }}
               onCancel={() => (clearConfirmOpen = false)} />
```

Imports: `Trash`, `ConfirmDialog`, `sendCmd`, `toasts`, plus `let clearConfirmOpen = $state(false);`.

**Verify:** `pnpm check`. Manual: finish 2 sessions → "Clear 2 completed" appears → confirm → both gone, toast.

**Commit:** `feat(gui): sidebar clear-completed bulk action`

---

## Task 2.7: Reconnect banner when socket drops

**Objective:** Surface socket-loss state. The Tauri shim emits `daemon:connected` events on bootstrap; extend to listen for `daemon:disconnected` (already emitted on socket EOF, per `gui/src-tauri/src/relay.rs` — verify; if not, the listener simply never fires and the banner stays hidden, no harm).

**Files:**
- Modify: `gui/src/routes/+layout.svelte` or wherever the `daemon:connected` listener lives (search for `daemon:connected` in `gui/src/`)
- Create: `gui/src/lib/components/ReconnectBanner.svelte`

**Banner:**

```svelte
<script lang="ts">
  let { visible }: { visible: boolean } = $props();
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
</script>

{#if visible}
  <div class="absolute top-0 left-0 right-0 z-40 bg-gruvbox-red text-background text-xs px-3 py-1.5 flex items-center justify-center gap-2">
    <RefreshCw size={11} class="animate-spin" />
    Daemon disconnected — reconnecting…
  </div>
{/if}
```

State (in layout or a small `connection.svelte.ts` store):

```ts
let connected = $state(true);
listen('daemon:connected', () => connected = true);
listen('daemon:disconnected', () => connected = false);
```

Mount `<ReconnectBanner visible={!connected} />` at top of the main grid.

> **Verify shim emits the event** by grepping `gui/src-tauri/src/relay.rs` for `disconnected`. If absent, the banner is dormant — that's acceptable for this phase; raising the shim event is a separate (small) follow-up.

**Verify:** `pnpm check`. Manual: `mise run kill` while GUI is open → if shim emits, banner appears; if not, no regression.

**Commit:** `feat(gui): reconnect banner driven by daemon:disconnected event`

---

## Task 2.8: Phase 2 verification

1. `mise run check` → 0 errors, ≤1 warning.
2. `mise run dev` smoke: tabs work, ⌘F finds, `/` focuses filter, duplicate works, toasts appear on errors, clear-completed bulk-deletes, reconnect banner during `mise run kill`.

**Commit:** none. Open PR for Phase 2.

---

# PHASE 3 — Power Features

## Task 3.1: Command palette MRU bias

**Objective:** Last 20 used action IDs persist in localStorage; ranked first when filtered.

**Files:**
- Modify: `gui/src/lib/components/CommandPalette.svelte`

**Add helpers:**

```ts
const MRU_KEY = 'agentry:palette:mru';
function loadMru(): string[] { try { return JSON.parse(localStorage.getItem(MRU_KEY) ?? '[]'); } catch { return []; } }
function pushMru(id: string) {
	const cur = loadMru().filter(x => x !== id);
	cur.unshift(id);
	localStorage.setItem(MRU_KEY, JSON.stringify(cur.slice(0, 20)));
}
```

In `runItem` after `closePalette()`:

```ts
pushMru(item.id);
```

Bias filtered list — replace the existing `filtered` derived with:

```ts
let filtered = $derived.by<ActionItem[]>(() => {
	const q = query.trim().toLowerCase();
	const base = !q ? allActions : allActions.filter(/* existing subseq */ a => { /* unchanged */ });
	if (q) return base;
	const mru = loadMru();
	const rank = new Map(mru.map((id, i) => [id, i]));
	return [...base].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
});
```

(MRU only re-orders the empty-query view; once user types, fuzzy-subseq dominates.)

**Verify:** `pnpm check`. Manual: open palette → run "Go to Overview" → close → reopen → "Go to Overview" appears at top.

**Commit:** `feat(gui): palette MRU bias on empty query`

---

## Task 3.2: Terminal header bar

**Objective:** Above the xterm pane (below tab strip), show focused session title + status dot + Kill/Resume/Copy-ID buttons. Reduces glance-to-inspector cost.

**Files:**
- Create: `gui/src/lib/components/TerminalHeader.svelte`
- Modify: `gui/src/routes/+page.svelte` (mount under `<SessionTabs />` and `<TerminalFindBar />`, above `<TerminalView />`)

**Skeleton:**

```svelte
<script lang="ts">
  import { sessions, markSessionEnding } from '$lib/stores/sessions';
  import { ui } from '$lib/stores/ui';
  import { killSession, resumeSession } from '$lib/ipc';
  import { toasts } from '$lib/stores/toasts.svelte';
  import { agentMeta } from '$lib/utils/agent';
  import { cn } from '$lib/utils/cn';
  import Square from '@lucide/svelte/icons/square';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Copy from '@lucide/svelte/icons/copy';

  let s = $derived($ui.focusedSessionId ? $sessions.get($ui.focusedSessionId) : undefined);
</script>

{#if s}
  {@const m = agentMeta(s.agent)}
  <div class="flex items-center gap-2 h-9 px-3 border-b border-border bg-card text-xs">
    <m.icon size={12} class={m.color} />
    <span class="font-medium truncate flex-1">{s.title}</span>
    <span class={cn('text-[11px]', s.activity === 'awaiting_input' ? 'text-gruvbox-red' : s.activity === 'working' ? 'text-gruvbox-green' : 'text-muted-foreground')}>
      {s.status}{s.activity ? ` · ${s.activity.replace('_',' ')}` : ''}
    </span>
    {#if s.status === 'running' || s.status === 'queued'}
      <button class="p-1 rounded hover:bg-secondary text-gruvbox-red" title="Kill"
              onclick={() => { markSessionEnding(s!.id); killSession(s!.id).catch(e => toasts.error('Kill failed', String(e))); }}>
        <Square size={12} fill="currentColor" />
      </button>
    {/if}
    {#if (s.status === 'finished' || s.status === 'failed') && (s.agent === 'claude' || s.agent_session_id)}
      <button class="p-1 rounded hover:bg-secondary" title="Resume"
              onclick={() => resumeSession(s!.id)}>
        <RotateCcw size={12} />
      </button>
    {/if}
    <button class="p-1 rounded hover:bg-secondary" title="Copy session ID"
            onclick={() => { navigator.clipboard.writeText(s!.id); toasts.info('Copied session ID'); }}>
      <Copy size={12} />
    </button>
  </div>
{/if}
```

**Verify:** `pnpm check`. Manual: focus session → header shows; Kill button works without opening inspector.

**Commit:** `feat(gui): terminal header bar with title/status/actions`

---

## Task 3.3: Terminal font-size shortcuts (⌘= / ⌘- / ⌘0)

**Objective:** Persist `fontSize` per-user via localStorage; resize xterm and refit.

**Files:**
- Modify: `gui/src/lib/components/TerminalView.svelte`

**Add:**

```ts
const FONT_KEY = 'agentry:term:fontsize';
function loadFont(): number { return Number(localStorage.getItem(FONT_KEY) ?? '13') || 13; }
function saveFont(n: number) { localStorage.setItem(FONT_KEY, String(n)); }

// in terminal options use loadFont() instead of literal 13

$effect(() => {
	function onKey(e: KeyboardEvent) {
		const mod = e.metaKey || e.ctrlKey;
		if (!mod || !term) return;
		if (e.key === '=' || e.key === '+') {
			e.preventDefault();
			term.options.fontSize = Math.min(28, (term.options.fontSize ?? 13) + 1);
			saveFont(term.options.fontSize!); scheduleFit();
		} else if (e.key === '-') {
			e.preventDefault();
			term.options.fontSize = Math.max(8, (term.options.fontSize ?? 13) - 1);
			saveFont(term.options.fontSize!); scheduleFit();
		} else if (e.key === '0') {
			e.preventDefault();
			term.options.fontSize = 13; saveFont(13); scheduleFit();
		}
	}
	window.addEventListener('keydown', onKey);
	return () => window.removeEventListener('keydown', onKey);
});
```

Settings shortcuts list — add three entries.

**Verify:** Manual: ⌘= grows, ⌘- shrinks, ⌘0 resets; reload — persists.

**Commit:** `feat(gui): terminal font-size shortcuts ⌘= ⌘- ⌘0`

---

## Task 3.4: Theme picker (gruvbox / one-dark / light)

**Objective:** Stop hard-coding gruvbox; let users switch.

**Files:**
- Modify: `gui/src/app.css` (or wherever Tailwind config / global CSS lives — check `gui/src/` for `app.css` or `tailwind.css`)
- Create: `gui/src/lib/stores/theme.svelte.ts`
- Modify: `gui/src/lib/views/SettingsView.svelte` (add theme picker section)
- Modify: `gui/src/lib/components/TerminalView.svelte` (read theme palette dynamically)

**Approach:** 3 themes defined as CSS variable sets toggled via `<html data-theme="gruvbox|one-dark|light">`. Tailwind utilities continue using `bg-card`/`text-foreground` etc which are already CSS-var-backed in shadcn pattern. Gruvbox aliases (`text-gruvbox-yellow` etc) stay valid by mapping to CSS vars per theme.

```ts
// theme.svelte.ts
const KEY = 'agentry:theme';
export type Theme = 'gruvbox' | 'one-dark' | 'light';

function createTheme() {
	let cur = $state<Theme>((localStorage.getItem(KEY) as Theme) ?? 'gruvbox');
	$effect(() => { document.documentElement.dataset.theme = cur; localStorage.setItem(KEY, cur); });
	return {
		get value() { return cur; },
		set(t: Theme) { cur = t; }
	};
}
export const theme = createTheme();
```

**CSS** (in `gui/src/app.css` — append):

```css
:root[data-theme="gruvbox"] { /* existing vars unchanged */ }
:root[data-theme="one-dark"] {
  --background: 220 13% 18%;
  --foreground: 220 14% 90%;
  /* … remap shadcn vars */
}
:root[data-theme="light"] {
  --background: 0 0% 100%;
  --foreground: 220 13% 18%;
  /* … */
}
```

> Pragmatic scope: ship gruvbox + one-dark to start (light theme has more visual debt — many `bg-card`/border combinations need re-tuning). Add light in a follow-up commit if time permits.

**Settings UI section:**

```svelte
<section class="bg-card border border-border rounded p-4 space-y-3">
  <h2 class="text-sm font-semibold">Theme</h2>
  <div class="flex gap-2">
    {#each ['gruvbox','one-dark'] as t}
      <button class={cn('px-3 py-1.5 rounded text-xs border', theme.value === t ? 'border-gruvbox-yellow bg-secondary' : 'border-border hover:border-secondary')}
              onclick={() => theme.set(t)}>{t}</button>
    {/each}
  </div>
</section>
```

**TerminalView:** define a theme map `{ gruvbox: {…}, 'one-dark': {…} }` and pick by `theme.value` on mount + re-apply via `$effect`:

```ts
import { theme } from '$lib/stores/theme.svelte';
$effect(() => {
	if (!term) return;
	term.options.theme = THEMES[theme.value];
});
```

**Verify:** `pnpm check`. Manual: switch in Settings → entire UI + xterm recolor without reload.

**Commit:** `feat(gui): theme picker (gruvbox / one-dark)`

---

## Task 3.5: Profile "Test" button

**Objective:** In Profiles view, each profile card gets a Test button: spawns a dummy session in a tmpdir running `agent-cli --version` (or first 1 line), reports pass/fail in a toast.

> **Scope check:** this requires a Cmd to spawn an ephemeral session AND a way to capture its exit. Current `start_session` does spawn; capturing argv + exit needs `session_finished` event subscription scoped by session id. Both already exist (see `daemon/src/server.rs` events). No wire change.

**Files:**
- Modify: `gui/src/lib/views/ProfilesView.svelte`

**Sketch:**

```ts
async function testProfile(p: ProfileInfo) {
	const toastId = toasts.info(`Testing ${p.name}…`);
	try {
		// Reuse first available project — we just need any valid project id with a real cwd.
		const projs = Array.from(get(projects).values());
		const proj = projs[0];
		if (!proj) { toasts.error('Test failed', 'Create a project first'); return; }
		const sid = await startSession(proj.id, p.id);
		// Wait up to 3s for a session_started / failed event for this session id.
		// (Subscribe via existing listener; resolve a promise.)
		const res = await waitForSessionStart(sid, 3000);
		toasts.dismiss(toastId);
		if (res.ok) toasts.success(`${p.name}: OK`, `Started in ${res.ms}ms`);
		else        toasts.error(`${p.name}: failed`, res.error ?? 'unknown');
		// Optional: kill the test session immediately
		await killSession(sid).catch(() => {});
	} catch (e) { toasts.error('Test failed', String(e)); }
}
```

`waitForSessionStart` lives in `lib/ipc.ts` as a helper around the existing event stream (`listen('daemon:session_started', …)` and `daemon:session_failed`).

**UI:** add a small `<Play />` test button next to Edit in each card (line ~280 of ProfilesView).

**Verify:** Manual: click Test on a valid profile → toast `OK`; on a broken one (set `agent_type` to `codex` without codex installed) → `failed` with error.

**Commit:** `feat(gui): per-profile Test button reports start success/failure`

---

## Task 3.6: Onboarding tour (one-time)

**Objective:** After the wizard's `done` step closes, on first launch, run a 5-step coach-mark tour pointing at: activity bar, sidebar, terminal, inspector, palette hint. Dismissible. Persist `agentry:onboarded=1`.

**Files:**
- Create: `gui/src/lib/components/OnboardingTour.svelte`
- Modify: `gui/src/lib/components/SetupWizard.svelte` (`close()` — after first ever wizard completion, trigger `tour.start()`)

**Pattern:** absolute-positioned popover anchored to elements via `document.querySelector('[data-tour="sidebar"]')` etc. Add `data-tour` attributes on:

- ActivityBar root → `data-tour="activity"`
- SessionSidebar root → `data-tour="sidebar"`
- TerminalView container → `data-tour="terminal"`
- Inspector root → `data-tour="inspector"`

Tour state (5 steps, "Next" / "Skip" / final "Got it"). Keep simple — no complex spotlight, just a bordered card next to target with arrow.

**Trigger:**

```ts
// in SetupWizard close() after done step on first launch:
if (!localStorage.getItem('agentry:onboarded')) {
	localStorage.setItem('agentry:onboarded', '1');
	setTimeout(() => tour.start(), 400);
}
```

**Verify:** Wipe localStorage → restart → wizard → done → tour appears.

**Commit:** `feat(gui): first-launch onboarding tour`

---

## Task 3.7: Inspector "Copy as CLI"

**Objective:** Build the full reproducible command (`env KEY=VAL agent --flag=… …`) for the focused session and copy to clipboard.

**Files:**
- Modify: `gui/src/lib/components/Inspector.svelte`

**Requires** access to the profile's `params` + `env`. We have `profiles` store. Build:

```ts
import { profiles } from '$lib/stores/profiles';
import { shellQuote } from '$lib/utils/shell';

function copyAsCli(s: SessionState) {
	const p = $profiles.find(x => x.id === s.profileId);
	if (!p) { toasts.error('Profile not found'); return; }
	const env = p.env.map(e => `${e.key}=${shellQuote(e.value)}`).join(' ');
	const flags = p.params.map(x => x.value !== null ? `${x.flag}=${shellQuote(x.value)}` : x.flag).join(' ');
	const bin = p.agent_type === 'claude_code' ? 'claude' : p.agent_type === 'codex' ? 'codex' : 'opencode';
	const cmd = `cd ${shellQuote(s.cwd)} && ${env} ${bin} ${flags}`.replace(/\s+/g, ' ').trim();
	navigator.clipboard.writeText(cmd);
	toasts.success('Copied CLI command');
}
```

`gui/src/lib/utils/shell.ts`:

```ts
export function shellQuote(s: string): string {
	if (/^[A-Za-z0-9_\-./=]+$/.test(s)) return s;
	return `'${s.replace(/'/g, `'\\''`)}'`;
}
```

UI: small button in action row labeled "Copy as CLI".

**Verify:** Manual: copy → paste into terminal → runs.

**Commit:** `feat(gui): inspector Copy-as-CLI`

---

## Task 3.8: ConfirmDialog "Don't ask again" + Phase 3 gate

**Objective:** Per-action remember-choice for finished sessions; add to settings store with a "Reset confirmations" link in Settings.

**Files:**
- Modify: `gui/src/lib/components/ConfirmDialog.svelte` (add optional `rememberKey?: string` prop + checkbox)
- Modify: `gui/src/lib/stores/settings.ts` (add `dontConfirm: Record<string, boolean>` map persisted to localStorage)
- Modify: Inspector delete path to pass `rememberKey="delete-finished"` only when status is finished/failed

**Verify Phase 3:** `mise run check` green. Manual smoke: palette MRU works after switching action; terminal header shows; font size persists across reload; theme switch live; profile Test fires; tour fires once on wiped localStorage; Copy-as-CLI pastes a runnable command; confirm-skip honored.

**Commit:** `feat(gui): confirm-dialog dont-ask-again + settings reset`

---

# PHASE 4 — Polish

## Task 4.1: Density toggle (comfortable / compact)

**Files:**
- Modify: `gui/src/lib/stores/settings.ts` (add `density: 'comfortable' | 'compact'`)
- Modify: Sidebar/Inspector — use `density === 'compact' ? 'py-1' : 'py-1.5'` etc

Add Settings section + persist.

**Commit:** `feat(gui): density toggle (comfortable/compact)`

---

## Task 4.2: Replace literal `text-gruvbox-*` with semantic vars where feasible

**Files:**
- `gui/src/app.css` — add semantic aliases `--accent-warn`, `--accent-ok`, `--accent-error`, `--accent-info` mapping to gruvbox shades in gruvbox theme; remap in one-dark theme.
- Sidebar/Inspector/TopBar — swap `text-gruvbox-red` → `text-[hsl(var(--accent-error))]` (or define Tailwind utilities in `app.css` `@layer utilities`).

> **Scope guard:** don't do a sweeping rename. Only swap the colors used in cross-theme contexts (status dots, badges, urgent text). Decorative one-offs stay.

**Commit:** `refactor(gui): swap literal gruvbox colors for semantic theme vars`

---

## Task 4.3: Subtle animations

**Files:**
- `gui/src/lib/components/SessionSidebar.svelte` — add Svelte `transition:slide` (from `svelte/transition`) on new session row entry
- `gui/src/lib/components/Toaster.svelte` — `transition:fly` from right
- ChevronRight rotate on group collapse (if collapsible groups exist in sidebar)

Keep durations ≤ 150ms.

**Commit:** `feat(gui): subtle enter/exit transitions`

---

## Task 4.4: Audit remaining console.error → toast

**Files:**
- grep `gui/src/` for `console.error` — swap to `toasts.error` everywhere the user can trigger the failure interactively.

```bash
search_files target=content pattern="console\.error" path="gui/src"
```

Leave devtool-only logs (background polls, event-decode errors) as `console.error`.

**Commit:** `chore(gui): convert user-facing console.error to toasts`

---

## Task 4.5: Focus rings + a11y pass + Phase 4 gate

- Add `focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none` to interactive primitives (buttons inside Sidebar/TabStrip/Inspector/Toaster).
- Run final `mise run check`. Confirm gate: 0 errors, ≤1 warning.
- Manual smoke: tab through interactive elements with keyboard, every focus is visible.

**Commit:** `chore(gui): focus rings + a11y polish`

---

# Files Touched (rollup)

```
gui/src/app.css                                    (4.2, 3.4)
gui/src/routes/+layout.svelte                      (2.2, 2.7)
gui/src/routes/+page.svelte                        (1.3, 2.1, 2.4, 3.2)
gui/src/lib/components/ActivityBar.svelte          (1.4, 3.6)
gui/src/lib/components/CommandPalette.svelte       (2.2, 2.5, 3.1)
gui/src/lib/components/ConfirmDialog.svelte        (3.8)
gui/src/lib/components/Inspector.svelte            (1.8, 2.2, 2.5, 3.7, 3.6, 4.5)
gui/src/lib/components/SessionSidebar.svelte       (1.5, 1.6, 2.3, 2.6, 3.6, 4.1, 4.3)
gui/src/lib/components/SessionTabs.svelte          NEW (2.1)
gui/src/lib/components/SetupWizard.svelte          (1.2, 3.6)
gui/src/lib/components/TerminalFindBar.svelte      NEW (2.4)
gui/src/lib/components/TerminalHeader.svelte       NEW (3.2)
gui/src/lib/components/TerminalView.svelte         (2.4, 3.3, 3.4, 3.6)
gui/src/lib/components/Toaster.svelte              NEW (2.2)
gui/src/lib/components/ReconnectBanner.svelte      NEW (2.7)
gui/src/lib/components/OnboardingTour.svelte       NEW (3.6)
gui/src/lib/components/TopBar.svelte               (1.7)
gui/src/lib/ipc.ts                                 (3.5)
gui/src/lib/stores/settings.ts                     (3.8, 4.1)
gui/src/lib/stores/theme.svelte.ts                 NEW (3.4)
gui/src/lib/stores/toasts.svelte.ts                NEW (2.2)
gui/src/lib/utils/agent.ts                         NEW (1.1)
gui/src/lib/utils/shell.ts                         NEW (3.7)
gui/src/lib/views/ProfilesView.svelte              (1.9, 3.5)
gui/src/lib/views/SettingsView.svelte              (2.3, 2.4, 3.3, 3.4, 3.8, 4.1)
```

# Risks & Tradeoffs

1. **No tests** — only safety net is `svelte-check` + clippy + manual smoke. Each phase ends with a manual checklist; do not batch phases into one PR.
2. **Theme: one-dark needs real palette tuning.** Ship gruvbox + one-dark; defer light to a follow-up if visual debt > 30min.
3. **Tab strip duplicates sidebar info.** Some users prefer one or the other. Keep both; users self-select. If telemetry ever lands, measure usage.
4. **MRU bias** changes "free order" of palette; users who memorized positions will notice. Acceptable since palette is fuzzy-search-first.
5. **Tour can feel patronizing** for returning users. Gate on `localStorage['agentry:onboarded']` strictly; provide a "Run tour again" entry in Settings as escape valve.
6. **Reconnect banner** depends on shim emitting `daemon:disconnected`. If it doesn't yet, the banner is dormant — no regression.
7. **Profile Test** spawns a real session. Side effect: a transient row in the sidebar that immediately gets killed. Acceptable; could be hidden via a `transient: true` flag in a future iteration (out of scope, would touch wire).

# Open Questions

- Do we have a real path for **multi-window** (one project per window)? If so, tab strip should live per-window. Out of scope here.
- Should `Duplicate session` accept a cwd override (subdir within project)? Would need a small wire addition (`cwd_override` on `start_session`) — out of scope.
- Theme: do we want to honor `prefers-color-scheme` on first launch? Suggest yes, defaulting to user-pref-or-gruvbox.

# Verification per phase

After each phase, the implementer runs:

```bash
cd /Users/idev/Documents/projects/agentry
git status --short                  # confirm only intended files dirty
mise run check                      # gate: 0 errors, ≤1 warning (≤8 before Task 1.9)
mise run kill && mise run dev       # smoke
```

Then ticks the per-phase manual checklist (Tasks 1.10, 2.8, 3.8, 4.5).

# Execution Handoff

**Plan complete and saved.** Ready to execute using `subagent-driven-development` — I'll dispatch a fresh subagent per task with two-stage review (spec compliance then code quality). Shall I proceed?
