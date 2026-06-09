<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { ui, closePalette, setView, openWizard } from '$lib/stores/ui';
	import { sessions } from '$lib/stores/sessions';
	import { projects } from '$lib/stores/projects';
	import { profiles } from '$lib/stores/profiles';
	import { startSession, killSession, focusSession } from '$lib/ipc';
	import { markSessionEnding } from '$lib/stores/sessions';
	import { cn, fmtChord } from '$lib/utils/cn';

	const MRU_KEY = 'agentry:palette:mru';
	function loadMru(): string[] { try { return JSON.parse(localStorage.getItem(MRU_KEY) ?? '[]'); } catch { return []; } }
	function pushMru(id: string) {
		const cur = loadMru().filter(x => x !== id);
		cur.unshift(id);
		localStorage.setItem(MRU_KEY, JSON.stringify(cur.slice(0, 20)));
	}
	import Terminal from '@lucide/svelte/icons/terminal';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import User from '@lucide/svelte/icons/user-cog';
	import Settings from '@lucide/svelte/icons/settings';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import Copy from '@lucide/svelte/icons/copy';
	import Home from '@lucide/svelte/icons/home';

	type ActionItem = {
		id: string;
		title: string;
		subtitle?: string;
		category: string;
		icon: typeof Terminal;
		shortcut?: string[];
		run: () => void | Promise<void>;
	};

	let query = $state('');
	let selected = $state(0);
	let inputEl: HTMLInputElement | null = $state(null);

	const { onPickSession }: { onPickSession: (id: string) => void } = $props();

	let allActions = $derived.by<ActionItem[]>(() => {
		const acts: ActionItem[] = [];

		// Sessions — switch to
		for (const s of $sessions.values()) {
			acts.push({
				id: `session:${s.id}`,
				title: s.title,
				subtitle: `${s.status}${s.activity ? ` · ${s.activity}` : ''} — ${s.cwd}`,
				category: 'Sessions',
				icon: Terminal,
				run: () => onPickSession(s.id)
			});
		}

		// Sessions — kill
		for (const s of $sessions.values()) {
			if (s.status === 'running' || s.status === 'queued') {
				acts.push({
					id: `kill:${s.id}`,
					title: `Kill: ${s.title}`,
					subtitle: 'Terminate this session',
					category: 'Sessions',
					icon: X,
					run: async () => {
						markSessionEnding(s.id);
						killSession(s.id).catch((err) => {
							markSessionEnding(s.id, { failReason: `kill failed: ${err}` });
						});
					}
				});
			}
		}

		// Sessions — duplicate
		for (const s of $sessions.values()) {
			acts.push({
				id: `dup:${s.id}`,
				title: `Duplicate: ${s.title}`,
				subtitle: `New session with profile ${s.profileId.slice(0, 8)}…`,
				category: 'Sessions',
				icon: Copy,
				run: async () => { await startSession(s.projectId, s.profileId); }
			});
		}

		// Projects — switch
		for (const p of $projects.values()) {
			acts.push({
				id: `project:${p.id}`,
				title: `Open project: ${p.name}`,
				subtitle: p.path,
				category: 'Projects',
				icon: FolderOpen,
				run: () => {
					ui.update((u) => ({ ...u, activeProjectId: p.id, view: 'terminal' }));
				}
			});
		}

		// Start session for current project per profile
		const activeProj = $ui.activeProjectId;
		if (activeProj) {
			for (const pr of $profiles) {
				acts.push({
					id: `start:${pr.id}`,
					title: `Start ${pr.name}`,
					subtitle: `New ${pr.agent_type} session in current project`,
					category: 'New',
					icon: Plus,
					run: async () => {
						await startSession(activeProj, pr.id);
					}
				});
			}
		}

		// Navigation
		acts.push(
			{
				id: 'nav:overview',
				title: 'Go to Overview',
				category: 'Navigate',
				icon: Home,
				run: () => setView('overview')
			},
			{
				id: 'nav:terminal',
				title: 'Go to Sessions',
				category: 'Navigate',
				icon: Terminal,
				run: () => setView('terminal')
			},
			{
				id: 'nav:profiles',
				title: 'Manage Profiles',
				category: 'Navigate',
				icon: User,
				run: () => setView('profiles')
			},
			{
				id: 'nav:settings',
				title: 'Open Settings',
				category: 'Navigate',
				icon: Settings,
				run: () => setView('settings')
			},
			{
				id: 'nav:wizard',
				title: 'New Project Setup…',
				category: 'Navigate',
				icon: Plus,
				run: () => openWizard()
			}
		);

		return acts;
	});

	let filtered = $derived.by<ActionItem[]>(() => {
		const q = query.trim().toLowerCase();
		const base = !q
			? allActions
			: allActions.filter((a) => {
				const hay = `${a.title} ${a.subtitle ?? ''}`.toLowerCase();
				let i = 0;
				for (const ch of q) {
					const at = hay.indexOf(ch, i);
					if (at < 0) return false;
					i = at + 1;
				}
				return true;
			});
		if (q) return base;
		const mru = loadMru();
		const rank = new Map(mru.map((id, i) => [id, i]));
		return [...base].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
	});

	let groups = $derived.by(() => {
		const map = new Map<string, ActionItem[]>();
		for (const a of filtered) {
			const arr = map.get(a.category) ?? [];
			arr.push(a);
			map.set(a.category, arr);
		}
		return Array.from(map.entries());
	});

	// Keep `selected` index in bounds whenever `filtered` changes.
	$effect(() => {
		void filtered;
		if (selected >= filtered.length) selected = 0;
	});

	$effect(() => {
		if ($ui.paletteOpen) {
			query = '';
			selected = 0;
			tick().then(() => inputEl?.focus());
		}
	});

	async function runItem(item: ActionItem | undefined) {
		if (!item) return;
		closePalette();
		pushMru(item.id);
		await item.run();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closePalette();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = Math.min(selected + 1, filtered.length - 1);
			scrollIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
			scrollIntoView();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			runItem(filtered[selected]);
		}
	}

	function scrollIntoView() {
		queueMicrotask(() => {
			document
				.querySelector<HTMLElement>('[data-palette-selected="true"]')
				?.scrollIntoView({ block: 'nearest' });
		});
	}
</script>

{#if $ui.paletteOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[15vh]"
		onclick={() => closePalette()}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="bg-card border border-border rounded-lg shadow-2xl w-[640px] max-w-[90vw] overflow-hidden"
			onclick={(e) => e.stopPropagation()}
		>
			<input
				bind:this={inputEl}
				type="text"
				bind:value={query}
				onkeydown={onKey}
				placeholder="Type a command or session name…"
				class="w-full px-4 py-3 bg-transparent border-b border-border text-sm focus:outline-none placeholder:text-muted-foreground"
			/>

			<div class="max-h-96 overflow-y-auto py-1">
				{#if filtered.length === 0}
					<div class="px-4 py-6 text-sm text-muted-foreground text-center">No matches</div>
				{/if}

				{#each groups as [cat, items] (cat)}
					<div class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
						{cat}
					</div>
					{#each items as item (item.id)}
						{@const idx = filtered.indexOf(item)}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							data-palette-selected={selected === idx}
							class={cn(
								'px-3 py-2 cursor-pointer flex items-center gap-3',
								selected === idx ? 'bg-secondary' : 'hover:bg-secondary/50'
							)}
							onclick={() => runItem(item)}
							onmouseenter={() => (selected = idx)}
						>
							<item.icon size={14} class="text-muted-foreground flex-shrink-0" />
							<div class="flex-1 min-w-0">
								<div class="text-sm truncate">{item.title}</div>
								{#if item.subtitle}
									<div class="text-xs text-muted-foreground truncate">{item.subtitle}</div>
								{/if}
							</div>
							{#if item.shortcut}
								<kbd class="px-1.5 py-0.5 rounded bg-background text-foreground text-[10px] font-mono border border-border">
									{fmtChord(item.shortcut)}
								</kbd>
							{/if}
						</div>
					{/each}
				{/each}
			</div>

			<div class="px-3 py-1.5 border-t border-border flex items-center gap-3 text-[10px] text-muted-foreground">
				<span><kbd class="font-mono text-foreground">↑↓</kbd> navigate</span>
				<span><kbd class="font-mono text-foreground">↵</kbd> select</span>
				<span><kbd class="font-mono text-foreground">Esc</kbd> close</span>
			</div>
		</div>
	</div>
{/if}
