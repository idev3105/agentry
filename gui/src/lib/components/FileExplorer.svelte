<script lang="ts">
	import { explorer } from "$lib/stores/explorer.svelte";
	import FileTreeNode from "./FileTreeNode.svelte";
	import EmptyState from "./EmptyState.svelte";
	import { Button } from "$lib/components/ui/button";
	import RefreshCw from "@lucide/svelte/icons/refresh-cw";
	import FolderTree from "@lucide/svelte/icons/folder-tree";

	let root = $derived(explorer.root);
	let rootEntries = $derived(root ? (explorer.children.get(root) ?? []) : []);
	let rootName = $derived(root ? (root.split("/").filter(Boolean).pop() ?? root) : "");

	function refresh() {
		if (root) void explorer.reload(root);
	}
</script>

<div class="flex flex-col h-full overflow-hidden bg-card">
	<div
		class="flex items-center gap-1 border-b border-border-strong"
		style="padding: var(--row-py, 4px) var(--pad-x, 8px)"
	>
		<FolderTree size={13} class="text-muted-foreground flex-shrink-0" />
		<span class="text-xs font-medium truncate flex-1" title={root ?? ""}>{rootName || "No folder"}</span>
		<Button variant="ghost" size="icon-xs" title="Refresh" disabled={!root} onclick={refresh}>
			<RefreshCw size={12} />
		</Button>
	</div>

	<div class="flex-1 overflow-y-auto py-1">
		{#if !root}
			<EmptyState
				icon={FolderTree}
				title="No folder"
				hint="Open or select a project to browse its files"
			/>
		{:else if rootEntries.length === 0}
			<div class="p-4 text-xs text-muted-foreground text-center">Empty or unreadable folder</div>
		{:else}
			{#each rootEntries as entry (entry.path)}
				<FileTreeNode {entry} depth={0} />
			{/each}
		{/if}
	</div>
</div>
