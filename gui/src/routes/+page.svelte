<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import ActivityBar from '$lib/components/ActivityBar.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import SessionSidebar from '$lib/components/SessionSidebar.svelte';
	import TerminalView from '$lib/components/TerminalView.svelte';
	import Inspector from '$lib/components/Inspector.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import SetupWizard from '$lib/components/SetupWizard.svelte';
	import SplitPane from '$lib/components/SplitPane.svelte';
	import ProfilesView from '$lib/views/ProfilesView.svelte';
	import OverviewView from '$lib/views/OverviewView.svelte';
	import SettingsView from '$lib/views/SettingsView.svelte';
	import { projects, addProject } from '$lib/stores/projects';
	import { sessions, upsertSession, updateSession, markSessionEnding } from '$lib/stores/sessions';
	import { profiles } from '$lib/stores/profiles';
	import { settings } from '$lib/stores/settings';
	import {
		ui,
		togglePalette,
		closePalette,
		openWizard,
		closeWizard,
		setView
	} from '$lib/stores/ui';
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
		sendCmd,
		onProjectCreated,
		onSessionStarted,
		onAgentOutput,
		onSessionActivity,
		onSessionFinished,
		onSessionFailed,
		onDaemonConnected,
		onBootstrapError
	} from '$lib/ipc';
	import { bindKeys } from '$lib/utils/keybindings';
	import type { UnlistenFn } from '@tauri-apps/api/event';

	let termRef: TerminalView | undefined = $state();
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
						failReason: null
					});
				}
			}

			if (projs.length === 0) {
				openWizard();
			} else if (!$ui.activeProjectId) {
				ui.update((u) => ({ ...u, activeProjectId: projs[0].id }));
			}
		} catch (e) {
			console.error('bootstrap rpc failed:', e);
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
					failReason: null
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
				if (e.session_id !== $ui.focusedSessionId) {
					updateSession(e.session_id, { unread: ($sessions.get(e.session_id)?.unread ?? 0) + 1 });
					return;
				}
				termRef?.write(b64decode(e.data_b64));
			})
		);
		unlisteners.push(
			await onSessionActivity((e) => {
				const cur = $sessions.get(e.session_id);
				// Ignore late activity ticks for a session the user already
				// killed — flipping `activity` would resurrect "working" /
				// "awaiting_input" labels on a row that should stay in Past.
				if (cur && (cur.status === 'finished' || cur.status === 'failed')) {
					return;
				}
				const patch: Partial<typeof cur> = { activity: e.state };
				if (cur && cur.status === 'starting') patch.status = 'running';
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
			const entries = await readBuffer(id, 0, 4096);
			for (const e of entries) termRef?.write(b64decode(e.data_b64));
		} catch (e) {
			console.error('focus failed:', e);
		}
	}

	async function handleInput(data: string) {
		const sid = $ui.focusedSessionId;
		if (!sid) return;
		captureFirstPrompt(sid, data);
		try {
			await sendInput(sid, data);
		} catch (e) {
			console.error('send_input failed:', e);
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
				handler: () => openWizard()
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
					else if ($ui.wizardOpen) closeWizard();
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

<div class="flex h-screen bg-background text-foreground overflow-hidden">
	<ActivityBar />

	<div class="flex flex-col flex-1 min-w-0">
		<TopBar {connected} />

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
								<div class="h-full w-full overflow-hidden bg-[#282828]">
									<TerminalView
										bind:this={termRef}
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
						<div class="h-full w-full flex items-center justify-center bg-[#282828]">
							{#if activeProject}
								<div class="flex flex-col items-center text-muted-foreground text-sm gap-3">
									<div>No session focused.</div>
									<button
										class="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
										onclick={() => openWizard()}
									>
										Start a session
									</button>
								</div>
							{:else}
								<div class="text-muted-foreground text-sm">
									Pick a project from the top bar.
								</div>
							{/if}
						</div>
					{/if}
						</div>
					{/snippet}
				</SplitPane>
			{:else if $ui.view === 'overview'}
				<div class="flex-1 overflow-hidden">
					<OverviewView />
				</div>
			{:else if $ui.view === 'profiles'}
				<div class="flex-1 overflow-hidden">
					<ProfilesView />
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
<SetupWizard />
