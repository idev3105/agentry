<script lang="ts">
	import { explorer } from "$lib/stores/explorer.svelte";
	import { fileIcon } from "$lib/utils/fileIcon";
	import { cn } from "$lib/utils/cn";
	import type { DirEntry } from "$lib/types";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import Self from "./FileTreeNode.svelte";

	let { entry, depth }: { entry: DirEntry; depth: number } = $props();

	let isOpen = $derived(explorer.expanded.has(entry.path));
	let isSelected = $derived(explorer.selected === entry.path);
	let kids = $derived(explorer.children.get(entry.path) ?? []);
	let isLoading = $derived(explorer.loading.has(entry.path));
	let Icon = $derived(fileIcon(entry.name, entry.is_dir, isOpen));

	function onClick() {
		if (entry.is_dir) {
			void explorer.toggle(entry.path);
		} else {
			explorer.select(entry.path);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class={cn(
		"flex items-center gap-1 cursor-pointer rounded-sm text-sm select-none transition-colors py-[var(--row-py,2px)] pr-1",
		isSelected ? "bg-secondary text-foreground" : "hover:bg-secondary/50 text-muted-foreground",
	)}
	style="padding-left: {depth * 12 + 4}px"
	onclick={onClick}
	title={entry.name}
>
	{#if entry.is_dir}
		<ChevronRight
			size={13}
			class={cn("flex-shrink-0 transition-transform", isOpen && "rotate-90")}
		/>
	{:else}
		<span class="w-[13px] flex-shrink-0"></span>
	{/if}
	<Icon size={14} class="flex-shrink-0" />
	<span class="truncate">{entry.name}</span>
</div>

{#if entry.is_dir && isOpen}
	{#if isLoading}
		<div class="text-[11px] text-muted-foreground/60" style="padding-left: {(depth + 1) * 12 + 18}px">
			loading…
		</div>
	{:else if kids.length === 0}
		<div class="text-[11px] text-muted-foreground/40" style="padding-left: {(depth + 1) * 12 + 18}px">
			empty
		</div>
	{:else}
		{#each kids as child (child.path)}
			<Self entry={child} depth={depth + 1} />
		{/each}
	{/if}
{/if}
