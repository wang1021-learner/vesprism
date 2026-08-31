mod account;
mod catalog;
mod commands;
mod computer;
mod computer_mcp;
mod engine_prefs;
mod perm_always;
mod pty;
mod sandbox;
mod security;
mod session_index;
mod state;
mod workbench;
mod writing_store;

use state::{AppState, spawn_supervisor};
use tauri::Manager;

/// 与 `tauri.conf.json` `build.devUrl` 一致：只有这一份 Vite 源算应用内导航。
const DEV_VITE_PORT: u16 = 9527;

fn is_app_navigation(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" | "ipc" | "asset" | "data" | "blob" | "about" => true,
        "http" | "https" => match url.host_str() {
            Some("asset.localhost" | "ipc.localhost" | "tauri.localhost") => true,
            Some("127.0.0.1") if url.scheme() == "http" && url.port() == Some(DEV_VITE_PORT) => {
                true
            }
            _ => false,
        },
        _ => false,
    }
}

fn open_in_system_browser(url: &tauri::Url) {
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    let url = url.as_str();
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        use windows::core::PCWSTR;

        let file: Vec<u16> = std::ffi::OsStr::new(url)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // 交给默认浏览器，避免 `cmd /C start` 把 URL 查询串里的 `&` 当成命令分隔符。
        let _ = unsafe {
            ShellExecuteW(
                None,
                windows::core::w!("open"),
                PCWSTR(file.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

fn external_link_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("vesprism-nav")
        .on_navigation(|_webview, url| {
            if is_app_navigation(url) {
                return true;
            }
            open_in_system_browser(url);
            false
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 内置 MCP server 模式：exe --vesprism-mcp-server（stdio 传输，供官方引擎 .mcp.json 挂载）。
    // 必须在 GUI 初始化之前分支，避免拉起整个 Tauri 应用。
    if std::env::args().any(|a| a == workbench::mcp_server::MCP_SERVER_FLAG) {
        std::process::exit(workbench::mcp_server::run_mcp_server_stdio());
    }
    if std::env::args().any(|a| a == computer_mcp::MCP_FLAG) {
        std::process::exit(computer_mcp::run_stdio());
    }

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
        std::fs::create_dir_all(&desktop_grok_home).expect("创建隔离配置目录失败");
    }

    // SAFETY: 此时进程尚处于单线程启动阶段，早于任何读取 GROK_HOME 的代码路径
    // （grok_home() 首次调用发生在 .setup() 内的 GrokSession::start()），
    // 不存在并发访问环境变量的竞争。
    unsafe {
        std::env::set_var("GROK_HOME", &desktop_grok_home);
    }

    if let Err(e) = workbench::role_agents::seed_role_subagents(&desktop_grok_home) {
        eprintln!("[vesprism] 写入岗位子代理失败: {e}");
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
                    Ok(_) => eprintln!("[vesprism] 已将旧版密钥迁移到 {}", secrets_env.display()),
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
            eprintln!("[vesprism] 加载 {} 失败: {e}", secrets_env.display());
        }
        if let Err(e) = commands::harden_env_file_permissions(&secrets_env) {
            eprintln!(
                "[vesprism] 收紧 {} 权限失败: {e}",
                secrets_env.display()
            );
        }
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

            // 官方记忆系统：确保 [memory] enabled 已显式配置（默认开）。
            // 必须在任何会话启动前完成，否则官方 MemoryConfig 默认禁用。
            if let Err(e) = engine_prefs::ensure_memory_default() {
                log::warn!("[vesprism] 写入记忆开关默认值失败: {e}");
            }

            // 启动 Supervisor 线程（管理所有 tab 的会话 Actor），并把句柄交给 Tauri 状态管理。
            let (supervisor_tx, tabs) = spawn_supervisor(app.handle().clone());
            app.manage(AppState {
                tabs,
                supervisor_tx,
                workspace_cwd_override: std::sync::Arc::new(std::sync::Mutex::new(None)),
                sandbox_tabs: std::sync::Arc::new(std::sync::Mutex::new(
                    std::collections::HashSet::new(),
                )),
                sandbox_binds: std::sync::Arc::new(std::sync::Mutex::new(
                    std::collections::HashMap::new(),
                )),
                pty: std::sync::Arc::new(crate::pty::PtyManager::new()),
                tab_cwds: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
                pending_flow_import: std::sync::Arc::new(std::sync::Mutex::new(None)),
            });

            // 索引启动兜底：一次性全量重建，之后由 TurnEnded 增量 upsert 维护，list_sessions 不再反应式重建。
            tauri::async_runtime::spawn(async {
                if let Err(e) = crate::commands::rebuild_session_index_full().await {
                    log::warn!("会话索引启动重建失败: {e}");
                }
            });

            Ok(())
        })
        .plugin(external_link_plugin())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_tab,
            commands::close_tab,
            commands::restart_tab,
            commands::workspace_cwd,
            commands::set_workspace_cwd,
            commands::scratch_cwd,
            commands::get_security_policy,
            commands::set_security_policy,
            engine_prefs::get_engine_prefs,
            engine_prefs::set_engine_prefs,
            engine_prefs::get_worktree_status,
            engine_prefs::gc_desktop_worktrees,
            engine_prefs::list_config_hooks,
            engine_prefs::set_config_hooks,
            commands::enable_tab_sandbox,
            commands::disable_tab_sandbox,
            commands::get_sandbox_status,
            commands::get_computer_use,
            commands::set_computer_use,
            commands::sync_sandbox_to_origin,
            commands::start_session,
            commands::send_prompt,
            commands::interject_prompt,
            commands::remove_queued_prompt,
            commands::edit_queued_prompt,
            commands::reorder_queued_prompts,
            commands::clear_queued_prompts,
            commands::interject_queued_prompt,
            commands::hold_queued_edit,
            commands::release_queued_edit,
            commands::session_caps,
            commands::session_recap,
            commands::session_memory_flush,
            commands::session_memory_rewrite,
            commands::session_set_memory,
            commands::hunk_call,
            commands::plugins_list,
            commands::plugins_action,
            commands::marketplace_list,
            commands::marketplace_action,
            commands::hooks_list,
            commands::hooks_action,
            commands::submit_feedback,
            commands::share_session,
            commands::scheduler_delete,
            commands::session_info,
            commands::session_usage,
            commands::compact_conversation,
            commands::cancel_turn,
            commands::respond_permission,
            commands::respond_user_question,
            commands::set_session_mode,
            commands::respond_exit_plan_mode,
            commands::cancel_subagent,
            commands::get_subagent,
            commands::list_mcp_servers,
            commands::toggle_mcp_server,
            commands::toggle_mcp_tool,
            commands::mcp_auth_trigger,
            commands::mcp_setup,
            commands::upsert_mcp_server,
            commands::delete_mcp_server,
            commands::list_session_commands,
            commands::list_workflows,
            commands::update_session_flows,
            commands::list_skills,
            commands::add_skill,
            commands::remove_skill,
            commands::toggle_skill,
            commands::restart_session,
            commands::get_env_status,
            commands::save_env_key,
            account::account_status,
            account::account_login,
            account::account_logout,
            commands::env_file_location,
            commands::get_model_settings,
            commands::save_model_settings,
            commands::probe_model_endpoint,
            commands::reload_models,
            commands::load_session,
            commands::list_sessions,
            commands::add_project,
            commands::remove_project,
            commands::list_projects,
            commands::list_sessions_for_project,
            commands::search_sessions,
            commands::mark_tool_session,
            commands::unmark_tool_session,
            commands::is_tool_session,
            commands::get_session_messages,
            commands::delete_session,
            commands::rename_session,
            commands::set_current_model,
            commands::apply_composition,
            commands::get_composition,
            commands::save_composition,
            commands::list_compositions,
            workbench::flows::save_flow,
            workbench::flows::list_flows,
            workbench::flows::get_flow,
            workbench::flows::delete_flow,
            workbench::flows::export_flow,
            workbench::flows::import_flow,
            workbench::flows::purge_rerun_sidecars,
            workbench::agents::list_agents,
            workbench::agents::get_agent,
            workbench::agents::save_agent,
            workbench::agents::delete_agent,
            workbench::bindings::get_workbench_binding,
            workbench::bindings::list_workbench_bindings,
            workbench::bindings::list_workbench_sessions,
            workbench::bindings::bind_workbench_artifact,
            workbench::bindings::touch_workbench_session,
            commands::list_dir,
            commands::search_workspace_files,
            commands::save_paste_image,
            commands::read_file_text,
            commands::read_memory_file,
            commands::delete_memory_path,
            catalog::list_catalog_mcp,
            catalog::list_catalog_skills,
            catalog::list_catalog_memory,
            catalog::list_catalog_plugins,
            commands::file_working_diff,
            commands::workspace_changes,
            commands::get_rewind_points,
            commands::execute_rewind,
            commands::mount_mcp,
            commands::fork_session,
            commands::kill_task,
            commands::list_running_subagents,
            commands::start_pty,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_detach,
            commands::stop_pty,
            writing_store::writing_list_books,
            writing_store::writing_load_book,
            writing_store::writing_save_book,
            writing_store::writing_delete_book,
            writing_store::writing_export_book,
            writing_store::writing_session_cwd,
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}

#[cfg(test)]
mod nav_tests {
    use super::{DEV_VITE_PORT, is_app_navigation};

    fn u(s: &str) -> tauri::Url {
        tauri::Url::parse(s).unwrap()
    }

    #[test]
    fn vite_dev_origin_is_in_app() {
        assert!(is_app_navigation(&u("http://127.0.0.1:9527/")));
        assert!(is_app_navigation(&u("http://127.0.0.1:9527/index.html")));
        assert_eq!(DEV_VITE_PORT, 9527);
    }

    #[test]
    fn other_loopback_is_external() {
        assert!(!is_app_navigation(&u("http://127.0.0.1:8080/")));
        assert!(!is_app_navigation(&u("http://localhost/")));
        assert!(!is_app_navigation(&u("http://localhost:9527/")));
        assert!(!is_app_navigation(&u("http://[::1]:9527/")));
        assert!(!is_app_navigation(&u("https://127.0.0.1:9527/")));
    }

    #[test]
    fn tauri_schemes_and_hosts_are_in_app() {
        assert!(is_app_navigation(&u("tauri://localhost/")));
        assert!(is_app_navigation(&u("http://asset.localhost/foo")));
        assert!(is_app_navigation(&u("http://ipc.localhost/")));
        assert!(is_app_navigation(&u("https://tauri.localhost/")));
        assert!(!is_app_navigation(&u("https://example.com/")));
    }
}
