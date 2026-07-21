mod commands;
mod state;

use state::{spawn_session_actor, AppState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 按常见工作目录布局尝试加载密钥（仓库根 / 包目录 / src-tauri）。
    for path in [
        "crates/jike-grok-desktop/.env",
        "crates/grok-gui-poc/.env",
        "../.env",
        ".env",
        "../../grok-gui-poc/.env",
    ] {
        if dotenvy::from_path(path).is_ok() {
            break;
        }
    }
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 启动专用会话线程，并把命令发送端交给 Tauri 状态管理。
            let cmd_tx = spawn_session_actor(app.handle().clone());
            app.manage(AppState { cmd_tx });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace_cwd,
            commands::start_session,
            commands::send_prompt,
            commands::cancel_turn,
            commands::respond_permission,
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}
