use serde::{Deserialize, Serialize};

pub const WIRE_VERSION: u32 = 1;

// ── Envelope ──────────────────────────────────────────────────────────────────

/// Top-level message discriminator
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Message {
    Cmd(CmdEnvelope),
    Event(Event),
    Resp(RespEnvelope),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CmdEnvelope {
    pub v: u32,
    pub id: String,
    #[serde(flatten)]
    pub cmd: Cmd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RespEnvelope {
    pub v: u32,
    pub id: String,
    #[serde(flatten)]
    pub resp: Resp,
}

// ── Commands (Client → Daemon) ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Cmd {
    // Projects
    CreateProject(CreateProjectCmd),
    ListProjects,
    RemoveProject(RemoveProjectCmd),

    // Profiles
    CreateProfile(CreateProfileCmd),
    UpdateProfile(UpdateProfileCmd),
    DeleteProfile(DeleteProfileCmd),
    ListProfiles,

    // Sessions
    StartSession(StartSessionCmd),
    ResumeSession(ResumeSessionCmd),
    KillSession(KillSessionCmd),
    DeleteSession(DeleteSessionCmd),
    SendInput(SendInputCmd),
    Resize(ResizeCmd),
    RenameSession(RenameSessionCmd),
    Focus(FocusCmd),
    ReadBuffer(ReadBufferCmd),
    ListSessions(ListSessionsCmd),

    // Settings
    GetSettings,
    SetDefaultProfile(SetDefaultProfileCmd),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectCmd {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveProjectCmd {
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProfileCmd {
    pub name: String,
    pub agent_type: AgentType,
    #[serde(default)]
    pub params: Vec<ParamEntry>,
    #[serde(default)]
    pub env: Vec<EnvEntry>,
    pub start_script: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProfileCmd {
    pub profile_id: String,
    pub name: Option<String>,
    pub agent_type: Option<AgentType>,
    pub params: Option<Vec<ParamEntry>>,
    pub env: Option<Vec<EnvEntry>>,
    pub start_script: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteProfileCmd {
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartSessionCmd {
    pub project_id: String,
    pub profile_id: String,
    pub cwd: Option<String>,
    pub initial_input: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeSessionCmd {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KillSessionCmd {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteSessionCmd {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendInputCmd {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizeCmd {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameSessionCmd {
    pub session_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusCmd {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadBufferCmd {
    pub session_id: String,
    pub from_seq: u64,
    pub n: u32,
    /// If set, return the last `tail` chunks in the ring buffer and ignore
    /// from_seq/n. Used by the GUI to reconstruct current TUI state after
    /// reconnect or session switch — head-of-ring would be stale history.
    #[serde(default)]
    pub tail: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListSessionsCmd {
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetDefaultProfileCmd {
    pub profile_id: String,
}

// ── Events (Daemon → Client, push) ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    ProjectCreated(ProjectCreatedEvent),
    SessionStarted(SessionStartedEvent),
    AgentOutput(AgentOutputEvent),
    SessionActivity(SessionActivityEvent),
    SessionFinished(SessionFinishedEvent),
    SessionFailed(SessionFailedEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectCreatedEvent {
    pub v: u32,
    pub project_id: String,
    pub name: String,
    pub path: String,
    pub ts: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStartedEvent {
    pub v: u32,
    pub session_id: String,
    pub project_id: String,
    pub agent: String,
    pub title: String,
    pub cwd: String,
    pub pid: Option<u32>,
    pub status: SessionStatus,
    pub ts: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentOutputEvent {
    pub v: u32,
    pub session_id: String,
    pub seq: u64,
    pub data_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionActivityEvent {
    pub v: u32,
    pub session_id: String,
    pub state: ActivityState,
    pub unread_seq: u64,
    pub ts: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionFinishedEvent {
    pub v: u32,
    pub session_id: String,
    pub exit_code: i32,
    pub ts: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionFailedEvent {
    pub v: u32,
    pub session_id: String,
    pub reason: String,
    pub exit_code: i32,
    pub ts: String,
}

// ── Responses (Daemon → Client, RPC) ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Resp {
    Ok(OkResp),
    Err(ErrResp),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkResp {
    pub ok: bool,
    #[serde(flatten)]
    pub data: RespData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrResp {
    pub ok: bool,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RespData {
    StartSession(StartSessionResp),
    ListSessions(ListSessionsResp),
    ReadBuffer(ReadBufferResp),
    ListProjects(ListProjectsResp),
    ListProfiles(ListProfilesResp),
    GetSettings(GetSettingsResp),
    Empty(EmptyResp),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmptyResp {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartSessionResp {
    pub session_id: String,
    pub status: SessionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListSessionsResp {
    pub sessions: Vec<SessionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadBufferResp {
    pub entries: Vec<BufferEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListProjectsResp {
    pub projects: Vec<ProjectInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListProfilesResp {
    pub profiles: Vec<ProfileInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetSettingsResp {
    pub default_profile_id: Option<String>,
    pub max_concurrent_sessions: u32,
    pub idle_threshold_s: u32,
    pub awaiting_threshold_s: u32,
    pub ring_buffer_bytes: u64,
}

// ── Shared data types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    ClaudeCode,
    OpenCode,
    Codex,
}

impl AgentType {
    pub fn binary(&self) -> &'static str {
        match self {
            AgentType::ClaudeCode => "claude",
            AgentType::OpenCode => "opencode",
            AgentType::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Queued,
    Starting,
    Running,
    Finished,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityState {
    Working,
    Idle,
    AwaitingInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParamEntry {
    pub flag: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub agent: String,
    pub status: SessionStatus,
    pub activity: Option<ActivityState>,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BufferEntry {
    pub seq: u64,
    pub data_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileInfo {
    pub id: String,
    pub name: String,
    pub agent_type: AgentType,
    pub params: Vec<ParamEntry>,
    pub env: Vec<EnvEntry>,
    pub start_script: Option<String>,
}

// ── Codec: JSON-line encode/decode ────────────────────────────────────────────

pub fn encode(msg: &Message) -> anyhow::Result<String> {
    let mut s = serde_json::to_string(msg)?;
    s.push('\n');
    Ok(s)
}

pub fn decode(line: &str) -> anyhow::Result<Message> {
    Ok(serde_json::from_str(line.trim())?)
}
