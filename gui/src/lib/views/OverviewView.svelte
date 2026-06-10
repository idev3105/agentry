<script lang="ts">
	import { sessions } from '$lib/stores/sessions';
	import { projects } from '$lib/stores/projects';
	import { ui, setView, openOnboarding } from '$lib/stores/ui';
	import { cn } from '$lib/utils/cn';
	import Plus from '@lucide/svelte/icons/plus';
	import Terminal from '@lucide/svelte/icons/terminal';
	import ExternalLink from '@lucide/svelte/icons/external-link';

	let sessionList = $derived(Array.from($sessions.values()));
	let projectList = $derived(Array.from($projects.values()));

	let stats = $derived.by(() => {
		const s = { total: sessionList.length, working: 0, awaiting: 0, queued: 0, done: 0, failed: 0 };
		for (const x of sessionList) {
			if (x.status === 'queued') s.queued++;
			else if (x.status === 'finished') s.done++;
			else if (x.status === 'failed') s.failed++;
			else if (x.activity === 'working') s.working++;
			else if (x.activity === 'awaiting_input') s.awaiting++;
		}
		return s;
	});

	function openSession(id: string, projectId: string) {
		ui.update((u) => ({
			...u,
			activeProjectId: projectId,
			focusedSessionId: id,
			view: 'terminal'
		}));
	}
</script>

<div class="flex flex-col h-full overflow-y-auto">
	<header class="px-6 py-5 border-b border-border">
		<h1 class="text-base font-semibold">Overview</h1>
		<p class="text-xs text-muted-foreground mt-0.5">All projects and sessions at a glance.</p>
	</header>

	<div class="p-6 space-y-6">
		<!-- Stats -->
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
			{@render stat('Total', stats.total, 'text-foreground')}
			{@render stat('Working', stats.working, 'text-gruvbox-green')}
			{@render stat('Awaiting', stats.awaiting, 'text-gruvbox-red')}
			{@render stat('Queued', stats.queued, 'text-gruvbox-gray')}
			{@render stat('Done', stats.done, 'text-muted-foreground')}
			{@render stat('Failed', stats.failed, 'text-gruvbox-red')}
		</div>

		<!-- Per-project -->
		{#if projectList.length === 0}
			<div class="bg-card border border-border rounded p-6 text-center">
				<p class="text-sm text-muted-foreground mb-3">No projects yet.</p>
				<button
					title="Get started"
					class="inline-flex items-center justify-center p-2 rounded bg-primary text-primary-foreground hover:bg-primary/90"
					onclick={() => openOnboarding()}
				>
					<Plus size={14} />
				</button>
			</div>
		{:else}
			<div class="space-y-4">
				{#each projectList as p (p.id)}
					{@const inProj = sessionList.filter((s) => s.projectId === p.id)}
					<div class="bg-card border border-border rounded">
						<div class="flex items-center justify-between px-4 py-2 border-b border-border">
							<div class="min-w-0">
								<div class="text-sm font-medium">{p.name}</div>
								<div class="text-[11px] text-muted-foreground font-mono truncate">{p.path}</div>
							</div>
						<button
							title="Open sessions"
							class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
							onclick={() => {
								ui.update((u) => ({ ...u, activeProjectId: p.id, view: 'terminal' }));
							}}
						><ExternalLink size={14} /></button>
						</div>
						{#if inProj.length === 0}
							<div class="px-4 py-3 text-xs text-muted-foreground">No sessions.</div>
						{:else}
							<div class="divide-y divide-border">
								{#each inProj as s (s.id)}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										class="flex items-center gap-2 px-4 py-2 hover:bg-secondary/40 cursor-pointer"
										onclick={() => openSession(s.id, p.id)}
									>
										<Terminal size={12} class="text-muted-foreground" />
										<span class="text-sm flex-1 truncate">{s.title}</span>
										<span class="text-[11px] text-muted-foreground">
											{s.status}{s.activity ? ` · ${s.activity}` : ''}
										</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

{#snippet stat(label: string, n: number, color: string)}
	<div class="bg-card border border-border rounded px-3 py-2">
		<div class="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
		<div class={cn('text-2xl font-light tabular-nums', color)}>{n}</div>
	</div>
{/snippet}
