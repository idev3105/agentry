<script lang="ts">
	import { projects, removeProject } from '$lib/stores/projects';
	import { sessions } from '$lib/stores/sessions';
	import { ui } from '$lib/stores/ui';
	import { removeProject as removeProjectCmd, createProject } from '$lib/ipc';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { cn } from '$lib/utils/cn';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
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
		<Button variant="outline" size="xs" onclick={() => (showNew = true)}>
			<Plus class="size-3.5" /> New project
		</Button>
	</header>

	{#if projectList.length === 0}
		<div class="flex-1 flex flex-col items-center justify-center text-center gap-3 p-10">
			<FolderKanban class="size-10 text-muted-foreground" />
			<div>
				<p class="text-sm font-medium">No projects yet</p>
				<p class="text-xs text-muted-foreground mt-1">Create a project to start launching agents.</p>
			</div>
			<Button variant="secondary" size="xs" onclick={() => (showNew = true)}>
				<Plus class="size-3.5" /> Create project
			</Button>
		</div>
	{:else}
		<div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-3">
			{#each projectList as p (p.id)}
				<Card.Root class="p-4 flex flex-col gap-2">
					<div class="flex items-center gap-2">
						<span class="font-medium text-sm truncate">{p.name}</span>
						{#if $ui.activeProjectId === p.id}
							<Badge variant="secondary" class="text-[10px]">active</Badge>
						{/if}
						<Button
							variant="ghost"
							size="icon-xs"
							class="ml-auto text-muted-foreground hover:text-destructive"
							title="Remove project"
							onclick={() => (pendingDelete = p.id)}
						>
							<Trash class="size-3.5" />
						</Button>
					</div>
					<div class="text-xs text-muted-foreground font-mono truncate">{p.path}</div>
					<div class="flex items-center gap-3 text-xs text-muted-foreground mt-1">
						<span class="text-accent-ok">{liveCount(p.id)} running</span>
						<span>{totalCount(p.id)} total</span>
					</div>
					{#if $ui.activeProjectId !== p.id}
						<Button
							variant="outline"
							size="xs"
							class="mt-1 justify-center"
							onclick={() => switchTo(p.id)}
						>
							<Check class="size-3.5" /> Switch to this project
						</Button>
					{/if}
				</Card.Root>
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

<Dialog.Root open={showNew} onOpenChange={(v) => { if (!v) resetNew(); }}>
	<Dialog.Content class="w-full max-w-md">
		<Dialog.Header>
			<Dialog.Title>New project</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-1.5">
			<Label for="np-path" class="text-xs text-muted-foreground">Folder</Label>
			<div class="flex gap-2">
				<Input
					id="np-path"
					class="flex-1 font-mono"
					placeholder="/path/to/repo"
					bind:value={newPath}
					oninput={() => { pathError = ''; if (!nameTouched) newName = basename(newPath); }}
				/>
				<Button variant="outline" size="xs" onclick={browse}>
					Browse
				</Button>
			</div>
			{#if pathError}
				<p class="text-xs text-destructive">{pathError}</p>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label for="np-name" class="text-xs text-muted-foreground">Name</Label>
			<Input
				id="np-name"
				class="w-full"
				bind:value={newName}
				oninput={() => (nameTouched = true)}
			/>
		</div>

		<Dialog.Footer>
			<Button variant="outline" size="xs" onclick={resetNew}>
				Cancel
			</Button>
			<Button
				size="xs"
				disabled={submitting || !newPath.trim()}
				onclick={submitNew}
			>
				{submitting ? 'Creating…' : 'Create'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
