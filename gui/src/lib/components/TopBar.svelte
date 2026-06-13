<script lang="ts">
	import { projects } from '$lib/stores/projects';
	import { sessions } from '$lib/stores/sessions';
	import { ui, openPalette } from '$lib/stores/ui';
	import { setView } from '$lib/stores/ui';
	import { remote } from '$lib/stores/remote.svelte';
	import { cn, fmtChord } from '$lib/utils/cn';
import Search from '@lucide/svelte/icons/search';
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import Check from '@lucide/svelte/icons/check';
import RadioTower from '@lucide/svelte/icons/radio-tower';

	const { connected }: { connected: boolean } = $props();

	let projectList = $derived(Array.from($projects.values()));
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

	let projectMenuOpen = $state(false);
	let activeProject = $derived(
		$ui.activeProjectId ? $projects.get($ui.activeProjectId) : undefined
	);

	function liveCount(projectId: string): number {
		let n = 0;
		for (const s of sessionList) {
			if (s.projectId !== projectId) continue;
			if (s.status === 'finished' || s.status === 'failed') continue;
			n++;
		}
		return n;
	}
</script>

<div class="flex items-center gap-3 px-3 py-1.5 border-b border-border flex-shrink-0 bg-background">
	<!-- Project switcher -->
	<div class="relative">
		<button
			class="flex items-center gap-1.5 px-2 py-1 text-sm rounded hover:bg-secondary/60 transition-colors"
			onclick={() => (projectMenuOpen = !projectMenuOpen)}
		>
			<span class="font-medium">{activeProject?.name ?? 'No project'}</span>
			<ChevronDown size={14} class="text-muted-foreground" />
		</button>

		{#if projectMenuOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fixed inset-0 z-30"
				onclick={() => (projectMenuOpen = false)}
			></div>
			<div
				class="absolute top-full left-0 mt-1 min-w-52 bg-card border border-border rounded shadow-lg z-40 py-1"
			>
				{#each projectList as p (p.id)}
					<button
						class={cn(
							'w-full text-left px-3 py-1.5 text-sm hover:bg-secondary flex items-center gap-2',
							$ui.activeProjectId === p.id && 'text-gruvbox-yellow'
						)}
						onclick={() => {
							ui.update((u) => ({ ...u, activeProjectId: p.id }));
							projectMenuOpen = false;
						}}
					>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-1.5">
								{#if $ui.activeProjectId === p.id}<Check size={12} />{/if}
								<span class="truncate">{p.name}</span>
							</div>
							<div class="text-xs text-muted-foreground font-mono truncate">{p.path}</div>
						</div>
						{#if liveCount(p.id) > 0}
							<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent-ok/15 text-accent-ok">{liveCount(p.id)}</span>
						{/if}
					</button>
				{/each}
				{#if projectList.length === 0}
					<div class="px-3 py-1.5 text-xs text-muted-foreground">No projects</div>
				{/if}
				<div class="border-t border-border mt-1 pt-1">
					<button
						class="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
						onclick={() => { setView('projects'); projectMenuOpen = false; }}
					>
						Manage projects…
					</button>
				</div>
			</div>
		{/if}
	</div>

	<!-- Command palette button -->
	<button
		class="flex items-center gap-2 flex-1 max-w-md px-3 py-1 text-xs rounded bg-card border border-border text-muted-foreground hover:text-foreground hover:border-secondary transition-colors"
		onclick={() => openPalette()}
	>
		<Search size={12} />
		<span class="flex-1 text-left">Search sessions, run commands…</span>
		<kbd class="px-1.5 py-0.5 rounded bg-secondary text-foreground text-[10px] font-mono">
			{fmtChord(['mod', 'k'])}
		</kbd>
	</button>

	<!-- Status counts -->
	<div class="flex items-center gap-2 text-xs">
		{#if counts.working === 0 && counts.awaiting === 0 && counts.queued === 0 && counts.total > 0}
			<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-muted-foreground border border-border">
				<Check size={11} class="text-accent-ok" /> All idle
			</span>
		{:else if counts.total === 0}
			<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-muted-foreground">
				No sessions
			</span>
		{:else}
			{#if counts.working > 0}
				<span class="flex items-center gap-1 text-accent-ok">
					<span class="w-1.5 h-1.5 rounded-full bg-accent-ok"></span>
					{counts.working}
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

	<!-- Remote pill -->
	<button
		title={remote.status.listening ? `Remote on · ${remote.status.address}` : 'Remote off — click to configure'}
		class={cn(
			'flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors',
			remote.status.listening
				? 'border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10'
				: 'border-border text-muted-foreground hover:bg-secondary'
		)}
		onclick={() => { setView('settings'); }}
	>
		<RadioTower size={11} />
		{#if remote.status.listening}
			<span>Remote</span>
		{:else}
			<span class="hidden sm:inline">Remote off</span>
		{/if}
	</button>

	<!-- Connection -->
	<span
		class={cn(
			'flex items-center gap-1 text-xs',
			connected ? 'text-accent-ok' : 'text-accent-error'
		)}
	>
		<span
			class={cn(
				'w-1.5 h-1.5 rounded-full',
				connected ? 'bg-accent-ok' : 'bg-accent-error'
			)}
		></span>
		{connected ? 'online' : 'offline'}
	</span>
</div>
