<!-- LaunchSheet — quick-launch modal khi user đã có projects + profiles.
     Hiện khi onboardingOpen = true nhưng user đã onboarded.
     Cho phép chọn project, profile, CWD override, initial prompt. -->
<script lang="ts">
	import { ui, closeOnboarding } from '$lib/stores/ui';
	import { projects } from '$lib/stores/projects';
	import { profiles } from '$lib/stores/profiles';
	import { settings } from '$lib/stores/settings';
	import { startSession } from '$lib/ipc';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { agentMeta } from '$lib/utils/agent';
	import { cn } from '$lib/utils/cn';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import X from '@lucide/svelte/icons/x';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Play from '@lucide/svelte/icons/play';

	let projectList = $derived(Array.from($projects.values()));
	let profileList = $derived($profiles);

	let selProjectId = $state($ui.activeProjectId ?? '');
	let selProfileId = $state($settings.defaultProfileId ?? '');
	let cwdOverride = $state('');
	let initialPrompt = $state('');
	let launching = $state(false);

	// Keep selProjectId in sync if active project changes while open
	$effect(() => {
		if (!selProjectId && $ui.activeProjectId) selProjectId = $ui.activeProjectId;
	});
	$effect(() => {
		if (!selProfileId && $settings.defaultProfileId) selProfileId = $settings.defaultProfileId;
		else if (!selProfileId && profileList.length > 0) selProfileId = profileList[0].id;
	});

	async function pickCwd() {
		try {
			const result = await openDialog({ directory: true, multiple: false, title: 'Working directory' });
			if (typeof result === 'string') cwdOverride = result;
		} catch {}
	}

	async function launch() {
		if (!selProjectId || !selProfileId) return;
		launching = true;
		try {
			const cwd = cwdOverride.trim() || undefined;
			const prompt = initialPrompt.trim() || undefined;
			await startSession(selProjectId, selProfileId, cwd, prompt);
			closeOnboarding();
		} catch (e) {
			toasts.error('Launch failed', String(e));
		} finally {
			launching = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') closeOnboarding();
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); launch(); }
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	onkeydown={onKeydown}
>
	<!-- Backdrop -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="absolute inset-0" onclick={closeOnboarding}></div>

	<!-- Panel -->
	<div class="relative w-full max-w-lg bg-card border border-border rounded-lg shadow-lg p-6 space-y-4 mx-4">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-semibold">New Session</h2>
			<button class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
				onclick={closeOnboarding}>
				<X size={16} />
			</button>
		</div>

		<!-- Project -->
		<label class="block">
			<span class="block text-xs text-muted-foreground mb-1">Project <span class="text-destructive">*</span></span>
			<select
				bind:value={selProjectId}
				class="w-full bg-input rounded px-2 py-1.5 text-sm border border-border focus:border-accent focus:outline-none"
			>
				<option value="">— Select project —</option>
				{#each projectList as p (p.id)}
					<option value={p.id}>{p.name} <span class="text-muted-foreground font-mono">{p.path}</span></option>
				{/each}
			</select>
			{#if projectList.length === 0}
				<p class="text-xs text-muted-foreground mt-1">No projects yet — create one in Projects view.</p>
			{/if}
		</label>

		<!-- Profile -->
		<label class="block">
			<span class="block text-xs text-muted-foreground mb-1">Profile <span class="text-destructive">*</span></span>
			<select
				bind:value={selProfileId}
				class="w-full bg-input rounded px-2 py-1.5 text-sm border border-border focus:border-accent focus:outline-none"
			>
				<option value="">— Select profile —</option>
				{#each profileList as p (p.id)}
					{@const m = agentMeta(p.agent_type)}
					<option value={p.id}>{p.name} ({m.label})</option>
				{/each}
			</select>
		</label>

		<!-- CWD override -->
		<label class="block">
			<span class="block text-xs text-muted-foreground mb-1">Working directory <span class="text-muted-foreground/60">(optional — defaults to project path)</span></span>
			<div class="flex items-stretch gap-1">
				<input
					type="text"
					bind:value={cwdOverride}
					placeholder="Leave blank to use project path"
					class="flex-1 bg-input rounded px-2 py-1.5 text-xs font-mono border border-border focus:border-accent focus:outline-none"
				/>
				<button
					class="px-2 rounded border border-border hover:bg-secondary text-muted-foreground hover:text-foreground"
					onclick={pickCwd}
					title="Browse"
				><FolderOpen size={13} /></button>
			</div>
		</label>

		<!-- Initial prompt -->
		<label class="block">
			<span class="block text-xs text-muted-foreground mb-1">Initial prompt <span class="text-muted-foreground/60">(optional)</span></span>
			<textarea
				bind:value={initialPrompt}
				rows={3}
				placeholder="An optional first message for the agent. Leave blank to start an interactive session."
				class="w-full bg-input rounded px-2 py-1.5 text-xs border border-border focus:border-accent focus:outline-none resize-none"
			></textarea>
		</label>

		<!-- Actions -->
		<div class="flex items-center justify-between pt-1">
			<span class="text-[11px] text-muted-foreground font-mono">⌘↩ to start</span>
			<button
				class={cn(
					'flex items-center gap-2 px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium disabled:opacity-50',
					'focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none'
				)}
				disabled={!selProjectId || !selProfileId || launching}
				onclick={launch}
			>
				{#if launching}
					Starting…
				{:else}
					<Play size={13} /> Start Session
				{/if}
			</button>
		</div>
	</div>
</div>
