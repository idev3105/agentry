# Agentry

> Linux desktop app for managing multiple AI-coding-agent sessions
> (`claude`, `opencode`, `codex`) inside a single window — agents survive
> closing the window.

[![build](https://github.com/idev3105/agentry/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/idev3105/agentry/actions/workflows/build.yml)
[![status](https://img.shields.io/badge/status-Phase%202-orange)]()
[![rust](https://img.shields.io/badge/rust-stable-93450a?logo=rust)]()
[![svelte](https://img.shields.io/badge/svelte-5-ff3e00?logo=svelte)]()
[![tauri](https://img.shields.io/badge/tauri-2-24c8db?logo=tauri)]()
[![license](https://img.shields.io/badge/license-TBD-lightgrey)]()

---

## Why

Running several CLI coding agents in parallel means juggling terminal tabs,
re-attaching after a crash, and losing scrollback. Agentry centralizes that
into one GUI:

- **One pane per session**, all backed by real PTYs (so TUIs like `claude`
  render correctly via xterm.js).
- **Agents outlive the GUI.** Closing the window does *not* kill them; the
  daemon keeps the PTYs running, GUI re-attaches on next launch.
- **Activity badges.** A 1 Hz idle heuristic surfaces sessions that need
  your attention (`● cần bạn` / "needs you").
- **Resume.** Re-attach to an interrupted session by its captured
  `agent_session_id`: Claude Code via pre-generated `--session-id` UUID,
  Codex via fs-watch on its session log, OpenCode via session-list diff.
- **9Router integration.** Detect, start/stop, and embed the 9Router
  dashboard (`localhost:20128/dashboard`) from inside the GUI.

> Status: mid Phase 2 of [`docs/roadmap.md`](docs/roadmap.md). Single-agent
> usage works end-to-end; orchestration / multi-agent pipelines / Windows
> support are intentionally deferred.

---

## Architecture

Three processes, one Unix socket, one JSON-line wire protocol:

```
┌──────────────────────┐  Unix socket  ┌──────────────────┐  tauri::invoke   ┌────────────────────┐
│  agentry-daemon      │ ◄───────────► │  Tauri shim      │ ◄──────────────► │  SvelteKit         │
│  (Rust, long-lived)  │   JSON lines  │  (Rust)          │   app.emit()     │  (xterm.js, runes) │
│  PTY · ring buffer · │               │  spawn / attach  │                  │  3-pane UI         │
│  SQLite (WAL)        │               │  daemon, relay   │                  │                    │
└──────────────────────┘               └──────────────────┘                  └────────────────────┘
            ▲
            │  same socket
            ▼
┌──────────────────────┐
│  agentry-cli         │   minimal test client
└──────────────────────┘
```

- **Daemon** owns every PTY (via `portable-pty`), a ring buffer for raw
  output bytes (`focus` + `read_buffer` deliver base64 chunks with `seq`),
  and SQLite (`~/.agentry/daemon.db`, WAL mode). Single instance enforced
  via `~/.agentry/daemon.pid`.
- **Tauri shim** spawns/attaches the daemon, relays each JSON event line
  as a `daemon:<event_name>` Tauri event, and turns frontend `send_cmd`
  invocations into RPC requests with a 30 s timeout.
- **Frontend** is SvelteKit (static adapter) with Svelte 5 runes,
  Tailwind v4, shadcn-svelte, and xterm.js. Three panes: session sidebar,
  terminal, inspector.

`crates/wire/src/lib.rs` is the **single source of truth** for the wire
protocol. The daemon and shim both `use agentry_wire::*`. The frontend
mirrors those types by hand in `gui/src/lib/types.ts` (no codegen yet).

---

## Workspace layout

```
crates/wire/      agentry-wire   — JSON-line protocol types (Cmd / Event / Resp)
crates/cli/       agentry-cli    — minimal socket client for manual verification
daemon/           agentry-daemon — PTY + ring buffer + SQLite + Unix-socket server
gui/src-tauri/    agentry-gui    — Tauri shim (spawn daemon, relay events)
gui/src/          SvelteKit frontend
docs/             design docs (Vietnamese)
```

Architecture deep-dive: [`CLAUDE.md`](CLAUDE.md). Agent-specific notes:
[`AGENTS.md`](AGENTS.md). Per-area design: [`docs/`](docs/).

---

## Requirements

- **Rust** stable, **Node** 24, **pnpm** 11 (pinned in `mise.toml`).
- **Linux** with WebKitGTK 4.1 (Tauri v2). On Ubuntu:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
- One or more agent CLIs on `$PATH`: `claude`, `opencode`, `codex`.
- Recommended: [mise](https://mise.jdx.dev) to manage toolchains and run
  tasks.

> macOS / Windows are not currently supported — see `docs/roadmap.md`.
> WebKit/Wayland needs `GDK_BACKEND=x11` + `WEBKIT_DISABLE_DMABUF_RENDERER=1`
> (already pinned in `mise.toml`).

---

## Quick start

```bash
mise install                  # pin toolchains
mise run dev                  # build daemon, run it, then `tauri dev` the GUI
```

Or step-by-step without mise:

```bash
cargo run -p agentry-daemon &       # daemon in background
cd gui && pnpm install && pnpm tauri:dev
```

Drive the daemon directly (no GUI) for sanity checks:

```bash
mise run cli -- list_projects
mise run cli -- list_sessions
```

---

## Common tasks

| Task | What it does |
|---|---|
| `mise run dev` | Build + run daemon, then full `tauri dev` |
| `mise run daemon` | `cargo watch` on the daemon (falls back to plain `run`) |
| `mise run gui` | Frontend-only Vite dev (no Tauri shim) |
| `mise run tauri` | Frontend + Tauri shim |
| `mise run check` | `cargo clippy -D warnings` (wire/daemon/cli) + `pnpm check` |
| `mise run build` | Release build daemon + CLI + Tauri bundle |
| `mise run cli -- <cmd>` | Run the test client against the daemon socket |
| `mise run kill` | `pkill` daemon/GUI/Tauri/Vite + clean `~/.agentry/{pid,sock,log}` |
| `mise run reset` | `kill` + wipe `~/.agentry/daemon.db*` (loses everything) |

There are **no automated tests** yet — verify by running daemon + CLI
together, or driving the GUI manually.

---

## Runtime files (`~/.agentry/`)

- `daemon.sock` — Unix socket (shim & CLI both connect here)
- `daemon.pid`  — single-instance lock; shim probes with `kill -0` before spawning
- `daemon.db`   — SQLite, WAL mode; schema in `daemon/src/migrations.sql`
- `daemon.log`  — daemon stdout+stderr when launched by the shim

`mise run reset` is the right hammer when something looks wedged.

---

## Wire protocol

JSON lines, one message per line, framed `\n`. Every message carries
`v` (= `WIRE_VERSION`) and `kind`:

```jsonc
// frontend → daemon
{ "v": 1, "kind": "cmd",  "id": "uuid", "name": "list_sessions", "params": {} }

// daemon → frontend
{ "v": 1, "kind": "resp", "id": "uuid", "ok": true,  "data": { ... } }
{ "v": 1, "kind": "event","name": "session_activity", "payload": { ... } }
```

Adding or changing a wire message **requires editing four files together**
(see [`AGENTS.md`](AGENTS.md) and [`docs/wire-protocol.md`](docs/wire-protocol.md)):

1. `crates/wire/src/lib.rs` — add the variant
2. `daemon/src/server.rs` — `dispatch()` + `build_resp()`
3. `gui/src/lib/types.ts` — hand-mirrored TS types
4. `gui/src/lib/ipc.ts` — typed wrapper

Bump `WIRE_VERSION` only on breaking changes — daemon rejects
`v > WIRE_VERSION` with `unsupported_version`.

---

## Roadmap

- **Phase 1** ✅ wire protocol + GUI skeleton with mock data
- **Phase 2** 🚧 real PTY sessions, activity heuristic, resume; *currently here*
- **Phase 3** ⏳ auto-queue, secret redaction, session persistence, distribution

Deferred (not in scope for now): orchestration / multi-agent pipelines,
git-worktree isolation, macOS / Windows, packaged distribution. See
[`docs/roadmap.md`](docs/roadmap.md).

---

## Documentation

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Distilled architecture + foot-guns for AI assistants and humans |
| [`AGENTS.md`](AGENTS.md) | Agent-specific shortcuts, source-of-truth order, gotchas |
| [`docs/tech-stack.md`](docs/tech-stack.md) | Why each dependency was picked |
| [`docs/daemon.md`](docs/daemon.md) | Daemon internals (process model, threading) |
| [`docs/wire-protocol.md`](docs/wire-protocol.md) | Full Cmd / Event / Resp catalogue |
| [`docs/data-models.md`](docs/data-models.md) | DB schema + session lifecycle states |
| [`docs/session-lifecycle.md`](docs/session-lifecycle.md) | Start / focus / resume / restart flows |
| [`docs/security.md`](docs/security.md) | `profile.env` handling, redaction |
| [`docs/ux.md`](docs/ux.md) | UX / interaction notes |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Per-milestone breakdown |
| [`docs/roadmap.md`](docs/roadmap.md) | Phase status + deferred work |

> Most docs are written in Vietnamese. New code & comments default to
> English unless the file you're editing already uses Vietnamese.

---

## License

TBD.
