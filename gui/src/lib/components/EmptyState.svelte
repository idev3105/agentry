<script lang="ts">
	import type { Component } from 'svelte';
	import { Button } from '$lib/components/ui/button';
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
		<Button variant="outline" size="xs" class="mt-2" onclick={action.onClick}>{action.label}</Button>
	{/if}
</div>
