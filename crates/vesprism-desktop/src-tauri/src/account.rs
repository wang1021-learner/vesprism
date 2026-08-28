//! 官方账号登录 / 退出。
//!
//! 走 `xai_grok_shell::auth::run_cli_login` / `run_cli_logout`，
//! 凭证写入本机 `auth.json`，与命令行登录同一份。桌面默认走浏览器回环授权。

use serde::Serialize;
use std::sync::OnceLock;
use tokio::sync::Mutex;
use xai_grok_shell::auth::{AuthMode, GrokAuth};

fn login_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub(crate) fn load_agent_config() -> Result<xai_grok_shell::agent::config::Config, String> {
    let raw = xai_grok_shell::config::load_effective_config()
        .map_err(|e| format!("加载配置失败: {e}"))?;
    xai_grok_shell::agent::config::Config::new_from_toml_cfg(&raw)
        .map_err(|e| format!("创建 agent 配置失败: {e}"))
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountStatusDto {
    pub logged_in: bool,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub team_name: Option<String>,
    pub mode: Option<String>,
    pub api_key_env: bool,
}

fn mode_label(mode: &AuthMode) -> &'static str {
    match mode {
        AuthMode::Oidc => "账号",
        AuthMode::ApiKey => "密钥",
        AuthMode::External => "外部登录",
        AuthMode::WebLogin => "旧版登录",
    }
}

fn display_name(auth: &GrokAuth) -> Option<String> {
    let first = auth.first_name.as_deref().unwrap_or("").trim();
    let last = auth.last_name.as_deref().unwrap_or("").trim();
    let name = format!("{first} {last}").trim().to_string();
    if !name.is_empty() {
        return Some(name);
    }
    auth.email.clone()
}

fn status_from_auth(auth: Option<GrokAuth>, api_key_env: bool) -> AccountStatusDto {
    match auth {
        Some(a) => AccountStatusDto {
            logged_in: true,
            display_name: display_name(&a),
            email: a.email,
            team_name: a.team_name,
            mode: Some(mode_label(&a.auth_mode).to_string()),
            api_key_env,
        },
        None => AccountStatusDto {
            logged_in: false,
            email: None,
            display_name: None,
            team_name: None,
            mode: None,
            api_key_env,
        },
    }
}

async fn current_status() -> Result<AccountStatusDto, String> {
    let cfg = load_agent_config()?;
    let auth = xai_grok_shell::auth::try_ensure_fresh_auth(&cfg.grok_com_config).await;
    let api_key_env = xai_grok_shell::agent::auth_method::has_xai_api_key_env();
    Ok(status_from_auth(auth, api_key_env))
}

#[tauri::command]
pub async fn account_status() -> Result<AccountStatusDto, String> {
    current_status().await
}

/// 官方 `run_cli_login` 内部有 Rc，不能在 Tauri 多线程 runtime 上直接 await。
fn run_cli_login_local() -> Result<(), String> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("无法启动登录运行时: {e}"))?;
    let local = tokio::task::LocalSet::new();
    local.block_on(&rt, async {
        let cfg = load_agent_config()?;
        // oauth=true：浏览器回环，适合桌面窗口；不走 SSH 用的设备码。
        xai_grok_shell::auth::run_cli_login(&cfg, true, false, false)
            .await
            .map_err(|e| format!("登录失败: {e}"))
    })
}

/// 打开系统浏览器完成官方授权。正在登录时拒绝第二次点击。
#[tauri::command]
pub async fn account_login() -> Result<AccountStatusDto, String> {
    let Ok(_guard) = login_lock().try_lock() else {
        return Err("正在登录，请先在浏览器里完成授权".into());
    };
    tokio::task::spawn_blocking(run_cli_login_local)
        .await
        .map_err(|e| format!("登录任务失败: {e}"))??;
    current_status().await
}

#[tauri::command]
pub async fn account_logout() -> Result<AccountStatusDto, String> {
    let cfg = load_agent_config()?;
    xai_grok_shell::auth::run_cli_logout(&cfg).map_err(|e| format!("退出失败: {e}"))?;
    current_status().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_from_auth_empty() {
        let s = status_from_auth(None, true);
        assert!(!s.logged_in);
        assert!(s.api_key_env);
        assert!(s.email.is_none());
    }
}
