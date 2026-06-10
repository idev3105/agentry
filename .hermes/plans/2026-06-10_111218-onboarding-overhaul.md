# Agentry GUI — Onboarding Overhaul Plan

**Audience:** Junior frontend engineer.
**Scope:** First-time launch only — from app start to user's first session running. No empty-state rework, no tour expansion.
**Approach:** Tear down current `SetupWizard.svelte` and rebuild as a full-screen, 4-step onboarding flow with detect-and-suggest logic.
**Baseline:** commit `23c8e12` (Phase 4 landed) + 7 outstanding fixes (see `2026-06-10_013439-agentry-ui-fix-pass.md`). Land those first.
**Stack constraint:** Svelte 5 runes, Tailwind v4, lucide-svelte. No new npm deps. No wire-protocol changes.
**Effort:** 3–4 days for a junior. 6 tasks. Commit per task.

---

## Why we are doing this

Current `SetupWizard.svelte` problems (read it before you start — `gui/src/lib/components/SetupWizard.svelte`):

| # | Problem | Impact |
|---|---|---|
| 1 | **Modal over empty UI** — user sees a broken-looking app behind a card. The activity bar, top bar, and empty terminal pane peek through `bg-black/50`. | Looks unfinished. |
| 2 | **No agent detection** — the agent picker lists Claude/Codex/OpenCode with no hint about whether the CLIs are actually installed. Users pick one, hit Create, see a cryptic error when the binary is missing. | Highest drop-off point. |
| 3 | **"Pick a project folder" is the first real choice** — no explanation of what a project IS in Agentry's mental model. New users don't know if they should pick a code repo, a parent dir, or `~/`. | Decision paralysis. |
| 4 | **Failure recovery is bad** — any error in `finish()` rolls back to step `agent` with a tiny red text line. User cannot see WHICH step failed (project create? profile create? session start?). | Stuck users abandon. |
| 5 | **"All set" screen is a dead end** — says "session starting" but provides no next-step guidance. User clicks Open Terminal and is dropped into a terminal with no idea what to type. | First-session confusion. |
| 6 | **Click-outside-to-close** — easy to accidentally dismiss mid-flow. State is preserved (good), but the dismiss feels like a bug, not a feature. | Confusing UX. |
| 7 | **Single CTA on each step** — no "skip", no "I already have a project, just let me in" escape hatch. | Power users frustrated. |
| 8 | **Progress dots don't include `creating`** — the dots show welcome→folder→agent→done, skipping the loading state. User loses sense of progress when the spinner appears. | Minor but jarring. |

---

## Target experience

```
┌─────────────────────────────────────────────────────────┐
│  FULL-SCREEN onboarding (NOT a modal — fills viewport)  │
│                                                         │
│  Step 1: Welcome              "What is Agentry?"        │
│           [Get started]  [Skip onboarding]              │
│                                                         │
│  Step 2: Detect agents        Auto-runs which/where     │
│           ✓ Claude Code (detected)                      │
│           ✓ Codex (detected)                            │
│           ✗ OpenCode (not installed — install guide)    │
│           [Continue with Claude Code]                   │
│                                                         │
│  Step 3: Pick project         Folder + name + preset    │
│           [Browse folder]  [Use ~/Documents (default)]  │
│                                                         │
│  Step 4: Launch               Live progress checklist   │
│           ✓ Project created                             │
│           ✓ Profile saved                               │
│           ⟳ Starting session…                           │
│           [Take a quick tour] [Just open terminal]      │
└─────────────────────────────────────────────────────────┘
```

Differences from current:
- Full-screen (not modal) — no broken-looking background
- Step 2 **detects installed agents** before showing the picker → no cryptic errors
- Step 4 shows **per-step progress** with checkmarks/spinners → failures pinpoint the broken step
- Always-visible "Skip onboarding" escape hatch
- Each completed step is editable via the progress dots (click to go back)

---

## Files

### Create
- `gui/src/lib/components/Onboarding.svelte` — new full-screen flow (replaces SetupWizard.svelte for first-run)
- `gui/src/lib/utils/detect-agents.ts` — runs `which` for each agent CLI, returns availability map

### Modify
- `gui/src/lib/stores/ui.ts` — rename `wizardOpen` → `onboardingOpen`; add `openOnboarding()`/`closeOnboarding()`
- `gui/src/routes/+page.svelte` — swap `<SetupWizard />` for `<Onboarding />`; auto-open on first launch when no projects exist
- `gui/src/lib/types.ts` — add `AgentAvailability` interface

### Delete
- `gui/src/lib/components/SetupWizard.svelte` — replaced

---

## Gate (every task)

```bash
cd gui && pnpm check    # MUST: 0 errors, ≤1 warning
mise run dev            # MUST: app launches without white/gray screen
```

Manual smoke test before merging each task — see "Done criteria" at the bottom.

---

# Task O1: Add agent detection utility

**Why:** Step 2 needs to know which agent CLIs are installed before showing them. Tauri can shell out via `Command::new(...)`.

**Files:**
- Create `gui/src/lib/utils/detect-agents.ts`

**Code (full file):**

```ts
import { Command } from '@tauri-apps/plugin-shell';
import type { AgentType } from '$lib/types';

export interface AgentAvailability {
	id: AgentType;
	bin: string;
	installed: boolean;
	path: string | null;
	version: string | null;
	error: string | null;
}

const PROBES: Record<AgentType, string> = {
	claude_code: 'claude',
	codex:       'codex',
	open_code:   'opencode'
};

/** Run `which <bin>` and `<bin> --version` for each agent. Returns availability map. */
export async function detectAgents(): Promise<AgentAvailability[]> {
	const ids: AgentType[] = ['claude_code', 'codex', 'open_code'];

	const results = await Promise.all(ids.map(async (id) => {
		const bin = PROBES[id];
		const out: AgentAvailability = { id, bin, installed: false, path: null, version: null, error: null };

		try {
			const which = await Command.create('which', [bin]).execute();
			if (which.code === 0 && which.stdout.trim()) {
				out.installed = true;
				out.path = which.stdout.trim();
			} else {
				out.error = 'not found on PATH';
				return out;
			}
		} catch (e) {
			out.error = String(e);
			return out;
		}

		try {
			const ver = await Command.create(bin, ['--version']).execute();
			if (ver.code === 0) {
				out.version = ver.stdout.trim().split('\n')[0] || ver.stderr.trim().split('\n')[0] || null;
			}
		} catch {
			// version optional — installed flag is the source of truth
		}

		return out;
	}));

	return results;
}
```

**Acceptance:**
- TS compiles, no `any`
- Returns 3 results regardless of failures (never throws to caller)
- `installed: true` iff `which` exits 0 with non-empty stdout
- Tauri `Command` requires shell scope — check `gui/src-tauri/capabilities/default.json`. If `shell:allow-execute` is missing, ADD `shell:allow-which`, `shell:allow-claude`, `shell:allow-codex`, `shell:allow-opencode` and stop to ask senior before continuing (capability changes are sensitive)

**Verify:**
```bash
cd gui && pnpm check
```

**Commit:**
```
feat(gui): add detect-agents util — probe which/--version for each AgentType
```

---

# Task O2: Rename store field + helpers

**Why:** "Wizard" is generic. Renaming to `onboarding` clarifies intent and signals the rebuild.

**Files:**
- `gui/src/lib/stores/ui.ts` — rename field + functions
- `gui/src/routes/+page.svelte` — update 5 call sites (lines 33, 34, 124, 442, 504, 522 — exact line numbers from current code)

**Step 1 — `ui.ts`:**

Find every `wizardOpen` and rename to `onboardingOpen`. Find `openWizard`/`closeWizard` and rename to `openOnboarding`/`closeOnboarding`.

Before:
```ts
wizardOpen: boolean;
// ...
wizardOpen: false
// ...
export function openWizard() {
	ui.update((u) => ({ ...u, wizardOpen: true }));
}
export function closeWizard() {
	ui.update((u) => ({ ...u, wizardOpen: false }));
}
```

After:
```ts
onboardingOpen: boolean;
// ...
onboardingOpen: false
// ...
export function openOnboarding() {
	ui.update((u) => ({ ...u, onboardingOpen: true }));
}
export function closeOnboarding() {
	ui.update((u) => ({ ...u, onboardingOpen: false }));
}
```

**Step 2 — `+page.svelte`:** Update imports + call sites:

```ts
// line 33-34
openOnboarding,
closeOnboarding,
```

Then global find-and-replace `openWizard` → `openOnboarding`, `closeWizard` → `closeOnboarding`, `$ui.wizardOpen` → `$ui.onboardingOpen` within this file.

**Step 3 — `SetupWizard.svelte`:** Update the same 3 references (lines 3, 126, 140) — temporarily, since this file gets deleted in O5.

**Verify:** `pnpm check` — 0 errors.

**Commit:**
```
refactor(gui): rename wizardOpen → onboardingOpen across ui store + call sites
```

---

# Task O3: Build Onboarding.svelte shell

**Why:** Build the chrome before the steps — easier to iterate visually.

**Files:**
- Create `gui/src/lib/components/Onboarding.svelte`

**Layout requirements:**
- **Full-screen** — `fixed inset-0 z-50 bg-background flex` (NOT `bg-black/50` — onboarding owns the viewport during first run)
- **Two-column layout:**
  - LEFT (1/3 width, max 320px): vertical progress rail with 4 numbered steps + labels. Each completed step has a green check. Current step shows yellow ring. Future steps muted.
  - RIGHT (rest): step content, max width 600px, centered with generous padding (`px-12 py-10`)
- **Header bar** above the columns: app logo/wordmark on the left, "Skip onboarding" link on the right (top-right, `text-xs text-muted-foreground hover:text-foreground`)
- **Footer bar** below: error region (only shown when `error != null`), no other content

**Code skeleton (use this exact structure — fill steps in O4):**

```svelte
<script lang="ts">
	import { ui, closeOnboarding } from '$lib/stores/ui';
	import { cn } from '$lib/utils/cn';
	import Check from '@lucide/svelte/icons/check';
	import Sparkles from '@lucide/svelte/icons/sparkles';

	type Step = 'welcome' | 'agents' | 'project' | 'launch';
	const STEPS: { id: Step; label: string; desc: string }[] = [
		{ id: 'welcome', label: 'Welcome',  desc: 'What is Agentry?' },
		{ id: 'agents',  label: 'Agents',   desc: 'Detect installed CLIs' },
		{ id: 'project', label: 'Project',  desc: 'Pick a folder' },
		{ id: 'launch',  label: 'Launch',   desc: 'Start your first session' }
	];

	let step = $state<Step>('welcome');
	let error = $state<string | null>(null);
	let canSkip = $derived(step !== 'launch'); // can't bail mid-launch — would leave half-created records

	const stepIndex = $derived(STEPS.findIndex(s => s.id === step));
	function goto(s: Step) {
		const targetIdx = STEPS.findIndex(x => x.id === s);
		// only allow going BACK to completed steps, not forward-jumping
		if (targetIdx < stepIndex) step = s;
	}

	function skip() {
		localStorage.setItem('agentry:onboarded', '1');
		closeOnboarding();
	}
</script>

{#if $ui.onboardingOpen}
	<div class="fixed inset-0 z-50 bg-background flex flex-col">
		<!-- Header -->
		<header class="flex items-center justify-between px-6 py-4 border-b border-border">
			<div class="flex items-center gap-2">
				<Sparkles size={18} class="text-gruvbox-yellow" />
				<span class="text-sm font-semibold">Agentry</span>
			</div>
			{#if canSkip}
				<button class="text-xs text-muted-foreground hover:text-foreground transition-colors" onclick={skip}>
					Skip onboarding →
				</button>
			{/if}
		</header>

		<!-- Body: two-column -->
		<div class="flex flex-1 overflow-hidden">
			<!-- LEFT: progress rail -->
			<aside class="w-80 border-r border-border px-6 py-10 overflow-y-auto">
				<ol class="space-y-1">
					{#each STEPS as s, i (s.id)}
						{@const completed = i < stepIndex}
						{@const current = i === stepIndex}
						<li>
							<button
								class={cn(
									'w-full flex items-start gap-3 px-3 py-3 rounded text-left transition-colors',
									completed && 'hover:bg-secondary/50 cursor-pointer',
									current && 'bg-secondary/30 ring-1 ring-gruvbox-yellow/50',
									!completed && !current && 'opacity-50 cursor-not-allowed'
								)}
								disabled={!completed}
								onclick={() => goto(s.id)}
							>
								<span class={cn(
									'mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0',
									completed && 'bg-gruvbox-green text-background',
									current   && 'bg-gruvbox-yellow text-background',
									!completed && !current && 'bg-secondary text-muted-foreground'
								)}>
									{#if completed}<Check size={12} />{:else}{i + 1}{/if}
								</span>
								<span class="min-w-0 flex-1">
									<span class="block text-sm font-medium">{s.label}</span>
									<span class="block text-xs text-muted-foreground mt-0.5">{s.desc}</span>
								</span>
							</button>
						</li>
					{/each}
				</ol>
			</aside>

			<!-- RIGHT: step content -->
			<main class="flex-1 overflow-y-auto">
				<div class="max-w-2xl mx-auto px-12 py-10">
					{#if step === 'welcome'}
						<!-- TODO O4.1 -->
					{:else if step === 'agents'}
						<!-- TODO O4.2 -->
					{:else if step === 'project'}
						<!-- TODO O4.3 -->
					{:else if step === 'launch'}
						<!-- TODO O4.4 -->
					{/if}
				</div>
			</main>
		</div>

		<!-- Footer: error region (only if error) -->
		{#if error}
			<footer class="px-6 py-3 border-t border-border bg-destructive/10">
				<p class="text-xs text-destructive-foreground">{error}</p>
			</footer>
		{/if}
	</div>
{/if}
```

**Acceptance:**
- Full-screen, no peek-through
- Progress rail shows 4 steps, current has yellow ring, completed have green checks
- Clicking a *completed* step goes back to it. Clicking a *future* step does nothing (button disabled). Clicking current does nothing.
- "Skip onboarding" hidden during `launch` step (can't bail half-way)
- Body scrolls if content overflows
- Error footer appears only when `error != null`

**Wire it temporarily** in `+page.svelte` (we'll swap SetupWizard in O5, but you need to see it):
```svelte
<!-- line 700, add ABOVE <SetupWizard /> -->
<Onboarding />
```

Open via console: `localStorage.removeItem('agentry:onboarded'); location.reload()` — but first, in `+page.svelte` `bootstrap()` (around line 124), the existing logic `if (projs.length === 0) openOnboarding()` will trigger it.

**Verify:** `pnpm check` clean. `mise run dev` and clear localStorage to see Onboarding open.

**Commit:**
```
feat(gui): scaffold full-screen Onboarding component with progress rail
```

---

# Task O4: Implement the 4 steps

## O4.1 — Welcome step

**Goal:** Explain what Agentry is in 2 sentences. Single CTA forward.

Add inside the `{#if step === 'welcome'}` block:

```svelte
<div class="space-y-6">
	<div class="space-y-3">
		<h1 class="text-2xl font-semibold">Welcome to Agentry</h1>
		<p class="text-sm text-muted-foreground leading-relaxed">
			Agentry runs multiple coding agents (Claude Code, Codex, OpenCode) side by side in your terminal.
			Each agent operates in its own session bound to a project folder.
		</p>
	</div>

	<div class="grid grid-cols-3 gap-3">
		<!-- 3 mini "what you can do" cards. Use lucide icons: Terminal, Layers, RefreshCw -->
		<div class="rounded border border-border p-3">
			<div class="text-xs font-medium mb-1">Run agents</div>
			<div class="text-xs text-muted-foreground">In native terminals, no API juggling</div>
		</div>
		<div class="rounded border border-border p-3">
			<div class="text-xs font-medium mb-1">Switch quickly</div>
			<div class="text-xs text-muted-foreground">Tabs, MRU palette (⌘K), filters</div>
		</div>
		<div class="rounded border border-border p-3">
			<div class="text-xs font-medium mb-1">Resume sessions</div>
			<div class="text-xs text-muted-foreground">Pick up where Claude/Codex left off</div>
		</div>
	</div>

	<div class="pt-2">
		<button
			class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium"
			onclick={() => step = 'agents'}
		>
			Get started →
		</button>
	</div>
</div>
```

**Acceptance:** Reads in <10 seconds. No jargon ("daemon", "wire protocol" — banned here).

---

## O4.2 — Agents step

**Goal:** Detect installed CLIs. Make installed ones primary; installed ones get sub-text with version. Missing ones get an install hint URL.

**Add to script block:**

```ts
import { detectAgents, type AgentAvailability } from '$lib/utils/detect-agents';
import type { AgentType } from '$lib/types';

let detection = $state<AgentAvailability[] | null>(null);
let detecting = $state(false);
let pickedAgent = $state<AgentType | null>(null);

async function runDetection() {
	detecting = true;
	try {
		detection = await detectAgents();
		// Auto-select first installed agent
		const firstInstalled = detection.find(a => a.installed);
		if (firstInstalled) pickedAgent = firstInstalled.id;
	} catch (e) {
		error = String(e);
	} finally {
		detecting = false;
	}
}

// re-run detection every time user enters the agents step
$effect(() => {
	if (step === 'agents' && detection === null) {
		runDetection();
	}
});

const AGENT_LABELS: Record<AgentType, { label: string; install: string }> = {
	claude_code: { label: 'Claude Code', install: 'https://docs.anthropic.com/claude/docs/claude-code' },
	codex:       { label: 'Codex',       install: 'https://github.com/openai/codex' },
	open_code:   { label: 'OpenCode',    install: 'https://opencode.ai' }
};
```

**Add to `{#if step === 'agents'}` block:**

```svelte
<div class="space-y-6">
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold">Pick an agent</h1>
		<p class="text-sm text-muted-foreground">
			We checked your PATH for installed CLIs. You can install more later.
		</p>
	</div>

	{#if detecting || detection === null}
		<div class="text-sm text-muted-foreground py-8 text-center">Detecting agents…</div>
	{:else}
		<div class="space-y-2">
			{#each detection as a (a.id)}
				{@const meta = AGENT_LABELS[a.id]}
				<button
					class={cn(
						'w-full text-left px-4 py-3 rounded border transition-colors',
						pickedAgent === a.id  && 'border-gruvbox-yellow bg-secondary/30',
						pickedAgent !== a.id && a.installed && 'border-border hover:border-secondary',
						!a.installed && 'border-border/50 opacity-60 cursor-not-allowed'
					)}
					disabled={!a.installed}
					onclick={() => a.installed && (pickedAgent = a.id)}
				>
					<div class="flex items-center justify-between">
						<div class="min-w-0">
							<div class="text-sm font-medium flex items-center gap-2">
								{meta.label}
								{#if a.installed}
									<span class="text-[10px] uppercase tracking-wide text-gruvbox-green">installed</span>
								{:else}
									<span class="text-[10px] uppercase tracking-wide text-muted-foreground">not found</span>
								{/if}
							</div>
							{#if a.installed && a.version}
								<div class="text-xs text-muted-foreground mt-0.5 font-mono">{a.version}</div>
							{:else if !a.installed}
								<div class="text-xs text-muted-foreground mt-0.5">
									Install: <a href={meta.install} target="_blank" class="underline hover:text-foreground">{meta.install}</a>
								</div>
							{/if}
						</div>
					</div>
				</button>
			{/each}
		</div>

		<div class="flex items-center justify-between pt-2">
			<button class="text-xs text-muted-foreground hover:text-foreground" onclick={runDetection}>
				↻ Re-detect
			</button>
			<button
				class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm font-medium"
				disabled={!pickedAgent}
				onclick={() => step = 'project'}
			>
				Continue with {pickedAgent ? AGENT_LABELS[pickedAgent].label : '…'} →
			</button>
		</div>
	{/if}
</div>
```

**Acceptance:**
- Spinner shows while detecting
- Installed agents are clickable, others are disabled with install URL shown
- Auto-selects first installed agent
- "Re-detect" button re-runs probe (in case user just installed one)
- "Continue" button label updates to chosen agent name
- All zero-installed case: button stays disabled, user must install something → re-detect

---

## O4.3 — Project step

**Goal:** Folder picker + name. Add a "common locations" quick pick.

**Add to script block:**

```ts
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';

let folder = $state('');
let projectName = $state('');
let homeDirPath = $state<string | null>(null);

$effect(() => {
	if (step === 'project' && homeDirPath === null) {
		homeDir().then(p => homeDirPath = p).catch(() => {});
	}
});

async function pickFolder() {
	try {
		const result = await openDialog({ directory: true, multiple: false, title: 'Pick a project folder' });
		if (typeof result === 'string') {
			folder = result;
			if (!projectName.trim()) {
				projectName = result.split('/').filter(Boolean).pop() ?? 'Project';
			}
		}
	} catch (e) {
		error = String(e);
	}
}

function useCommonFolder(path: string, suggestedName: string) {
	folder = path;
	if (!projectName.trim()) projectName = suggestedName;
}
```

**Add to `{#if step === 'project'}` block:**

```svelte
<div class="space-y-6">
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold">Pick a project folder</h1>
		<p class="text-sm text-muted-foreground">
			A project is a folder the agent works in. You can switch later. Typically a code repo.
		</p>
	</div>

	<button
		class="w-full px-4 py-4 rounded border border-dashed border-border hover:border-gruvbox-yellow hover:bg-secondary/30 transition-colors flex items-center gap-3 text-left"
		onclick={pickFolder}
	>
		<FolderOpen size={18} class="text-muted-foreground shrink-0" />
		<div class="flex-1 min-w-0">
			{#if folder}
				<div class="text-sm font-mono truncate">{folder}</div>
			{:else}
				<div class="text-sm text-muted-foreground">Click to choose a folder…</div>
			{/if}
		</div>
	</button>

	{#if homeDirPath && !folder}
		<div class="space-y-1">
			<div class="text-xs text-muted-foreground">Or quick pick:</div>
			<div class="flex flex-wrap gap-2">
				<button class="text-xs px-2 py-1 rounded border border-border hover:border-gruvbox-yellow font-mono" onclick={() => useCommonFolder(homeDirPath!, 'Home')}>~/</button>
				<button class="text-xs px-2 py-1 rounded border border-border hover:border-gruvbox-yellow font-mono" onclick={() => useCommonFolder(homeDirPath + '/Documents', 'Documents')}>~/Documents</button>
				<button class="text-xs px-2 py-1 rounded border border-border hover:border-gruvbox-yellow font-mono" onclick={() => useCommonFolder(homeDirPath + '/Projects', 'Projects')}>~/Projects</button>
			</div>
		</div>
	{/if}

	<label class="block">
		<span class="block text-xs text-muted-foreground mb-1">Project name</span>
		<input
			type="text"
			bind:value={projectName}
			class="w-full bg-input rounded px-3 py-2 text-sm border border-border focus:border-gruvbox-yellow focus:outline-none"
			placeholder="My App"
		/>
	</label>

	<div class="flex justify-end">
		<button
			class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm font-medium"
			disabled={!folder.trim() || !projectName.trim()}
			onclick={() => step = 'launch'}
		>
			Create project →
		</button>
	</div>
</div>
```

**Acceptance:**
- Native folder picker opens via Tauri dialog
- Selecting folder auto-fills the name to the last path segment
- Quick-pick chips only show before a folder is chosen
- Project name input persists if user goes back to this step
- Create button disabled until both fields non-empty

---

## O4.4 — Launch step

**Goal:** Live checklist of: create project → ensure profile → start session. Each step has spinner → check / cross. If any fails, show retry button + actual error.

**Add to script block:**

```ts
import { createProject, listProjects, listProfiles, startSession, sendCmd } from '$lib/ipc';
import { addProject } from '$lib/stores/projects';
import { profiles } from '$lib/stores/profiles';
import { toasts } from '$lib/stores/toasts.svelte';

type StepStatus = 'pending' | 'running' | 'ok' | 'err';
let launch = $state({
	project: 'pending' as StepStatus,
	profile: 'pending' as StepStatus,
	session: 'pending' as StepStatus
});
let launchError = $state<string | null>(null);

async function ensureProfile(at: AgentType, label: string): Promise<string> {
	const existing = $profiles.find(p => p.agent_type === at);
	if (existing) return existing.id;
	const r = await sendCmd({
		cmd: 'create_profile',
		name: label,
		agent_type: at,
		params: [],
		env: [],
		start_script: null
	}) as { ok: boolean; profile_id?: string; error?: string };
	if (!r.ok || !r.profile_id) throw new Error(r.error || 'create_profile failed');
	return r.profile_id;
}

async function runLaunch() {
	if (!pickedAgent) { error = 'No agent selected'; step = 'agents'; return; }
	launchError = null;
	launch = { project: 'running', profile: 'pending', session: 'pending' };

	try {
		await createProject(projectName.trim(), folder.trim());
		const projs = await listProjects();
		const proj = projs.find(p => p.path === folder.trim()) ?? projs[projs.length - 1];
		if (!proj) throw new Error('project not found after create');
		addProject({ ...proj, sessions: [] });
		launch.project = 'ok';

		launch.profile = 'running';
		const label = AGENT_LABELS[pickedAgent].label;
		const profileId = await ensureProfile(pickedAgent, label);
		profiles.set(await listProfiles());
		launch.profile = 'ok';

		launch.session = 'running';
		ui.update(u => ({ ...u, activeProjectId: proj.id, view: 'terminal' }));
		await startSession(proj.id, profileId);
		launch.session = 'ok';

		localStorage.setItem('agentry:onboarded', '1');
	} catch (e) {
		launchError = String(e);
		if (launch.project === 'running') launch.project = 'err';
		else if (launch.profile === 'running') launch.profile = 'err';
		else if (launch.session === 'running') launch.session = 'err';
	}
}

// Auto-run on enter
$effect(() => {
	if (step === 'launch' && launch.project === 'pending' && !launchError) {
		runLaunch();
	}
});

const allOk = $derived(launch.project === 'ok' && launch.profile === 'ok' && launch.session === 'ok');

function openTerminal() {
	closeOnboarding();
}

function startTour() {
	closeOnboarding();
	setTimeout(() => window.dispatchEvent(new CustomEvent('tour:start')), 400);
}
```

**Add to `{#if step === 'launch'}` block:**

```svelte
<div class="space-y-6">
	<div class="space-y-2">
		<h1 class="text-2xl font-semibold">Setting up your project</h1>
		<p class="text-sm text-muted-foreground">This usually takes a second.</p>
	</div>

	<ul class="space-y-3">
		{#each [
			{ key: 'project', label: 'Creating project' },
			{ key: 'profile', label: 'Saving agent profile' },
			{ key: 'session', label: 'Starting first session' }
		] as item}
			{@const s = launch[item.key as 'project' | 'profile' | 'session']}
			<li class="flex items-center gap-3">
				{#if s === 'pending'}
					<span class="w-5 h-5 rounded-full border border-border"></span>
					<span class="text-sm text-muted-foreground">{item.label}</span>
				{:else if s === 'running'}
					<Loader2 size={16} class="animate-spin text-gruvbox-yellow" />
					<span class="text-sm">{item.label}…</span>
				{:else if s === 'ok'}
					<Check size={16} class="text-gruvbox-green" />
					<span class="text-sm">{item.label}</span>
				{:else}
					<X size={16} class="text-destructive-foreground" />
					<span class="text-sm text-destructive-foreground">{item.label} failed</span>
				{/if}
			</li>
		{/each}
	</ul>

	{#if launchError}
		<div class="rounded border border-destructive/40 bg-destructive/10 p-3 space-y-2">
			<div class="text-xs font-mono text-destructive-foreground break-all">{launchError}</div>
			<button class="text-xs underline hover:text-foreground" onclick={runLaunch}>Retry</button>
		</div>
	{/if}

	{#if allOk}
		<div class="flex gap-2 pt-2">
			<button class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium" onclick={startTour}>
				Take a quick tour
			</button>
			<button class="px-4 py-2 rounded border border-border hover:bg-secondary/30 text-sm" onclick={openTerminal}>
				Just open terminal
			</button>
		</div>
	{/if}
</div>
```

Add imports: `import X from '@lucide/svelte/icons/x';`, `import Loader2 from '@lucide/svelte/icons/loader-2';`, `import FolderOpen from '@lucide/svelte/icons/folder-open';`

**Acceptance:**
- On entering Launch step, all 3 items run sequentially with live state changes
- Failure at any step shows the actual error + Retry button
- Retry resumes from `pending` of failed step (resets `launch` state)
- All-ok → 2 buttons appear: tour or terminal
- Closing via either button sets `agentry:onboarded` flag

---

# Task O5: Wire onboarding in +page.svelte, delete SetupWizard

**Files:**
- `gui/src/routes/+page.svelte`
- Delete `gui/src/lib/components/SetupWizard.svelte`

**Step 1.** In `+page.svelte`:
- Replace import (line 10):
  ```ts
  import Onboarding from '$lib/components/Onboarding.svelte';
  ```
- Replace mount tag (line 700):
  ```svelte
  <Onboarding />
  ```
- Verify `bootstrap()` (line 124) still calls `openOnboarding()` when `projs.length === 0`. Should already work because we renamed in O2.

**Step 2.** Delete the file:
```bash
git rm gui/src/lib/components/SetupWizard.svelte
```

**Step 3.** Search for any remaining references:
```bash
grep -rn "SetupWizard\|wizardOpen\|openWizard\|closeWizard" gui/src
```
Should be zero hits. If any remain, fix them.

**Verify:** `pnpm check` clean. `mise run dev`, clear localStorage, reload — Onboarding opens fullscreen.

**Commit:**
```
feat(gui): replace SetupWizard with full-screen Onboarding flow
```

---

# Task O6: First-launch detection + restart guard

**Why:** Currently `bootstrap()` opens onboarding when `projs.length === 0`. That fires every time someone deletes all projects — not just first launch. Use the `agentry:onboarded` flag as the primary gate.

**File:** `gui/src/routes/+page.svelte`

Around line 124 — find the existing block:

```ts
} else if (!$ui.activeProjectId) {
	ui.update((u) => ({ ...u, activeProjectId: projs[0].id }));
}
// ... and the openWizard call somewhere nearby
```

Replace the openOnboarding trigger with:

```ts
const onboarded = localStorage.getItem('agentry:onboarded') === '1';
if (projs.length === 0 && !onboarded) {
	openOnboarding();
} else if (projs.length === 0) {
	// User onboarded once but deleted all projects — show empty state instead, NOT full onboarding.
	// (Empty state work is out of scope for this plan — for now, do nothing; ActivityBar's "New project" button handles it.)
} else if (!$ui.activeProjectId) {
	ui.update((u) => ({ ...u, activeProjectId: projs[0].id }));
}
```

**Also:** the existing line 442 `if (!projId) { openWizard(); return; }` — this fires when user clicks "+ New session" with no project. Change to open onboarding ONLY if not onboarded, else show a toast asking them to create a project:

```ts
if (!projId) {
	const onboarded = localStorage.getItem('agentry:onboarded') === '1';
	if (!onboarded) openOnboarding();
	else toasts.info('No project selected', 'Use the activity bar to create one.');
	return;
}
```

**Acceptance:**
- First launch: onboarding opens
- After onboarding: `agentry:onboarded=1` saved
- User deletes all projects: onboarding does NOT reopen on reload
- User clicks "+ New session" with no project after onboarding: toast (not modal)
- User in Settings can manually re-open onboarding (out of scope — add a `localStorage.removeItem('agentry:onboarded')` button in dev tools if needed)

**Verify:**
- `pnpm check` clean
- Manual test: 4 scenarios above

**Commit:**
```
fix(gui): gate onboarding behind agentry:onboarded flag; toast on no-project new-session
```

---

# Out of scope (don't touch in this plan)

- Empty-state design when user deletes all projects (separate plan)
- Tooltips on first hover
- Persistent help drawer
- Detect rate-limit / API key issues per agent
- Detection of agent CLI **upgrade available**
- Multi-project bootstrap (onboarding always creates exactly one)
- I18n / Vietnamese strings for onboarding
- Animations beyond the existing CSS transitions (no `fly:` `slide:` here — keep diff small)

If a junior is tempted by any of these — stop, ask senior. They are NOT bugs.

---

# Done criteria (all must hold)

```bash
cd gui && pnpm check
# 0 errors, ≤1 warning

mise run check
# green

mise run dev
# launches without white/gray screen
```

**Manual smoke (do all of these):**

1. **Fresh install path** — delete `~/.agentry/projects/*` and `localStorage.clear()` in webview devtools, reload:
   - [ ] Full-screen onboarding appears (no modal-over-UI peek)
   - [ ] Welcome step renders 3 cards
   - [ ] Agents step auto-detects (spinner → list with ✓ green for installed, dimmed for missing)
   - [ ] At least one installed agent is auto-selected
   - [ ] Re-detect button works
   - [ ] Project step: folder picker opens, quick-pick chips work, project name auto-fills from folder
   - [ ] Launch step: 3 checklist items animate sequentially
   - [ ] All-ok: tour + open terminal buttons shown
   - [ ] Clicking "open terminal" closes onboarding cleanly, first session is visible
2. **Restart path** — quit app, relaunch:
   - [ ] Onboarding does NOT reopen
   - [ ] App opens to last active project + session
3. **Failure path** — uninstall claude CLI, redo fresh install path, pick Claude:
   - [ ] Launch step fails at "Starting first session"
   - [ ] Error footer shows the actual stderr
   - [ ] Retry button is visible
   - [ ] Project + profile rows show green checks (didn't roll back partially)
4. **Skip path** — start fresh install, immediately click "Skip onboarding":
   - [ ] Onboarding closes
   - [ ] `agentry:onboarded=1` saved
   - [ ] App opens to empty state (ActivityBar visible, no project)
   - [ ] Clicking "+ New session" shows the no-project toast, NOT the wizard
5. **Back-nav** — start fresh install, advance to Project step, click "Agents" in progress rail:
   - [ ] Goes back to Agents step
   - [ ] Folder selection from Project step is preserved
   - [ ] Forward arrow / "Continue" returns to Project step with state intact

---

# Time budget (junior)

| Task | Time |
|---|---|
| O1 detect-agents util | 1.5h |
| O2 rename store | 0.5h |
| O3 Onboarding shell | 2h |
| O4.1 welcome | 0.5h |
| O4.2 agents | 2h |
| O4.3 project | 1h |
| O4.4 launch | 2h |
| O5 swap component | 0.5h |
| O6 first-launch guard | 1h |
| Manual smoke + fixes | 2h |
| **Total** | **~13h / 2 days** |

Add 50% buffer for first-time-Svelte-5 junior → 3 days. Hard cap 4 days; if blowing past, escalate.

---

# Review checkpoints

Junior must ping senior for review at:

1. **After O1** — shell capability config (Tauri capabilities are security-sensitive).
2. **After O3** — visual layout review before filling in steps. Saves rework if header/rail design is off.
3. **After O4.4** — full flow review before O5/O6 swap.
4. **After O6** — final review with all 5 smoke scenarios demoed.
