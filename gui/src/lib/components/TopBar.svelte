<script lang="ts">
	import { projects, removeProject } from '$lib/stores/projects';
	import { sessions } from '$lib/stores/sessions';
	import { ui, openPalette, toggleSidebar, toggleInspector } from '$lib/stores/ui';
	import { cn, fmtChord } from '$lib/utils/cn';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { createProject, removeProject as removeProjectCmd } from '$lib/ipc';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { toasts } from '$lib/stores/toasts.svelte';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import PanelLeft from '@lucide/svelte/icons/panel-left';
	import PanelRight from '@lucide/svelte/icons/panel-right';

	let projectList = $derived(Array.from($projects.values()));
	let sessionList = $derived(Array.from($sessions.values()));

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

<div class="flex flex-col flex-shrink-0 bg-card border-b border-border">
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
					<span class="text-[10px] px-1 py-0 rounded bg-secondary text-muted-foreground flex-shrink-0">{live}</span>
				{/if}
				<Button
					variant="ghost"
					size="icon-xs"
					title="Remove project"
					aria-label="Remove project"
					class={cn(
						'flex-shrink-0 size-4 ml-0.5',
						active
							? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-60 group-hover:opacity-100'
							: 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10'
					)}
					onclick={(e) => doRemove(p.id, e)}
				>
					<X size={10} />
				</Button>
			</div>
		{/each}

		<!-- Add project button -->
		<Button
			variant="ghost"
			size="xs"
			title="Add project"
			aria-label="Add project"
			class="flex-shrink-0 text-muted-foreground hover:text-foreground hover:bg-secondary/40"
			onclick={() => (showNew = true)}
		>
			<Plus size={12} />
		</Button>

		<div class="flex-1"></div>
	</div>

	<!-- Main toolbar row -->
	<div class="flex items-center gap-2" style="height:var(--bar-h);padding-inline:var(--pad-x)">
		{#if $ui.view === 'terminal'}
			<Button
				variant="ghost"
				size="icon-xs"
				title={$ui.sidebarCollapsed ? 'Show session list' : 'Hide session list'}
				aria-label="Toggle session list"
				class={cn('flex-shrink-0', !$ui.sidebarCollapsed && 'text-foreground')}
				onclick={() => toggleSidebar()}
			>
				<PanelLeft />
			</Button>
		{/if}

		<!-- Command palette button -->
		<Button
			variant="outline"
			class="flex items-center gap-2 flex-1 max-w-md h-auto px-3 py-1 text-xs justify-start font-normal text-muted-foreground hover:text-foreground"
			onclick={() => openPalette()}
		>
			<Search size={12} />
			<span class="flex-1 text-left">Search sessions, run commands…</span>
			<kbd class="px-1.5 py-0.5 rounded bg-secondary text-foreground text-[10px] font-mono">
				{fmtChord(['mod', 'k'])}
			</kbd>
		</Button>

		<div class="flex-1"></div>

		{#if $ui.view === 'terminal'}
			<Button
				variant="ghost"
				size="icon-xs"
				title={$ui.inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
				aria-label="Toggle inspector"
				class={cn('flex-shrink-0', !$ui.inspectorCollapsed && 'text-foreground')}
				onclick={() => toggleInspector()}
			>
				<PanelRight />
			</Button>
		{/if}
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
				<Label for="nb-path" class="text-xs text-muted-foreground">Folder</Label>
				<div class="flex gap-2">
					<Input
						id="nb-path"
						class="flex-1 font-mono"
						placeholder="/path/to/repo"
						bind:value={newPath}
						oninput={() => { pathError = ''; if (!nameTouched) newName = basename(newPath); }}
					/>
					<Button variant="outline" size="sm" onclick={browse}>
						Browse
					</Button>
				</div>
				{#if pathError}
					<p class="text-xs text-destructive">{pathError}</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<Label for="nb-name" class="text-xs text-muted-foreground">Name</Label>
				<Input
					id="nb-name"
					class="w-full"
					bind:value={newName}
					oninput={() => (nameTouched = true)}
				/>
			</div>

			<div class="flex justify-end gap-2 pt-1">
				<Button variant="outline" size="sm" onclick={resetNew}>
					Cancel
				</Button>
				<Button
					size="sm"
					disabled={submitting || !newPath.trim()}
					onclick={submitNew}
				>
					{submitting ? 'Creating…' : 'Create'}
				</Button>
			</div>
		</div>
	</div>
{/if}
