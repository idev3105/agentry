#!/bin/sh
# Agentry integration hook for Codex CLI.
# AGENTRY_INTEGRATION_ID=codex
# AGENTRY_INTEGRATION_VERSION=3
#
# Codex (>= 0.139) reads Claude-style lifecycle hooks from ~/.codex/hooks.json
# and runs each as `bash <this-script> session`. The real event is carried in
# the JSON payload on stdin (`hook_event_name`), NOT in argv, so we dispatch on
# the payload, not on the first arg. Registered events: SessionStart (session
# id), PreToolUse/PostToolUse (timeline + file paths), Stop/Notification
# (activity state).

set -eu

[ "${AGENTRY_ENV:-}" = "1" ] || exit 0
[ -n "${AGENTRY_SOCKET_PATH:-}" ] || exit 0
[ -n "${AGENTRY_PANE_ID:-}" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

hook_input_file="$(mktemp "${TMPDIR:-/tmp}/agentry-codex-hook.XXXXXX")" || exit 0
trap 'rm -f "$hook_input_file"' EXIT HUP INT TERM
cat >"$hook_input_file" 2>/dev/null || true

AGENTRY_HOOK_INPUT_FILE="$hook_input_file" python3 - <<'PY'
import json, os, random, socket, time

pane_id = os.environ.get("AGENTRY_PANE_ID")
socket_path = os.environ.get("AGENTRY_SOCKET_PATH")
hook_input_file = os.environ.get("AGENTRY_HOOK_INPUT_FILE")
if not pane_id or not socket_path:
    raise SystemExit(0)

hook = {}
if hook_input_file:
    try:
        with open(hook_input_file, encoding="utf-8") as f:
            content = f.read()
        if content.strip():
            hook = json.loads(content)
    except Exception:
        hook = {}

event_name = str(hook.get("type") or hook.get("hook_event_name") or "")

import re, shlex

# Bash/Shell tools carry the command instead of a file_path. Parse the command
# for write targets so `cat > file`, `tee file`, redirects, PowerShell
# Set-Content, etc. still surface as touched files.
_REDIR = re.compile(r"""(?:^|[\s;&|(])\d*>{1,2}\s*('[^']*'|"[^"]*"|[^\s;&|>)]+)""")
_UNIX_LAST_ARG = {"tee", "truncate", "touch", "install", "unlink"}
_UNIX_DEST_FINAL = {"cp", "mv", "ln"}
_PS_PATH_FLAGS = ("-path", "-filepath", "-literalpath", "-destination")
_PS_WRITE_CMDS = {
    "set-content", "add-content", "out-file", "new-item",
    "copy-item", "move-item", "sc", "ac",
}
_CMD_DEST_FINAL = {"copy", "move", "ren", "rename", "type"}


def _clean(tok):
    tok = tok.strip().strip("'\"")
    return tok or None


def extract_write_paths(cmd):
    if not isinstance(cmd, str) or not cmd.strip():
        return []
    paths = []

    def add(p):
        p = _clean(p) if isinstance(p, str) else None
        if p and p not in paths:
            paths.append(p)

    for m in _REDIR.finditer(cmd):
        add(m.group(1))

    for stmt in re.split(r"&&|\|\||[;\n|]", cmd):
        stmt = stmt.strip()
        if not stmt:
            continue
        try:
            toks = shlex.split(stmt, posix=True)
        except ValueError:
            toks = stmt.split()
        if not toks:
            continue
        verb = toks[0].rsplit("/", 1)[-1].lower()
        rest = toks[1:]
        non_flag = [t for t in rest if not t.startswith("-")]

        if verb == "dd":
            for t in rest:
                if t.lower().startswith("of="):
                    add(t[3:])
            continue
        if verb == "sed" and any(t == "-i" or t.startswith("-i") for t in rest):
            if non_flag:
                add(non_flag[-1])
            continue
        if verb == "tee":
            for t in non_flag:
                add(t)
            continue
        if verb in _UNIX_LAST_ARG and non_flag:
            add(non_flag[-1])
            continue
        if verb in _UNIX_DEST_FINAL and len(non_flag) >= 2:
            add(non_flag[-1])
            continue
        if verb in _CMD_DEST_FINAL and len(non_flag) >= 2:
            add(non_flag[-1])
            continue
        if verb in _PS_WRITE_CMDS:
            flagged = False
            for i, t in enumerate(rest):
                if t.lower() in _PS_PATH_FLAGS and i + 1 < len(rest):
                    add(rest[i + 1])
                    flagged = True
            if not flagged and non_flag:
                add(non_flag[-1])
            continue
    return paths


def extract_command(h):
    for key in ("command", "cmd"):
        v = h.get(key)
        if isinstance(v, str) and v:
            return v
    args = h.get("arguments") or h.get("args") or h.get("tool_input") or h.get("input")
    if isinstance(args, dict):
        for key in ("command", "cmd"):
            v = args.get(key)
            if isinstance(v, str) and v:
                return v
    return None


def send(method, extra):
    params = {
        "pane_id": pane_id,
        "source": "agentry:codex",
        "agent": "codex",
        "seq": time.time_ns(),
    }
    params.update(extra)
    req = {
        "id": f"agentry:codex:{int(time.time() * 1000)}:{random.randrange(1_000_000):06d}",
        "method": method,
        "params": params,
    }
    try:
        c = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        c.settimeout(0.5)
        c.connect(socket_path)
        c.sendall((json.dumps(req) + "\n").encode())
        try:
            c.recv(4096)
        except Exception:
            pass
        c.close()
    except Exception:
        pass


# Session id
session_id = hook.get("session_id") or hook.get("sessionId")
if isinstance(session_id, str) and session_id:
    send("pane.report_agent_session", {"agent_session_id": session_id})

# Report any file path a tool touched (daemon keeps only "plan" names).
def extract_path(h):
    for key in ("file_path", "path", "filename"):
        v = h.get(key)
        if isinstance(v, str) and v:
            return v
    args = h.get("arguments") or h.get("args") or h.get("tool_input") or h.get("input")
    if isinstance(args, dict):
        for key in ("file_path", "path", "filename"):
            v = args.get(key)
            if isinstance(v, str) and v:
                return v
    return None

file_path = extract_path(hook)
tool_name = hook.get("tool_name") or hook.get("tool") or hook.get("name")
if file_path:
    extra = {"path": file_path}
    if isinstance(tool_name, str) and tool_name:
        extra["tool"] = tool_name
    send("pane.report_file", extra)
else:
    # Bash/Shell tools: parse the command for write targets.
    bash_paths = extract_write_paths(extract_command(hook))
    if bash_paths:
        file_path = bash_paths[0]
    for p in bash_paths:
        extra = {"path": p}
        if isinstance(tool_name, str) and tool_name:
            extra["tool"] = tool_name
        send("pane.report_file", extra)

# Log every event (with a short detail) for the timeline.
if event_name:
    detail = None
    if isinstance(tool_name, str) and tool_name:
        detail = tool_name
        if isinstance(file_path, str) and file_path:
            detail = f"{tool_name} {file_path}"
    elif isinstance(file_path, str) and file_path:
        detail = file_path
    extra = {"name": event_name}
    if detail:
        extra["detail"] = detail
    send("pane.report_event", extra)

# Activity state. Codex emits PascalCase hook_event_name values (PreToolUse,
# PostToolUse, Stop, Notification, SessionStart); keep lowercase fallbacks too.
state = None
if event_name in ("PreToolUse", "PostToolUse", "task_start", "tool_call", "working"):
    state = "working"
elif event_name in ("Notification", "approval_request", "awaiting_input"):
    state = "blocked"
elif event_name in ("Stop", "task_complete", "idle", "stop"):
    state = "idle"

if state:
    send("pane.report_agent", {"state": state})
PY
