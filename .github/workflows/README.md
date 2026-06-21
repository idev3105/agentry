# CI workflows

## build.yml

Runs `cargo clippy`, `svelte-check`, and `pnpm tauri build` for macOS
arm64 (`aarch64-apple-darwin`) and macOS x64 (`x86_64-apple-darwin`).

**Triggers:** push to `main`, tags `v*`, PRs to `main`, manual dispatch.

**Artifacts:** `.app` + `.dmg` + `agentry-daemon` + `agentry-cli` per arch,
uploaded as workflow artifacts with 14-day retention for smoke-testing PRs.
No GitHub Release is created.

**Local equivalent:** `mise run check && mise run build`

**To add an arch:** extend `matrix.include` in `build.yml`.

**To enable releases:** see TODO (separate workflow `release.yml`, not yet written).

> Linux/Windows builds were dropped — macOS-only target.
