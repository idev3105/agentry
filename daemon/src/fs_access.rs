//! Read-only filesystem access for the GUI explorer/viewer.
//! Every path is canonicalized and must resolve under one of the allowed
//! roots (project paths + live session cwds). This stops a malicious remote
//! client from reading arbitrary files (e.g. /etc/shadow) via read_file.

use std::fs;
use std::path::PathBuf;

/// One directory entry returned to the GUI.
#[derive(Debug, serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Unix mtime in seconds (0 if unavailable).
    pub modified: u64,
}

/// File content payload. Bytes are base64-encoded so binary-ish data survives
/// the JSON transport; the GUI decodes then renders as UTF-8 (lossy).
#[derive(Debug, serde::Serialize)]
pub struct FileContent {
    pub path: String,
    pub data_b64: String,
    pub size: u64,
    pub truncated: bool,
    /// Heuristic: contains a NUL byte in the inspected prefix.
    pub is_binary: bool,
}

const DEFAULT_MAX_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB viewer cap

/// Canonicalize `target` and ensure it lives under at least one allowed root.
/// `roots` are themselves canonicalized for a fair prefix compare.
fn guard<'a>(target: &str, roots: impl IntoIterator<Item = &'a str>) -> Result<PathBuf, String> {
    let canon = fs::canonicalize(target).map_err(|e| format!("path_error: {e}"))?;
    for root in roots {
        if let Ok(rc) = fs::canonicalize(root) {
            if canon.starts_with(&rc) {
                return Ok(canon);
            }
        }
    }
    Err("forbidden: path is outside any allowed project/session root".to_string())
}

/// List a directory. Entries sorted dirs-first then name (case-insensitive).
pub fn list_dir<'a>(
    path: &str,
    roots: impl IntoIterator<Item = &'a str>,
) -> Result<Vec<DirEntry>, String> {
    let dir = guard(path, roots)?;
    if !dir.is_dir() {
        return Err("not_a_directory".to_string());
    }
    let mut out: Vec<DirEntry> = Vec::new();
    let rd = fs::read_dir(&dir).map_err(|e| format!("read_dir: {e}"))?;
    for entry in rd.flatten() {
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(DirEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

/// Read a file (capped). Returns base64 + binary/truncation flags.
pub fn read_file<'a>(
    path: &str,
    max_bytes: Option<u64>,
    roots: impl IntoIterator<Item = &'a str>,
) -> Result<FileContent, String> {
    use base64::Engine;
    let file = guard(path, roots)?;
    if !file.is_file() {
        return Err("not_a_file".to_string());
    }
    let cap = max_bytes.unwrap_or(DEFAULT_MAX_BYTES).min(DEFAULT_MAX_BYTES);
    let full = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    let bytes = fs::read(&file).map_err(|e| format!("read: {e}"))?;
    let truncated = bytes.len() as u64 > cap;
    let slice = if truncated {
        &bytes[..cap as usize]
    } else {
        &bytes[..]
    };
    let is_binary = slice.iter().take(8192).any(|&b| b == 0);
    let data_b64 = base64::engine::general_purpose::STANDARD.encode(slice);
    Ok(FileContent {
        path: file.to_string_lossy().to_string(),
        data_b64,
        size: full,
        truncated,
        is_binary,
    })
}
