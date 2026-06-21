//! Check and install agent integration hook scripts.
//!
//! Each agent integration is a shell/JS script embedded at compile-time.
//! The daemon can:
//!   - **check**: scan expected paths, parse version header, detect agent CLI,
//!     and verify the agent's config is wired to call the hook.
//!   - **install**: write the bundled script to the expected path + chmod +x,
//!     then wire the agent's config (Claude settings.json / Codex config.toml)
//!     to invoke it. OpenCode auto-loads plugins so no wiring is needed.
//!
//! Config files are mutated in place; a `.bak` copy is written first and
//! existing user entries are preserved (merge, never clobber).

use std::path::{Path, PathBuf};

use agentry_wire::IntegrationStatus;

// Embed scripts at compile time.
const CLAUDE_SCRIPT: &str = include_str!("../../integrations/claude/agentry-hook.sh");
const OPENCODE_SCRIPT: &str = include_str!("../../integrations/opencode/agentry-plugin.js");
const CODEX_SCRIPT: &str = include_str!("../../integrations/codex/agentry-hook.sh");
const HERMES_SCRIPT: &str = include_str!("../../integrations/hermes/agentry-hook.sh");

/// Claude hook events we wire. SessionStart/Stop/Notification drive activity
/// state; PreToolUse/PostToolUse additionally carry tool file paths (plan
/// detection). All five point at the same script.
const CLAUDE_HOOK_EVENTS: &[&str] = &[
    "SessionStart",
    "Stop",
    "Notification",
    "PreToolUse",
    "PostToolUse",
];

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
    /// Whether this agent needs separate config wiring beyond the script.
    needs_wiring: bool,
}

const DEFS: &[IntegrationDef] = &[
    IntegrationDef {
        agent: "claude",
        dest_rel: ".claude/hooks/agentry-hook.sh",
        script: CLAUDE_SCRIPT,
        version: 2,
        version_tag: "# AGENTRY_INTEGRATION_VERSION=",
        cli_binary: "claude",
        needs_wiring: true,
    },
    IntegrationDef {
        agent: "opencode",
        dest_rel: ".config/opencode/plugins/agentry-plugin.js",
        script: OPENCODE_SCRIPT,
        version: 2,
        version_tag: "// AGENTRY_INTEGRATION_VERSION=",
        cli_binary: "opencode",
        needs_wiring: false,
    },
    IntegrationDef {
        agent: "codex",
        dest_rel: ".codex/hooks/agentry-hook.sh",
        script: CODEX_SCRIPT,
        version: 3,
        version_tag: "# AGENTRY_INTEGRATION_VERSION=",
        cli_binary: "codex",
        needs_wiring: true,
    },
    IntegrationDef {
        agent: "hermes",
        dest_rel: ".hermes/agent-hooks/agentry-hook.sh",
        script: HERMES_SCRIPT,
        version: 1,
        version_tag: "# AGENTRY_INTEGRATION_VERSION=",
        cli_binary: "hermes",
        needs_wiring: true,
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

fn parse_installed_version(path: &Path, version_tag: &str) -> Option<u32> {
    let content = std::fs::read_to_string(path).ok()?;
    for line in content.lines() {
        if let Some(rest) = line.strip_prefix(version_tag) {
            return rest.trim().parse().ok();
        }
    }
    None
}

/// Write `content` to `path`, backing up any existing file to `<path>.bak`.
fn write_with_backup(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        let bak = path.with_extension(format!(
            "{}bak",
            path.extension()
                .and_then(|e| e.to_str())
                .map(|e| format!("{e}."))
                .unwrap_or_default()
        ));
        let _ = std::fs::copy(path, &bak);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create_dir_all {}: {e}", parent.display()))?;
    }
    std::fs::write(path, content).map_err(|e| format!("write {}: {e}", path.display()))
}

// ── Claude settings.json wiring ───────────────────────────────────────────────

fn claude_settings_path() -> PathBuf {
    home().join(".claude/settings.json")
}

fn claude_hook_command(script_path: &Path) -> String {
    format!("bash '{}' session", script_path.display())
}

/// True if every required Claude hook event has an entry whose command points
/// at our agentry hook script.
fn claude_hooks_wired() -> bool {
    let path = claude_settings_path();
    let Ok(content) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };
    let Some(hooks) = json.get("hooks").and_then(|h| h.as_object()) else {
        return false;
    };
    CLAUDE_HOOK_EVENTS.iter().all(|ev| {
        hooks
            .get(*ev)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter().any(|matcher| {
                    matcher
                        .get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|hs| {
                            hs.iter().any(|h| {
                                h.get("command")
                                    .and_then(|c| c.as_str())
                                    .map(|c| c.contains("agentry-hook.sh"))
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    })
}

/// Merge agentry hook entries into ~/.claude/settings.json, preserving any
/// existing hooks the user already configured for other tools.
fn wire_claude(script_path: &Path) -> Result<(), String> {
    let path = claude_settings_path();
    let mut root: serde_json::Value = if path.exists() {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        if content.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&content)
                .map_err(|e| format!("parse {}: {e}", path.display()))?
        }
    } else {
        serde_json::json!({})
    };

    if !root.is_object() {
        return Err("settings.json root is not an object".into());
    }
    let obj = root.as_object_mut().unwrap();
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    if !hooks.is_object() {
        return Err("settings.json `hooks` is not an object".into());
    }
    let hooks = hooks.as_object_mut().unwrap();

    let command = claude_hook_command(script_path);

    for ev in CLAUDE_HOOK_EVENTS {
        let arr = hooks
            .entry((*ev).to_string())
            .or_insert_with(|| serde_json::json!([]));
        if !arr.is_array() {
            return Err(format!("settings.json hooks.{ev} is not an array"));
        }
        let arr = arr.as_array_mut().unwrap();

        // Skip if an agentry entry already exists for this event.
        let already = arr.iter().any(|matcher| {
            matcher
                .get("hooks")
                .and_then(|h| h.as_array())
                .map(|hs| {
                    hs.iter().any(|h| {
                        h.get("command")
                            .and_then(|c| c.as_str())
                            .map(|c| c.contains("agentry-hook.sh"))
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false)
        });
        if already {
            continue;
        }

        arr.push(serde_json::json!({
            "matcher": "*",
            "hooks": [{ "type": "command", "command": command, "timeout": 10 }]
        }));
    }

    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    write_with_backup(&path, &pretty)
}

// ── Codex hooks.json + config.toml wiring ─────────────────────────────────────
//
// Codex (>= 0.139) reads Claude-style lifecycle hooks from ~/.codex/hooks.json
// and gates them behind a `[features] hooks = true` flag in ~/.codex/config.toml.
// Hook events in hooks.json use PascalCase keys (SessionStart, PreToolUse, …),
// mirroring Claude's schema. Per-hook trust (a `trusted_hash` under
// `[hooks.state."…"]`) is handled at launch time via --dangerously-bypass-hook-trust
// (see build_argv in session.rs), so we do not forge trust hashes here.

/// Codex home dir. Codex uses ~/.codex (NOT ~/.config/codex) for hooks.json,
/// config.toml and session rollouts (matches codex_watch.rs).
fn codex_home() -> PathBuf {
    home().join(".codex")
}

fn codex_config_path() -> PathBuf {
    codex_home().join("config.toml")
}

fn codex_hooks_path() -> PathBuf {
    codex_home().join("hooks.json")
}

/// Hook events we register in hooks.json (PascalCase, Claude-style). SessionStart
/// captures the agent session id; PreToolUse/PostToolUse drive the timeline
/// (tool names + file paths); Stop/Notification drive activity state.
const CODEX_HOOK_EVENTS: &[&str] = &[
    "SessionStart",
    "Stop",
    "Notification",
    "PreToolUse",
    "PostToolUse",
];

fn codex_hook_command(script_path: &Path) -> String {
    format!("bash '{}' session", script_path.display())
}

/// True if every required hook event in ~/.codex/hooks.json points at our hook
/// script AND config.toml enables the hooks feature.
fn codex_hooks_wired() -> bool {
    let feature_on = std::fs::read_to_string(codex_config_path())
        .map(|c| toml_hooks_feature_enabled(&c))
        .unwrap_or(false);
    if !feature_on {
        return false;
    }
    let Ok(content) = std::fs::read_to_string(codex_hooks_path()) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };
    let Some(hooks) = json.get("hooks").and_then(|h| h.as_object()) else {
        return false;
    };
    CODEX_HOOK_EVENTS.iter().all(|ev| {
        hooks
            .get(*ev)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter().any(|matcher| {
                    matcher
                        .get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|hs| {
                            hs.iter().any(|h| {
                                h.get("command")
                                    .and_then(|c| c.as_str())
                                    .map(|c| c.contains("agentry-hook.sh"))
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    })
}

/// Cheap check for `[features] hooks = true` without a full TOML parser.
/// We only need to know if the feature is on; tolerant of spacing/comments.
fn toml_hooks_feature_enabled(content: &str) -> bool {
    let mut in_features = false;
    for raw in content.lines() {
        let line = raw.trim();
        if line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            in_features = line == "[features]";
            continue;
        }
        if in_features {
            let norm: String = line.chars().filter(|c| !c.is_whitespace()).collect();
            if norm == "hooks=true" {
                return true;
            }
        }
    }
    false
}

/// Wire Codex to call our hook script: merge entries into ~/.codex/hooks.json
/// (Claude-style, preserving existing user hooks) and ensure
/// `[features] hooks = true` is set in ~/.codex/config.toml.
fn wire_codex(script_path: &Path) -> Result<(), String> {
    wire_codex_hooks_json(script_path)?;
    enable_codex_hooks_feature()
}

/// Merge agentry hook entries into ~/.codex/hooks.json, preserving any hooks the
/// user already configured (e.g. a herdr SessionStart entry). Mirrors wire_claude.
fn wire_codex_hooks_json(script_path: &Path) -> Result<(), String> {
    let path = codex_hooks_path();
    let mut root: serde_json::Value = if path.exists() {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        if content.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&content)
                .map_err(|e| format!("parse {}: {e}", path.display()))?
        }
    } else {
        serde_json::json!({})
    };

    if !root.is_object() {
        return Err("hooks.json root is not an object".into());
    }
    let obj = root.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| serde_json::json!({}));
    if !hooks.is_object() {
        return Err("hooks.json `hooks` is not an object".into());
    }
    let hooks = hooks.as_object_mut().unwrap();

    let command = codex_hook_command(script_path);

    for ev in CODEX_HOOK_EVENTS {
        let arr = hooks
            .entry((*ev).to_string())
            .or_insert_with(|| serde_json::json!([]));
        if !arr.is_array() {
            return Err(format!("hooks.json hooks.{ev} is not an array"));
        }
        let arr = arr.as_array_mut().unwrap();

        // Skip if an agentry entry already exists for this event.
        let already = arr.iter().any(|matcher| {
            matcher
                .get("hooks")
                .and_then(|h| h.as_array())
                .map(|hs| {
                    hs.iter().any(|h| {
                        h.get("command")
                            .and_then(|c| c.as_str())
                            .map(|c| c.contains("agentry-hook.sh"))
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false)
        });
        if already {
            continue;
        }

        arr.push(serde_json::json!({
            "hooks": [{ "type": "command", "command": command, "timeout": 10 }]
        }));
    }

    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    write_with_backup(&path, &pretty)
}

/// Ensure `[features] hooks = true` exists in ~/.codex/config.toml. Idempotent;
/// preserves the rest of the file. If a `[features]` table exists we append the
/// key under it; otherwise we append a fresh table.
fn enable_codex_hooks_feature() -> Result<(), String> {
    let path = codex_config_path();
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if toml_hooks_feature_enabled(&existing) {
        return Ok(());
    }

    let mut next = existing;
    // If a [features] table already exists, insert the key right after it.
    if let Some(idx) = next.lines().position(|l| l.trim() == "[features]") {
        let mut lines: Vec<String> = next.lines().map(|s| s.to_string()).collect();
        lines.insert(idx + 1, "hooks = true".to_string());
        next = lines.join("\n");
        if !next.ends_with('\n') {
            next.push('\n');
        }
    } else {
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str("\n# agentry-integration\n[features]\nhooks = true\n");
    }
    write_with_backup(&path, &next)
}

// ── Hermes config.yaml hooks wiring ──────────────────────────────────────────
//
// Hermes runs "shell hooks" declared as a `hooks:` block in ~/.hermes/config.yaml.
// Unlike Claude/Codex (JSON, PascalCase events), Hermes uses YAML with snake_case
// event names and a stdin JSON payload keyed on `hook_event_name`. We register
// the script under four lifecycle events. `--accept-hooks` (passed at launch in
// session.rs) auto-approves the first-use consent prompt.

/// Hermes hook events we register (snake_case). on_session_start captures the
/// agent session id; pre/post_tool_call drive the timeline + activity; on_session_end
/// flips activity back to idle.
const HERMES_HOOK_EVENTS: &[&str] = &[
    "on_session_start",
    "pre_tool_call",
    "post_tool_call",
    "on_session_end",
];

fn hermes_config_path() -> PathBuf {
    home().join(".hermes/config.yaml")
}

/// True if every required event in ~/.hermes/config.yaml has an entry whose
/// `command` points at our hook script.
fn hermes_hooks_wired() -> bool {
    let Ok(content) = std::fs::read_to_string(hermes_config_path()) else {
        return false;
    };
    let Ok(root) = serde_yaml::from_str::<serde_yaml::Value>(&content) else {
        return false;
    };
    let Some(hooks) = root.get("hooks").and_then(|h| h.as_mapping()) else {
        return false;
    };
    HERMES_HOOK_EVENTS.iter().all(|ev| {
        hooks
            .get(serde_yaml::Value::String((*ev).to_string()))
            .and_then(|v| v.as_sequence())
            .map(|arr| {
                arr.iter().any(|entry| {
                    entry
                        .get("command")
                        .and_then(|c| c.as_str())
                        .map(|c| c.contains("agentry-hook.sh"))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    })
}

/// Merge agentry hook entries into ~/.hermes/config.yaml under the `hooks:` key,
/// preserving any hooks the user already configured. serde_yaml round-trips lose
/// comments and may reorder keys, so write_with_backup keeps a `.bak` copy.
fn wire_hermes(script_path: &Path) -> Result<(), String> {
    let path = hermes_config_path();
    let mut root: serde_yaml::Value = if path.exists() {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        if content.trim().is_empty() {
            serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
        } else {
            serde_yaml::from_str(&content)
                .map_err(|e| format!("parse {}: {e}", path.display()))?
        }
    } else {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    };

    let map = root
        .as_mapping_mut()
        .ok_or_else(|| "config.yaml root is not a mapping".to_string())?;

    // `hooks:` may exist as null (`hooks:`) or an empty mapping (`hooks: {}`).
    let hooks_key = serde_yaml::Value::String("hooks".to_string());
    let needs_init = match map.get(&hooks_key) {
        Some(v) => !v.is_mapping(),
        None => true,
    };
    if needs_init {
        map.insert(
            hooks_key.clone(),
            serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
        );
    }
    let hooks = map
        .get_mut(&hooks_key)
        .and_then(|v| v.as_mapping_mut())
        .ok_or_else(|| "config.yaml `hooks` is not a mapping".to_string())?;

    let command = format!("bash '{}'", script_path.display());

    for ev in HERMES_HOOK_EVENTS {
        let ev_key = serde_yaml::Value::String((*ev).to_string());
        let entry = hooks
            .entry(ev_key)
            .or_insert_with(|| serde_yaml::Value::Sequence(Vec::new()));
        let arr = entry
            .as_sequence_mut()
            .ok_or_else(|| format!("config.yaml hooks.{ev} is not a sequence"))?;

        // Skip if an agentry entry already exists for this event.
        let already = arr.iter().any(|e| {
            e.get("command")
                .and_then(|c| c.as_str())
                .map(|c| c.contains("agentry-hook.sh"))
                .unwrap_or(false)
        });
        if already {
            continue;
        }

        let mut item = serde_yaml::Mapping::new();
        item.insert(
            serde_yaml::Value::String("command".to_string()),
            serde_yaml::Value::String(command.clone()),
        );
        arr.push(serde_yaml::Value::Mapping(item));
    }

    let serialized = serde_yaml::to_string(&root).map_err(|e| e.to_string())?;
    write_with_backup(&path, &serialized)
}

// ── Public API ────────────────────────────────────────────────────────────────

fn hooks_wired(agent: &str) -> Option<bool> {
    match agent {
        "claude" => Some(claude_hooks_wired()),
        "codex" => Some(codex_hooks_wired()),
        "hermes" => Some(hermes_hooks_wired()),
        _ => None, // opencode auto-loads plugins
    }
}

fn manual_step(agent: &str, wired: Option<bool>) -> Option<String> {
    if wired == Some(false) {
        match agent {
            "claude" => Some(
                "Click Install to wire ~/.claude/settings.json (SessionStart, Stop, Notification, PreToolUse, PostToolUse). Restart your Claude session afterward.".into(),
            ),
            "codex" => Some(
                "Click Install to register agentry hooks in ~/.codex/hooks.json and enable [features] hooks in ~/.codex/config.toml. Restart Codex afterward.".into(),
            ),
            "hermes" => Some(
                "Click Install to register agentry hooks in ~/.hermes/config.yaml (on_session_start, pre_tool_call, post_tool_call, on_session_end). Restart your Hermes session afterward.".into(),
            ),
            _ => None,
        }
    } else {
        None
    }
}

pub fn check_all() -> Vec<IntegrationStatus> {
    let home = home();
    DEFS.iter()
        .map(|def| {
            let install_path = home.join(def.dest_rel);
            let script_present = install_path.exists();
            let installed_version = if script_present {
                parse_installed_version(&install_path, def.version_tag)
            } else {
                None
            };
            let needs_update = installed_version.map(|v| v < def.version).unwrap_or(false);

            let wired = if def.needs_wiring {
                hooks_wired(def.agent)
            } else {
                None
            };

            // For agents that need wiring, "installed" means BOTH the script is
            // present AND the config points at it — otherwise the hook never runs.
            let installed = script_present && wired != Some(false);

            IntegrationStatus {
                agent: def.agent.to_string(),
                agent_detected: detect_cli(def.cli_binary),
                installed,
                installed_version,
                latest_version: def.version,
                needs_update,
                install_path: install_path.to_string_lossy().to_string(),
                manual_step: manual_step(def.agent, wired),
                hooks_wired: wired,
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
    write_with_backup(&dest, def.script)?;

    // chmod +x for shell scripts
    if dest.extension().map(|e| e == "sh").unwrap_or(false) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&dest).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&dest, perms).map_err(|e| e.to_string())?;
        }
    }

    // Wire the agent config so the hook actually fires.
    match def.agent {
        "claude" => wire_claude(&dest)?,
        "codex" => wire_codex(&dest)?,
        "hermes" => wire_hermes(&dest)?,
        _ => {}
    }

    tracing::info!("installed {} integration -> {}", agent, dest.display());

    let wired = if def.needs_wiring {
        hooks_wired(def.agent)
    } else {
        None
    };

    Ok(IntegrationStatus {
        agent: def.agent.to_string(),
        agent_detected: detect_cli(def.cli_binary),
        installed: true,
        installed_version: Some(def.version),
        latest_version: def.version,
        needs_update: false,
        install_path: dest.to_string_lossy().to_string(),
        manual_step: manual_step(def.agent, wired),
        hooks_wired: wired,
    })
}
