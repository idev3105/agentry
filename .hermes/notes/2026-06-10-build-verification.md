# Build verification — 2026-06-10

## Toolchain
- rust: 1.96.0
- node: v24.16.0
- pnpm: 11.5.2

## Local build results (macOS arm64)

| Command | Status | Time |
|---------|--------|------|
| `pnpm install --frozen-lockfile` | ✅ | <1s |
| `mise run check` | ✅ (clippy 0 err, svelte-check 0 err/1 warn) | ~1m |
| `cargo build --release -p agentry-daemon -p agentry-cli` | ✅ | 30s |
| `cd gui && pnpm build` | ✅ | 1.5s |
| `cd gui && pnpm tauri:build` | ✅ (needed `frontendDist: "../dist"` → `"../build"` fix first) | 57s |

## macOS output paths
- `target/release/bundle/macos/Agentry.app`
- `target/release/bundle/dmg/Agentry_0.1.0_aarch64.dmg`

## Note
- Tauri workspace member shares root `target/` dir (no `gui/src-tauri/target/`).
- `tauri.conf.json` had `frontendDist: "../dist"` — fixed to `"../build"` (SvelteKit outputs to `build/`).
