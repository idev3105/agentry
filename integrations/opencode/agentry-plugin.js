// Agentry integration plugin for OpenCode.
// AGENTRY_INTEGRATION_ID=opencode
// AGENTRY_INTEGRATION_VERSION=1
//
// Install: place this file in ~/.config/opencode/plugins/ (or wherever OpenCode
// loads plugins — check `opencode --help` or OPENCODE_PLUGIN_DIR env var).
// OpenCode will auto-import it as an ES module plugin.

import net from "node:net";

const SOURCE = "agentry:opencode";
const AGENT = "opencode";
let reportSeq = Date.now() * 1000;

function nextSeq() {
  return ++reportSeq;
}

// session.{created,updated,deleted} carry the session under `properties.info`
// (id + title); session.{status,idle,error,compacted} carry a flat
// `properties.sessionID`. Read both shapes so capture works on every event.
function sessionIDFromProperties(properties) {
  const flat = properties?.sessionID;
  if (typeof flat === "string" && flat) return flat;
  const infoId = properties?.info?.id;
  if (typeof infoId === "string" && infoId) return infoId;
  return undefined;
}

function sessionNameFromProperties(properties) {
  const title = properties?.info?.title;
  return typeof title === "string" && title ? title : undefined;
}

function stateFromStatus(status) {
  if (typeof status !== "string") return undefined;
  switch (status.toLowerCase()) {
    case "idle":
      return "idle";
    case "active":
    case "busy":
    case "pending":
    case "running":
    case "streaming":
    case "working":
      return "working";
    default:
      return undefined;
  }
}

function send(method, params) {
  const paneId = process.env.AGENTRY_PANE_ID;
  const socketPath = process.env.AGENTRY_SOCKET_PATH;
  if (!paneId || !socketPath) return Promise.resolve();

  const req = {
    id: `${SOURCE}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, "0")}`,
    method,
    params: {
      pane_id: paneId,
      source: SOURCE,
      agent: AGENT,
      seq: nextSeq(),
      ...params,
    },
  };

  return new Promise((resolve) => {
    const client = net.createConnection(socketPath, () => {
      client.write(`${JSON.stringify(req)}\n`);
    });
    const finish = () => { client.destroy(); resolve(); };
    client.setTimeout(500, finish);
    client.on("data", finish);
    client.on("error", finish);
    client.on("end", finish);
    client.on("close", resolve);
  });
}

const reportSession = (sessionID, sessionName) =>
  sessionID
    ? send("pane.report_agent_session", {
        agent_session_id: sessionID,
        ...(sessionName ? { agent_session_name: sessionName } : {}),
      })
    : Promise.resolve();

const reportState = (state, sessionID) => {
  const extra = sessionID ? { agent_session_id: sessionID } : {};
  return send("pane.report_agent", { state, ...extra });
};

const releaseAgent = () => send("pane.release_agent", {});

export const AgentryAgentStatePlugin = async () => {
  if (
    process.env.AGENTRY_ENV !== "1" ||
    !process.env.AGENTRY_SOCKET_PATH ||
    !process.env.AGENTRY_PANE_ID
  ) {
    return {};
  }

  return {
    "chat.message": async ({ sessionID }) => {
      await reportState("working", sessionID);
    },
    event: async ({ event }) => {
      const type = event?.type;
      const props = event?.properties ?? {};
      const sessionID = sessionIDFromProperties(props);
      const sessionName = sessionNameFromProperties(props);

      switch (type) {
        case "session.created":
        case "session.updated":
          await reportSession(sessionID, sessionName);
          break;
        case "session.status": {
          const state = stateFromStatus(props.status);
          if (state) {
            await reportState(state, sessionID);
          } else {
            await reportSession(sessionID, sessionName);
          }
          break;
        }
        case "tool.execute.before":
        case "tool.execute.after":
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
        case "session.compacted":
          await reportState("working", sessionID);
          break;
        case "permission.asked":
        case "question.asked":
        case "session.error":
          await reportState("blocked", sessionID);
          break;
        case "session.idle":
          await reportState("idle", sessionID);
          break;
        case "session.deleted":
          await releaseAgent();
          break;
        default:
          break;
      }
    },
  };
};
