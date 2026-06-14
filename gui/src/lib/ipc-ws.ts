/**
 * WebSocket transport — same API surface as ipc.ts but talks to the daemon
 * over ws://<host>:20200/ws instead of Tauri invoke (Unix socket).
 *
 * Used by the mobile (Android) build. Desktop continues to use ipc.ts.
 *
 * Wire protocol: JSON text frames, same schema as the Unix socket:
 *   Cmd:   { kind:"cmd",  v:1, id:"w1", cmd:"list_sessions", ...params }
 *   Resp:  { kind:"resp", v:1, id:"w1", ok:true,  ...data }
 *   Event: { kind:"event", v:1, event:"session_started", ... }
 */

import type {
	AgentOutputEvent,
	AgentSessionCapturedEvent,
	ProjectCreatedEvent,
	SessionActivityEvent,
	SessionFailedEvent,
	SessionFinishedEvent,
	SessionStartedEvent,
	ProjectInfo,
	ProfileInfo,
	SessionInfo,
	RemoteStatus,
} from '$lib/types';

const WIRE_V = 1;
const LS_HOST = 'agentry:remote_host'; // e.g. "100.x.x.x:20200"

// ── Connection state ──────────────────────────────────────────────────────────

export type WsConnState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface WsState {
	state: WsConnState;
	host: string | null;
	error: string | null;
}

let ws: WebSocket | null = null;
let seq = 0;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();

// Reactive state (simple pub/sub — no Svelte dep)
let connState: WsState = { state: 'disconnected', host: null, error: null };
const connListeners = new Set<(s: WsState) => void>();

function setConnState(patch: Partial<WsState>) {
	connState = { ...connState, ...patch };
	connListeners.forEach(fn => fn(connState));
}

export function onConnStateChange(fn: (s: WsState) => void): () => void {
	connListeners.add(fn);
	fn(connState); // immediate call
	return () => connListeners.delete(fn);
}

export function getConnState(): WsState {
	return connState;
}

export function getSavedHost(): string | null {
	try { return localStorage.getItem(LS_HOST); } catch { return null; }
}

// ── Connect / disconnect ──────────────────────────────────────────────────────

export function connect(host: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (ws) { ws.close(); ws = null; }

		const url = `ws://${host}/ws`;
		setConnState({ state: 'connecting', host, error: null });

		const socket = new WebSocket(url);
		ws = socket;

		const timeout = setTimeout(() => {
			socket.close();
			const err = 'Connection timed out';
			setConnState({ state: 'error', error: err });
			reject(new Error(err));
		}, 8000);

		socket.onopen = () => {
			clearTimeout(timeout);
			localStorage.setItem(LS_HOST, host);
			setConnState({ state: 'connected', host, error: null });
			resolve();
		};

		socket.onclose = () => {
			clearTimeout(timeout);
			pending.forEach(p => p.reject(new Error('ws_closed')));
			pending.clear();
			if (connState.state === 'connected') {
				setConnState({ state: 'disconnected', error: 'Connection closed' });
			}
			ws = null;
		};

		socket.onerror = () => {
			clearTimeout(timeout);
			const err = `Cannot reach ${host}`;
			setConnState({ state: 'error', error: err });
			reject(new Error(err));
		};

		socket.onmessage = (e) => {
			let msg: Record<string, unknown>;
			try { msg = JSON.parse(e.data); } catch { return; }

			if (msg.kind === 'resp') {
				const id = msg.id as string;
				const p = pending.get(id);
				if (p) {
					pending.delete(id);
					msg.ok ? p.resolve(msg) : p.reject(new Error((msg.error as string) ?? 'rpc_error'));
				}
			} else if (msg.kind === 'event') {
				const evName = msg.event as string;
				const listeners = eventListeners.get(evName);
				if (listeners) listeners.forEach(fn => fn(msg));
				// also fire wildcard listeners (used by +page.svelte event bus)
				const wildcard = eventListeners.get('*');
				if (wildcard) wildcard.forEach(fn => fn(msg));
			}
		};
	});
}

export function disconnect() {
	ws?.close();
	ws = null;
}

// ── Low-level RPC ─────────────────────────────────────────────────────────────

interface RespOk { ok: true; [key: string]: unknown }
interface RespErr { ok: false; error: string }
type Resp = RespOk | RespErr;

function rpc(cmd: object): Promise<RespOk> {
	return new Promise((resolve, reject) => {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			reject(new Error('not_connected')); return;
		}
		const id = 'w' + (++seq);
		pending.set(id, {
			resolve: (v) => resolve(v as RespOk),
			reject,
		});
		ws.send(JSON.stringify({ kind: 'cmd', v: WIRE_V, id, ...cmd }));
	});
}

export function sendCmd(cmd: object): Promise<unknown> {
	return rpc(cmd);
}

// ── Event subscription (mirrors Tauri listen() API) ───────────────────────────

type UnlistenFn = () => void;

function listenWs<T>(eventName: string, cb: (payload: T) => void): Promise<UnlistenFn> {
	if (!eventListeners.has(eventName)) eventListeners.set(eventName, new Set());
	const handler = (msg: unknown) => {
		const m = msg as Record<string, unknown>;
		// daemon events: { kind:"event", event:"session_started", ...payload }
		// strip kind/v/event keys → pass rest as payload
		const { kind: _k, v: _v, event: _e, ...payload } = m;
		cb(payload as T);
	};
	eventListeners.get(eventName)!.add(handler);
	return Promise.resolve(() => eventListeners.get(eventName)?.delete(handler));
}

// Focus session (needed for agent_output filtering on daemon side)
export function focusSession(sessionId: string): Promise<void> {
	return rpc({ cmd: 'focus_session', session_id: sessionId }).then(() => {});
}

// ── Typed command wrappers (same signature as ipc.ts) ─────────────────────────

export async function listProjects(): Promise<ProjectInfo[]> {
	const r = await rpc({ cmd: 'list_projects' });
	return (r.projects as ProjectInfo[]) ?? [];
}

export async function listProfiles(): Promise<ProfileInfo[]> {
	const r = await rpc({ cmd: 'list_profiles' });
	return (r.profiles as ProfileInfo[]) ?? [];
}

export async function listSessions(projectId: string): Promise<SessionInfo[]> {
	const r = await rpc({ cmd: 'list_sessions', project_id: projectId });
	return (r.sessions as SessionInfo[]) ?? [];
}

export async function getSettings(): Promise<RespOk> {
	return rpc({ cmd: 'get_settings' });
}

export async function createProject(name: string, path: string): Promise<void> {
	await rpc({ cmd: 'create_project', name, path });
}

export async function getRemoteStatus(): Promise<RemoteStatus> {
	const r = await rpc({ cmd: 'get_remote_status' }) as Record<string, unknown>;
	return {
		listening: (r.listening as boolean) ?? false,
		address: (r.address as string) ?? null,
		error: (r.error as string) ?? null,
	};
}

export async function removeProject(projectId: string): Promise<void> {
	await rpc({ cmd: 'remove_project', project_id: projectId });
}

export async function startSession(
	projectId: string,
	profileId: string,
	cwd?: string,
	initialInput?: string,
	cols?: number,
	rows?: number,
): Promise<{ session_id: string; status: string }> {
	const r = await rpc({
		cmd: 'start_session',
		project_id: projectId,
		profile_id: profileId,
		cwd: cwd ?? null,
		initial_input: initialInput ?? null,
		cols: cols ?? null,
		rows: rows ?? null,
	});
	return r as { ok: true; session_id: string; status: string };
}

export async function killSession(sessionId: string): Promise<void> {
	await rpc({ cmd: 'kill_session', session_id: sessionId });
}

export async function killSessionOptimistic(
	sessionId: string,
	store: { update: (id: string, patch: object) => void }
): Promise<void> {
	store.update(sessionId, { status: 'finished', activity: null });
	try {
		await killSession(sessionId);
	} catch (e) {
		store.update(sessionId, { status: 'failed', failReason: `kill failed: ${e}` });
		throw e;
	}
}

export async function resumeSession(
	sessionId: string,
	cols?: number,
	rows?: number,
): Promise<{ session_id: string; status: string }> {
	const r = await rpc({
		cmd: 'resume_session',
		session_id: sessionId,
		cols: cols ?? null,
		rows: rows ?? null,
	});
	return r as { ok: true; session_id: string; status: string };
}

export async function sendInput(sessionId: string, data: string): Promise<void> {
	await rpc({ cmd: 'send_input', session_id: sessionId, data });
}

export async function resize(sessionId: string, cols: number, rows: number): Promise<void> {
	await rpc({ cmd: 'resize', session_id: sessionId, cols, rows });
}

export async function readBuffer(sessionId: string, fromSeq = 0, n = 1024, tail?: number) {
	const r = await rpc({
		cmd: 'read_buffer',
		session_id: sessionId,
		from_seq: fromSeq,
		n,
		tail: tail ?? null,
	});
	return (r.entries as { seq: number; data_b64: string }[]) ?? [];
}

// ── Event listeners (same API as ipc.ts) ─────────────────────────────────────

export function onProjectCreated(cb: (e: ProjectCreatedEvent) => void): Promise<UnlistenFn> {
	return listenWs('project_created', cb);
}

export function onSessionStarted(cb: (e: SessionStartedEvent) => void): Promise<UnlistenFn> {
	return listenWs('session_started', cb);
}

export function onAgentOutput(cb: (e: AgentOutputEvent) => void): Promise<UnlistenFn> {
	return listenWs('agent_output', cb);
}

export function onSessionActivity(cb: (e: SessionActivityEvent) => void): Promise<UnlistenFn> {
	return listenWs('session_activity', cb);
}

export function onSessionFinished(cb: (e: SessionFinishedEvent) => void): Promise<UnlistenFn> {
	return listenWs('session_finished', cb);
}

export function onSessionFailed(cb: (e: SessionFailedEvent) => void): Promise<UnlistenFn> {
	return listenWs('session_failed', cb);
}

export function onDaemonConnected(cb: (e: { sock_path: string }) => void): Promise<UnlistenFn> {
	// Not applicable on mobile — simulate connected immediately
	cb({ sock_path: 'ws' });
	return Promise.resolve(() => {});
}

export function onBootstrapError(_cb: (msg: string) => void): Promise<UnlistenFn> {
	return Promise.resolve(() => {});
}

export function onAgentSessionCaptured(cb: (e: AgentSessionCapturedEvent) => void): Promise<UnlistenFn> {
	return listenWs('agent_session_captured', cb);
}

export function waitForSessionStart(sessionId: string, timeoutMs = 3000): Promise<{ ok: boolean; ms: number; error?: string }> {
	const start = Date.now();
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve({ ok: false, ms: Date.now() - start, error: 'timeout' }), timeoutMs);
		const unsub = listenWs<SessionStartedEvent>('session_started', (e) => {
			if (e.session_id === sessionId) {
				clearTimeout(timer);
				unsub.then(f => f());
				resolve({ ok: true, ms: Date.now() - start });
			}
		});
	});
}

// r9 not available on mobile
export async function r9Status() { throw new Error('not_available'); }
export async function r9Start() { throw new Error('not_available'); }
export async function r9Stop() { throw new Error('not_available'); }
export async function r9OpenDashboard() { throw new Error('not_available'); }
