#!/bin/sh
# Agentry integration hook for Claude Code.
# Installed manually or via `agentry integration install claude`.
#
# Wire it into ~/.claude/settings.json hooks (SessionStart / Stop / Notification)
# so Claude invokes:  agentry-hook.sh session   (stdin = hook JSON payload)
#
# AGENTRY_INTEGRATION_ID=claude
# AGENTRY_INTEGRATION_VERSION=1

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

