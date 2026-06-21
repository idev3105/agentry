import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentOutputEvent,
  AgentSessionCapturedEvent,
  ProjectCreatedEvent,
  SessionActivityEvent,
  SessionFailedEvent,
  SessionFinishedEvent,
  SessionStartedEvent,
  FileTrackedEvent,
  TrackedFileInfo,
  SessionEventInfo,
  SessionEventLoggedEvent,
  ProjectInfo,
  ProfileInfo,
  IntegrationStatus,
  R9StatusResp,
  RemoteStatus,
  SessionInfo,
  DirEntry,
  FileContent,
} from "$lib/types";

// ── Low-level cmd plumbing ────────────────────────────────────────────────────

interface RespOk {
  ok: true;
  [key: string]: unknown;
}
interface RespErr {
  ok: false;
  error: string;
}
type Resp = RespOk | RespErr;

async function rpc(cmd: object): Promise<RespOk> {
  const r = (await invoke("send_cmd", { cmd })) as Resp;
  if (!r.ok) throw new Error(r.error);
  return r;
}

export function sendCmd(cmd: object): Promise<unknown> {
  return invoke("send_cmd", { cmd });
}

export function focusSession(sessionId: string): Promise<void> {
  return invoke("focus_session", { sessionId });
}

// ── Typed command wrappers ────────────────────────────────────────────────────

export async function listProjects(): Promise<ProjectInfo[]> {
  const r = await rpc({ cmd: "list_projects" });
  return (r.projects as ProjectInfo[]) ?? [];
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  const r = await rpc({ cmd: "list_profiles" });
  return (r.profiles as ProfileInfo[]) ?? [];
}

export async function listSessions(projectId: string): Promise<SessionInfo[]> {
  const r = await rpc({ cmd: "list_sessions", project_id: projectId });
  return (r.sessions as SessionInfo[]) ?? [];
}

export async function listTrackedFiles(
  sessionId: string,
): Promise<TrackedFileInfo[]> {
  const r = await rpc({ cmd: "list_tracked_files", session_id: sessionId });
  return (r.files as TrackedFileInfo[]) ?? [];
}

export async function listSessionEvents(
  sessionId: string,
): Promise<SessionEventInfo[]> {
  const r = await rpc({ cmd: "list_session_events", session_id: sessionId });
  return (r.events as SessionEventInfo[]) ?? [];
}

export async function getSettings(): Promise<RespOk> {
  return rpc({ cmd: "get_settings" });
}

export async function createProject(name: string, path: string): Promise<void> {
  await rpc({ cmd: "create_project", name, path });
}

export async function getRemoteStatus(): Promise<RemoteStatus> {
  const r = (await rpc({ cmd: "get_remote_status" })) as Record<
    string,
    unknown
  >;
  return {
    listening: (r.listening as boolean) ?? false,
    address: (r.address as string) ?? null,
    error: (r.error as string) ?? null,
    enabled: (r.enabled as boolean) ?? true,
  };
}

export async function setRemoteEnabled(enabled: boolean): Promise<void> {
  await rpc({ cmd: "set_remote_enabled", enabled });
}

export async function removeProject(projectId: string): Promise<void> {
  await rpc({ cmd: "remove_project", project_id: projectId });
}

export async function checkIntegrations(): Promise<IntegrationStatus[]> {
  const r = await rpc({ cmd: "check_integrations" });
  return (r.integrations as IntegrationStatus[]) ?? [];
}

export async function installIntegration(
  agent: string,
): Promise<IntegrationStatus> {
  const r = await rpc({ cmd: "install_integration", agent });
  return r.integration as IntegrationStatus;
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
    cmd: "start_session",
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
  await rpc({ cmd: "kill_session", session_id: sessionId });
}

/**
 * Kill the session AND immediately mark it as finishing in the local store
 * so the UI doesn't lag while the daemon tears down the PTY (1–2s).
 * The real `session_finished`/`session_failed` event from the daemon will
 * arrive shortly after and overwrite this with the authoritative status.
 */
export async function killSessionOptimistic(
  sessionId: string,
  store: { update: (id: string, patch: object) => void },
): Promise<void> {
  store.update(sessionId, {
    status: "finished",
    activity: null,
  });
  try {
    await killSession(sessionId);
  } catch (e) {
    // rollback: mark as failed so the user knows it didn't go through
    store.update(sessionId, {
      status: "failed",
      failReason: `kill failed: ${e}`,
    });
    throw e;
  }
}

export async function resumeSession(
  sessionId: string,
  cols?: number,
  rows?: number,
): Promise<{ session_id: string; status: string }> {
  const r = await rpc({
    cmd: "resume_session",
    session_id: sessionId,
    cols: cols ?? null,
    rows: rows ?? null,
  });
  return r as { ok: true; session_id: string; status: string };
}

export async function sendInput(
  sessionId: string,
  data: string,
): Promise<void> {
  await rpc({ cmd: "send_input", session_id: sessionId, data });
}

export async function resize(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  await rpc({ cmd: "resize", session_id: sessionId, cols, rows });
}

export async function readBuffer(
  sessionId: string,
  fromSeq = 0,
  n = 1024,
  tail?: number,
) {
  const r = await rpc({
    cmd: "read_buffer",
    session_id: sessionId,
    from_seq: fromSeq,
    n,
    tail: tail ?? null,
  });
  return (r.entries as { seq: number; data_b64: string }[]) ?? [];
}

// ── Filesystem (read-only explorer/viewer) ───────────────────────────────

export async function listDir(path: string): Promise<DirEntry[]> {
  const r = await rpc({ cmd: "list_dir", path });
  return (r.entries as DirEntry[]) ?? [];
}

export async function readFile(
  path: string,
  maxBytes?: number,
): Promise<FileContent> {
  const r = await rpc({ cmd: "read_file", path, max_bytes: maxBytes ?? null });
  return r.file as FileContent;
}

export async function r9Status(): Promise<R9StatusResp> {
  const r = (await invoke("r9_status")) as R9StatusResp;
  if (typeof r !== "object") throw new Error("invalid response");
  return r;
}

export async function r9Start(): Promise<R9StatusResp> {
  const r = (await invoke("r9_start")) as R9StatusResp;
  if (!r.running) throw new Error("start failed");
  return r;
}

export async function r9Stop(): Promise<R9StatusResp> {
  const r = (await invoke("r9_stop")) as R9StatusResp;
  return r;
}

export async function r9OpenDashboard(): Promise<void> {
  await invoke("r9_open_dashboard");
}

// ── System fonts ─────────────────────────────────────────────────────────

/**
 * List font families installed on the host. Tauri-only; returns [] when the
 * command is unavailable (e.g. remote/WS browser mode) so callers degrade to
 * the built-in presets.
 */
export async function listSystemFonts(): Promise<string[]> {
  try {
    const r = (await invoke("list_system_fonts")) as string[];
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

// ── Event listeners ────────────────────────────────────────────────────────

export function waitForSessionStart(
  sessionId: string,
  timeoutMs = 3000,
): Promise<{ ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, ms: Date.now() - start, error: "timeout" }),
      timeoutMs,
    );
    const unsubStarted = listen(
      "daemon:session_started",
      (ev: { payload: { session_id: string } }) => {
        if (ev.payload.session_id === sessionId) {
          clearTimeout(timer);
          unsubStarted.then((f) => f());
          unsubFailed.then((f) => f());
          resolve({ ok: true, ms: Date.now() - start });
        }
      },
    );
    const unsubFailed = listen(
      "daemon:session_failed",
      (ev: { payload: { session_id: string; reason?: string } }) => {
        if (ev.payload.session_id === sessionId) {
          clearTimeout(timer);
          unsubStarted.then((f) => f());
          unsubFailed.then((f) => f());
          resolve({
            ok: false,
            ms: Date.now() - start,
            error: ev.payload.reason ?? "session failed",
          });
        }
      },
    );
  });
}

// ── Event listeners ───────────────────────────────────────────────────────────

export function onProjectCreated(
  cb: (e: ProjectCreatedEvent) => void,
): Promise<UnlistenFn> {
  return listen<ProjectCreatedEvent>("daemon:project_created", (ev) =>
    cb(ev.payload),
  );
}

export function onSessionStarted(
  cb: (e: SessionStartedEvent) => void,
): Promise<UnlistenFn> {
  return listen<SessionStartedEvent>("daemon:session_started", (ev) =>
    cb(ev.payload),
  );
}

export function onAgentOutput(
  cb: (e: AgentOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<AgentOutputEvent>("daemon:agent_output", (ev) =>
    cb(ev.payload),
  );
}

export function onSessionActivity(
  cb: (e: SessionActivityEvent) => void,
): Promise<UnlistenFn> {
  return listen<SessionActivityEvent>("daemon:session_activity", (ev) =>
    cb(ev.payload),
  );
}

export function onSessionFinished(
  cb: (e: SessionFinishedEvent) => void,
): Promise<UnlistenFn> {
  return listen<SessionFinishedEvent>("daemon:session_finished", (ev) =>
    cb(ev.payload),
  );
}

export function onSessionFailed(
  cb: (e: SessionFailedEvent) => void,
): Promise<UnlistenFn> {
  return listen<SessionFailedEvent>("daemon:session_failed", (ev) =>
    cb(ev.payload),
  );
}

export function onDaemonConnected(
  cb: (e: { sock_path: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ sock_path: string }>("daemon:connected", (ev) =>
    cb(ev.payload),
  );
}

export function onBootstrapError(
  cb: (msg: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("daemon:bootstrap_error", (ev) => cb(ev.payload));
}

export function onAgentSessionCaptured(
  cb: (e: AgentSessionCapturedEvent) => void,
): Promise<UnlistenFn> {
  return listen<AgentSessionCapturedEvent>(
    "daemon:agent_session_captured",
    (ev) => cb(ev.payload),
  );
}

export function onFileTracked(
  cb: (e: FileTrackedEvent) => void,
): Promise<UnlistenFn> {
  return listen<FileTrackedEvent>("daemon:file_tracked", (ev) =>
    cb(ev.payload),
  );
}

export function onSessionEventLogged(
  cb: (e: SessionEventLoggedEvent) => void,
): Promise<UnlistenFn> {
  return listen<SessionEventLoggedEvent>("daemon:session_event_logged", (ev) =>
    cb(ev.payload),
  );
}
