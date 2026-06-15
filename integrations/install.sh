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
  dest="$HOME_DIR/.config/codex/hooks"
  mkdir -p "$dest"
  cp "$SCRIPT_DIR/codex/agentry-hook.sh" "$dest/agentry-hook.sh"
  chmod +x "$dest/agentry-hook.sh"
  echo "codex hook copied -> $dest/agentry-hook.sh"
  echo "Wire it via ~/.config/codex/config.toml [hooks] or CODEX_HOOK env."
}

case "${1:-all}" in
  claude)   install_claude ;;
  opencode) install_opencode ;;
  codex)    install_codex ;;
  all)      install_claude; install_opencode; install_codex ;;
  *) echo "usage: $0 [claude|opencode|codex|all]"; exit 1 ;;
esac
