<script lang="ts">
	import { projects, removeProject } from '$lib/stores/projects';
	import { sessions } from '$lib/stores/sessions';
	import { ui } from '$lib/stores/ui';
	import { removeProject as removeProjectCmd, createProject } from '$lib/ipc';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { cn } from '$lib/utils/cn';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash from '@lucide/svelte/icons/trash-2';
	import FolderKanban from '@lucide/svelte/icons/folder-kanban';
	import Check from '@lucide/svelte/icons/check';

	// modal state
	let showNew = $state(false);

	// confirm-delete state
	let pendingDelete = $state<string | null>(null);

	let projectList = $derived(Array.from($projects.values()));

	// live session count per project (status not finished/failed)
	function liveCount(projectId: string): number {
		let n = 0;
		for (const s of $sessions.values()) {
			if (s.projectId !== projectId) continue;
			if (s.status === 'finished' || s.status === 'failed') continue;
			n++;
		}
		return n;
	}
	function totalCount(projectId: string): number {
		let n = 0;
		for (const s of $sessions.values()) if (s.projectId === projectId) n++;
		return n;
	}

	function switchTo(id: string) {
		ui.update((u) => ({ ...u, activeProjectId: id }));
		toasts.info('Switched project');
	}

	let pendingProject = $derived(pendingDelete ? $projects.get(pendingDelete) : undefined);
	let pendingLive = $derived(pendingDelete ? liveCount(pendingDelete) : 0);

	async function doDelete() {
		const id = pendingDelete;
		pendingDelete = null;
		if (!id) return;
		try {
			await removeProjectCmd(id);
			removeProject(id);
			// reassign active project if we deleted the active one
			if ($ui.activeProjectId === id) {
				const next = Array.from($projects.keys())[0] ?? null;
				ui.update((u) => ({ ...u, activeProjectId: next }));
			}
			toasts.success('Project removed');
		} catch (e) {
			toasts.error(`Remove failed: ${e}`);
		}
	}

	// New project modal logic
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
			// project_created event updates the store (listener in +page.svelte)
			resetNew();
			toasts.success('Project created');
		} catch (e) {
			pathError = String(e);
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex flex-col h-full overflow-y-auto">
	<header class="px-6 py-5 border-b border-border flex items-center justify-between">
		<div>
			<h1 class="text-base font-semibold">Projects</h1>
			<p class="text-xs text-muted-foreground mt-0.5">Switch, create, or remove projects.</p>
		</div>
		<button
			class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary"
			onclick={() => (showNew = true)}
		>
			<Plus class="size-3.5" /> New project
		</button>
	</header>

	{#if projectList.length === 0}
		<div class="flex-1 flex flex-col items-center justify-center text-center gap-3 p-10">
			<FolderKanban class="size-10 text-muted-foreground" />
			<div>
				<p class="text-sm font-medium">No projects yet</p>
				<p class="text-xs text-muted-foreground mt-1">Create a project to start launching agents.</p>
			</div>
			<button
				class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/70"
				onclick={() => (showNew = true)}
			>
				<Plus class="size-3.5" /> Create project
			</button>
		</div>
	{:else}
		<div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-3">
			{#each projectList as p (p.id)}
				<div class="bg-card border border-border rounded p-4 flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<span class="font-medium text-sm truncate">{p.name}</span>
						{#if $ui.activeProjectId === p.id}
							<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground">active</span>
						{/if}
						<button
							class="ml-auto p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
							title="Remove project"
							onclick={() => (pendingDelete = p.id)}
						>
							<Trash class="size-3.5" />
						</button>
					</div>
					<div class="text-xs text-muted-foreground font-mono truncate">{p.path}</div>
					<div class="flex items-center gap-3 text-xs text-muted-foreground mt-1">
						<span class="text-accent-ok">{liveCount(p.id)} running</span>
						<span>{totalCount(p.id)} total</span>
					</div>
					{#if $ui.activeProjectId !== p.id}
						<button
							class="mt-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary"
							onclick={() => switchTo(p.id)}
						>
							<Check class="size-3.5" /> Switch to this project
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<ConfirmDialog
	open={pendingDelete !== null}
	title="Remove project?"
	message={pendingLive > 0
		? `"${pendingProject?.name}" has ${pendingLive} running agent(s). Removing it will kill them.`
		: `"${pendingProject?.name}" will be removed.`}
	confirmLabel="Remove"
	onConfirm={doDelete}
	onCancel={() => (pendingDelete = null)}
/>

{#if showNew}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-40 bg-black/50" role="presentation" onclick={resetNew}></div>
	<div class="fixed z-50 inset-0 grid place-items-center pointer-events-none">
		<div class="pointer-events-auto w-full max-w-md bg-popover border border-border rounded-lg p-5 space-y-4 shadow-lg">
			<h2 class="text-sm font-semibold">New project</h2>

			<div class="space-y-1.5">
				<label class="text-xs text-muted-foreground" for="np-path">Folder</label>
				<div class="flex gap-2">
					<input
						id="np-path"
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
				<label class="text-xs text-muted-foreground" for="np-name">Name</label>
				<input
					id="np-name"
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
