# CI workflows

## build.yml

Runs `cargo clippy`, `svelte-check`, and `pnpm tauri:build` for macOS arm64,
Linux x64, Windows x64.

**Triggers:** push to `main`, PRs to `main`, manual dispatch.

**No release artifacts.** Bundles are uploaded as workflow artifacts with
14-day retention for smoke-testing PRs.

**Local equivalent:** `mise run check && mise run build`

**To add a new OS:** extend `matrix.include` in `build.yml`, add an upload step.

**To enable releases:** see TODO (separate workflow `release.yml`, not yet written).

**Tauri Linux deps:** see `mise.toml` lines 7-9 for the canonical apt list.
