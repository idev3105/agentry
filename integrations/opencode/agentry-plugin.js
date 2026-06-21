// Agentry integration plugin for OpenCode.
// AGENTRY_INTEGRATION_ID=opencode
// AGENTRY_INTEGRATION_VERSION=2
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
    const finish = () => {
      client.destroy();
      resolve();
    };
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

// Pull a file path out of a tool-execute event payload. OpenCode nests the
// tool arguments under a few possible keys depending on version.
function filePathFromProps(props) {
  const candidates = [
    props?.args,
    props?.input,
    props?.tool_input,
    props?.arguments,
    props,
  ];
  for (const c of candidates) {
    if (c && typeof c === "object") {
      const fp = c.file_path ?? c.path ?? c.filename;
      if (typeof fp === "string" && fp) return fp;
    }
  }
  return undefined;
}

// Pull a shell command out of a tool-execute event payload (Bash/Shell tools
// carry `command` instead of a file path).
function commandFromProps(props) {
  const candidates = [
    props?.args,
    props?.input,
    props?.tool_input,
    props?.arguments,
    props,
  ];
  for (const c of candidates) {
    if (c && typeof c === "object") {
      const cmd = c.command ?? c.cmd;
      if (typeof cmd === "string" && cmd) return cmd;
    }
  }
  return undefined;
}

const _REDIR = /(?:^|[\s;&|(])\d*>{1,2}\s*('[^']*'|"[^"]*"|[^\s;&|>)]+)/g;
const _UNIX_LAST_ARG = new Set([
  "tee",
  "truncate",
  "touch",
  "install",
  "unlink",
]);
const _UNIX_DEST_FINAL = new Set(["cp", "mv", "ln"]);
const _PS_PATH_FLAGS = new Set([
  "-path",
  "-filepath",
  "-literalpath",
  "-destination",
]);
const _PS_WRITE_CMDS = new Set([
  "set-content",
  "add-content",
  "out-file",
  "new-item",
  "copy-item",
  "move-item",
  "sc",
  "ac",
]);
const _CMD_DEST_FINAL = new Set(["copy", "move", "ren", "rename", "type"]);

function cleanTok(tok) {
  const t = String(tok)
    .trim()
    .replace(/^['"]|['"]$/g, "");
  return t || undefined;
}

// Best-effort tokeniser respecting single/double quotes (no shell expansion).
function tokenize(stmt) {
  const out = [];
  const re = /'[^']*'|"[^"]*"|[^\s]+/g;
  let m;
  while ((m = re.exec(stmt)) !== null) out.push(m[0]);
  return out;
}

// Parse a shell/PowerShell/cmd command string for files it writes. Mirrors the
// Python extract_write_paths in the Claude/Codex hooks.
function extractWritePaths(cmd) {
  if (typeof cmd !== "string" || !cmd.trim()) return [];
  const paths = [];
  const add = (p) => {
    const c = cleanTok(p);
    if (c && !paths.includes(c)) paths.push(c);
  };

  let m;
  _REDIR.lastIndex = 0;
  while ((m = _REDIR.exec(cmd)) !== null) add(m[1]);

  for (const rawStmt of cmd.split(/&&|\|\||[;\n|]/)) {
    const stmt = rawStmt.trim();
    if (!stmt) continue;
    const toks = tokenize(stmt);
    if (!toks.length) continue;
    const verb = toks[0].split("/").pop().toLowerCase();
    const rest = toks.slice(1);
    const nonFlag = rest.filter((t) => !t.startsWith("-"));

    if (verb === "dd") {
      for (const t of rest)
        if (t.toLowerCase().startsWith("of=")) add(t.slice(3));
      continue;
    }
    if (verb === "sed" && rest.some((t) => t === "-i" || t.startsWith("-i"))) {
      if (nonFlag.length) add(nonFlag[nonFlag.length - 1]);
      continue;
    }
    if (verb === "tee") {
      for (const t of nonFlag) add(t);
      continue;
    }
    if (_UNIX_LAST_ARG.has(verb) && nonFlag.length) {
      add(nonFlag[nonFlag.length - 1]);
      continue;
    }
    if (_UNIX_DEST_FINAL.has(verb) && nonFlag.length >= 2) {
      add(nonFlag[nonFlag.length - 1]);
      continue;
    }
    if (_CMD_DEST_FINAL.has(verb) && nonFlag.length >= 2) {
      add(nonFlag[nonFlag.length - 1]);
      continue;
    }
    if (_PS_WRITE_CMDS.has(verb)) {
      let flagged = false;
      for (let i = 0; i < rest.length; i++) {
        if (_PS_PATH_FLAGS.has(rest[i].toLowerCase()) && i + 1 < rest.length) {
          add(rest[i + 1]);
          flagged = true;
        }
      }
      if (!flagged && nonFlag.length) add(nonFlag[nonFlag.length - 1]);
      continue;
    }
  }
  return paths;
}

const reportFile = (path, tool) =>
  path
    ? send("pane.report_file", { path, ...(tool ? { tool } : {}) })
    : Promise.resolve();

const reportEvent = (name, detail) =>
  name
    ? send("pane.report_event", { name, ...(detail ? { detail } : {}) })
    : Promise.resolve();

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

      // Log every event (with a short detail) for the timeline.
      if (type) {
        const fp = filePathFromProps(props);
        const tool = props?.tool ?? props?.tool_name ?? props?.name;
        let detail;
        if (typeof tool === "string" && tool)
          detail = fp ? `${tool} ${fp}` : tool;
        else if (fp) detail = fp;
        else if (typeof props?.status === "string") detail = props.status;
        await reportEvent(type, detail);
      }

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
        case "tool.execute.after": {
          const tool = props?.tool ?? props?.tool_name ?? props?.name;
          const fp = filePathFromProps(props);
          if (fp) {
            await reportFile(fp, tool);
          } else {
            // Bash/Shell tools: parse the command for write targets.
            for (const p of extractWritePaths(commandFromProps(props))) {
              await reportFile(p, tool);
            }
          }
          await reportState("working", sessionID);
          break;
        }
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
