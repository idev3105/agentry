# Agentry GUI — Post-Phase-4 Fix Plan

**Audience:** subagent-driven-development executor
**Baseline:** commit `23c8e12` (Phase 4 landed). Gate green at baseline (`pnpm check`: 0 errors / 1 warning).
**Scope:** Close the 7 outstanding bugs from Phase 3 + Phase 4 reviews. No new features. No wire-protocol changes.
**Effort:** ~45 min total. 1 commit per task (7 commits) or squash to 1.

---

## Gate (every task)

```bash
cd gui && pnpm check   # MUST: 0 errors, ≤1 warning
```

If gate fails, fix before next task. After all 7 tasks land, optional manual smoke:

```bash
mise run dev   # launch app, verify gruvbox colors render, Settings → density toggles row height, Resume button visible on finished Claude session
```

---

## Task list (in order — each is independent and trivially small)

| # | File | Severity | Effort |
|---|---|---|---|
| F1 | `app.css` | 🔴 | 5m |
| F2 | `routes/+page.svelte` | 🔴 | 3m |
| F3 | `components/SessionSidebar.svelte` | 🔴 | 5m |
| F4 | `components/Inspector.svelte` | 🔴 | 3m |
| F5 | `components/TerminalHeader.svelte` | 🔴 | 2m |
| F6 | `components/Inspector.svelte` | 🟡 | 1m |
| F7 | `routes/+page.svelte` | 🟡 | 5m |

---

# Task F1 — Add density CSS vars

**Objective:** Make density toggle actually change row spacing.

**File:** `gui/src/app.css`

**Change:** Append after the existing `:root[data-theme="one-dark"]` block (before `@layer base`):

```css
/* Density — switched via data-density attribute on root <div> in +page.svelte.
   Default (no attribute or "comfortable") = py-1.5 equiv. "compact" = py-1 equiv.
   Components opt-in by using py-[var(--row-py)] instead of hardcoded py-1/py-1.5. */
:root,
[data-density="comfortable"] {
	--row-py: 0.375rem;  /* matches Tailwind py-1.5 */
	--row-gap: 0.5rem;   /* matches Tailwind gap-2 */
}

[data-density="compact"] {
	--row-py: 0.25rem;   /* matches Tailwind py-1 */
	--row-gap: 0.375rem; /* matches Tailwind gap-1.5 */
}
```

**Gate after:** `pnpm check` clean.

---

# Task F2 — Apply `data-density` to root in +page.svelte

**Objective:** Surface the density store value as a DOM attribute so CSS selectors fire.

**File:** `gui/src/routes/+page.svelte`

**Step 1.** Add import near top of `<script>` (after the other store imports, around line 30-40):

```ts
import { density } from '$lib/stores/settings';
```

**Step 2.** Update the root wrapper `<div>` at **line 574**:

Before:
```svelte
<div class="flex h-screen bg-background text-foreground overflow-hidden">
```

After:
```svelte
<div class="flex h-screen bg-background text-foreground overflow-hidden" data-density={$density}>
```

**Step 3.** Same line area, fix bug N2 from review — replace **line 620** hardcoded bg:

Before:
```svelte
<div data-tour="terminal" class="h-full w-full overflow-hidden bg-[#282828]">
```

After:
```svelte
<div data-tour="terminal" class="h-full w-full overflow-hidden bg-background">
```

(Theme-reactive — switches with `data-theme`.)

**Gate after:** `pnpm check` clean.

---

# Task F3 — Wire density var in SessionSidebar

**Objective:** Replace inline density ternary with the CSS var so density actually affects rendering.

**File:** `gui/src/lib/components/SessionSidebar.svelte`

**Find** the per-session row that currently has the inline ternary (search for `py-1.5` or `$density === 'compact' ? 'py-1' : 'py-1.5'`):

Before (example — exact match depends on current code):
```svelte
class={cn(
	'group relative flex items-center gap-2 px-2 cursor-pointer transition-colors',
	$density === 'compact' ? 'py-1' : 'py-1.5',
	...
)}
```

After:
```svelte
class={cn(
	'group relative flex items-center gap-2 px-2 cursor-pointer transition-colors py-[var(--row-py)]',
	...
)}
```

Remove the `$density === 'compact' ? ...` clause AND the `import { density } from '$lib/stores/settings'` line if it's no longer referenced anywhere else in this file.

**Verify after edit:** Search file for `$density` — should be zero hits. If hits remain, leave the import.

**Gate after:** `pnpm check` clean.

---

# Task F4 — Fix Resume button condition in Inspector

**Objective:** `agent === 'claude'` never matches (wire value is `'claude_code'`). Resume button hidden for every Claude Code session without a captured `agent_session_id`.

**File:** `gui/src/lib/components/Inspector.svelte`

**Line 221.** Find:

```svelte
{@const canResume = session.agent === 'claude' || !!session.agent_session_id}
```

Replace with:

```svelte
{@const canResume = session.agent === 'claude_code' || !!session.agent_session_id}
```

**Gate after:** `pnpm check` clean.

---

# Task F5 — Same fix in TerminalHeader

**File:** `gui/src/lib/components/TerminalHeader.svelte`

**Line 29.** Find:

```svelte
{#if (s.status === 'finished' || s.status === 'failed') && (s.agent === 'claude' || s.agent_session_id)}
```

Replace with:

```svelte
{#if (s.status === 'finished' || s.status === 'failed') && (s.agent === 'claude_code' || s.agent_session_id)}
```

**Gate after:** `pnpm check` clean.

---

# Task F6 — Remove dead `density` import from Inspector

**File:** `gui/src/lib/components/Inspector.svelte`

**Line 4.** Delete the line entirely:

```ts
import { density } from '$lib/stores/settings';
```

(Inspector never reads `$density` — confirmed via grep.)

**Verify after edit:** `grep -n density gui/src/lib/components/Inspector.svelte` → zero hits.

**Gate after:** `pnpm check` clean.

---

# Task F7 — Bootstrap catch → toasts.error

**Objective:** Phase 4.4 audit missed this one. Silent bootstrap failure leaves user with a blank UI and no feedback.

**File:** `gui/src/routes/+page.svelte`

**Step 1.** Ensure `toasts` is already imported (it is — search confirms). If not, add:
```ts
import { toasts } from '$lib/stores/toasts.svelte';
```

**Step 2.** Replace **lines 128-130**:

Before:
```ts
} catch (e) {
	console.error('bootstrap rpc failed:', e);
}
```

After:
```ts
} catch (e) {
	console.error('bootstrap rpc failed:', e);
	toasts.error('Bootstrap failed', String(e));
	bootstrapError = String(e);
}
```

> Keep the `console.error` — useful for devtools. Add the toast + set `bootstrapError` so the existing banner at line 581-585 also shows. Belt-and-suspenders.

**Note:** Leave **line 337** `console.warn('pre-replay resize failed (non-fatal)')` alone — it's correctly labeled non-fatal and shouldn't toast.

**Gate after:** `pnpm check` clean.

---

# Out of scope (deferred — file bugs separately if you want them)

- **N3** Trash/Trash2 import naming inversion in SessionSidebar — cosmetic, no runtime issue.
- **N4** `transition:slide` per-keystroke jank on filter — needs `animate:flip` rework, design call.
- **N5** No explicit `:root[data-theme="gruvbox"]` rule — works via cascade fallback; fragile only if a 3rd theme is added.
- **`OnboardingTour.svelte`** `data-tour="palette"` step has no target element — needs separate design discussion (palette is a modal).
- **`ProfilesView.svelte:158`** `testProfile` catch already calls `toasts.error` but doesn't dismiss `toastId`. Lower priority — toast auto-dismisses after 4.5s. If you want it fixed: wrap in `try/finally`.

---

# Commit message templates

If committing one-per-task:

```
fix(gui): wire density CSS vars (F1)
fix(gui): apply data-density on root + theme-reactive terminal bg (F2)
fix(gui): use --row-py var instead of inline density ternary (F3)
fix(gui): canResume check 'claude_code' not 'claude' (Inspector) (F4)
fix(gui): canResume check 'claude_code' not 'claude' (TerminalHeader) (F5)
chore(gui): remove dead density import from Inspector (F6)
fix(gui): surface bootstrap failure via toast + banner (F7)
```

Or squash all into one:

```
fix(gui): close Phase 3+4 review feedback — density wiring, resume button, bootstrap toast

- app.css: add --row-py / --row-gap density vars
- +page.svelte: apply data-density on root; replace hardcoded bg-[#282828] with bg-background
- SessionSidebar: use py-[var(--row-py)] instead of inline density ternary
- Inspector + TerminalHeader: canResume checks 'claude_code' not 'claude' (wire value)
- Inspector: drop dead density import
- +page.svelte bootstrap catch: surface error via toasts.error + bootstrapError banner
```

---

# Done criteria

✅ `cd gui && pnpm check` → 0 errors / 1 warning
✅ `mise run dev` launches without white/gray screen
✅ Settings → Density → Compact: visibly tighter session list rows
✅ Settings → Theme → One Dark: terminal pane background updates (no more stuck on `#282828`)
✅ Finished Claude session shows Resume button in both Inspector and TerminalHeader
✅ Killing the daemon mid-session triggers a red toast (not silent console error)
