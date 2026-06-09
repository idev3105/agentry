<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import Folders from '@lucide/svelte/icons/folders';
	import User from '@lucide/svelte/icons/user-cog';
	import Router from '@lucide/svelte/icons/router';
	import Settings from '@lucide/svelte/icons/settings';
	import Plus from '@lucide/svelte/icons/plus';
	import { ui, setView, openWizard } from '$lib/stores/ui';
	import { r9 } from '$lib/stores/r9.svelte';
	import { cn } from '$lib/utils/cn';
	import type { View } from '$lib/stores/ui';

	const items: { id: View; icon: typeof Home; label: string; shortcut?: string }[] = [
		{ id: 'overview', icon: Home, label: 'Overview' },
		{ id: 'terminal', icon: Folders, label: 'Sessions' },
		{ id: 'profiles', icon: User, label: 'Profiles' },
		{ id: 'r9', icon: Router, label: '9Router' },
		{ id: 'settings', icon: Settings, label: 'Settings' }
	];
</script>

<div class="flex flex-col items-center gap-1 py-2 w-16 bg-card border-r border-border flex-shrink-0">
	{#each items as item (item.id)}
		<button
			title={item.label}
			class={cn(
				'flex flex-col items-center justify-center w-full py-2 gap-0.5 transition-colors relative group',
				$ui.view === item.id
					? 'text-foreground bg-secondary/60'
					: 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
			)}
			onclick={() => setView(item.id)}
		>
			<item.icon size={18} />
			<span class="text-[9px] leading-tight">{item.label}</span>
			{#if item.id === 'r9' && r9.status.running}
				<span class="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
			{/if}
			{#if $ui.view === item.id}
				<span class="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-gruvbox-yellow rounded-r"></span>
			{/if}
		</button>
	{/each}

	<div class="flex-1"></div>

	<button
		title="New session"
		class="flex flex-col items-center justify-center w-full py-2 gap-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
		onclick={() => openWizard()}
	>
		<Plus size={18} />
		<span class="text-[9px] leading-tight">New</span>
	</button>
</div>
