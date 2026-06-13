// Mirror của wire protocol types từ crates/wire/src/lib.rs

export type AgentType = 'claude_code' | 'open_code' | 'codex';
export type SessionStatus = 'queued' | 'starting' | 'running' | 'finished' | 'failed';
export type ActivityState = 'working' | 'idle' | 'awaiting_input';

export interface ParamEntry {
	flag: string;
	value: string | null;
}

export interface EnvEntry {
	key: string;
	value: string;
}

export interface ProjectInfo {
	id: string;
	name: string;
	path: string;
}

export interface ProfileInfo {
	id: string;
	name: string;
	agent_type: AgentType;
	params: ParamEntry[];
	env: EnvEntry[];
	start_script: string | null;
}

export interface SessionInfo {
	id: string;
	title: string;
	agent: string;
	status: SessionStatus;
	activity: ActivityState | null;
	cwd: string;
	agent_session_id: string | null;
	agent_session_name: string | null;
}

export interface BufferEntry {
	seq: number;
	data_b64: string;
}

// ── Store shapes ──────────────────────────────────────────────────────────────

export interface ProjectState extends ProjectInfo {
	sessions: string[]; // session IDs
}

export interface SessionState {
	id: string;
	projectId: string;
	profileId: string;
	agent: string;
	title: string;
	cwd: string;
	status: SessionStatus;
	activity: ActivityState | null;
	unread: number;
	/** Monotonic seq counter from session_activity.unread_seq; used to
	 *  derive unread badge deltas when this session is not focused. */
	lastSeenSeq: number;
	failReason: string | null;
	agent_session_id: string | null;
	agent_session_name: string | null;
	/** Exit code from session_finished/session_failed events */
	exitCode?: number | null;
	/** ISO timestamp when session was started (from session_started event) */
	createdAt?: string | null;
}

export interface R9StatusResp {
	resolved: string;
	running: boolean;
	pid: number | null;
	port: number;
}

export interface RemoteStatus {
	listening: boolean;
	address: string | null;
	error: string | null;
}

export interface Settings {
	defaultProfileId: string | null;
	maxConcurrentSessions: number;
	idleThresholdS: number;
	awaitingThresholdS: number;
	ringBufferBytes: number;
}

// ── Wire events (from daemon via Tauri) ───────────────────────────────────────

export interface ProjectCreatedEvent {
	project_id: string;
	name: string;
	path: string;
	ts: string;
}

export interface SessionStartedEvent {
	session_id: string;
	project_id: string;
	agent: string;
	title: string;
	cwd: string;
	pid: number | null;
	status: SessionStatus;
	ts: string;
	agent_session_id: string | null;
	agent_session_name: string | null;
}

export interface AgentSessionCapturedEvent {
    v: number;
    session_id: string;
    agent_session_id: string;
    agent_session_name?: string | null;
    ts: string;
}

export interface AgentOutputEvent {
	session_id: string;
	seq: number;
	data_b64: string;
}

export interface SessionActivityEvent {
	session_id: string;
	state: ActivityState;
	unread_seq: number;
	ts: string;
}

export interface SessionFinishedEvent {
	session_id: string;
	exit_code: number;
	ts: string;
}

export interface SessionFailedEvent {
	session_id: string;
	reason: string;
	exit_code: number;
	ts: string;
}
