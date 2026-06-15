# AGENTS.md

Primary guide is **`CLAUDE.md`** (root). Read it first — it covers architecture, commands, wire protocol, and known foot-guns. This file only adds agent-specific notes not already there.

## Source-of-truth order

1. `crates/wire/src/lib.rs` — wire protocol types
2. `daemon/src/migrations.sql` — DB schema
3. `mise.toml` — dev commands (drives all task running)
4. `docs/*.md` — design (Vietnamese; keep that style if editing those)
5. `CLAUDE.md` — distilled architecture + foot-guns

If prose docs disagree with code, trust the code.

## Commands (use `mise`, not raw cargo/pnpm where possible)

- `mise run check` — clippy (`-D warnings`) + `svelte-check`. Run before declaring done.
- `mise run dev` — full loop (daemon + Tauri).
- `mise run kill` / `mise run reset` — when daemon/socket/DB looks wedged.
- `mise run cli -- <cmd>` — drive daemon over `~/.agentry/daemon.sock` for manual verification.

No automated tests exist. Verify by running daemon + CLI, or GUI manually.

## Wire-protocol changes — 4 files MUST change together

Forgetting any of these breaks silently at runtime:

1. `crates/wire/src/lib.rs` — add `Cmd` / `Event` / `RespData` variant (snake_case `serde` tags)
2. `daemon/src/server.rs` — handle in `dispatch()`, build response in `build_resp()`
3. `gui/src/lib/types.ts` — hand-mirrored TS types (no codegen)
4. `gui/src/lib/ipc.ts` — typed wrapper

Bump `WIRE_VERSION` only on breaking changes (daemon rejects `v > WIRE_VERSION`).

## Non-obvious gotchas (beyond CLAUDE.md)

- Workspace `Cargo.toml` lists 4 members but `mise run check` only clippies 3 (`wire`, `daemon`, `cli`) — `gui/src-tauri` is checked via `pnpm tauri:build`, not clippy. If you change shim code, build it explicitly.
- `.mcp.json` configures `codegraph` and `shadcn` MCP servers. CodeGraph index lives in `.codegraph/` — prefer `codegraph_*` tools over grep for structural lookups (see `~/.config/opencode/AGENTS.md`).
- Frontend uses **Svelte 5 runes** (`$state`, `$derived`) — not Svelte 4 stores. shadcn-svelte components, Tailwind, xterm.js.
- `agent_type` has two encodings (`claude_code` wire vs `claude` display). See `agent_display_name()` in `daemon/src/server.rs`. Don't conflate.
- PTY reader is **blocking** — must run in `std::thread::spawn`, capture `tokio::runtime::Handle::current()` *before* the thread starts.
- `Store::cleanup_zombies` runs every daemon startup → marks all non-terminal sessions `failed`. Resume-after-restart in `docs/session-lifecycle.md` is NOT implemented.
- Agent-session-id capture is now implemented for all three: Claude Code (`--session-id`), Codex (fs watch), OpenCode (session-list diff). Surfaces as `agent_session_id` / `agent_session_name` on `SessionInfo` + `SessionStarted`.
- **Agent integration hook server** (`daemon/src/agent_hook_server.rs`) now runs on `~/.agentry/agent-hook.sock`. Agents report session id + activity state via JSON-RPC (`pane.report_agent_session`, `pane.report_agent`, `pane.release_agent`). Integration scripts live in `integrations/` — install with `integrations/install.sh`. Daemon injects `AGENTRY_ENV=1`, `AGENTRY_SOCKET_PATH`, `AGENTRY_PANE_ID` into every PTY child. The old fs-watch/poll fallbacks (`codex_watch.rs`, `opencode_capture.rs`) remain for users who haven't installed hooks.
- `agent_output` events are filtered per-connection by the focused session (set via `focus_session`). Unread badges derive from a per-session activity sequence — bump `lastSeenSeq` in `pickSession` to avoid stale spikes (see commit 9954aa2).
- 9Router lifecycle (detect/start/stop/dashboard) lives in the Tauri shim, not the daemon — see `gui/src-tauri/src/r9.rs` and `gui/src/lib/stores/r9.svelte.ts`. Dashboard is iframed from `localhost:20128/dashboard`.

## Style

- New code/comments: English unless the file is already Vietnamese (most of `docs/`).
- Don't add tests infra unprompted — repo has none by design (mid-Phase-2).
- Don't add features from `docs/roadmap.md` "deferred" section (orchestration, git-worktree isolation, Windows, bundling).
