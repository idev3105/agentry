# Hermes agent integration plan

Adds a 4th agent type `hermes` alongside `claude_code`, `open_code`, `codex`.
Follows the existing per-agent pattern. Assumes Hermes ships a CLI binary
`hermes` and (ideally) a hooks/plugin mechanism for session-id + activity
reporting. Where Hermes lacks hooks, fall back to a post-spawn capture like
codex/opencode.

## Open questions (confirm before coding)
1. CLI binary name (`hermes`?) and its resume flag (`--resume <id>` / `resume <id>` / `-s <id>`?).
2. Does Hermes pre-generate session id (like claude `--session-id <uuid>`),
   or must we capture post-spawn (fs-watch like codex / list-diff like opencode)?
3. Does Hermes support hooks/plugins for activity + session reporting?
   Path + config format (settings.json merge / config.toml block / auto-loaded plugin dir)?
4. Brand SVG/icon + display label + accent color.

## Wire protocol — 4 files together (see AGENTS.md)
1. `crates/wire/src/lib.rs`
   - Add `AgentType::Hermes` variant (serde `hermes`).
   - `AgentType::binary()` → `"hermes"`.
2. `daemon/src/server.rs`
   - `BUILTIN_HERMES = "__default_hermes__"` + add to `is_builtin()`.
   - `builtin_meta()` map → `("Hermes", "hermes")`.
   - Add builtin profile JSON in the profiles list.
   - `agent_type_str()` → `AgentType::Hermes => "hermes"`.
   - `agent_display_name("hermes")` → `"hermes"`.
   - Resume display-name reverse map (`"hermes" => "hermes"`).
   - Resume agent_session_id capture guard: include `hermes` if it pre-captures.
3. `gui/src/lib/types.ts` — extend `AgentType` union with `'hermes'`.
4. `gui/src/lib/ipc.ts` — no new cmd unless a Hermes-specific call is added; verify.

No `WIRE_VERSION` bump (additive, non-breaking).

## Daemon spawn / capture (`daemon/src/session.rs`)
- `build_argv()`: add `"hermes" => "hermes"` binary map + resume-flag branch
  matching Hermes' actual resume syntax (Q1/Q2).
- If pre-generated id: mirror claude branch (push flag + uuid, set `captured`).
- If post-spawn capture: add a `hermes_capture.rs` (model on `codex_watch.rs`
  fs-watch or `opencode_capture.rs` list-diff) and wire it in the
  `_agent_type == "hermes"` post-spawn block.

## Agent hook integration
- `integrations/hermes/agentry-hook.sh` (or `.js` plugin) — copy codex hook as
  template; emits `pane.report_agent_session`, `pane.report_agent`,
  `pane.report_file`, `pane.report_event` over `AGENTRY_SOCKET_PATH` with
  `agent: "hermes"`. Map Hermes event names → working/blocked/idle states.
- `daemon/src/integrations.rs`:
  - `HERMES_SCRIPT = include_str!("../../integrations/hermes/...")`.
  - Add registry entry (agent, dest_rel, cli_binary, wired check, hint text).
  - `wire_hermes()` if Hermes needs config injection (else rely on auto-load).
- `integrations/install.sh` — add `install_hermes()` + case arm + `all`.
- `daemon/src/agent_hook_server.rs` — generic; verify it accepts `agent:"hermes"`
  (no per-agent allowlist expected, but confirm).

## Frontend surfaces
- `gui/src/lib/utils/agent.ts` — `META.hermes` (+ display alias) icon/label/color/brand.
- `gui/src/lib/utils/detect-agents.ts` — add `hermes` to `PROBES`, `ids`, and any label map.
- `gui/src/lib/assets/brands/hermes*.svg` — brand icon (Q4); else lucide fallback.
- `gui/src/lib/views/ProfilesView.svelte` — add `hermes` to `agents` array.
- `gui/src/lib/components/Onboarding.svelte` — agent picker entry + install URL.
- Spot-check `Inspector.svelte`, `SessionSidebar.svelte`, `SessionTabs.svelte`
  for hardcoded agent lists gating session-id/resume UI.

## Verification (no automated tests)
- `mise run check` (clippy `-D warnings` + svelte-check).
- `mise run dev`, create a Hermes profile, start a session, confirm:
  spawn, output streaming, activity transitions, agent_session_id capture,
  resume, and integration install via Onboarding/CheckIntegrations.
- `cd gui && pnpm tauri:build` if shim code touched.

## Steps
1. Confirm open questions (binary, resume syntax, capture mode, hooks, brand).
2. Wire types: `wire/lib.rs` + `server.rs` + `types.ts` (+ ipc.ts if needed).
3. `build_argv` + capture module in `session.rs`.
4. Integration script + `integrations.rs` + `install.sh`.
5. Frontend meta/detect/profiles/onboarding + brand asset.
6. `mise run check` + manual dev-loop verification.
