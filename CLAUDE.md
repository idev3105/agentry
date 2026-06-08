# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Agentry is a Linux desktop app for managing multiple AI-coding-agent sessions
(`claude`, `opencode`, `codex`) inside one window. It is split into three
processes:

```
agentry-daemon (Rust, long-lived)  ──Unix socket──  Tauri shim (Rust)  ──IPC──  SvelteKit frontend
   PTY + ring buffer + SQLite           JSON-line protocol             tauri::invoke / app.emit()
```

The daemon outlives the GUI: closing the window does NOT kill agents.

Detailed design lives in `docs/` — `tech-stack.md`, `daemon.md`,
`wire-protocol.md`, `data-models.md`, `session-lifecycle.md`,
`implementation-plan.md`, `roadmap.md`, `ux.md`, `security.md`. Read these
first when in doubt; this file only covers what is *not* derivable from them.

## Common commands

The project is driven by [mise](https://mise.jdx.dev) tasks defined in `mise.toml`.
Run them from the repo root.

| Task | What it does |
|---|---|
| `mise install` | Install pinned toolchains (Rust stable, Node 24, pnpm 11) |
| `mise run dev` | Build + run daemon, then `pnpm tauri:dev` (full dev loop) |
| `mise run daemon` | `cargo watch -x 'run -p agentry-daemon'` (watch mode if installed; falls back to plain run) |
| `mise run gui` | `pnpm dev` in `gui/` (Vite only — no Tauri shim) |
| `mise run tauri` | `pnpm tauri:dev` in `gui/` (frontend + shim) |
| `mise run check` | `cargo clippy -p agentry-{wire,daemon,cli} -- -D warnings` + `pnpm check` (svelte-check) |
| `mise run build` | Release build daemon + CLI + Tauri bundle |
| `mise run cli -- <cmd>` | Run the test client against `~/.agentry/daemon.sock` |
| `mise run kill` | `pkill` daemon/GUI/Tauri/Vite + remove `~/.agentry/{daemon.pid,daemon.sock,daemon.log}` |
| `mise run reset` | `kill` + delete `~/.agentry/daemon.db*` (fresh DB; loses projects/profiles/sessions) |

`mise.toml` also pins `GDK_BACKEND=x11` and `WEBKIT_DISABLE_DMABUF_RENDERER=1`
to avoid WebKit/Wayland segfaults — keep those when running Tauri locally.

Lower-level fallbacks (when not using mise):

```bash
cargo build -p agentry-daemon       # daemon only
cargo run   -p agentry-daemon       # run daemon in foreground
cargo run   -p agentry-cli -- list_projects
cargo clippy --workspace -- -D warnings
cd gui && pnpm tauri:dev            # frontend + shim
cd gui && pnpm check                # svelte-check
```

There are **no automated tests** in the repo today; verify changes by
running the daemon + CLI together, or driving the GUI manually.

## System dependencies (Ubuntu)

Tauri v2 needs these (mise does not manage them):

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Workspace layout

```
crates/wire/          # agentry-wire — single source of truth for the JSON-line protocol
crates/cli/           # agentry-cli  — minimal test client for the daemon socket
daemon/               # agentry-daemon — PTY + ring buffer + SQLite + Unix-socket server
gui/src-tauri/        # agentry-gui  — Tauri shim (spawn/attach daemon, relay events)
gui/src/              # SvelteKit frontend (static adapter, Tailwind, shadcn-svelte, xterm.js)
docs/                 # design docs (Vietnamese; read before implementing new features)
```

Workspace `Cargo.toml` lists `daemon`, `gui/src-tauri`, `crates/wire`, `crates/cli`.
The shim and daemon both `use agentry_wire::*` so wire types never drift.

## Runtime files (`~/.agentry/`)

- `daemon.sock` — Unix socket the shim and CLI both connect to
- `daemon.pid`  — single-instance lock; the shim probes with `kill -0` before spawning
- `daemon.db`   — SQLite (WAL mode); schema in `daemon/src/migrations.sql`
- `daemon.log`  — daemon stdout+stderr when launched by the shim

`mise run reset` is the right hammer when anything in here looks wedged.

## Architecture quick map

### Daemon (`daemon/src/`)

- `main.rs` — wires `Store` + `SessionManager` + `Server` together, writes/cleans pidfile
- `server.rs` — accepts `UnixListener` connections; per-conn reader/writer tasks; central `dispatch()` matches every `Cmd` variant
- `session.rs` — `SessionManager` owns `HashMap<SessionId, SessionHandle>`. PTY is spawned in a `std::thread` (portable-pty is **blocking**); reader → `event_tx.send(AgentOutput)` + ring buffer; per-session 1 s tokio task computes `ActivityState` and emits `SessionActivity`
- `store.rs` — `rusqlite` behind `Mutex<Connection>`; `cleanup_zombies()` flips `running/starting/queued` → `failed` on every startup (recovery is not yet implemented past this)
- `pid.rs` — pidfile read/write/cleanup
- `migrations.sql` — embedded via `include_str!`; tables `projects`, `agent_profiles`, `sessions`, `session_tail`, `settings`

Events fan out through one `tokio::sync::broadcast::Sender<Event>` (capacity 512). Each connection's writer task subscribes; lagged receivers are skipped, not killed. `agent_output` is supposed to be filtered by the connection's focused session id but currently every connection receives every output event — see `server.rs` `_focused_clone` (subscription model still TODO; see `wire-protocol.md` §2.4).

### Tauri shim (`gui/src-tauri/src/`)

- `daemon.rs` — `ensure_running()`: read pidfile → `kill -0` probe → reuse, else SIGTERM/SIGKILL stale daemon and respawn. Resolves the binary by `AGENTRY_DAEMON_BIN`, sibling of `current_exe()`, then `target/{debug,release}/agentry-daemon`, then `$PATH`
- `socket.rs` — async `UnixStream`, `Connection::rpc(id, line)` registers a oneshot in `Pending` and times out after 30 s
- `relay.rs` — reads each JSON line: `kind=event` → `app.emit("daemon:<event_name>", payload)`, `kind=resp` → fulfil oneshot keyed by `id`
- `lib.rs` — exposes `send_cmd` + `focus_session` Tauri commands; `bootstrap()` spawns daemon + emits `daemon:connected`/`daemon:bootstrap_error`

### Frontend (`gui/src/`)

- `lib/ipc.ts` — typed wrappers over `invoke('send_cmd', { cmd })` + `listen('daemon:...')`
- `lib/types.ts` — TS mirror of `crates/wire/src/lib.rs`. **Keep these in sync by hand** when changing wire types
- `lib/stores/{projects,profiles,sessions,settings,ui}.ts` — Svelte 5 runes-based stores
- `lib/components/` — `TerminalView` (xterm.js), `SessionSidebar`, `Inspector`, `TopBar`, `ActivityBar`, `CommandPalette`, `SetupWizard`, `SplitPane`
- `routes/+page.svelte` — single-page app: 3-pane layout (sidebar / terminal / inspector), keybindings, optimistic kill, first-prompt → title auto-rename

## Wire protocol — invariants to keep

`crates/wire/src/lib.rs` is the source of truth. When changing it:

1. Add the variant to `Cmd` / `Event` / `RespData` (snake_case `serde` tags).
2. Handle it in `daemon/src/server.rs` `dispatch()`.
3. Mirror types in `gui/src/lib/types.ts` and add a wrapper in `gui/src/lib/ipc.ts`.
4. Bump `WIRE_VERSION` only on breaking changes — daemon rejects `v > WIRE_VERSION` with `unsupported_version`.

Every cmd response is built ad-hoc in `build_resp()` (a JSON `Value` with `v`/`kind`/`id` injected). Don't try to round-trip through `Resp` — the dispatch layer doesn't.

## Known foot-guns

- **Don't read PTY in async.** `portable-pty` reader is blocking. The pattern is: `std::thread::spawn` for the reader, capture `tokio::runtime::Handle::current()` *before* the thread starts (calling it inside the thread panics), forward bytes via `mpsc` then `broadcast`.
- **`agent_type` strings have two encodings.** Wire enum `AgentType` serializes as `claude_code` / `open_code` / `codex` (snake_case). `SessionInfo.agent` and `SessionStartedEvent.agent` are the *display* names (`claude` / `opencode` / `codex`) — see `agent_display_name()` in `server.rs`. Don't conflate them.
- **Resume reuses the original session row** via `Store::reactivate_session` — it nulls `exit_code`/`fail_reason`/`finished_at` and re-stamps `created_at`. There is no separate "resumed" row, even though `data-models.md` §4 describes it as creating a new session with `parent_session_id`. The schema column exists but is currently always NULL.
- **`Store::cleanup_zombies` runs on every startup** and marks any non-terminal session `failed` with reason `daemon restarted`. The three recovery scenarios in `session-lifecycle.md` §"Resume sau restart daemon" are NOT yet implemented.
- **OpenCode + Codex session-id capture are not implemented.** Only Claude Code's pre-generated `--session-id <uuid>` works (`session.rs` `build_argv()`). The codex `notify`-watch and opencode list-diff approaches in `data-models.md` §4 are still TODO.
- **`SessionManager::get_activity` uses `block_in_place` + `block_on`** to read activity sync from inside `ListSessions`. Don't call it from a single-threaded runtime.
- **`SessionHandle::inner` is std::sync::Mutex.** Hot per-session state (ring, activity) lives in `Arc<Mutex<SessionInner>>` separate from the outer `RwLock<HashMap>`. NEVER hold an `inner.lock()` guard across `.await` — `MutexGuard: !Send`. Lock in a block, copy out the data, drop the guard, then await.
- **Frontend mirrors are hand-written.** No `ts-rs` codegen — every wire change requires touching `gui/src/lib/types.ts` *and* `ipc.ts`.

## Documentation language

`docs/*.md` and many comments are in Vietnamese. Keep that style when editing those files; for new code/comments default to English unless the file you're editing already uses Vietnamese.

## Scope guardrails

The project is mid-Phase-2 of `roadmap.md`. Before adding features, check:

- `docs/implementation-plan.md` for the milestone you're touching
- `docs/roadmap.md` for what's intentionally deferred (workflow orchestration, git-worktree isolation, Windows support, distribution bundling)
- `docs/security.md` if adding anything that crosses `profile.env` or PTY output redaction

Pipeline / multi-agent orchestration is explicitly out of scope right now.
