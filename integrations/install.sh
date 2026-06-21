#!/bin/sh
# Install Agentry agent-state integrations into each agent's config dir.
# Usage: ./install.sh [claude|opencode|codex|all]
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${HOME:?HOME not set}"

install_claude() {
  dest="$HOME_DIR/.claude/hooks"
  mkdir -p "$dest"
  cp "$SCRIPT_DIR/claude/agentry-hook.sh" "$dest/agentry-hook.sh"
  chmod +x "$dest/agentry-hook.sh"
  echo "claude hook copied -> $dest/agentry-hook.sh"
  echo "Add to ~/.claude/settings.json hooks (SessionStart/Stop/Notification/PreToolUse/PostToolUse):"
  cat <<'JSON'
  {
    "hooks": {
      "SessionStart":   [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bash '~/.claude/hooks/agentry-hook.sh' session", "timeout": 10 }] }],
      "Stop":           [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bash '~/.claude/hooks/agentry-hook.sh' session", "timeout": 10 }] }],
      "Notification":   [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bash '~/.claude/hooks/agentry-hook.sh' session", "timeout": 10 }] }],
      "PreToolUse":     [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bash '~/.claude/hooks/agentry-hook.sh' session", "timeout": 10 }] }],
      "PostToolUse":    [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bash '~/.claude/hooks/agentry-hook.sh' session", "timeout": 10 }] }]
    }
  }
JSON
}

install_opencode() {
  dest="$HOME_DIR/.config/opencode/plugins"
  mkdir -p "$dest"
  cp "$SCRIPT_DIR/opencode/agentry-plugin.js" "$dest/agentry-plugin.js"
  echo "opencode plugin copied -> $dest/agentry-plugin.js"
}

install_codex() {
  # Codex uses ~/.codex (NOT ~/.config/codex) for hooks + config.
  dest="$HOME_DIR/.codex/hooks"
  mkdir -p "$dest"
  cp "$SCRIPT_DIR/codex/agentry-hook.sh" "$dest/agentry-hook.sh"
  chmod +x "$dest/agentry-hook.sh"
  echo "codex hook copied -> $dest/agentry-hook.sh"
  echo "Register agentry hooks in ~/.codex/hooks.json (Claude-style, PascalCase events):"
  cat <<'JSON'
  {
    "hooks": {
      "SessionStart": [{ "hooks": [{ "type": "command", "command": "bash '~/.codex/hooks/agentry-hook.sh' session", "timeout": 10 }] }],
      "Stop":         [{ "hooks": [{ "type": "command", "command": "bash '~/.codex/hooks/agentry-hook.sh' session", "timeout": 10 }] }],
      "Notification": [{ "hooks": [{ "type": "command", "command": "bash '~/.codex/hooks/agentry-hook.sh' session", "timeout": 10 }] }],
      "PreToolUse":   [{ "hooks": [{ "type": "command", "command": "bash '~/.codex/hooks/agentry-hook.sh' session", "timeout": 10 }] }],
      "PostToolUse":  [{ "hooks": [{ "type": "command", "command": "bash '~/.codex/hooks/agentry-hook.sh' session", "timeout": 10 }] }]
    }
  }
JSON
  echo "Then enable the feature in ~/.codex/config.toml:"
  echo "  [features]"
  echo "  hooks = true"
  echo "Codex prompts to trust each hook on first run; agentry launches Codex with"
  echo "--dangerously-bypass-hook-trust so no manual approval is needed."
}

install_hermes() {
  dest="$HOME_DIR/.hermes/agent-hooks"
  mkdir -p "$dest"
  cp "$SCRIPT_DIR/hermes/agentry-hook.sh" "$dest/agentry-hook.sh"
  chmod +x "$dest/agentry-hook.sh"
  echo "hermes hook copied -> $dest/agentry-hook.sh"
  echo "Merge into ~/.hermes/config.yaml under the existing 'hooks:' key:"
  cat <<'YAML'
  hooks:
    on_session_start:
      - command: "bash '~/.hermes/agent-hooks/agentry-hook.sh'"
    pre_tool_call:
      - command: "bash '~/.hermes/agent-hooks/agentry-hook.sh'"
    post_tool_call:
      - command: "bash '~/.hermes/agent-hooks/agentry-hook.sh'"
    on_session_end:
      - command: "bash '~/.hermes/agent-hooks/agentry-hook.sh'"
YAML
  echo "Hermes prompts for hook consent on first run; agentry launches it with"
  echo "--accept-hooks so no manual approval is needed."
}

case "${1:-all}" in
  claude)   install_claude ;;
  opencode) install_opencode ;;
  codex)    install_codex ;;
  hermes)   install_hermes ;;
  all)      install_claude; install_opencode; install_codex; install_hermes ;;
  *) echo "usage: $0 [claude|opencode|codex|hermes|all]"; exit 1 ;;
esac
