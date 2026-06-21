<script lang="ts">
	import { sessions } from '$lib/stores/sessions';
	import { remote } from '$lib/stores/remote.svelte';
	import { setView } from '$lib/stores/ui';
	import { cn } from '$lib/utils/cn';
	import RadioTower from '@lucide/svelte/icons/radio-tower';
	import Check from '@lucide/svelte/icons/check';

	const { connected }: { connected: boolean } = $props();

	let sessionList = $derived(Array.from($sessions.values()));

	let counts = $derived.by(() => {
		let working = 0,
			awaiting = 0,
			queued = 0,
			total = 0;
		for (const s of sessionList) {
			if (s.status === 'finished' || s.status === 'failed') continue;
			total++;
			if (s.status === 'queued') queued++;
			else if (s.status === 'running') {
				if (s.activity === 'working') working++;
				else if (s.activity === 'awaiting_input') awaiting++;
			}
		}
		return { working, awaiting, queued, total };
	});
</script>

<footer
	class="flex items-center gap-3 flex-shrink-0 border-t border-border bg-card text-xs text-muted-foreground select-none"
	style="height:var(--status-h);padding-inline:var(--pad-x)"
>
	<!-- Session counts -->
	<div class="flex items-center gap-2">
		{#if counts.total === 0}
			<span>No session</span>
		{:else if counts.working === 0 && counts.awaiting === 0 && counts.queued === 0}
			<span class="inline-flex items-center gap-1">
				<Check size={11} class="text-accent-ok" /> All idle
			</span>
		{:else}
			{#if counts.working > 0}
				<span class="flex items-center gap-1 text-accent-ok">
					<span class="w-1.5 h-1.5 rounded-full bg-accent-ok"></span>
					{counts.working} working
				</span>
			{/if}
			{#if counts.awaiting > 0}
				<span class="flex items-center gap-1 text-accent-error">
					<span class="w-1.5 h-1.5 rounded-full bg-accent-error"></span>
					{counts.awaiting} awaiting
				</span>
			{/if}
			{#if counts.queued > 0}
				<span class="flex items-center gap-1 text-accent-info">
					<span class="w-1.5 h-1.5 rounded-full bg-accent-info"></span>
					{counts.queued} queued
				</span>
			{/if}
		{/if}
	</div>

	<div class="flex-1"></div>

	<!-- Remote -->
	<button
		type="button"
		title={remote.status.listening ? `Remote on · ${remote.status.address}` : 'Remote off — click to configure'}
		class={cn(
			'flex items-center gap-1 transition-colors hover:text-foreground',
			remote.status.listening ? 'text-emerald-500' : ''
		)}
		onclick={() => setView('settings')}
	>
		<RadioTower size={11} />
		<span>{remote.status.listening ? 'Remote on' : 'Remote off'}</span>
	</button>

	<!-- Connection -->
	<span class={cn('flex items-center gap-1', connected ? 'text-accent-ok' : 'text-accent-error')}>
		<span class={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-accent-ok' : 'bg-accent-error')}></span>
		{connected ? 'online' : 'offline'}
	</span>
</footer>
