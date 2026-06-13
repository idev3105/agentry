<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import ActivityBar from '$lib/components/ActivityBar.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import SessionSidebar from '$lib/components/SessionSidebar.svelte';
	import TerminalView from '$lib/components/TerminalView.svelte';
	import TerminalHeader from '$lib/components/TerminalHeader.svelte';
	import Inspector from '$lib/components/Inspector.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import Onboarding from '$lib/components/Onboarding.svelte';
import SplitPane from '$lib/components/SplitPane.svelte';
import SessionTabs from '$lib/components/SessionTabs.svelte';
import TerminalFindBar from '$lib/components/TerminalFindBar.svelte';
import ReconnectBanner from '$lib/components/ReconnectBanner.svelte';
import OnboardingTour from '$lib/components/OnboardingTour.svelte';
import { toasts } from '$lib/stores/toasts.svelte';
	import ProfilesView from '$lib/views/ProfilesView.svelte';
	import OverviewView from '$lib/views/OverviewView.svelte';
	import SettingsView from '$lib/views/SettingsView.svelte';
	import R9DashboardView from '$lib/views/R9DashboardView.svelte';
	import ProjectsView from '$lib/views/ProjectsView.svelte';
	import { projects, addProject } from '$lib/stores/projects';
	import Plus from '@lucide/svelte/icons/plus';
	import Command from '@lucide/svelte/icons/command';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import { sessions, upsertSession, updateSession, markSessionEnding } from '$lib/stores/sessions';
	import { profiles } from '$lib/stores/profiles';
	import { settings, density } from '$lib/stores/settings';
	import {
		ui,
		togglePalette,
		closePalette,
		openPalette,
		openOnboarding,
		closeOnboarding,
		setView
	} from '$lib/stores/ui';
	import { r9 } from '$lib/stores/r9.svelte';
	import {
		listProjects,
		listProfiles,
		listSessions,
		getSettings,
		sendInput,
		focusSession,
		readBuffer,
		killSession,
		startSession,
		resize,
		sendCmd,
		onProjectCreated,
		onSessionStarted,
		onAgentOutput,
		onSessionActivity,
		onSessionFinished,
		onSessionFailed,
		onAgentSessionCaptured,
		onDaemonConnected,
		onBootstrapError
	} from '$lib/ipc';
	import { bindKeys } from '$lib/utils/keybindings';
	import { fmtChord } from '$lib/utils/cn';
	import type { UnlistenFn } from '@tauri-apps/api/event';
import { listen } from '@tauri-apps/api/event';
	import type { SessionState } from '$lib/types';

	let termRef: TerminalView | undefined = $state();
	let termCtl = $state<{ findNext: (q: string) => void; findPrev: (q: string) => void } | null>(null);
	let findOpen = $state(false);
	// While we're replaying the ring buffer for a freshly-picked session,
	// queue live agent_output for that same session id and flush AFTER replay
	// completes. Without this, the live writer races readBuffer: bytes that
	// arrive between `focusSession` and `readBuffer` resolving get written
	// BEFORE the older buffered chunks, scrambling the TUI.
	let replayingSessionId: string | null = $state(null);
	const pendingChunks: Map<string, Uint8Array[]> = new Map();
	let connected = $state(false);
	let bootstrapError: string | null = $state(null);
	const unlisteners: UnlistenFn[] = [];

	function b64decode(s: string): Uint8Array {
		const bin = atob(s);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}

	async function bootstrap() {
		try {
			const s = (await getSettings()) as Record<string, unknown>;
			settings.set({
				defaultProfileId: (s.default_profile_id as string | null) ?? null,
				maxConcurrentSessions: (s.max_concurrent_sessions as number) ?? 8,
				idleThresholdS: (s.idle_threshold_s as number) ?? 10,
				awaitingThresholdS: (s.awaiting_threshold_s as number) ?? 30,
				ringBufferBytes: (s.ring_buffer_bytes as number) ?? 2_097_152
			});

			profiles.set(await listProfiles());

			const projs = await listProjects();
			for (const p of projs) {
				addProject({ ...p, sessions: [] });
				const sess = await listSessions(p.id);
				for (const ss of sess) {
				upsertSession({
					id: ss.id,
					projectId: p.id,
					profileId: '',
					agent: ss.agent,
					title: ss.title,
					cwd: ss.cwd,
					status: ss.status,
					activity: ss.activity,
					unread: 0,
					lastSeenSeq: 0,
					failReason: null,
					agent_session_id: ss.agent_session_id,
					agent_session_name: ss.agent_session_name,
				});
				}
			}

			const onboarded = localStorage.getItem('agentry:onboarded') === '1';
			if (projs.length === 0 && !onboarded) {
				openOnboarding();
			} else if (projs.length === 0) {
				// User onboarded once but deleted all projects — empty state handles it
			} else if (!$ui.activeProjectId) {
				ui.update((u) => ({ ...u, activeProjectId: projs[0].id }));
			}
		} catch (e) {
			console.error('bootstrap rpc failed:', e);
			toasts.error('Bootstrap failed', String(e));
			bootstrapError = String(e);
		}
	}

	async function bindListeners() {
		unlisteners.push(
			await onDaemonConnected(async () => {
				connected = true;
				bootstrapError = null;
				await bootstrap();
			})
		);
		unlisteners.push(
			await listen('daemon:disconnected', () => {
				connected = false;
			}) as unknown as UnlistenFn
		);
		unlisteners.push(
			await onBootstrapError((msg) => {
				bootstrapError = msg;
				connected = false;
			})
		);
		unlisteners.push(
			await onProjectCreated((e) => {
				addProject({ id: e.project_id, name: e.name, path: e.path, sessions: [] });
				if (!$ui.activeProjectId) ui.update((u) => ({ ...u, activeProjectId: e.project_id }));
			})
		);
		unlisteners.push(
			await onSessionStarted((e) => {
				upsertSession({
					id: e.session_id,
					projectId: e.project_id,
					profileId: '',
					agent: e.agent,
					title: e.title,
					cwd: e.cwd,
					status: e.status,
					activity: null,
					unread: 0,
					lastSeenSeq: 0,
					failReason: null,
					agent_session_id: e.agent_session_id,
					agent_session_name: e.agent_session_name,
				});
				// Resumed/already-titled sessions should NOT get auto-renamed by
				// the first prompt — only fresh "<agent> · #N" titles are subject
				// to auto-rename.
				if (!/^[a-z]+ · #\d+$/.test(e.title)) {
					renamed.add(e.session_id);
				}
				// Auto-focus newly started session if user hasn't explicitly
				// chosen one — OR if the just-started session IS the focused one
				// (resume case): re-pick so the terminal clears its stale
				// scrollback before the agent re-renders its history.
				if (!$ui.focusedSessionId || $ui.focusedSessionId === e.session_id) {
					pickSession(e.session_id);
				}
			})
		);
		unlisteners.push(
			await onAgentOutput((e) => {
				// First output → session is definitely running. But never flip
				// a session that's already finished/failed back to running:
				// after the user optimistically killed it, the daemon may emit
				// a few trailing bytes (SIGTERM exit message, shell prompt
				// redraw) before the actual session_finished event lands —
				// those should be discarded, not resurrect the session.
				const cur = $sessions.get(e.session_id);
				if (cur && (cur.status === 'starting' || cur.status === 'queued')) {
					updateSession(e.session_id, { status: 'running' });
				}
				if (cur && (cur.status === 'finished' || cur.status === 'failed')) {
					return;
				}
				// Daemon now filters agent_output per-connection by focused session
				// (server.rs writer task). The guard below is defense-in-depth in case
				// a Focus cmd is still in-flight when an event races in.
				if (e.session_id !== $ui.focusedSessionId) return;

				const bytes = b64decode(e.data_b64);
				if (replayingSessionId === e.session_id) {
					let q = pendingChunks.get(e.session_id);
					if (!q) { q = []; pendingChunks.set(e.session_id, q); }
					q.push(bytes);
					return;
				}
				termRef?.write(bytes);
			})
		);
		unlisteners.push(
			await onSessionActivity((e) => {
				const cur = $sessions.get(e.session_id);
				// Ignore late activity ticks for a session the user already killed —
				// flipping `activity` would resurrect "working" labels on a Past row.
				if (cur && (cur.status === 'finished' || cur.status === 'failed')) return;

				const patch: Partial<SessionState> = { activity: e.state };
				if (cur && cur.status === 'starting') patch.status = 'running';

				if (e.session_id === $ui.focusedSessionId) {
					// Focused: catch the seq up but don't accumulate unread.
					patch.unread = 0;
					patch.lastSeenSeq = e.unread_seq;
				} else if (cur) {
					// Non-focused: bump unread by the seq delta. Bounded so a long
					// backlog after reconnect doesn't render "9999+" badges.
					const prev = cur.lastSeenSeq ?? 0;
					const delta = Math.max(0, e.unread_seq - prev);
					if (delta > 0) {
						patch.unread = Math.min(999, cur.unread + delta);
						patch.lastSeenSeq = e.unread_seq;
					}
				}
				updateSession(e.session_id, patch);
			})
		);
		unlisteners.push(
			await onSessionFinished((e) => {
				const wasActive = isActive($sessions.get(e.session_id));
				updateSession(e.session_id, {
					status: 'finished',
					activity: null,
					failReason: e.exit_code === 0 ? null : `exit ${e.exit_code}`
				});
				// Only auto-close the terminal pane if the session was still
				// considered active right before the event — i.e. it just
				// terminated naturally. If the user already optimistically
				// killed it (status was already finished/failed) and is now
				// browsing past sessions, don't yank focus.
				if (wasActive) maybeUnfocus(e.session_id);
			})
		);
		unlisteners.push(
			await onSessionFailed((e) => {
				const wasActive = isActive($sessions.get(e.session_id));
				updateSession(e.session_id, {
					status: 'failed',
					activity: null,
					failReason: e.reason
				});
				if (wasActive) maybeUnfocus(e.session_id);
			})
		);
		unlisteners.push(
			await onAgentSessionCaptured((e) => {
				updateSession(e.session_id, {
					agent_session_id: e.agent_session_id,
					agent_session_name: e.agent_session_name ?? null,
				});
			})
		);
	}

	function isActive(s: import('$lib/types').SessionState | undefined): boolean {
		if (!s) return false;
		return s.status === 'running' || s.status === 'starting' || s.status === 'queued';
	}

	// When the focused session terminates, drop focus so the terminal pane closes.
	function maybeUnfocus(deadId: string) {
		if ($ui.focusedSessionId !== deadId) return;
		ui.update((u) => ({ ...u, focusedSessionId: null }));
		termRef?.clear();
	}

	async function pickSession(id: string) {
		// Clear synchronously BEFORE switching focus so the user never sees
		// stale content from the previous session flash through.
		termRef?.clear();
		ui.update((u) => ({ ...u, focusedSessionId: id, view: 'terminal' }));
		updateSession(id, { unread: 0 });

		// Arm the replay gate. Any agent_output that arrives between now and
		// the finally block gets queued instead of written.
		replayingSessionId = id;
		pendingChunks.set(id, []);

		try {
			await focusSession(id);
			const s = $sessions.get(id);
			// Past sessions: skip ring-buffer replay. The buffer often holds
			// kernel TTY echo from the agent's pre-raw-mode boot phase (OSC
			// color-query responses, etc.) that's pure noise, especially
			// when the agent was killed before its TUI took over. Show a
			// static placeholder instead. Active sessions still replay so
			// switching tabs stays seamless.
			if (s && (s.status === 'finished' || s.status === 'failed')) {
				const reason = s.failReason ? ` — ${s.failReason}` : '';
				const label = s.status === 'failed' ? 'failed' : 'ended';
				termRef?.write(
					new TextEncoder().encode(
						`\x1b[2m[Session ${label}${reason}]\x1b[0m\r\n`
					)
				);
				return;
			}
			// Push the current xterm viewport to the PTY BEFORE we ask for the
			// ring buffer. The PTY's pre-existing size may be 80x24 (initial spawn)
			// or a stale value from a previous focus on a different window. Without
			// this, the agent TUI re-renders into the wrong geometry and flickers
			// when ResizeObserver eventually catches up.
			const sz = await termRef?.ensureFit();
			if (sz) {
				try {
					await resize(id, sz.cols, sz.rows);
				} catch (err) {
					console.warn('pre-replay resize failed (non-fatal):', err);
				}
			}
			// Pull the LAST 4096 chunks from the ring buffer, not the first.
			// With from_seq=0 the daemon returns head-of-ring, which is the oldest
			// surviving history after eviction — not the current TUI state.
			const entries = await readBuffer(id, 0, 0, 4096);
			for (const e of entries) termRef?.write(b64decode(e.data_b64));
			// catch up lastSeenSeq so activity tick after switch
			// computes delta correctly (avoids spiking unread badge).
			if (entries.length > 0) {
				const lastSeq: number = entries[entries.length - 1].seq;
				updateSession(id, { lastSeenSeq: lastSeq });
			}
		} catch (e) {
			toasts.error('Focus failed', String(e));
		} finally {
			// Flush queued live chunks for the session we just picked.
			// Only flush if user hasn't switched away in the meantime —
			// otherwise we'd write bytes for the wrong session into termRef.
			const queued = pendingChunks.get(id) ?? [];
			if ($ui.focusedSessionId === id) {
				for (const chunk of queued) termRef?.write(chunk);
			}
			pendingChunks.delete(id);
			if (replayingSessionId === id) replayingSessionId = null;
		}
	}

	async function handleInput(data: string) {
		const sid = $ui.focusedSessionId;
		if (!sid) return;
		captureFirstPrompt(sid, data);
		try {
			await sendInput(sid, data);
		} catch (e) {
			toasts.error('Send input failed', String(e));
		}
	}

	// Per-session input accumulator to derive a title from the user's first prompt.
	// We accumulate raw bytes the user types until they press Enter; that line
	// becomes the new session title (truncated). After the first commit, the
	// session is removed from the map so it never gets renamed again.
	const promptBuffers = new Map<string, string>();
	const renamed = new Set<string>();

	function captureFirstPrompt(sid: string, data: string) {
		if (renamed.has(sid)) return;

		// Strip terminal escape sequences upfront. xterm.js ships focus events
		// (ESC[I, ESC[O), bracketed-paste markers (ESC[200~), OSC color queries
		// (ESC]10;...BEL), SGR mouse-tracking reports (ESC[<35;45;23M emitted
		// by opencode/codex), etc. on user interaction — without stripping,
		// their non-ESC bytes leak into the title buffer.
		const ESC = String.fromCharCode(27);
		const clean = data
			// CSI: ESC [ + optional private-param byte (<=>?) + params (0-9;:)
			//      + intermediates ( -/) + final byte (@-~)
			.replace(new RegExp(ESC + '\\[[<=>?]?[0-9;:]*[ -/]*[@-~]', 'g'), '')
			// OSC: ESC ] ... BEL or ESC \\
			.replace(new RegExp(ESC + '\\][^\\x07' + ESC + ']*(?:\\x07|' + ESC + '\\\\)', 'g'), '')
			// any other 2-byte ESC sequence
			.replace(new RegExp(ESC + '.', 'g'), '')
			// Normalize Vietnamese (and any other diacritic) input to NFC so a
			// single visible char is one code point. Some Linux IMEs emit NFD
			// (`a` + combining grave), which makes per-codepoint slice(-1)
			// remove only the diacritic instead of the whole letter on
			// backspace.
			.normalize('NFC');

		let buf = promptBuffers.get(sid) ?? '';
		for (const ch of clean) {
			const code = ch.codePointAt(0)!;
			if (code === 13 || code === 10) {
				const title = sanitizeTitle(buf);
				if (title) {
					renamed.add(sid);
					promptBuffers.delete(sid);
					sendCmd({ cmd: 'rename_session', session_id: sid, title }).catch(() => {});
					updateSession(sid, { title });
					return;
				}
				buf = '';
			} else if (code === 127 || code === 8) {
				// Drop the last code point — Array.from splits by code point,
				// so this handles surrogate pairs and (post-NFC) Vietnamese
				// chars correctly. Plain slice(-1) cuts by UTF-16 code unit
				// and would mangle them.
				const arr = Array.from(buf);
				arr.pop();
				buf = arr.join('');
			} else if (code < 32) {
				// drop remaining control chars (Tab, etc.)
			} else {
				buf += ch;
			}
		}
		promptBuffers.set(sid, buf);
	}

	async function quickStartDefault() {
		const projId = $ui.activeProjectId;
		if (!projId) {
			const onboarded = localStorage.getItem('agentry:onboarded') === '1';
			if (!onboarded) openOnboarding();
			else toasts.info('No project selected', 'Use the activity bar to create one.');
			return;
		}
		const def = $settings.defaultProfileId
			? $profiles.find(p => p.id === $settings.defaultProfileId)
			: $profiles[0];
		if (!def) { setView('profiles'); return; }
		await startSession(projId, def.id);
	}

	function sanitizeTitle(raw: string): string {
		const cleaned = raw.replace(/\s+/g, ' ').trim();
		if (!cleaned) return '';
		// Truncate by code point, not by UTF-16 unit, so multibyte chars
		// (emoji, rare CJK) don't get cut mid-pair.
		const arr = Array.from(cleaned);
		return arr.length > 48 ? arr.slice(0, 47).join('') + '…' : cleaned;
	}

	function activeSessionsForProject(): string[] {
		const p = $ui.activeProjectId;
		if (!p) return [];
		return Array.from($sessions.values())
			.filter((s) => s.projectId === p && (s.status === 'running' || s.status === 'queued'))
			.map((s) => s.id);
	}

	onMount(async () => {
		// Default primary sidebar width = 1/5 viewport (only used the very first
		// time the user opens the app — after that SplitPane reads from localStorage).
		sidebarDefault = Math.max(220, Math.round(window.innerWidth / 5));

		// Reset stale split widths from earlier builds (px/ratio schema mismatch
		// and an older 1/6-viewport default). Drop the old keys outright so the
		// new 1/5 default takes effect on first run.
		localStorage.removeItem('split:left');
		for (const k of ['split:left:v2', 'split:right']) {
			const raw = localStorage.getItem(k);
			if (!raw) continue;
			const n = parseFloat(raw);
			if (k === 'split:left:v2' && (!Number.isFinite(n) || n < 100 || n > 600)) {
				localStorage.removeItem(k);
			} else if (k === 'split:right' && (!Number.isFinite(n) || n <= 0 || n >= 1)) {
				localStorage.removeItem(k);
			}
		}

		await bindListeners();
		try {
			await bootstrap();
			connected = true;
		} catch {
			// connected flips on `daemon:connected`.
		}

		const unbind = bindKeys([
			{
				key: 'k',
				mod: true,
				handler: () => togglePalette()
			},
			{
				key: 't',
				mod: true,
				handler: () => openOnboarding()
			},
			{
				key: 'p',
				mod: true,
				handler: () => {
					// Cycle to next project tab.
					const list = Array.from($projects.values());
					if (list.length === 0) return;
					const i = list.findIndex((p) => p.id === $ui.activeProjectId);
					const next = list[(i + 1) % list.length];
					ui.update((u) => ({ ...u, activeProjectId: next.id }));
				}
			},
			{
				key: 'Escape',
				handler: () => {
					if ($ui.paletteOpen) closePalette();
					else if ($ui.onboardingOpen) closeOnboarding();
				}
			},
			{
				key: 'k',
				mod: true,
				shift: true,
				handler: () => {
					const sid = $ui.focusedSessionId;
					if (!sid) return;
					markSessionEnding(sid);
					killSession(sid).catch((err) => {
						markSessionEnding(sid, { failReason: `kill failed: ${err}` });
					});
				}
			},
			{
				key: 'f',
				mod: true,
				handler: () => findOpen = true
			},
			...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => ({
				key: digit,
				mod: true,
				handler: () => {
					const ids = activeSessionsForProject();
					const i = digit === '9' ? ids.length - 1 : parseInt(digit, 10) - 1;
					const id = ids[i];
					if (id) pickSession(id);
				}
			}))
		]);
		unlisteners.push(unbind as unknown as UnlistenFn);

		r9.startPolling();
	});

	onDestroy(() => {
		for (const fn of unlisteners) {
			try {
				(fn as unknown as () => void)();
			} catch {
				/* noop */
			}
		}
	});

	let activeProject = $derived($projects.get($ui.activeProjectId ?? ''));

	// Primary sidebar — default 1/5 viewport (user can drag to resize via SplitPane;
	// the chosen pixel value is persisted by SplitPane to localStorage["split:left"]).
	let sidebarDefault = $state(260);
</script>

<div class="flex h-screen bg-background text-foreground overflow-hidden" data-density={$density}>
	<ActivityBar />
	
	<div class="flex flex-col flex-1 min-w-0">
		<TopBar {connected} />
		<ReconnectBanner visible={!connected} />
	
		{#if bootstrapError}
			<div class="px-3 py-2 text-xs text-destructive-foreground bg-destructive">
				Daemon bootstrap failed: {bootstrapError}
			</div>
		{/if}

		<div class="flex flex-1 overflow-hidden">
			{#if $ui.view === 'terminal'}
				<SplitPane
					id="left:v2"
					mode="fixed"
					defaultLeft={sidebarDefault}
					minLeft={180}
					maxLeft={520}
				>
					{#snippet left()}
						<div class="h-full w-full border-r border-border overflow-hidden">
							{#if activeProject}
								<SessionSidebar projectId={activeProject.id} onSelect={pickSession} />
							{:else}
								<div class="p-4 text-xs text-muted-foreground">
									No project — press <kbd class="font-mono">⌘T</kbd> to start.
								</div>
							{/if}
						</div>
					{/snippet}
					{#snippet right()}
						<div class="h-full w-full overflow-hidden">
						{#if $ui.focusedSessionId}
						<SplitPane
							id="right"
							mode="ratio"
							defaultLeft={99999}
							minLeft={320}
							minRight={280}
							minLeftRatio={0.7}
							maxRightWindowRatio={0.3}
						>
							{#snippet left()}
								<div data-tour="terminal" class="h-full w-full overflow-hidden bg-background">
									<SessionTabs />
									<TerminalHeader />
									{#if findOpen}
									<TerminalFindBar
										ctl={termCtl}
										onClose={() => findOpen = false}
									/>
									{/if}
									<TerminalView
										bind:this={termRef}
										bind:ctl={termCtl}
										sessionId={$ui.focusedSessionId}
										onInput={handleInput}
									/>
								</div>
							{/snippet}
							{#snippet right()}
								<div class="h-full w-full border-l border-border overflow-hidden">
									<Inspector />
								</div>
							{/snippet}
						</SplitPane>
					{:else}
						<div class="flex flex-col items-center justify-center h-full gap-6 p-8 text-center">
							<div>
								<h2 class="text-base font-semibold">No session focused</h2>
								<p class="text-xs text-muted-foreground mt-1">Pick one from the sidebar, or:</p>
							</div>
							<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl">
								<button class="bg-card border border-border hover:border-gruvbox-yellow rounded-lg p-4 text-left transition-colors group"
										onclick={() => quickStartDefault()}>
									<Plus size={18} class="text-gruvbox-yellow mb-2" />
									<div class="text-sm font-medium">New session</div>
									<div class="text-[11px] text-muted-foreground mt-0.5">Start with default profile</div>
									<kbd class="mt-2 inline-block text-[10px] font-mono text-muted-foreground">{fmtChord(['mod','t'])}</kbd>
								</button>
								<button class="bg-card border border-border hover:border-gruvbox-yellow rounded-lg p-4 text-left transition-colors"
										onclick={() => openPalette()}>
									<Command size={18} class="text-gruvbox-aqua mb-2" />
									<div class="text-sm font-medium">Command palette</div>
									<div class="text-[11px] text-muted-foreground mt-0.5">Switch session, run actions</div>
									<kbd class="mt-2 inline-block text-[10px] font-mono text-muted-foreground">{fmtChord(['mod','k'])}</kbd>
								</button>
								<button class="bg-card border border-border hover:border-gruvbox-yellow rounded-lg p-4 text-left transition-colors"
										onclick={() => setView('overview')}>
									<LayoutGrid size={18} class="text-gruvbox-blue mb-2" />
									<div class="text-sm font-medium">Overview</div>
									<div class="text-[11px] text-muted-foreground mt-0.5">All projects & sessions</div>
								</button>
							</div>
						</div>
					{/if}
						</div>
					{/snippet}
				</SplitPane>
			{:else if $ui.view === 'overview'}
				<div class="flex-1 overflow-hidden">
					<OverviewView />
				</div>
			{:else if $ui.view === 'projects'}
				<div class="flex-1 overflow-hidden">
					<ProjectsView />
				</div>
			{:else if $ui.view === 'profiles'}
				<div class="flex-1 overflow-hidden">
					<ProfilesView />
				</div>
			{:else if $ui.view === 'r9'}
				<div class="flex-1 overflow-hidden">
					<R9DashboardView />
				</div>
			{:else if $ui.view === 'settings'}
				<div class="flex-1 overflow-hidden">
					<SettingsView />
				</div>
			{/if}
		</div>
	</div>
</div>

<CommandPalette onPickSession={pickSession} />
<Onboarding />
<OnboardingTour />
