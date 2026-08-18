//! 会话级隔离工作区：在 `~/.vesprism/sandboxes/<tab>/` 建 git worktree。
//! 官方 `xai-grok-sandbox` 的内核沙箱是进程级且仅 Unix，不能套在 Tauri 窗口进程上。
//! 桌面端用 worktree 做可落地的文件系统隔离（命令与写文件都发生在副本里）。

use std::path::{Path, PathBuf};
use std::process::Command;

pub fn sandbox_root() -> PathBuf {
    crate::commands::desktop_home_dir().join("sandboxes")
}

fn sanitize_tab(tab_id: &str) -> String {
    tab_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn sandbox_path_for(tab_id: &str) -> PathBuf {
    sandbox_root().join(sanitize_tab(tab_id))
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("执行 git 失败: {e}"))
}

fn is_git_repo(cwd: &Path) -> bool {
    run_git(cwd, &["rev-parse", "--is-inside-work-tree"])
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .is_some_and(|s| s.trim().eq_ignore_ascii_case("true"))
}

/// 为该 tab 准备隔离 worktree。已存在则先拆除再重建，避免脏副本。
pub fn prepare_sandbox_worktree(origin: &Path, tab_id: &str) -> Result<PathBuf, String> {
    if !origin.is_dir() {
        return Err("工作区不存在，无法创建沙箱".into());
    }
    if !is_git_repo(origin) {
        return Err(
            "沙箱模式需要 git 仓库（用 worktree 隔离文件与命令）。请先 git init，或改用审批/信任模式。"
                .into(),
        );
    }
    let dest = sandbox_path_for(tab_id);
    if dest.exists() {
        let _ = teardown_sandbox_worktree(origin, &dest);
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建沙箱目录失败: {e}"))?;
    }
    let dest_str = dest.to_string_lossy().to_string();
    let add = run_git(origin, &["worktree", "add", "--detach", &dest_str])?;
    if !add.status.success() {
        let err = String::from_utf8_lossy(&add.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "创建隔离 worktree 失败".into()
        } else {
            format!("创建隔离 worktree 失败: {err}")
        });
    }
    let _ = std::fs::write(
        dest.join(".vesprism-sandbox-origin"),
        origin.to_string_lossy().as_bytes(),
    );
    Ok(dest)
}

pub fn teardown_sandbox_worktree(origin: &Path, dest: &Path) -> Result<(), String> {
    let dest_str = dest.to_string_lossy().to_string();
    if origin.is_dir() {
        let _ = run_git(origin, &["worktree", "remove", "--force", &dest_str]);
        let _ = run_git(origin, &["worktree", "prune"]);
    }
    if dest.exists() {
        std::fs::remove_dir_all(dest).map_err(|e| format!("删除沙箱目录失败: {e}"))?;
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub struct SandboxBind {
    pub origin: PathBuf,
    pub dest: PathBuf,
}

const MARKER: &str = ".vesprism-sandbox-origin";

fn porcelain_paths(dest: &Path) -> Result<Vec<String>, String> {
    let out = run_git(dest, &["status", "--porcelain", "-z"])?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let mut paths = Vec::new();
    for raw in out.stdout.split(|b| *b == 0) {
        if raw.len() < 4 {
            continue;
        }
        // "XY path" ；rename 取新路径
        let rel = String::from_utf8_lossy(&raw[3..]).replace('\\', "/");
        let name = rel.rsplit('/').next().unwrap_or(&rel);
        if name == MARKER || rel.is_empty() {
            continue;
        }
        paths.push(rel);
    }
    Ok(paths)
}

fn git_with_ident(cwd: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .args([
            "-c",
            "user.name=Vesprism",
            "-c",
            "user.email=vesprism@localhost",
        ])
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("执行 git 失败: {e}"))
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct SandboxInfoDto {
    pub active: bool,
    pub origin_cwd: String,
    pub sandbox_cwd: String,
    pub dirty_count: u32,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct SandboxSyncDto {
    pub files: u32,
    pub message: String,
}

pub fn sandbox_info(bind: &SandboxBind) -> Result<SandboxInfoDto, String> {
    let dirty = if bind.dest.is_dir() {
        porcelain_paths(&bind.dest)?.len() as u32
    } else {
        0
    };
    Ok(SandboxInfoDto {
        active: bind.dest.is_dir(),
        origin_cwd: bind.origin.to_string_lossy().into_owned(),
        sandbox_cwd: bind.dest.to_string_lossy().into_owned(),
        dirty_count: dirty,
    })
}

/// 把隔离 worktree 的改动提交到临时分支，再 merge 回主仓库。
pub fn sync_to_origin(bind: &SandboxBind, tab_id: &str) -> Result<SandboxSyncDto, String> {
    if !bind.dest.is_dir() {
        return Err("沙箱目录不存在".into());
    }
    if !bind.origin.is_dir() {
        return Err("主工作区不存在".into());
    }
    let dirty = porcelain_paths(&bind.dest)?;
    if dirty.is_empty() {
        return Ok(SandboxSyncDto {
            files: 0,
            message: "沙箱没有可同步的改动".into(),
        });
    }
    let branch = format!("vesprism-sandbox/{}", sanitize_tab(tab_id));
    let co = run_git(&bind.dest, &["checkout", "-B", &branch])?;
    if !co.status.success() {
        return Err(format!(
            "无法在沙箱建分支: {}",
            String::from_utf8_lossy(&co.stderr).trim()
        ));
    }
    let _ = run_git(&bind.dest, &["add", "-A"]);
    let _ = run_git(&bind.dest, &["reset", "HEAD", "--", MARKER]);
    let commit = git_with_ident(
        &bind.dest,
        &["commit", "-m", &format!("vesprism sandbox sync ({tab_id})")],
    )?;
    if !commit.status.success() {
        let err = String::from_utf8_lossy(&commit.stderr);
        let out = String::from_utf8_lossy(&commit.stdout);
        if !out.contains("nothing to commit") && !err.contains("nothing to commit") {
            return Err(format!("沙箱提交失败: {}", err.trim()));
        }
    }
    let merge = run_git(&bind.origin, &["merge", "--no-edit", "--no-ff", &branch])?;
    if !merge.status.success() {
        let _ = run_git(&bind.origin, &["merge", "--abort"]);
        return Err(format!(
            "同步到主仓库失败（可能有冲突，已中止合并）: {}",
            String::from_utf8_lossy(&merge.stderr).trim()
        ));
    }
    Ok(SandboxSyncDto {
        files: dirty.len() as u32,
        message: format!("已将 {} 个文件同步回主仓库", dirty.len()),
    })
}
