<script lang="ts">
	import { settings, density } from '$lib/stores/settings';
	import { profiles } from '$lib/stores/profiles';
	import { sendCmd, checkIntegrations, installIntegration } from '$lib/ipc';
	import { r9 } from '$lib/stores/r9.svelte';
	import { theme, accent, type Theme, type Accent } from '$lib/stores/theme.svelte';
	import { zoom, fontFamily, type FontFamily } from '$lib/stores/font.svelte';
	import { remote } from '$lib/stores/remote.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { onMount } from 'svelte';
	import type { IntegrationStatus } from '$lib/types';
	import Wifi from '@lucide/svelte/icons/wifi';
	import Copy from '@lucide/svelte/icons/copy';
	import { cn, fmtChord } from '$lib/utils/cn';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';
	import Play from '@lucide/svelte/icons/play';
	import Square from '@lucide/svelte/icons/square';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Download from '@lucide/svelte/icons/download';
	import Check from '@lucide/svelte/icons/check';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	const shortcuts: { keys: string[]; desc: string }[] = [
		{ keys: ['mod', 'k'], desc: 'Open command palette' },
		{ keys: ['mod', 't'], desc: 'New session' },
		{ keys: ['mod', 'p'], desc: 'Switch project' },
		{ keys: ['mod', 'f'], desc: 'Find in terminal' },
		{ keys: ['mod', '='], desc: 'Zoom in' },
		{ keys: ['mod', '-'], desc: 'Zoom out' },
		{ keys: ['mod', '0'], desc: 'Reset zoom' },
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
					<Select.Root
						type="single"
						value={$settings.defaultProfileId ?? ''}
						onValueChange={(v) => { if (v) setDefaultProfile(v); }}
					>
						<Select.Trigger class="max-w-[200px] h-7 text-xs">
							{$profiles.find((p) => p.id === $settings.defaultProfileId)?.name ?? '— none —'}
						</Select.Trigger>
						<Select.Content>
							{#each $profiles as p (p.id)}
								<Select.Item value={p.id}>{p.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
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
						<Button
							variant={theme.value === t ? 'default' : 'outline'}
							size="xs"
							class="capitalize"
							onclick={() => theme.set(t)}>{t}</Button>
					{/each}
				</div>
			</section>

			<section class="bg-card border border-border rounded p-4 space-y-3">
				<h2 class="text-sm font-semibold">Accent</h2>
				<div class="flex gap-2 flex-wrap">
					{#each (['default', 'teal', 'violet', 'amber'] as Accent[]) as a (a)}
						<Button
							variant={accent.value === a ? 'default' : 'outline'}
							size="xs"
							class="capitalize"
							onclick={() => accent.set(a)}
						>
							<span
								class="w-3 h-3 rounded-full border border-border"
								style={`background:${a === 'teal' ? '#2f9e6e' : a === 'violet' ? '#8b5cf6' : a === 'amber' ? '#d97706' : 'var(--color-accent)'}`}
							></span>
							{a}
						</Button>
					{/each}
				</div>
			</section>

			<section class="bg-card border border-border rounded p-4 space-y-3">
				<h2 class="text-sm font-semibold">Density</h2>
				<div class="flex gap-2">
					{#each (['comfortable', 'compact'] as const) as d}
						<Button
							variant={$density === d ? 'default' : 'outline'}
							size="xs"
							class="capitalize"
							onclick={() => density.set(d)}>{d}</Button>
					{/each}
				</div>
			</section>

			<section class="bg-card border border-border rounded p-4 space-y-3">
				<h2 class="text-sm font-semibold">Font family</h2>
				<div class="flex gap-2 flex-wrap">
					{#each (['system', 'inter', 'geist', 'mono'] as FontFamily[]) as f (f)}
						<Button
							variant={fontFamily.value === f ? 'default' : 'outline'}
							size="xs"
							class="capitalize"
							onclick={() => fontFamily.set(f)}>{f}</Button>
					{/each}
				</div>
				<p class="text-[11px] text-muted-foreground">
					Uses fonts already installed on your system; an unavailable choice falls back to the system default.
				</p>
			</section>

			<section class="bg-card border border-border rounded p-4 space-y-3">
				<h2 class="text-sm font-semibold">Zoom</h2>
				<div class="flex items-center gap-2">
					<Button
						variant="outline"
						size="icon-sm"
						disabled={!zoom.canZoomOut}
						onclick={() => zoom.zoomOut()}
						title="Zoom out ({fmtChord(['mod', '-'])})"
						aria-label="Zoom out"
					>
						<Minus class="size-4" />
					</Button>
					<span class="min-w-[3.5rem] text-center text-sm tabular-nums font-medium">{zoom.percent}%</span>
					<Button
						variant="outline"
						size="icon-sm"
						disabled={!zoom.canZoomIn}
						onclick={() => zoom.zoomIn()}
						title="Zoom in ({fmtChord(['mod', '='])})"
						aria-label="Zoom in"
					>
						<Plus class="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled={zoom.isDefault}
						onclick={() => zoom.reset()}
						title="Reset zoom ({fmtChord(['mod', '0'])})"
						class="ml-1"
					>
						<RotateCcw class="size-3.5" />
						Reset
					</Button>
				</div>
				<p class="text-[11px] text-muted-foreground">
					Scales the whole interface. Use {fmtChord(['mod', '='])} / {fmtChord(['mod', '-'])} to zoom
					in/out and {fmtChord(['mod', '0'])} to reset — works anywhere in the app.
				</p>
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
					<Button
						variant="outline"
						size="xs"
						disabled={integrationsLoading}
						onclick={loadIntegrations}
						title="Re-check"
					>
						<RefreshCw class={cn('size-3', integrationsLoading && 'animate-spin')} />
						Check
					</Button>
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
											<Badge variant="secondary" class="text-muted-foreground">
												CLI not found
											</Badge>
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
										<Button
											variant="outline"
											size="xs"
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
										</Button>
										{:else}
										<Button
											variant="outline"
											size="xs"
											class="border-accent bg-accent/10 hover:bg-accent/20"
											disabled={installingAgent === it.agent}
											onclick={() => install(it.agent)}
										>
											{#if installingAgent === it.agent}
												<Loader2 class="size-3 animate-spin" />
											{:else}
												<Download class="size-3" />
											{/if}
											{it.needs_update ? 'Update' : 'Install'}
										</Button>
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
							<Button
								variant="outline"
								size="sm"
								disabled={r9.busy}
								onclick={() => r9.stop()}
							>
								{#if r9.busy}
									<Loader2 class="size-3 animate-spin" />
								{:else}
									<Square class="size-3" />
								{/if}
								Stop
							</Button>
							<Button
								variant="outline"
								size="sm"
								onclick={() => r9.openDashboard()}
							>
								<ExternalLink class="size-3" />
								Open dashboard
							</Button>
						{:else}
							<Button
								variant="outline"
								size="sm"
								disabled={r9.busy}
								onclick={() => r9.start()}
							>
								{#if r9.busy}
									<Loader2 class="size-3 animate-spin" />
								{:else}
									<Play class="size-3" />
								{/if}
								Start
							</Button>
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
						<Badge class="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">on</Badge>
					{:else}
						<Badge variant="secondary" class="text-muted-foreground">off</Badge>
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
						<Button variant="ghost" size="icon-xs" title="Copy address" aria-label="Copy address" onclick={copyAddr}>
							<Copy class="size-3.5" />
						</Button>
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
		<Badge class="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
			installed{#if it.installed_version} v{it.installed_version}{/if}
		</Badge>
	{:else if it.needs_update}
		<Badge class="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30">
			update available
		</Badge>
	{:else}
		<Badge variant="secondary" class="text-muted-foreground">
			not installed
		</Badge>
	{/if}
{/snippet}

{#snippet r9Badge()}
	{#if r9.status.running}
		<Badge class="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
			running
		</Badge>
	{:else if r9.status.resolved === 'missing'}
		<Badge variant="secondary" class="text-muted-foreground">
			not installed
		</Badge>
	{:else}
		<Badge variant="secondary" class="text-muted-foreground">
			stopped
		</Badge>
	{/if}
{/snippet}
