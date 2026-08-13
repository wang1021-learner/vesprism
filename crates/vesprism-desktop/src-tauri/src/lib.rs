mod commands;
mod sandbox;
mod session_index;
mod state;

use state::{spawn_supervisor, AppState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 桌面 app 使用独立的 GROK_HOME，与命令行 grok 及 grok-gui-poc 完全隔离。
    // 必须在任何配置读取（grok_home() 首次调用）之前设置，否则 OnceLock 会锁定为默认值。
    // 密钥与 config.toml 一律放在此目录，**禁止**依赖仓库内 crates/vesprism-desktop/.env。
    let home = dirs::home_dir().expect("无法获取用户主目录");
    let desktop_grok_home = home.join(".vesprism");
    let legacy_home = home.join(".jike-grok-desktop");

    // 一次性：旧目录 ~/.jike-grok-desktop → ~/.vesprism
    if !desktop_grok_home.exists() && legacy_home.exists() {
        match std::fs::rename(&legacy_home, &desktop_grok_home) {
            Ok(()) => eprintln!(
                "[vesprism] 已迁移配置目录 {} → {}",
                legacy_home.display(),
                desktop_grok_home.display()
            ),
            Err(e) => {
                eprintln!(
                    "[vesprism] 迁移配置目录失败（{e}），将创建新目录 {}",
                    desktop_grok_home.display()
                );
            }
        }
    }

    if !desktop_grok_home.exists() {
        std::fs::create_dir_all(&desktop_grok_home)
            .expect("创建隔离配置目录失败");
    }

    // SAFETY: 此时进程尚处于单线程启动阶段，早于任何读取 GROK_HOME 的代码路径
    // （grok_home() 首次调用发生在 .setup() 内的 GrokSession::start()），
    // 不存在并发访问环境变量的竞争。
    unsafe {
        std::env::set_var("GROK_HOME", &desktop_grok_home);
    }

    // 一次性迁移：若用户目录尚无 .env，而旧版曾把密钥写在仓库包目录，则复制过来。
    // 之后只读 $GROK_HOME/.env；仓库内 .env 不再参与加载。
    let secrets_env = desktop_grok_home.join(".env");
    if !secrets_env.exists() {
        let legacy = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.join(".env"));
        if let Some(legacy) = legacy {
            if legacy.is_file() {
                match std::fs::copy(&legacy, &secrets_env) {
                    Ok(_) => eprintln!(
                        "[vesprism] 已将旧版密钥迁移到 {}",
                        secrets_env.display()
                    ),
                    Err(e) => eprintln!(
                        "[vesprism] 迁移旧版 .env 失败（{} → {}）: {e}",
                        legacy.display(),
                        secrets_env.display()
                    ),
                }
            }
        }
    }

    // 仅从用户隔离目录加载密钥（不扫描仓库内相对路径）。
    if secrets_env.is_file() {
        if let Err(e) = dotenvy::from_path_override(&secrets_env) {
            eprintln!(
                "[vesprism] 加载 {} 失败: {e}",
                secrets_env.display()
            );
        }
        commands::harden_env_file_permissions(&secrets_env);
    }

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 启动 Supervisor 线程（管理所有 tab 的会话 Actor），并把句柄交给 Tauri 状态管理。
            let (supervisor_tx, tabs) = spawn_supervisor(app.handle().clone());
            app.manage(AppState {
                tabs,
                supervisor_tx,
                workspace_cwd_override: std::sync::Arc::new(std::sync::Mutex::new(None)),
                sandbox_tabs: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashSet::new())),
                sandbox_binds: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            });

            // 索引启动兜底：一次性全量重建，之后由 TurnEnded 增量 upsert 维护，list_sessions 不再反应式重建。
            tauri::async_runtime::spawn(async {
                if let Err(e) = crate::commands::rebuild_session_index_full().await {
                    log::warn!("会话索引启动重建失败: {e}");
                }
            });

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_tab,
            commands::close_tab,
            commands::restart_tab,
            commands::workspace_cwd,
            commands::set_workspace_cwd,
            commands::get_security_policy,
            commands::set_security_policy,
            commands::enable_tab_sandbox,
            commands::get_sandbox_status,
            commands::sync_sandbox_to_origin,
            commands::start_session,
            commands::send_prompt,
            commands::cancel_turn,
            commands::respond_permission,
            commands::respond_user_question,
            commands::cancel_subagent,
            commands::get_subagent,
            commands::list_mcp_servers,
            commands::toggle_mcp_server,
            commands::upsert_mcp_server,
            commands::delete_mcp_server,
            commands::list_session_commands,
            commands::list_workflows,
            commands::restart_session,
            commands::get_env_status,
            commands::save_env_key,
            commands::env_file_location,
            commands::get_model_settings,
            commands::save_model_settings,
            commands::reload_models,
            commands::load_session,
            commands::list_sessions,
            commands::search_sessions,
            commands::get_session_messages,
            commands::delete_session,
            commands::rename_session,
            commands::set_current_model,
            commands::read_file_for_preview,
            commands::save_artifact_file,
            commands::list_dir,
            commands::read_file_text,
            commands::file_working_diff,
            commands::workspace_changes,
            commands::get_rewind_points,
            commands::execute_rewind,
            commands::fork_session,
            commands::kill_task,
            commands::list_running_subagents,
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}
