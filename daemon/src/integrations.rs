//! Check and install agent integration hook scripts.
//!
//! Each agent integration is a shell/JS script embedded at compile-time.
//! The daemon can:
//!   - **check**: scan expected paths, parse version header, detect agent CLI.
//!   - **install**: write the bundled script to the expected path + chmod +x.
//!
//! For Claude, installing the script alone is not enough — the user must also
//! add hook entries to ~/.claude/settings.json. We surface this as `manual_step`.

use std::path::PathBuf;

use agentry_wire::IntegrationStatus;

// Embed scripts at compile time.
const CLAUDE_SCRIPT: &str =
    include_str!("../../integrations/claude/agentry-hook.sh");
const OPENCODE_SCRIPT: &str =
    include_str!("../../integrations/opencode/agentry-plugin.js");
const CODEX_SCRIPT: &str =
    include_str!("../../integrations/codex/agentry-hook.sh");

struct IntegrationDef {
    agent: &'static str,
    /// Relative to $HOME.
    dest_rel: &'static str,
    script: &'static str,
    version: u32,
    /// e.g. AGENTRY_INTEGRATION_VERSION=1
    version_tag: &'static str,
    /// Binary name to test with `which`.
    cli_binary: &'static str,
    manual_step: Option<&'static str>,
}

const DEFS: &[IntegrationDef] = &[
    IntegrationDef {
        agent: "claude",
        dest_rel: ".claude/hooks/agentry-hook.sh",
        script: CLAUDE_SCRIPT,
        version: 1,
        version_tag: "# AGENTRY_INTEGRATION_VERSION=",
        cli_binary: "claude",
        manual_step: Some(
            "Add hook entries to ~/.claude/settings.json (SessionStart, Stop, Notification, PreToolUse, PostToolUse). See integrations/claude/agentry-hook.sh header for the JSON snippet.",
        ),
    },
    IntegrationDef {
        agent: "opencode",
        dest_rel: ".config/opencode/plugins/agentry-plugin.js",
        script: OPENCODE_SCRIPT,
        version: 1,
        version_tag: "// AGENTRY_INTEGRATION_VERSION=",
        cli_binary: "opencode",
        manual_step: None,
    },
    IntegrationDef {
        agent: "codex",
        dest_rel: ".config/codex/hooks/agentry-hook.sh",
        script: CODEX_SCRIPT,
        version: 1,
        version_tag: "# AGENTRY_INTEGRATION_VERSION=",
        cli_binary: "codex",
        manual_step: Some(
            "Wire the hook via CODEX_HOOK env or ~/.config/codex/config.toml [hooks] section.",
        ),
    },
];

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/root".to_string()))
}

fn detect_cli(binary: &str) -> bool {
    std::process::Command::new("which")
        .arg(binary)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn parse_installed_version(path: &PathBuf, version_tag: &str) -> Option<u32> {
    let content = std::fs::read_to_string(path).ok()?;
    for line in content.lines() {
        if let Some(rest) = line.strip_prefix(version_tag) {
            return rest.trim().parse().ok();
        }
    }
    None
}

pub fn check_all() -> Vec<IntegrationStatus> {
    let home = home();
    DEFS.iter()
        .map(|def| {
            let install_path = home.join(def.dest_rel);
            let installed = install_path.exists();
            let installed_version = if installed {
                parse_installed_version(&install_path, def.version_tag)
            } else {
                None
            };
            let needs_update = installed_version
                .map(|v| v < def.version)
                .unwrap_or(false);
            IntegrationStatus {
                agent: def.agent.to_string(),
                agent_detected: detect_cli(def.cli_binary),
                installed,
                installed_version,
                latest_version: def.version,
                needs_update,
                install_path: install_path.to_string_lossy().to_string(),
                manual_step: def.manual_step.map(str::to_string),
            }
        })
        .collect()
}

pub fn install(agent: &str) -> Result<IntegrationStatus, String> {
    let home = home();
    let def = DEFS
        .iter()
        .find(|d| d.agent == agent)
        .ok_or_else(|| format!("unknown agent: {agent}"))?;

    let dest = home.join(def.dest_rel);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
    }
    std::fs::write(&dest, def.script)
        .map_err(|e| format!("write {}: {e}", dest.display()))?;

    // chmod +x for shell scripts
    if dest
        .extension()
        .map(|e| e == "sh")
        .unwrap_or(false)
    {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&dest)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&dest, perms).map_err(|e| e.to_string())?;
        }
    }

    tracing::info!("installed {} integration -> {}", agent, dest.display());

    Ok(IntegrationStatus {
        agent: def.agent.to_string(),
        agent_detected: detect_cli(def.cli_binary),
        installed: true,
        installed_version: Some(def.version),
        latest_version: def.version,
        needs_update: false,
        install_path: dest.to_string_lossy().to_string(),
        manual_step: def.manual_step.map(str::to_string),
    })
}
