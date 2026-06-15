#!/bin/sh
# Agentry integration hook for Codex CLI.
# AGENTRY_INTEGRATION_ID=codex
# AGENTRY_INTEGRATION_VERSION=1
#
# Codex hooks: set CODEX_HOOK=path/to/script in env, or configure via
# ~/.config/codex/config.toml [hooks] section.
# Script is called with action as first arg; payload via stdin.

set -eu

action="${1:-}"
[ "$action" = "session" ] || exit 0

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

# Activity state
state = None
if event_name in ("task_start", "tool_call", "working"):
    state = "working"
elif event_name in ("approval_request", "awaiting_input"):
    state = "blocked"
elif event_name in ("task_complete", "idle", "stop"):
    state = "idle"

if state:
    send("pane.report_agent", {"state": state})
PY
