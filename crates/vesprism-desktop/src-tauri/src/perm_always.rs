//! 「总是允许」落在 `~/.vesprism/perm-always.json`，只由 Rust 在真实审批
//! 选了 allow_always 时写入。渲染进程不能直接改这份名单。

use crate::commands::desktop_home_dir;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Default, Serialize, Deserialize)]
struct AlwaysFile {
    #[serde(default)]
    grants: Vec<String>,
}

fn always_path() -> PathBuf {
    desktop_home_dir().join("perm-always.json")
}

fn load_from(path: &Path) -> AlwaysFile {
    let Ok(text) = std::fs::read_to_string(path) else {
        return AlwaysFile::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_to(path: &Path, file: &AlwaysFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建权限记忆目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    crate::commands::atomic_write(path, text.as_bytes())?;
    crate::commands::harden_env_file_permissions(path)
}

pub fn is_always_granted(sig: &str) -> bool {
    is_always_granted_in(&always_path(), sig)
}

pub fn is_always_granted_in(path: &Path, sig: &str) -> bool {
    if sig.is_empty() || !sig.starts_with("cmd:") {
        return false;
    }
    load_from(path).grants.iter().any(|g| g == sig)
}

pub fn remember_always(sig: &str) -> Result<(), String> {
    remember_always_in(&always_path(), sig)
}

pub fn remember_always_in(path: &Path, sig: &str) -> Result<(), String> {
    if !sig.starts_with("cmd:") {
        return Err("总是允许只接受命令签名".into());
    }
    let mut file = load_from(path);
    if !file.grants.iter().any(|g| g == sig) {
        file.grants.push(sig.to_string());
    }
    save_to(path, &file)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_file() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "vesprism-always-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("perm-always.json")
    }

    #[test]
    fn remember_round_trip_and_reject_kind_grant() {
        let path = tmp_file();
        assert!(!is_always_granted_in(&path, "cmd:npm run build"));
        remember_always_in(&path, "cmd:npm run build").unwrap();
        assert!(is_always_granted_in(&path, "cmd:npm run build"));
        assert!(!is_always_granted_in(&path, "cmd:npm run deploy"));
        assert!(remember_always_in(&path, "kind:运行终端命令").is_err());
        assert!(!is_always_granted_in(&path, "kind:运行终端命令"));
        let _ = std::fs::remove_file(&path);
        if let Some(dir) = path.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}
