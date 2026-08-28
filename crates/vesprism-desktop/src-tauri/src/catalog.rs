//! 设置页全量目录：不绑会话，直接读 `$GROK_HOME` / 工作区磁盘。

use crate::commands::desktop_home_dir;
use crate::commands::load_config_root;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};

fn toml_str(t: &toml::map::Map<String, toml::Value>, key: &str) -> String {
    t.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn toml_bool(t: &toml::map::Map<String, toml::Value>, key: &str, default: bool) -> bool {
    t.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

fn toml_string_array(v: &toml::Value) -> Vec<String> {
    match v {
        toml::Value::Array(arr) => arr
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect(),
        toml::Value::String(s) => split_args(s),
        _ => Vec::new(),
    }
}

fn split_args(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut quote: Option<char> = None;
    for ch in raw.chars() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => buf.push(ch),
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch.is_whitespace() => {
                if !buf.is_empty() {
                    out.push(std::mem::take(&mut buf));
                }
            }
            None => buf.push(ch),
        }
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

/// 从 `config.toml` `[mcp_servers.*]` 列出全部 MCP（无 live 状态）。
#[tauri::command]
pub fn list_catalog_mcp() -> Result<Value, String> {
    let root = load_config_root()?;
    let mut servers = Vec::new();
    let Some(table) = root.get("mcp_servers").and_then(|v| v.as_table()) else {
        return Ok(json!({ "servers": servers }));
    };
    for (name, spec) in table {
        let Some(t) = spec.as_table() else { continue };
        let command = toml_str(t, "command");
        let url = toml_str(t, "url");
        let args = t.get("args").map(toml_string_array).unwrap_or_default();
        let enabled = !toml_bool(t, "disabled", false) && toml_bool(t, "enabled", true);
        let transport = if !url.is_empty() { "http" } else { "stdio" };
        servers.push(json!({
            "name": name,
            "displayName": name,
            "source": "local",
            "sourceLabel": "config.toml",
            "type": transport,
            "command": command,
            "args": args,
            "url": url,
            "session": {
                "enabled": enabled,
                "status": "offline",
                "tools": [],
                "authRequired": false,
                "setupRequired": false,
            }
        }));
    }
    Ok(json!({ "servers": servers }))
}

fn read_frontmatter(md: &str) -> (String, String) {
    let trimmed = md.trim_start();
    if !trimmed.starts_with("---") {
        return (String::new(), String::new());
    }
    let rest = &trimmed[3..];
    let Some(end) = rest.find("\n---") else {
        return (String::new(), String::new());
    };
    let fm = &rest[..end];
    let mut name = String::new();
    let mut description = String::new();
    for line in fm.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("name:") {
            name = v.trim().trim_matches('"').trim_matches('\'').to_string();
        }
        if let Some(v) = line.strip_prefix("description:") {
            description = v.trim().trim_matches('"').trim_matches('\'').to_string();
        }
    }
    (name, description)
}

fn collect_skills_dir(dir: &Path, scope: &str, out: &mut Vec<Value>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        let folder = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let body = fs::read_to_string(&skill_md).unwrap_or_default();
        let (fm_name, description) = read_frontmatter(&body);
        let name = if fm_name.is_empty() { folder } else { fm_name };
        out.push(json!({
            "name": name,
            "displayName": name,
            "description": description,
            "scope": scope,
            "path": path.to_string_lossy(),
            "enabled": true,
            "userInvocable": true,
            "disableModelInvocation": false,
            "removable": scope == "user" || scope == "repo",
        }));
    }
}

/// 扫用户/仓库技能目录（`.grok/skills`、`$GROK_HOME/skills`）。
#[tauri::command]
pub fn list_catalog_skills(cwd: Option<String>) -> Result<Value, String> {
    let mut skills = Vec::new();
    let home = desktop_home_dir();
    collect_skills_dir(&home.join("skills"), "user", &mut skills);
    collect_skills_dir(&home.join("agents"), "user", &mut skills);
    if let Some(cwd) = cwd {
        let root = PathBuf::from(cwd.trim());
        if !cwd.trim().is_empty() {
            collect_skills_dir(&root.join(".grok").join("skills"), "repo", &mut skills);
            collect_skills_dir(&root.join(".agents").join("skills"), "local", &mut skills);
            collect_skills_dir(&root.join(".grok").join("agents"), "repo", &mut skills);
        }
    }
    Ok(json!({ "skills": skills }))
}

fn walk_memory(dir: &Path, source: &str, out: &mut Vec<Value>, depth: u8) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let next_source = if source == "global" {
                "workspace"
            } else {
                source
            };
            walk_memory(&path, next_source, out, depth + 1);
            continue;
        }
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if name != "memory.md" && !name.ends_with(".md") && !name.ends_with(".jsonl") {
            continue;
        }
        let src = if name == "memory.md" && dir == desktop_home_dir().join("memory") {
            "global"
        } else if name.contains("session") || name.ends_with(".jsonl") {
            "session"
        } else {
            source
        };
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        out.push(json!({
            "path": path.to_string_lossy(),
            "source": src,
            "sizeBytes": size,
        }));
    }
}

/// 列出 `$GROK_HOME/memory` 下全部记忆文件。
#[tauri::command]
pub fn list_catalog_memory() -> Result<Value, String> {
    let root = desktop_home_dir().join("memory");
    let mut files = Vec::new();
    if root.is_dir() {
        walk_memory(&root, "global", &mut files, 0);
    }
    Ok(json!({ "files": files }))
}

fn read_plugin_json(dir: &Path) -> Option<(String, String, String)> {
    for rel in [
        "plugin.json",
        ".grok-plugin/plugin.json",
        ".claude-plugin/plugin.json",
    ] {
        let p = dir.join(rel);
        if !p.is_file() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&p) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let name = v
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let description = v
            .get("description")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let version = v
            .get("version")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        return Some((name, description, version));
    }
    None
}

fn collect_plugins_dir(dir: &Path, scope: &str, out: &mut Vec<Value>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if folder.starts_with('.') {
            continue;
        }
        let (name, description, version) = read_plugin_json(&path)
            .unwrap_or_else(|| (folder.clone(), String::new(), String::new()));
        let id = if name.is_empty() {
            folder
        } else {
            name.clone()
        };
        out.push(json!({
            "id": id,
            "name": if name.is_empty() { id.clone() } else { name },
            "enabled": true,
            "description": description,
            "version": version,
            "scope": scope,
            "skillCount": 0,
            "mcpServerCount": 0,
            "root": path.to_string_lossy(),
        }));
    }
}

/// 扫用户/项目插件目录。
#[tauri::command]
pub fn list_catalog_plugins(cwd: Option<String>) -> Result<Value, String> {
    let mut plugins = Vec::new();
    let home = desktop_home_dir();
    collect_plugins_dir(&home.join("plugins"), "user", &mut plugins);
    if let Some(cwd) = cwd {
        let root = PathBuf::from(cwd.trim());
        if !cwd.trim().is_empty() {
            collect_plugins_dir(&root.join(".grok").join("plugins"), "project", &mut plugins);
        }
    }
    Ok(json!({ "plugins": plugins }))
}
