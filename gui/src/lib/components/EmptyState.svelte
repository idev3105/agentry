<script lang="ts">
	import type { Component } from 'svelte';
	let { icon: Icon, title, hint, action }: {
		icon: Component;
		title: string;
		hint?: string;
		action?: { label: string; onClick: () => void };
	} = $props();
</script>

<div class="flex flex-col items-center justify-center h-full text-center px-6 py-12 gap-2">
	<Icon class="size-8 text-muted-foreground/50" />
	<p class="text-sm font-medium">{title}</p>
	{#if hint}<p class="text-xs text-muted-foreground max-w-xs">{hint}</p>{/if}
	{#if action}
		<button
			class="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary"
			onclick={action.onClick}
		>{action.label}</button>
	{/if}
</div>
