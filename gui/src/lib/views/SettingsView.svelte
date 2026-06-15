<script lang="ts">
	import { settings, density } from '$lib/stores/settings';
	import { profiles } from '$lib/stores/profiles';
	import { sendCmd, checkIntegrations, installIntegration } from '$lib/ipc';
	import { r9 } from '$lib/stores/r9.svelte';
	import { theme, accent, type Theme, type Accent } from '$lib/stores/theme.svelte';
	import { remote } from '$lib/stores/remote.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { onMount } from 'svelte';
	import type { IntegrationStatus } from '$lib/types';
	import Wifi from '@lucide/svelte/icons/wifi';
	import Copy from '@lucide/svelte/icons/copy';
	import { cn, fmtChord } from '$lib/utils/cn';
	import Play from '@lucide/svelte/icons/play';
	import Square from '@lucide/svelte/icons/square';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Download from '@lucide/svelte/icons/download';
	import Check from '@lucide/svelte/icons/check';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	const shortcuts: { keys: string[]; desc: string }[] = [
		{ keys: ['mod', 'k'], desc: 'Open command palette' },
		{ keys: ['mod', 't'], desc: 'New session' },
		{ keys: ['mod', 'p'], desc: 'Switch project' },
		{ keys: ['mod', 'f'], desc: 'Find in terminal' },
		{ keys: ['mod', '='], desc: 'Increase terminal font size' },
		{ keys: ['mod', '-'], desc: 'Decrease terminal font size' },
		{ keys: ['mod', '0'], desc: 'Reset terminal font size' },
		{ keys: ['mod', '1'], desc: 'Focus session 1' },
		{ keys: ['mod', '2'], desc: 'Focus session 2' },
		{ keys: ['mod', '9'], desc: 'Focus last session' },
		{ keys: ['mod', 'shift', 'k'], desc: 'Kill focused session' },
		{ keys: ['Escape'], desc: 'Close dialogs' },
		{ keys: ['/'], desc: 'Focus session filter' }
	];

	type SettingsTab = 'general' | 'appearance' | 'integrations' | 'shortcuts';
	const TAB_KEY = 'agentry:settings-tab';
	let tab = $state<SettingsTab>(
		(localStorage.getItem(TAB_KEY) as SettingsTab) || 'general'
	);
	function setTab(t: SettingsTab) {
		tab = t;
		localStorage.setItem(TAB_KEY, t);
	}
	let confirmEnable = $state(false);

	// ── Agent integrations ───────────────────────────────────────────────────
	let integrations = $state<IntegrationStatus[]>([]);
	let integrationsLoading = $state(false);
	let installingAgent = $state<string | null>(null);

	async function loadIntegrations() {
		integrationsLoading = true;
		try {
			integrations = await checkIntegrations();
		} catch (e) {
			toasts.error(`Failed to check integrations: ${e}`);
		} finally {
			integrationsLoading = false;
		}
	}

	async function install(agent: string) {
		installingAgent = agent;
		try {
			const updated = await installIntegration(agent);
			integrations = integrations.map((i) => (i.agent === agent ? updated : i));
			toasts.success(`${agent} integration installed`);
		} catch (e) {
			toasts.error(`Install failed: ${e}`);
		} finally {
			installingAgent = null;
		}
	}

	onMount(() => {
		remote.startPolling();
		if (tab === 'integrations') loadIntegrations();
		return () => remote.stopPolling();
	});

	$effect(() => {
		if (tab === 'integrations' && integrations.length === 0 && !integrationsLoading) {
			loadIntegrations();
		}
	});

	function copyAddr() {
		if (!remote.status.address) return;
		navigator.clipboard.writeText(`http://${remote.status.address}`);
		toasts.success('Address copied');
	}

	async function setDefaultProfile(id: string) {
		await sendCmd({ cmd: 'set_default_profile', profile_id: id });
		settings.update((s) => ({ ...s, defaultProfileId: id }));
	}

	const tabs: { id: SettingsTab; label: string }[] = [
		{ id: 'general', label: 'General' },
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'integrations', label: 'Integrations' },
		{ id: 'shortcuts', label: 'Shortcuts' }
	];
</script>

<div class="flex flex-col h-full overflow-y-auto">
	<header class="px-6 pt-5 border-b border-border">
		<h1 class="text-base font-semibold">Settings</h1>
		<div class="flex gap-1 mt-3 -mb-px" role="tablist">
			{#each tabs as t (t.id)}
				<button
					role="tab"
					aria-selected={tab === t.id}
					class={cn(
						'px-3 py-2 text-xs rounded-t border-b-2 transition-colors',
						tab === t.id
							? 'border-accent text-foreground font-medium'
							: 'border-transparent text-muted-foreground hover:text-foreground'
					)}
					onclick={() => setTab(t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>
	</header>

	<div class="p-6 space-y-6 max-w-2xl">
		{#if tab === 'general'}
			<section class="bg-card border border-border rounded p-4 space-y-3">
				<h2 class="text-sm font-semibold">Daemon</h2>
				<div class="flex items-center justify-between gap-4">
					<span class="text-xs text-muted-foreground shrink-0">Default profile</span>
					<select
						class="bg-input rounded px-2 py-1 text-xs border border-border focus:border-accent focus:outline-none max-w-[200px]"
						value={$settings.defaultProfileId ?? ''}
						onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) setDefaultProfile(v); }}
					>
						<option value="">— none —</option>
						{#each $profiles as p (p.id)}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
				</div>
				{@render row('Max concurrent sessions', String($settings.maxConcurrentSessions))}
				{@render row('Idle threshold', `${$settings.idleThresholdS}s`)}
				{@render row('Awaiting threshold', `${$settings.awaitingThresholdS}s`)}
				{@render row(
					'Ring buffer',
					`${(($settings.ringBufferBytes / 1024 / 1024) || 0).toFixed(1)} MiB`
				)}
			</section>
		{:else if tab === 'appearance'}
			<section class="bg-card border border-border rounded p-4 space-y-3">
				<h2 class="text-sm font-semibold">Theme</h2>
				<div class="flex gap-2 flex-wrap">
					{#each (['dark', 'light'] as Theme[]) as t (t)}
						<button class={cn('px-3 py-1.5 rounded text-xs border focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none', theme.value === t ? 'border-accent bg-secondary' : 'border-border hover:border-secondary')}
								onclick={() => theme.set(t)}>{t}</button>
					{/each}
				</div>
			</section>

			<section class="bg-card border border-border rounded p-4 space-y-3">
				<h2 class="text-sm font-semibold">Accent</h2>
				<div class="flex gap-2 flex-wrap">
					{#each (['default', 'teal', 'violet', 'amber'] as Accent[]) as a (a)}
						<button
							class={cn('flex items-center gap-2 px-3 py-1.5 rounded text-xs border focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none', accent.value === a ? 'border-accent bg-secondary' : 'border-border hover:border-secondary')}
							onclick={() => accent.set(a)}
						>
							<span
								class="w-3 h-3 rounded-full border border-border"
								style={`background:${a === 'teal' ? '#2f9e6e' : a === 'violet' ? '#8b5cf6' : a === 'amber' ? '#d97706' : 'var(--color-accent)'}`}
							></span>
							{a}
						</button>
					{/each}
				</div>
			</section>

			<section class="bg-card border border-border rounded p-4 space-y-3">
				<h2 class="text-sm font-semibold">Density</h2>
				<div class="flex gap-2">
					{#each (['comfortable', 'compact'] as const) as d}
						<button class={cn('px-3 py-1.5 rounded text-xs border focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none', $density === d ? 'border-accent bg-secondary' : 'border-border hover:border-secondary')}
								onclick={() => density.set(d)}>{d}</button>
					{/each}
				</div>
			</section>
		{:else if tab === 'integrations'}
			<section class="bg-card border border-border rounded p-4 space-y-3">
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-sm font-semibold">Agent State Hooks</h2>
						<p class="text-xs text-muted-foreground mt-0.5">
							Install hooks so agents report their session id and live state
							(working / idle / blocked) directly — more reliable than screen scraping.
						</p>
					</div>
					<button
						class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border hover:bg-accent disabled:opacity-50"
						disabled={integrationsLoading}
						onclick={loadIntegrations}
						title="Re-check"
					>
						<RefreshCw class={cn('size-3', integrationsLoading && 'animate-spin')} />
						Check
					</button>
				</div>

				{#if integrationsLoading && integrations.length === 0}
					<p class="text-xs text-muted-foreground">Checking…</p>
				{:else}
					<div class="space-y-2">
						{#each integrations as it (it.agent)}
							<div class="flex items-start justify-between gap-3 border border-border rounded px-3 py-2">
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="text-sm font-medium capitalize">{it.agent}</span>
										{@render integrationBadge(it)}
										{#if !it.agent_detected}
											<span class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
												CLI not found
											</span>
										{/if}
									</div>
									<p class="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
										{it.install_path}
									</p>
									{#if it.manual_step && (it.installed || installingAgent === it.agent)}
										<p class="text-[11px] text-yellow-600 dark:text-yellow-400 mt-1">
											⚠ {it.manual_step}
										</p>
									{/if}
								</div>
								<div class="shrink-0">
									{#if it.installed && !it.needs_update}
										<button
											class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border hover:bg-accent disabled:opacity-50"
											disabled={installingAgent === it.agent}
											onclick={() => install(it.agent)}
											title="Reinstall / overwrite"
										>
											{#if installingAgent === it.agent}
												<Loader2 class="size-3 animate-spin" />
											{:else}
												<Check class="size-3 text-emerald-500" />
											{/if}
											Reinstall
										</button>
									{:else}
										<button
											class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-accent bg-accent/10 hover:bg-accent/20 disabled:opacity-50"
											disabled={installingAgent === it.agent}
											onclick={() => install(it.agent)}
										>
											{#if installingAgent === it.agent}
												<Loader2 class="size-3 animate-spin" />
											{:else}
												<Download class="size-3" />
											{/if}
											{it.needs_update ? 'Update' : 'Install'}
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<section class="bg-card border border-border rounded p-4 space-y-3">
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-sm font-semibold">9Router</h2>
						<p class="text-xs text-muted-foreground mt-0.5">
							FREE AI router. Connect agents to free Claude / GPT / Gemini.
						</p>
					</div>
					{@render r9Badge()}
				</div>

				{#if r9.status.resolved === 'missing'}
					<div class="text-xs bg-yellow-500/10 border border-yellow-500/30 rounded px-3 py-2">
						9Router not installed. Run
						<code class="px-1 rounded bg-muted">npm i -g 9router</code>
						then restart Agentry.
					</div>
				{:else}
					<div class="flex items-center gap-2">
						{#if r9.status.running}
							<button
								class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-accent disabled:opacity-50"
								disabled={r9.busy}
								onclick={() => r9.stop()}
							>
								{#if r9.busy}
									<Loader2 class="size-3 animate-spin" />
								{:else}
									<Square class="size-3" />
								{/if}
								Stop
							</button>
							<button
								class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-accent"
								onclick={() => r9.openDashboard()}
							>
								<ExternalLink class="size-3" />
								Open dashboard
							</button>
						{:else}
							<button
								class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-accent disabled:opacity-50"
								disabled={r9.busy}
								onclick={() => r9.start()}
							>
								{#if r9.busy}
									<Loader2 class="size-3 animate-spin" />
								{:else}
									<Play class="size-3" />
								{/if}
								Start
							</button>
						{/if}
						<span class="text-xs text-muted-foreground ml-auto">
							via {r9.status.resolved}
							{#if r9.status.pid}· pid {r9.status.pid}{/if}
							· :{r9.status.port}
						</span>
					</div>
				{/if}

				{#if r9.lastError}
					<div class="text-xs bg-destructive/10 border border-destructive/30 rounded px-3 py-2 font-mono">
						{r9.lastError}
					</div>
				{/if}
			</section>

			<section class="bg-card border border-border rounded p-4 space-y-3">
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-sm font-semibold">Remote Access</h2>
						<p class="text-xs text-muted-foreground mt-0.5">
							Control agents from your phone over Tailscale. Devices on your tailnet are trusted — no pairing needed.
						</p>
					</div>
					{#if remote.status.listening}
						<span class="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">on</span>
					{:else}
						<span class="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">off</span>
					{/if}
				</div>

				{#if remote.status.error}
					<div class="text-xs bg-yellow-500/10 border border-yellow-500/30 rounded px-3 py-2">
						{remote.status.error === 'tailscale interface not found'
							? 'Tailscale is not running on this machine. Install/start Tailscale, then restart Agentry.'
							: remote.status.error}
					</div>
				{/if}

				{#if remote.status.listening && remote.status.address}
					<div class="flex items-center gap-2">
						<code class="text-xs px-2 py-1 rounded bg-muted font-mono">http://{remote.status.address}</code>
						<button class="p-1 rounded hover:bg-secondary" title="Copy address" onclick={copyAddr}>
							<Copy class="size-3.5" />
						</button>
					</div>
					<p class="text-xs text-muted-foreground">
						Open this address in a browser on any device in your tailnet.
					</p>
				{:else if !remote.status.error}
					<p class="text-xs text-muted-foreground">
						Start Tailscale on this machine — Agentry will auto-detect and start listening.
					</p>
				{/if}

				{#if remote.lastError}
					<div class="text-xs bg-destructive/10 border border-destructive/30 rounded px-3 py-2 font-mono">
						{remote.lastError}
					</div>
				{/if}
			</section>
		{:else if tab === 'shortcuts'}
			<section class="bg-card border border-border rounded p-4 space-y-3">
				<h2 class="text-sm font-semibold">Keyboard shortcuts</h2>
				<div class="space-y-1">
					{#each shortcuts as sc (sc.desc)}
						<div class="flex items-center justify-between text-sm py-1">
							<span class="text-muted-foreground">{sc.desc}</span>
							<kbd class="px-1.5 py-0.5 rounded bg-background border border-border text-foreground text-xs font-mono">
								{fmtChord(sc.keys)}
							</kbd>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	</div>
</div>

{#snippet row(label: string, value: string)}
	<div class="flex items-center justify-between text-sm">
		<span class="text-muted-foreground">{label}</span>
		<span class="font-mono">{value}</span>
	</div>
{/snippet}

{#snippet integrationBadge(it: IntegrationStatus)}
	{#if it.installed && !it.needs_update}
		<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
			installed{#if it.installed_version} v{it.installed_version}{/if}
		</span>
	{:else if it.needs_update}
		<span class="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30">
			update available
		</span>
	{:else}
		<span class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
			not installed
		</span>
	{/if}
{/snippet}

{#snippet r9Badge()}
	{#if r9.status.running}
		<span class="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
			running
		</span>
	{:else if r9.status.resolved === 'missing'}
		<span class="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
			not installed
		</span>
	{:else}
		<span class="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
			stopped
		</span>
	{/if}
{/snippet}
