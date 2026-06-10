# Agentry — GitHub Actions Build CI Plan

**Audience:** Mid-level developer.
**Scope:** Add cross-platform build CI for macOS arm64, Linux x64, Windows x64. Build only — no release artifacts, no signing, no notarization.
**Triggers:** `push` to `main` + `pull_request` to `main`.
**Baseline:** commit `9d0b7b5` + the 2 retry fixes from the last review (B1+B2 in onboarding review). Land those first.
**Effort:** 1.5–2 days for a mid-dev.
**Stack:** Rust workspace (4 members) + pnpm + Vite + Tauri v2 + SvelteKit 2.

---

## Why we are doing this

- No CI today. `pnpm check` and `mise run check` only run locally.
- Project is mid-Phase-2, no automated tests. CI **must build the full Tauri bundle** to catch breakage that escapes `clippy` + `svelte-check` — e.g. capability-config errors, native-dep mismatches, Linux-only segfaults.
- Cross-OS coverage matters because the daemon uses platform-specific bits (Unix socket, PTY, GTK on Linux, WebKit). A change that compiles on macOS often breaks on Linux/Windows.

---

## Step 0 — VERIFY build commands work locally FIRST

**Do this before writing any YAML.** If the local build is broken, fixing the workflow in CI is 10× slower.

Open a terminal at the repo root and run each command. Each must exit 0. **Stop and ask senior if any fail.**

### 0.1 Verify toolchain matches `mise.toml`

```bash
mise install                      # installs rust stable, node 24, pnpm 11
mise current                      # show resolved versions
cargo --version                   # >= 1.96
node --version                    # v24.x
pnpm --version                    # 11.x
```

### 0.2 Verify pnpm install works clean

```bash
cd gui
pnpm install --frozen-lockfile    # MUST work — if lockfile drift, run `pnpm install` then commit pnpm-lock.yaml first
```

### 0.3 Verify check passes (already known green from prior phases — sanity check)

```bash
cd /Users/idev/Documents/projects/agentry
mise run check
# Expected: clippy 0 warnings (uses -D warnings), svelte-check 0 errors / 1 warning
```

### 0.4 Verify the actual build commands the CI will run

CI runs these three things per OS:

```bash
# 1. Release build of daemon + CLI (Rust workspace minus the GUI shim)
cargo build --release -p agentry-daemon -p agentry-cli

# 2. Frontend dist
cd gui && pnpm install --frozen-lockfile && pnpm build

# 3. Tauri full bundle (uses `beforeBuildCommand: pnpm build` automatically; runs cargo build for agentry-gui shim too)
cd gui && pnpm tauri:build
```

> **Note:** `mise run build` (defined in `mise.toml`) does steps 1 + 3 sequentially. CI will replicate this. Step 2 is implicit inside step 3 via `tauri.conf.json`'s `beforeBuildCommand`.

**On your local mac**, run all three and confirm:
- `cargo build --release -p agentry-daemon -p agentry-cli` → produces `target/release/agentry-daemon` and `target/release/agentry`
- `pnpm tauri:build` → produces:
  - `gui/src-tauri/target/release/bundle/macos/Agentry.app`
  - `gui/src-tauri/target/release/bundle/dmg/Agentry_0.1.0_aarch64.dmg`

If `pnpm tauri:build` fails with `error: failed to bundle project: Failed to read x.icns`, the icon set is missing/broken — check `gui/src-tauri/icons/icon.icns` exists (we verified it does at `9d0b7b5`).

**Write down which targets the build emits on macOS** — you'll need this for the artifact-upload step. Expected on Apple Silicon:
- `.app` bundle (dir)
- `.dmg`

**Linux** (run inside a Ubuntu VM/Docker if needed; system libs required — see below):
- `.deb`
- `.rpm`
- `.AppImage` (only if `appimagetool` available)

**Windows** (run inside Windows VM if accessible; otherwise trust CI to verify):
- `.msi` (WiX)
- `.exe` (NSIS, default in Tauri v2)

### 0.5 Verify Linux system deps

Tauri v2 on Linux **requires apt packages** (documented in `mise.toml` comment lines 7-9):

```bash
sudo apt install \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl wget file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

CI must install these on the `ubuntu-latest` runner. They are NOT pre-installed on GitHub's hosted runners.

### 0.6 Document blockers you find

Write a short note (file at `.hermes/notes/2026-06-10-build-verification.md`) with:
- exact versions resolved (`mise current` output)
- mac build output paths (so we know the artifact glob)
- any commands that failed + error
- any commands that needed env tweaks

**Submit this note to senior before writing the workflow.** Cuts review cycles in half.

---

# Workflow design

## File layout

```
.github/
  workflows/
    build.yml          # main CI workflow
    README.md          # 1-page explainer for future maintainers (optional but expected)
```

## Triggers

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:   # manual trigger from Actions tab — useful for debugging
```

## Matrix

3 runners, run in parallel, fail-fast disabled (so all 3 finish even if one breaks — easier to diagnose):

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - { os: macos-14,     name: macos-arm64,  rust_target: aarch64-apple-darwin }
      - { os: ubuntu-22.04, name: linux-x64,    rust_target: x86_64-unknown-linux-gnu }
      - { os: windows-2022, name: windows-x64,  rust_target: x86_64-pc-windows-msvc }
```

**Why pinned versions, not `*-latest`:**
- `macos-14` = Apple Silicon (M-series). `macos-latest` is currently macos-14 but will drift. Pin.
- `ubuntu-22.04` matches the apt package names in `mise.toml` (`libwebkit2gtk-4.1-dev`). `ubuntu-24.04` ships 4.1 too but pin to avoid surprises.
- `windows-2022` is the current LTS image. `windows-latest` drifts.

## Caching

Three caches, in order of expected speedup:

1. **Rust target dir** (~ 4 GB, biggest win): `Swatinem/rust-cache@v2` — handles `target/` + cargo registry + git deps + clippy state.
2. **pnpm store**: `actions/setup-node@v4` with `cache: 'pnpm'`.
3. **Tauri cargo target** lives inside `gui/src-tauri/target/`, separate from root `target/`. The `rust-cache` action caches BOTH workspaces by default when given `workspaces:` input.

---

# Tasks (in order)

## Task C0 — Verify local builds (Step 0 above)
Document findings. **Block on senior review before C1.**

---

## Task C1 — Write `.github/workflows/build.yml` skeleton

**Goal:** Get the matrix + checkout + toolchain setup right. No build steps yet — just `echo`s that prove the runner is alive.

**File:** Create `.github/workflows/build.yml`

```yaml
name: build

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

# Cancel in-progress runs on the same branch when a new commit lands
concurrency:
  group: build-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    name: ${{ matrix.name }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: macos-14,     name: macos-arm64,  rust_target: aarch64-apple-darwin }
          - { os: ubuntu-22.04, name: linux-x64,    rust_target: x86_64-unknown-linux-gnu }
          - { os: windows-2022, name: windows-x64,  rust_target: x86_64-pc-windows-msvc }

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Print runner info
        run: |
          echo "OS:        ${{ matrix.os }}"
          echo "Name:      ${{ matrix.name }}"
          echo "Target:    ${{ matrix.rust_target }}"
          echo "GHA event: ${{ github.event_name }}"
        shell: bash
```

**Push to a feature branch**, open a draft PR, watch Actions tab. All 3 jobs should turn green within ~1 minute.

**Acceptance:**
- Workflow appears in Actions tab
- 3 jobs run in parallel
- Each prints its OS info

**Commit:**
```
ci: scaffold build workflow with macos/linux/windows matrix
```

---

## Task C2 — Install Linux system deps

**Why:** Tauri's WebKit needs them. If the runner doesn't have them, `cargo build` for `agentry-gui` fails with `WebKit2GTK not found in pkg-config`.

Add **before** the toolchain setup (runs first on Linux only):

```yaml
      - name: Install Linux system deps
        if: matrix.os == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            build-essential \
            curl wget file \
            libxdo-dev \
            libssl-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev
```

**Verify:** push, watch `linux-x64` job; should add ~30s for apt step.

**Commit:**
```
ci: install tauri system deps on ubuntu runner
```

---

## Task C3 — Set up Rust toolchain + cache

```yaml
      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.rust_target }}
          components: clippy, rustfmt

      - name: Cache Rust build artifacts
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: |
            . -> target
            gui/src-tauri -> target
          key: ${{ matrix.name }}
```

**Why two `workspaces:`** — root `Cargo.toml` is workspace root for `daemon`, `crates/wire`, `crates/cli`. `gui/src-tauri` is a workspace MEMBER but has its own `target/` because Tauri overrides. Cache both.

> **Sanity check:** open `Cargo.toml` at repo root — line 4 lists `gui/src-tauri` as workspace member, which means it MIGHT share root `target/`. **Test on first CI run** — if `gui/src-tauri/target/` doesn't exist, drop the second line. If both exist, keep both.

**Acceptance:** cache restore log appears in second run; second run's `cargo build` is faster.

**Commit:**
```
ci: install rust toolchain + cache target dirs
```

---

## Task C4 — Set up Node + pnpm

```yaml
      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: 'pnpm'
          cache-dependency-path: gui/pnpm-lock.yaml

      - name: Install frontend deps
        working-directory: gui
        run: pnpm install --frozen-lockfile
```

**Why `--frozen-lockfile`:** CI must fail if `pnpm-lock.yaml` is out of sync with `package.json` (someone forgot to commit lockfile changes). On local dev, use `pnpm install` (no flag) to update.

**Acceptance:**
- pnpm install completes in <30s after cache warm
- Lockfile drift fails the job with clear error

**Commit:**
```
ci: install pnpm + node 24 + frontend deps with frozen lockfile
```

---

## Task C5 — Run `mise run check` equivalent (lint gate)

We don't want to depend on `mise` itself in CI (extra tool to bootstrap). Run the underlying commands directly.

```yaml
      - name: Clippy
        run: cargo clippy -p agentry-wire -p agentry-daemon -p agentry-cli -- -D warnings

      - name: svelte-check
        working-directory: gui
        run: pnpm check
```

**Why these run BEFORE the heavy build:** fast fail. Clippy finds 80% of breaks in <2 min, vs Tauri bundle in 8–15 min.

**Acceptance:** both pass on all 3 runners.

⚠️ **Watch for:** clippy on Windows often catches platform-specific Unix-socket `cfg(unix)` issues. If `agentry-daemon` has bare `use std::os::unix::*` without `#[cfg(unix)]` gating, it'll fail to compile on Windows. **If you hit this, stop and ask senior** — fixing Unix-socket gating is wire-protocol-adjacent and risky.

**Commit:**
```
ci: run clippy + svelte-check before bundle build
```

---

## Task C6 — Build the Tauri bundle

```yaml
      - name: Build daemon + CLI (release)
        run: cargo build --release -p agentry-daemon -p agentry-cli

      - name: Build Tauri app
        working-directory: gui
        run: pnpm tauri:build
        env:
          # Suppress Linux dialog plugin warning that aborts CI
          GDK_BACKEND: x11
          WEBKIT_DISABLE_DMABUF_RENDERER: '1'
```

**Why env vars on every runner:** harmless on macOS/Windows (ignored). Required on Linux to match `mise.toml`'s `[env]` block.

**Acceptance:** each OS produces bundles. Approximate timings on cold cache:
- macOS: 8–12 min
- Linux: 10–15 min
- Windows: 15–20 min (Windows builds are slow)

On warm cache: ~3–5 min each.

**Watch for first failures:**
- macOS: `Bundle/macos/Agentry.app/Contents/Frameworks` missing → identifier or icon issue. Re-check `tauri.conf.json` `identifier`/`bundle.icon`.
- Linux: `error: linker 'cc' not found` → `build-essential` not installed (C2 dep missing).
- Windows: `error: linker 'link.exe' not found` → MSVC toolchain not detected. Add `MSVC` setup step (rare on `windows-2022`, usually pre-installed).

**Commit:**
```
ci: build daemon + tauri bundle for all platforms
```

---

## Task C7 — Upload artifacts (per OS)

Even though the user said "no release artifacts," uploading build outputs as **workflow artifacts** is invaluable for debugging — reviewers can download a PR's built `.dmg`/`.deb`/`.msi` and smoke-test before merging. Artifacts auto-expire after 90 days by default.

```yaml
      - name: Upload macOS bundle
        if: matrix.os == 'macos-14'
        uses: actions/upload-artifact@v4
        with:
          name: agentry-${{ matrix.name }}-${{ github.sha }}
          path: |
            gui/src-tauri/target/release/bundle/dmg/*.dmg
            gui/src-tauri/target/release/bundle/macos/*.app
          retention-days: 14
          if-no-files-found: error

      - name: Upload Linux bundle
        if: matrix.os == 'ubuntu-22.04'
        uses: actions/upload-artifact@v4
        with:
          name: agentry-${{ matrix.name }}-${{ github.sha }}
          path: |
            gui/src-tauri/target/release/bundle/deb/*.deb
            gui/src-tauri/target/release/bundle/rpm/*.rpm
            gui/src-tauri/target/release/bundle/appimage/*.AppImage
          retention-days: 14
          if-no-files-found: error

      - name: Upload Windows bundle
        if: matrix.os == 'windows-2022'
        uses: actions/upload-artifact@v4
        with:
          name: agentry-${{ matrix.name }}-${{ github.sha }}
          path: |
            gui/src-tauri/target/release/bundle/msi/*.msi
            gui/src-tauri/target/release/bundle/nsis/*.exe
          retention-days: 14
          if-no-files-found: error
```

**Why `if-no-files-found: error`:** catches accidental config change that disables bundling (e.g. someone flips `tauri.conf.json` `bundle.active: false`).

**Why per-OS guards:** keeps each upload step focused; failure pinpoints which platform's bundle output changed shape.

**Watch out:**
- `.app` is a directory, not a file — `actions/upload-artifact@v4` handles dirs but the resulting artifact ZIPs the dir. Smoke-tester must unzip then move to `/Applications/`.
- AppImage only generated if `appimagetool` is in PATH. On `ubuntu-22.04` it usually IS — but if missing, the step succeeds without the appimage line; `if-no-files-found: error` won't catch this because OTHER files exist. **Add a smoke-check** after the build:

```yaml
      - name: List Linux bundle outputs
        if: matrix.os == 'ubuntu-22.04'
        run: ls -la gui/src-tauri/target/release/bundle/
```

Adjust upload paths after C0/C6 reveals exact output filenames.

**Acceptance:**
- PR Checks panel shows "Artifacts: 3" link
- Downloaded ZIPs contain the expected installers
- Re-run on a clean checkout (cache off) still produces all 3

**Commit:**
```
ci: upload per-os bundles as workflow artifacts (14-day retention)
```

---

## Task C8 — Add status badge + maintainer note

**File:** `README.md` — add at the very top, under the title:

```md
[![build](https://github.com/<org>/agentry/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/<org>/agentry/actions/workflows/build.yml)
```

Replace `<org>` with the actual GitHub org/user.

**File:** Create `.github/workflows/README.md`:

```md
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
```

**Acceptance:** badge renders on README; click takes reviewer to latest run.

**Commit:**
```
docs: add CI status badge + workflow maintainer note
```

---

# Out of scope (do NOT add)

- **Signing / notarization** — needs Apple Developer cert + secrets (`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `KEYCHAIN_PASSWORD`) and Windows EV cert. File separate plan.
- **Release on tag** — separate workflow `release.yml`, separate plan. Will reuse this build job via `workflow_call`.
- **Unit tests** — repo has none by design (AGENTS.md). Don't invent infra.
- **Multi-arch** (mac x64, linux arm64) — deferred per user choice.
- **Coverage reports** — no tests to cover.
- **Auto-update endpoint** — Tauri updater needs signing first.
- **Self-hosted runners** — overhead not worth it at current scale.
- **Renovate / Dependabot config** — file separately if wanted.

---

# Gate (each task)

Every task: push branch, open draft PR, watch Actions tab. **CI itself is the gate.** No local equivalent needed beyond Step 0.

If a task fails on only some platforms, do NOT add platform-specific hacks — investigate the root cause. Platform-specific code in `daemon/` or `gui/` is the real bug.

---

# Done criteria (all must hold)

1. **Workflow file exists** at `.github/workflows/build.yml`
2. **Three matrix jobs** all turn green on a PR
3. **First run cold cache:** all 3 finish in <25 min
4. **Second run warm cache:** all 3 finish in <10 min
5. **Artifacts uploaded** for each OS — downloadable from the PR's Checks tab
6. **Downloaded mac DMG** opens without quarantine bypass (unsigned will require right-click "Open" — that's expected, document in README)
7. **Status badge** renders green on `main`
8. **fail-fast: false** confirmed: deliberately break one platform (e.g. `cargo` typo), confirm other two still finish
9. **Concurrency cancellation works:** push two commits back-to-back to the same branch; older run shows "Cancelled"
10. **Lockfile drift caught:** delete a line from `gui/pnpm-lock.yaml`, push; CI fails at install step with frozen-lockfile error

---

# Time budget

| Task | Effort |
|---|---|
| C0 verify local builds (mac only — Linux/Win first surface in CI) | 2h |
| C1 scaffold workflow | 0.5h |
| C2 Linux apt deps | 0.5h |
| C3 Rust toolchain + cache | 1h |
| C4 Node + pnpm + frontend deps | 0.5h |
| C5 clippy + svelte-check | 0.5h |
| C6 Tauri build (where most surprises live) | 4h (first failures eat hours) |
| C7 artifact upload + path debugging | 1.5h |
| C8 badge + README | 0.5h |
| Buffer for cross-platform breakage | 3h |
| **Total** | **~14h / 2 days** |

If Windows-specific clippy or build issues surface in C5/C6, expect +1 day. Escalate to senior if Unix-socket gating bugs in `daemon/` appear — that's a real defect, not a CI problem.

---

# Review checkpoints

Ping senior at:

1. **After C0** — share local build output paths + system info note. Critical because the artifact globs in C7 depend on it.
2. **After C6 first green run** — visual review of timings, cache effectiveness, any flaky steps.
3. **After C7** — download each platform's artifact, smoke-test that each installer opens.
4. **Final** — review the full `build.yml` against this plan + delete this plan file when merged.

---

# Common pitfalls (read before starting)

1. **`pnpm install` then forget to commit lockfile** → CI fails at C4. Always `git status` after `pnpm install`.
2. **Adding a Rust dep but forgetting `Cargo.lock`** → CI fails on second job because cache hit returned stale lock. Always commit `Cargo.lock`.
3. **Tauri's `beforeBuildCommand` runs in `gui/`** → if you change cwd inside the YAML, the `pnpm build` it triggers might run in the wrong dir. Use `working-directory:` on the YAML step, not `cd ...` in `run:`.
4. **Windows path separators in glob:** `actions/upload-artifact` uses forward slashes even on Windows. Don't use `\`.
5. **macOS-14 runner is arm64.** If you write a step that downloads x64 binaries, you'll hit `bad CPU type`. Use `arch -arm64` or download arm64 builds.
6. **`fail-fast: false` is critical for cross-OS CI.** Default is `true` — first failure kills the other two and you can't see if they would have passed. Always disable.
7. **Concurrency `cancel-in-progress`** kills runs on the same branch but **not the PR target branch** — `main` runs are safe.
8. **`Swatinem/rust-cache@v2`** keys on `Cargo.lock` hash. Adding a workspace member without updating lock → cache stays stale until lock changes. Usually fine, occasionally causes phantom failures.
9. **Don't use `actions/cache@v4` directly for cargo** — too easy to get wrong (registry vs git-deps vs target). `Swatinem/rust-cache` handles all of it.
10. **Submodules:** project has none. `actions/checkout@v4` defaults are fine.
