<script lang="ts">
	import { settings } from '$lib/stores/settings';
	import { fmtChord } from '$lib/utils/cn';

	const shortcuts: { keys: string[]; desc: string }[] = [
		{ keys: ['mod', 'k'], desc: 'Open command palette' },
		{ keys: ['mod', 't'], desc: 'New session' },
		{ keys: ['mod', 'p'], desc: 'Switch project' },
		{ keys: ['mod', '1'], desc: 'Focus session 1' },
		{ keys: ['mod', '2'], desc: 'Focus session 2' },
		{ keys: ['mod', '9'], desc: 'Focus last session' },
		{ keys: ['mod', 'shift', 'k'], desc: 'Kill focused session' },
		{ keys: ['Escape'], desc: 'Close dialogs' }
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
