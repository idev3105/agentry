<script lang="ts">
	import Folders from '@lucide/svelte/icons/folders';
	import User from '@lucide/svelte/icons/user-cog';
	import Router from '@lucide/svelte/icons/router';
	import Settings from '@lucide/svelte/icons/settings';
	import { ui, setView } from '$lib/stores/ui';
	import { r9 } from '$lib/stores/r9.svelte';
	import { cn } from '$lib/utils/cn';
	import { Button } from '$lib/components/ui/button';
	import type { View } from '$lib/stores/ui';

	const items: { id: View; icon: typeof Folders; label: string; shortcut?: string }[] = [
		{ id: 'terminal', icon: Folders, label: 'Sessions' },
		{ id: 'profiles', icon: User, label: 'Profiles' },
		{ id: 'r9', icon: Router, label: '9Router' },
		{ id: 'settings', icon: Settings, label: 'Settings' }
	];
</script>

<div data-tour="activity" class="flex flex-col items-center gap-0.5 py-2 bg-card flex-shrink-0 border-r border-border-strong" style="width:var(--rail-w)">
	{#each items as item (item.id)}
		<Button
			variant="ghost"
			title={item.label}
			class={cn(
				'flex flex-col items-center justify-center w-full h-auto py-2 gap-0.5 rounded-none relative group transition-colors',
				$ui.view === item.id
					? 'text-foreground hover:bg-transparent'
					: 'text-muted-foreground hover:text-foreground hover:bg-secondary/30'
			)}
			onclick={() => setView(item.id)}
		>
			<item.icon size={19} />
			{#if item.id === 'r9' && r9.status.running}
				<span class="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
			{/if}
			{#if $ui.view === item.id}
				<span class="absolute left-0 top-1 bottom-1 w-[2px] bg-accent rounded-r-full"></span>
			{/if}
		</Button>
	{/each}

	<div class="flex-1"></div>
</div>
