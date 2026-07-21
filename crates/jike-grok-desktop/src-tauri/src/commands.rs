use crate::state::{ActorCommand, AppState};
use std::path::PathBuf;
use tauri::State;
use tokio::sync::oneshot;

/// 向会话 Actor 发送命令并等待一次性回执。
async fn send_cmd(
    state: &AppState,
    make: impl FnOnce(oneshot::Sender<Result<(), String>>) -> ActorCommand,
) -> Result<(), String> {
    let (reply_tx, reply_rx) = oneshot::channel();
    state
        .cmd_tx
        .send(make(reply_tx))
        .map_err(|_| "会话线程已退出".to_string())?;
    reply_rx
        .await
        .map_err(|_| "会话线程无响应".to_string())?
}

/// 解析 monorepo 仓库根目录（agent 的默认工作区）。
///
/// 优先级：
/// 1. 环境变量 `GROK_DESKTOP_CWD`（用户显式指定）
/// 2. 由编译期 `CARGO_MANIFEST_DIR`（…/jike-grok-desktop/src-tauri）向上三级到仓库根
/// 3. 进程当前目录（兜底）
fn resolve_repo_root() -> PathBuf {
    if let Ok(p) = std::env::var("GROK_DESKTOP_CWD") {
        let path = PathBuf::from(p);
        if path.is_dir() {
            return path;
        }
    }

    // src-tauri → jike-grok-desktop → crates → 仓库根
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(root) = manifest
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
    {
        if root.is_dir() {
            return root.to_path_buf();
        }
    }

    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// 返回 agent 使用的工作目录（固定为 monorepo 仓库根，除非设置了 GROK_DESKTOP_CWD）。
#[tauri::command]
pub fn workspace_cwd() -> String {
    resolve_repo_root().display().to_string()
}

/// 在进程内为指定 `cwd` 启动 Grok agent 会话。
#[tauri::command]
pub async fn start_session(cwd: String, state: State<'_, AppState>) -> Result<(), String> {
    send_cmd(&state, |reply| ActorCommand::Start { cwd, reply }).await
}

/// 发送用户消息；流式回复通过 `session-event` 推送。
#[tauri::command]
pub async fn send_prompt(text: String, state: State<'_, AppState>) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("消息不能为空".into());
    }
    send_cmd(&state, |reply| ActorCommand::SendPrompt { text, reply }).await
}

/// 取消当前生成轮次。
#[tauri::command]
pub async fn cancel_turn(state: State<'_, AppState>) -> Result<(), String> {
    send_cmd(&state, |reply| ActorCommand::Cancel { reply }).await
}

/// 回答界面上的工具权限请求。
#[tauri::command]
pub async fn respond_permission(
    request_id: u64,
    option_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    send_cmd(&state, |reply| ActorCommand::RespondPermission {
        request_id,
        option_id,
        reply,
    })
    .await
}
