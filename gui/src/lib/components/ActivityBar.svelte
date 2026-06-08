<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import Folders from '@lucide/svelte/icons/folders';
	import User from '@lucide/svelte/icons/user-cog';
	import Settings from '@lucide/svelte/icons/settings';
	import Plus from '@lucide/svelte/icons/plus';
	import { ui, setView, openWizard } from '$lib/stores/ui';
	import { cn } from '$lib/utils/cn';
	import type { View } from '$lib/stores/ui';

	const items: { id: View; icon: typeof Home; label: string; shortcut?: string }[] = [
		{ id: 'overview', icon: Home, label: 'Overview' },
		{ id: 'terminal', icon: Folders, label: 'Sessions' },
		{ id: 'profiles', icon: User, label: 'Profiles' },
		{ id: 'settings', icon: Settings, label: 'Settings' }
	];
</script>

<div class="flex flex-col items-center gap-1 py-2 w-14 bg-card border-r border-border flex-shrink-0">
	{#each items as item (item.id)}
		<button
			title={item.label}
			class={cn(
				'w-10 h-10 rounded flex items-center justify-center transition-colors relative group',
				$ui.view === item.id
					? 'bg-secondary text-foreground'
					: 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
			)}
			onclick={() => setView(item.id)}
		>
			<item.icon size={20} />
			{#if $ui.view === item.id}
				<span class="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-gruvbox-yellow rounded-r"></span>
			{/if}
			<span
				class="absolute left-full ml-2 px-2 py-1 rounded bg-card border border-border text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10"
			>
				{item.label}
			</span>
		</button>
	{/each}

	<div class="flex-1"></div>

	<button
		title="New session"
		class="w-10 h-10 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
		onclick={() => openWizard()}
	>
		<Plus size={20} />
	</button>
</div>
