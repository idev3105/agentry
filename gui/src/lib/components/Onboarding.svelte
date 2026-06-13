<script lang="ts">
	import { ui, closeOnboarding } from '$lib/stores/ui';
	import { cn } from '$lib/utils/cn';
	import { detectAgents, type AgentAvailability } from '$lib/utils/detect-agents';
	import type { AgentType } from '$lib/types';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { homeDir } from '@tauri-apps/api/path';
	import { createProject, listProjects, listProfiles, startSession, sendCmd } from '$lib/ipc';
	import { addProject } from '$lib/stores/projects';
	import { profiles } from '$lib/stores/profiles';
	import { toasts } from '$lib/stores/toasts.svelte';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import FolderOpen from '@lucide/svelte/icons/folder-open';

	type Step = 'welcome' | 'agents' | 'project' | 'launch';
	const STEPS: { id: Step; label: string; desc: string }[] = [
		{ id: 'welcome', label: 'Welcome',  desc: 'What is Agentry?' },
		{ id: 'agents',  label: 'Agents',   desc: 'Detect installed CLIs' },
		{ id: 'project', label: 'Project',  desc: 'Pick a folder' },
		{ id: 'launch',  label: 'Launch',   desc: 'Start your first session' }
	];

	let step = $state<Step>('welcome');
	let error = $state<string | null>(null);
	let canSkip = $derived(step !== 'launch');

	const stepIndex = $derived(STEPS.findIndex(s => s.id === step));
	function goto(s: Step) {
		const targetIdx = STEPS.findIndex(x => x.id === s);
		if (targetIdx < stepIndex) step = s;
	}

	function skip() {
		localStorage.setItem('agentry:onboarded', '1');
		closeOnboarding();
	}

	// ── O4.2 Agent detection ──
	let detection = $state<AgentAvailability[] | null>(null);
	let detecting = $state(false);
	let pickedAgent = $state<AgentType | null>(null);

	async function runDetection() {
		detecting = true;
		try {
			detection = await detectAgents();
			const firstInstalled = detection.find(a => a.installed);
			if (firstInstalled) pickedAgent = firstInstalled.id;
		} catch (e) {
			error = String(e);
		} finally {
			detecting = false;
		}
	}

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

	// ── O4.3 Project ──
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

	// ── O4.4 Launch ──
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
</script>

{#if $ui.onboardingOpen}
	<div class="fixed inset-0 z-50 bg-background flex flex-col">
		<!-- Header -->
		<header class="flex items-center justify-between px-6 py-4 border-b border-border">
			<div class="flex items-center gap-2">
				<Sparkles size={18} class="text-accent" />
				<span class="text-sm font-semibold">Agentry</span>
			</div>
			{#if canSkip}
				<button class="text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none" onclick={skip}>
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
									'w-full flex items-start gap-3 px-3 py-3 rounded text-left transition-colors focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none',
									completed && 'hover:bg-secondary/50 cursor-pointer',
									current && 'bg-secondary/30 ring-1 ring-accent/50',
									!completed && !current && 'opacity-50 cursor-not-allowed'
								)}
								disabled={!completed}
								onclick={() => goto(s.id)}
							>
								<span class={cn(
									'mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0',
									completed && 'bg-gruvbox-green text-background',
									current   && 'bg-accent text-background',
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
						<div class="space-y-6">
							<div class="space-y-3">
								<h1 class="text-2xl font-semibold">Welcome to Agentry</h1>
								<p class="text-sm text-muted-foreground leading-relaxed">
									Agentry runs multiple coding agents (Claude Code, Codex, OpenCode) side by side in your terminal.
									Each agent operates in its own session bound to a project folder.
								</p>
							</div>

							<div class="grid grid-cols-3 gap-3">
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
									class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
									onclick={() => step = 'agents'}
								>
									Get started →
								</button>
							</div>
						</div>

					{:else if step === 'agents'}
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
												'w-full text-left px-4 py-3 rounded border transition-colors focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none',
												pickedAgent === a.id  && 'border-accent bg-secondary/30',
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
									<button class="text-xs text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none" onclick={runDetection}>
										↻ Re-detect
									</button>
									<button
										class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm font-medium focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
										disabled={!pickedAgent}
										onclick={() => step = 'project'}
									>
										Continue with {pickedAgent ? AGENT_LABELS[pickedAgent].label : '…'} →
									</button>
								</div>
							{/if}
						</div>

					{:else if step === 'project'}
						<div class="space-y-6">
							<div class="space-y-2">
								<h1 class="text-2xl font-semibold">Pick a project folder</h1>
								<p class="text-sm text-muted-foreground">
									A project is a folder the agent works in. You can switch later. Typically a code repo.
								</p>
							</div>

							<button
								class="w-full px-4 py-4 rounded border border-dashed border-border hover:border-accent hover:bg-secondary/30 transition-colors flex items-center gap-3 text-left focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
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
										<button class="text-xs px-2 py-1 rounded border border-border hover:border-accent font-mono focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none" onclick={() => useCommonFolder(homeDirPath!, 'Home')}>~/</button>
										<button class="text-xs px-2 py-1 rounded border border-border hover:border-accent font-mono focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none" onclick={() => useCommonFolder(homeDirPath + '/Documents', 'Documents')}>~/Documents</button>
										<button class="text-xs px-2 py-1 rounded border border-border hover:border-accent font-mono focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none" onclick={() => useCommonFolder(homeDirPath + '/Projects', 'Projects')}>~/Projects</button>
									</div>
								</div>
							{/if}

							<label class="block">
								<span class="block text-xs text-muted-foreground mb-1">Project name</span>
								<input
									type="text"
									bind:value={projectName}
									class="w-full bg-input rounded px-3 py-2 text-sm border border-border focus:border-accent focus:outline-none"
									placeholder="My App"
								/>
							</label>

							<div class="flex justify-end">
								<button
									class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm font-medium focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
									disabled={!folder.trim() || !projectName.trim()}
									onclick={() => step = 'launch'}
								>
									Create project →
								</button>
							</div>
						</div>

					{:else if step === 'launch'}
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
											<Loader2 size={16} class="animate-spin text-accent" />
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
									<button class="text-xs underline hover:text-foreground focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none" onclick={runLaunch}>Retry</button>
								</div>
							{/if}

							{#if allOk}
								<div class="flex gap-2 pt-2">
									<button class="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none" onclick={startTour}>
										Take a quick tour
									</button>
									<button class="px-4 py-2 rounded border border-border hover:bg-secondary/30 text-sm focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none" onclick={openTerminal}>
										Just open terminal
									</button>
								</div>
							{/if}
						</div>
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
