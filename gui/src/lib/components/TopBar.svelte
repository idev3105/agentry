<script lang="ts">
	import { projects, removeProject } from '$lib/stores/projects';
	import { sessions } from '$lib/stores/sessions';
	import { ui, openPalette, setView } from '$lib/stores/ui';
	import { remote } from '$lib/stores/remote.svelte';
	import { cn, fmtChord } from '$lib/utils/cn';
	import { createProject, removeProject as removeProjectCmd } from '$lib/ipc';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { toasts } from '$lib/stores/toasts.svelte';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
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

	function liveCount(projectId: string): number {
		let n = 0;
		for (const s of sessionList) {
			if (s.projectId !== projectId) continue;
			if (s.status === 'finished' || s.status === 'failed') continue;
			n++;
		}
		return n;
	}

	// New project inline
	let showNew = $state(false);
	let newPath = $state('');
	let newName = $state('');
	let nameTouched = $state(false);
	let pathError = $state('');
	let submitting = $state(false);

	function basename(p: string): string {
		return p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? '';
	}

	async function browse() {
		const dir = await openDialog({ directory: true, multiple: false });
		if (typeof dir === 'string') {
			newPath = dir;
			if (!nameTouched) newName = basename(dir);
			pathError = '';
		}
	}

	function resetNew() {
		newPath = ''; newName = ''; nameTouched = false; pathError = ''; showNew = false;
	}

	async function submitNew() {
		if (!newPath.trim()) { pathError = 'Path is required'; return; }
		const dup = Array.from($projects.values()).find((p) => p.path === newPath.trim());
		if (dup) { pathError = `Already added as "${dup.name}"`; return; }
		submitting = true;
		try {
			await createProject(newName.trim() || basename(newPath), newPath.trim());
			resetNew();
			toasts.success('Project created');
		} catch (e) {
			pathError = String(e);
		} finally {
			submitting = false;
		}
	}

	// Remove project
	async function doRemove(id: string, e: MouseEvent) {
		e.stopPropagation();
		const p = $projects.get(id);
		if (!p) return;
		const live = liveCount(id);
		const msg = live > 0
			? `"${p.name}" has ${live} running agent(s). Remove it?`
			: `Remove project "${p.name}"?`;
		if (!confirm(msg)) return;
		try {
			await removeProjectCmd(id);
			removeProject(id);
			if ($ui.activeProjectId === id) {
				const next = Array.from($projects.keys())[0] ?? null;
				ui.update((u) => ({ ...u, activeProjectId: next }));
			}
		} catch (err) {
			toasts.error(`Remove failed: ${err}`);
		}
	}
</script>

<div class="flex flex-col flex-shrink-0 bg-background border-b border-border">
	<!-- Project tabs row -->
	<div class="flex items-center min-w-0 overflow-x-auto scrollbar-none border-b border-border/50 px-1 pt-1 gap-0.5">
		{#each projectList as p (p.id)}
			{@const live = liveCount(p.id)}
			{@const active = $ui.activeProjectId === p.id}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class={cn(
					'group flex items-center gap-1.5 px-3 py-1 text-xs rounded-t border border-b-0 cursor-pointer select-none transition-colors flex-shrink-0 max-w-[180px]',
					active
						? 'bg-background border-border text-foreground'
						: 'bg-card/50 border-transparent text-muted-foreground hover:text-foreground hover:bg-card/80'
				)}
				onclick={() => ui.update((u) => ({ ...u, activeProjectId: p.id, view: u.view === 'terminal' || u.view === 'projects' || u.view === 'overview' ? 'terminal' : u.view }))}
			>
				<span class="truncate font-medium">{p.name}</span>
				{#if live > 0}
					<span class="text-[10px] px-1 py-0 rounded bg-accent-ok/20 text-accent-ok flex-shrink-0">{live}</span>
				{/if}
				<button
					title="Remove project"
					class={cn(
						'flex-shrink-0 rounded p-0.5 transition-colors ml-0.5',
						active
							? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-60 group-hover:opacity-100'
							: 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10'
					)}
					onclick={(e) => doRemove(p.id, e)}
				>
					<X size={10} />
				</button>
			</div>
		{/each}

		<!-- Add project button -->
		<button
			title="Add project"
			class="flex items-center gap-1 px-2 py-1 text-xs rounded text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors flex-shrink-0"
			onclick={() => (showNew = true)}
		>
			<Plus size={12} />
		</button>

		<div class="flex-1"></div>
	</div>

	<!-- Main toolbar row -->
	<div class="flex items-center gap-3 px-3 py-1.5">
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
</div>

{#if showNew}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-40 bg-black/50" role="presentation" onclick={resetNew}></div>
	<div class="fixed z-50 inset-0 grid place-items-center pointer-events-none">
		<div class="pointer-events-auto w-full max-w-md bg-popover border border-border rounded-lg p-5 space-y-4 shadow-lg">
			<h2 class="text-sm font-semibold">New project</h2>

			<div class="space-y-1.5">
				<label class="text-xs text-muted-foreground" for="nb-path">Folder</label>
				<div class="flex gap-2">
					<input
						id="nb-path"
						class="flex-1 px-2.5 py-1.5 text-sm rounded bg-input border border-border font-mono"
						placeholder="/path/to/repo"
						bind:value={newPath}
						oninput={() => { pathError = ''; if (!nameTouched) newName = basename(newPath); }}
					/>
					<button class="px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary" onclick={browse}>
						Browse
					</button>
				</div>
				{#if pathError}
					<p class="text-xs text-destructive">{pathError}</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<label class="text-xs text-muted-foreground" for="nb-name">Name</label>
				<input
					id="nb-name"
					class="w-full px-2.5 py-1.5 text-sm rounded bg-input border border-border"
					bind:value={newName}
					oninput={() => (nameTouched = true)}
				/>
			</div>

			<div class="flex justify-end gap-2 pt-1">
				<button class="px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary" onclick={resetNew}>
					Cancel
				</button>
				<button
					class="px-3 py-1.5 text-xs rounded bg-accent text-accent-foreground disabled:opacity-50"
					disabled={submitting || !newPath.trim()}
					onclick={submitNew}
				>
					{submitting ? 'Creating…' : 'Create'}
				</button>
			</div>
		</div>
	</div>
{/if}
