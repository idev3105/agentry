<script lang="ts">
	import { settings } from '$lib/stores/settings';
	import { r9 } from '$lib/stores/r9.svelte';
	import { fmtChord } from '$lib/utils/cn';
	import Play from '@lucide/svelte/icons/play';
	import Square from '@lucide/svelte/icons/square';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	const shortcuts: { keys: string[]; desc: string }[] = [
		{ keys: ['mod', 'k'], desc: 'Open command palette' },
		{ keys: ['mod', 't'], desc: 'New session' },
		{ keys: ['mod', 'p'], desc: 'Switch project' },
		{ keys: ['mod', 'f'], desc: 'Find in terminal' },
		{ keys: ['mod', '1'], desc: 'Focus session 1' },
		{ keys: ['mod', '2'], desc: 'Focus session 2' },
		{ keys: ['mod', '9'], desc: 'Focus last session' },
		{ keys: ['mod', 'shift', 'k'], desc: 'Kill focused session' },
		{ keys: ['Escape'], desc: 'Close dialogs' },
		{ keys: ['/'], desc: 'Focus session filter' }
	];
</script>

<div class="flex flex-col h-full overflow-y-auto">
	<header class="px-6 py-5 border-b border-border">
		<h1 class="text-base font-semibold">Settings</h1>
		<p class="text-xs text-muted-foreground mt-0.5">Daemon limits and keyboard shortcuts.</p>
	</header>

	<div class="p-6 space-y-6 max-w-2xl">
		<section class="bg-card border border-border rounded p-4 space-y-3">
			<h2 class="text-sm font-semibold">Daemon</h2>
			{@render row('Default profile', $settings.defaultProfileId ?? '—')}
			{@render row('Max concurrent sessions', String($settings.maxConcurrentSessions))}
			{@render row('Idle threshold', `${$settings.idleThresholdS}s`)}
			{@render row('Awaiting threshold', `${$settings.awaitingThresholdS}s`)}
			{@render row(
				'Ring buffer',
				`${(($settings.ringBufferBytes / 1024 / 1024) || 0).toFixed(1)} MiB`
			)}
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
	</div>
</div>

{#snippet row(label: string, value: string)}
	<div class="flex items-center justify-between text-sm">
		<span class="text-muted-foreground">{label}</span>
		<span class="font-mono">{value}</span>
	</div>
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
