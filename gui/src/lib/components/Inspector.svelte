<script lang="ts">
	import { sessions, updateSession, markSessionEnding } from '$lib/stores/sessions';
	import { profiles } from '$lib/stores/profiles';
	import { ui } from '$lib/stores/ui';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { SessionState } from '$lib/types';
	import { killSession, resumeSession, sendCmd, startSession } from '$lib/ipc';
	import { cn } from '$lib/utils/cn';
	import { shellQuote } from '$lib/utils/shell';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Square from '@lucide/svelte/icons/square';
	import Pencil from '@lucide/svelte/icons/pencil';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Trash from '@lucide/svelte/icons/trash-2';
	import Copy from '@lucide/svelte/icons/copy';
	import Terminal from '@lucide/svelte/icons/terminal';

	let session = $derived<SessionState | undefined>(
		$ui.focusedSessionId ? $sessions.get($ui.focusedSessionId) : undefined
	);

	let renaming = $state(false);
	let renameValue = $state('');
	let renameEl = $state<HTMLInputElement | null>(null);
	let copied = $state<string | null>(null);
	let confirmTarget = $state<SessionState | null>(null);

	$effect(() => {
		if (renaming) renameEl?.focus();
	});

	$effect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === 'F2' && session && !renaming) {
				e.preventDefault();
				startRename(session);
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = text;
			setTimeout(() => {
				if (copied === text) copied = null;
			}, 1200);
		} catch (e) {
			toasts.error('Copy failed', String(e));
		}
	}

	function doKill(s: SessionState) {
		markSessionEnding(s.id);
		killSession(s.id).catch((err) => {
			toasts.error('Kill failed', String(err));
			markSessionEnding(s.id, { failReason: `kill failed: ${err}` });
		});
	}

	async function performDelete(s: SessionState) {
		try {
			const wasActive = s.status === 'running' || s.status === 'starting' || s.status === 'queued';
			if (wasActive) {
				// Ask daemon to stop the PTY. The kill watcher escalates
				// SIGTERM → SIGKILL within 250ms, so by the time delete_session
				// runs the row is no longer active.
				markSessionEnding(s.id);
				await killSession(s.id).catch(() => {});
				await new Promise((r) => setTimeout(r, 350));
			}
			const r = (await sendCmd({ cmd: 'delete_session', session_id: s.id })) as {
				ok: boolean;
				error?: string;
			};
			if (!r.ok) throw new Error(r.error);
			sessions.update((m) => {
				m.delete(s.id);
				return m;
			});
			if ($ui.focusedSessionId === s.id) {
				ui.update((u) => ({ ...u, focusedSessionId: null }));
			}
		} catch (e) {
			toasts.error('Delete failed', String(e));
		}
	}

	async function duplicate(s: SessionState) {
		try {
			await startSession(s.projectId, s.profileId);
			toasts.success(`Duplicated ${s.title}`);
		} catch (e) {
			toasts.error('Duplicate failed', String(e));
		}
	}

	function copyAsCli(s: SessionState) {
		const p = $profiles.find(x => x.id === s.profileId);
		if (!p) { toasts.error('Profile not found'); return; }
		const env = p.env.map(e => `${e.key}=${shellQuote(e.value)}`).join(' ');
		const flags = p.params.map(x => x.value !== null ? `${x.flag}=${shellQuote(x.value)}` : x.flag).join(' ');
		const bin = p.agent_type === 'claude_code' ? 'claude' : p.agent_type === 'codex' ? 'codex' : 'opencode';
		const cmd = `cd ${shellQuote(s.cwd)} && ${env} ${bin} ${flags}`.replace(/\s+/g, ' ').trim();
		navigator.clipboard.writeText(cmd);
		toasts.success('Copied CLI command');
	}

	function statusColor(s: SessionState): string {
		if (s.status === 'failed') return 'text-accent-error';
		if (s.status === 'finished') return 'text-muted-foreground';
		if (s.activity === 'awaiting_input') return 'text-accent-error';
		if (s.activity === 'working') return 'text-accent-ok';
		return 'text-accent-warn';
	}

	function statusDot(s: SessionState): string {
		if (s.status === 'failed') return 'bg-accent-error';
		if (s.status === 'finished') return 'bg-muted-foreground';
		if (s.activity === 'awaiting_input') return 'bg-accent-error';
		if (s.activity === 'working') return 'bg-accent-ok';
		return 'bg-accent-warn';
	}

	function statusLabel(s: SessionState): string {
		if (s.status === 'queued') return 'Queued';
		if (s.status === 'running') return s.activity ? s.activity.replace('_', ' ') : 'running';
		if (s.status === 'failed') return 'Failed';
		if (s.status === 'finished') return 'Finished';
		return s.status;
	}

	async function startRename(s: SessionState) {
		renameValue = s.title;
		renaming = true;
	}

	async function commitRename(id: string) {
		if (!renameValue.trim()) {
			renaming = false;
			return;
		}
		try {
			await sendCmd({ cmd: 'rename_session', session_id: id, title: renameValue.trim() });
		} catch (e) {
			toasts.error('Rename failed', String(e));
		}
		renaming = false;
	}

	async function openCwd(path: string) {
		try {
			const { openPath } = await import('@tauri-apps/plugin-opener');
			await openPath(path);
		} catch (e) {
			toasts.error('Open failed', String(e));
		}
	}
</script>

<aside data-tour="inspector" class="flex flex-col h-full w-full overflow-y-auto text-sm bg-background">
	{#if !session}
		<div class="flex items-center justify-center h-full text-muted-foreground text-xs px-4 text-center">
			Select a session to inspect details.
		</div>
	{:else}
		<!-- Header -->
		<div class="px-4 pt-4 pb-3 border-b border-border space-y-2">
			<div class="flex items-center gap-2">
				<span class={cn('w-2 h-2 rounded-full', statusDot(session))}></span>
				{#if renaming}
					<input
						bind:value={renameValue}
						bind:this={renameEl}
						class="flex-1 bg-input border border-border rounded px-2 py-0.5 text-sm font-medium"
						onkeydown={(e) => e.key === 'Enter' && commitRename(session!.id)}
						onblur={() => commitRename(session!.id)}
					/>
				{:else}
					<button
						class="flex-1 text-left font-medium truncate hover:text-gruvbox-yellow"
						onclick={() => startRename(session!)}
					>
						{session.title}
					</button>
				{/if}
			</div>
			<div class={cn('text-xs', statusColor(session))}>
				{statusLabel(session)}
			</div>

			<div class="flex gap-1.5 pt-1">
				<button
					title="Rename (F2)"
					class="flex-1 flex items-center justify-center gap-1 p-1.5 rounded bg-secondary hover:bg-secondary/80 text-xs focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none"
					onclick={() => startRename(session!)}
				>
					<Pencil size={12} /> Rename
				</button>
				<button
					title="Duplicate (same profile + cwd)"
					class="flex-1 flex items-center justify-center gap-1 p-1.5 rounded bg-secondary hover:bg-secondary/80 text-xs focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none"
					onclick={() => duplicate(session!)}
				>
					<Copy size={12} /> Duplicate
				</button>
				{#if session.status === 'running' || session.status === 'queued'}
					<button
						title="Kill session"
						class="flex-1 flex items-center justify-center p-1.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/80 focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none"
						onclick={() => doKill(session!)}
					>
						<Square size={14} fill="currentColor" />
					</button>
				{/if}
				{#if session.status === 'finished' || session.status === 'failed'}
					{@const canResume = session.agent === 'claude_code' || !!session.agent_session_id}
					<button
						class="flex-1 flex items-center justify-center p-1.5 rounded bg-secondary hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-secondary focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none"
						disabled={!canResume}
						title={canResume
							? 'Resume session'
							: `Session này không capture được id — không resume được`}
						onclick={() => canResume && resumeSession(session!.id)}
					>
						<RotateCcw size={14} />
					</button>
				{/if}
				<button
					title="Copy as CLI command"
					class="flex-1 flex items-center justify-center gap-1 p-1.5 rounded bg-secondary hover:bg-secondary/80 text-xs focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none"
					onclick={() => copyAsCli(session!)}
				>
					<Terminal size={12} /> CLI
				</button>
				<button
					title="Delete session permanently"
					class="flex items-center justify-center p-1.5 rounded bg-secondary hover:bg-destructive hover:text-destructive-foreground transition-colors focus-visible:ring-1 focus-visible:ring-gruvbox-yellow focus-visible:outline-none"
					onclick={() => (confirmTarget = session!)}
				>
					<Trash size={14} />
				</button>
			</div>
		</div>

		<!-- Sections -->
		<section class="px-4 py-3 border-b border-border space-y-2">
			<h3 class="text-[10px] uppercase tracking-wider text-muted-foreground">General</h3>
			{@render row('Agent', session.agent)}
			{@render row('Status', session.status)}
			{#if session.activity}
				{@render row('Activity', session.activity)}
			{/if}
			<div>
				<div class="flex items-center justify-between mb-1">
					<span class="text-[10px] uppercase tracking-wider text-muted-foreground">Session ID</span>
					<button
						class="p-0.5 text-muted-foreground hover:text-foreground"
						onclick={() => copy(session!.id)}
						title="Copy ID"
					>
						<Copy size={10} />
					</button>
				</div>
				<div class="font-mono text-[10px] break-all text-muted-foreground select-all">
					{session.id}
				</div>
			</div>
			{#if session.agent_session_id}
				<div>
					<div class="flex items-center justify-between mb-1">
						<span class="text-[10px] uppercase tracking-wider text-muted-foreground">Agent ID</span>
						<button
							class="p-0.5 text-muted-foreground hover:text-foreground"
							onclick={() => copy(session!.agent_session_id!)}
							title="Copy Agent ID"
						>
							<Copy size={10} />
						</button>
					</div>
					<div class="font-mono text-[10px] break-all text-muted-foreground select-all">
						{session.agent_session_id}
					</div>
				</div>
			{/if}
			{#if session.agent_session_name}
				{@render row('Agent name', session.agent_session_name)}
			{/if}
			<div>
				<div class="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Working dir</div>
				<div class="flex items-center gap-1">
					<button
						class="flex-1 font-mono text-xs break-all text-left hover:text-gruvbox-yellow inline-flex items-start gap-1.5"
						onclick={() => openCwd(session!.cwd)}
						title="Open in file manager"
					>
						<FolderOpen size={11} class="mt-0.5 text-muted-foreground flex-shrink-0" />
						<span>{session.cwd}</span>
					</button>
					<button
						class="p-1 text-muted-foreground hover:text-foreground"
						onclick={() => copy(session!.cwd)}
						title="Copy path"
					>
						<Copy size={11} />
					</button>
				</div>
			</div>
			{@render row('Unread', String(session.unread), session.unread === 0)}
		</section>

		{#if session.failReason}
			<section class="px-4 py-3 border-b border-border space-y-2">
				<h3 class="text-[10px] uppercase tracking-wider text-muted-foreground">Fail reason</h3>
				<pre class="text-xs text-gruvbox-red bg-card rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{session.failReason}</pre>
			</section>
		{/if}
	{/if}
</aside>

<ConfirmDialog
	open={confirmTarget !== null}
	title="Delete session"
	message={confirmTarget
		? (confirmTarget.status === 'running' ||
			confirmTarget.status === 'starting' ||
			confirmTarget.status === 'queued'
			? `"${confirmTarget.title}" is still active. Kill and delete it?\nThis cannot be undone.`
			: `Delete "${confirmTarget.title}"?\nThis cannot be undone.`)
		: ''}
	confirmLabel="Delete"
	destructive
	onConfirm={() => {
		const t = confirmTarget;
		confirmTarget = null;
		if (t) performDelete(t);
	}}
	onCancel={() => (confirmTarget = null)}
/>

{#snippet row(label: string, value: string, muted: boolean = false)}
	<div class="flex items-baseline justify-between gap-2">
		<span class="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
		<span class={cn('text-xs', muted && 'text-muted-foreground')}>{value}</span>
	</div>
{/snippet}
