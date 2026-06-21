#!/bin/sh
# Agentry integration hook for Claude Code.
# Installed manually or via `agentry integration install claude`.
#
# Wire it into ~/.claude/settings.json hooks (SessionStart / Stop / Notification)
# so Claude invokes:  agentry-hook.sh session   (stdin = hook JSON payload)
#
# AGENTRY_INTEGRATION_ID=claude
# AGENTRY_INTEGRATION_VERSION=2

set -eu

action="${1:-}"
[ "$action" = "session" ] || exit 0

[ "${AGENTRY_ENV:-}" = "1" ] || exit 0
[ -n "${AGENTRY_SOCKET_PATH:-}" ] || exit 0
[ -n "${AGENTRY_PANE_ID:-}" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

hook_input_file="$(mktemp "${TMPDIR:-/tmp}/agentry-claude-hook.XXXXXX")" || exit 0
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

# SubagentStop is a completion event that can fire after the main turn already
# stopped — never let it revive an idle pane.
event_name = str(hook.get("hook_event_name") or "")
if event_name == "SubagentStop":
    raise SystemExit(0)


import re, shlex

# Bash/Shell tools carry the command instead of a file_path. Parse the command
# for write targets so `cat > file`, `tee file`, redirects, PowerShell
# Set-Content, etc. still surface as touched files.
_REDIR = re.compile(r"""(?:^|[\s;&|(])\d*>{1,2}\s*('[^']*'|"[^"]*"|[^\s;&|>)]+)""")
# unix: command that takes its destination as the last/known arg
_UNIX_LAST_ARG = {"tee", "truncate", "touch", "install", "unlink"}
# unix: command whose destination is the final positional arg
_UNIX_DEST_FINAL = {"cp", "mv", "ln"}
# unix: dd of=FILE, sed -i ... FILE handled specially
# powershell / cmd cmdlets whose -Path/-FilePath (or last arg) is a write target
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

    # 1) Shell/PowerShell/cmd redirects: > file / >> file / 2> file
    for m in _REDIR.finditer(cmd):
        add(m.group(1))

    # 2) Tokenise per simple statement (split on ; && || |) and inspect verbs.
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

        # unix: dd of=FILE
        if verb == "dd":
            for t in rest:
                if t.lower().startswith("of="):
                    add(t[3:])
            continue
        # unix: sed -i ... LASTFILE (in-place edit)
        if verb == "sed" and any(t == "-i" or t.startswith("-i") for t in rest):
            if non_flag:
                add(non_flag[-1])
            continue
        # unix: tee [-a] FILE...  (every non-flag arg is written)
        if verb == "tee":
            for t in non_flag:
                add(t)
            continue
        if verb in _UNIX_LAST_ARG and non_flag:
            add(non_flag[-1])
            continue
        # unix: cp/mv/ln SRC... DST  (last positional is the destination)
        if verb in _UNIX_DEST_FINAL and len(non_flag) >= 2:
            add(non_flag[-1])
            continue
        # cmd.exe: copy/move/ren SRC DST  (last positional is destination)
        if verb in _CMD_DEST_FINAL and len(non_flag) >= 2:
            add(non_flag[-1])
            continue
        # PowerShell write cmdlets: -Path/-FilePath VALUE, else last positional
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


def send(method, extra):
    params = {
        "pane_id": pane_id,
        "source": "agentry:claude",
        "agent": "claude",
        "seq": time.time_ns(),
    }
    params.update(extra)
    req = {
        "id": f"agentry:claude:{int(time.time() * 1000)}:{random.randrange(1_000_000):06d}",
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


# 1) Always report the session id when present (SessionStart, etc.).
session_id = hook.get("session_id")
if isinstance(session_id, str) and session_id:
    extra = {"agent_session_id": session_id}
    transcript = hook.get("transcript_path")
    if isinstance(transcript, str) and transcript:
        extra["agent_session_path"] = transcript
    send("pane.report_agent_session", extra)

# 2) Map the hook event to an activity state.
#    SessionStart / UserPromptSubmit / PreToolUse / PostToolUse -> working
#    Notification (permission/await)                            -> blocked
#    Stop                                                        -> idle
# 1b) Report any file path a tool touched (daemon keeps only "plan" names).
tool_input = hook.get("tool_input")
tool_name = hook.get("tool_name")
file_path = None
if isinstance(tool_input, dict):
    file_path = tool_input.get("file_path") or tool_input.get("path")
    if isinstance(file_path, str) and file_path:
        extra = {"path": file_path}
        if isinstance(tool_name, str) and tool_name:
            extra["tool"] = tool_name
        send("pane.report_file", extra)
    else:
        # Bash/Shell tools: parse the command for write targets.
        cmd = tool_input.get("command")
        bash_paths = extract_write_paths(cmd)
        if bash_paths:
            file_path = bash_paths[0]
        for p in bash_paths:
            extra = {"path": p}
            if isinstance(tool_name, str) and tool_name:
                extra["tool"] = tool_name
            send("pane.report_file", extra)

# 1c) Log every hook event (with a short detail) for the timeline.
if event_name:
    detail = None
    if isinstance(tool_name, str) and tool_name:
        detail = tool_name
        if isinstance(file_path, str) and file_path:
            detail = f"{tool_name} {file_path}"
    extra = {"name": event_name}
    if detail:
        extra["detail"] = detail
    send("pane.report_event", extra)

state = None
if event_name in ("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"):
    state = "working"
elif event_name == "Notification":
    state = "blocked"
elif event_name == "Stop":
    state = "idle"

if state:
    send("pane.report_agent", {"state": state})
PY
