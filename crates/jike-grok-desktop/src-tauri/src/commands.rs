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

/// 销毁旧会话并以新 cwd 重建。
#[tauri::command]
pub async fn restart_session(cwd: String, state: State<'_, AppState>) -> Result<(), String> {
    send_cmd(&state, |reply| ActorCommand::Restart { cwd, reply }).await
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

/// 桌面隔离目录（与 `GROK_HOME` / config.toml 同一位置）。
fn desktop_home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("GROK_HOME") {
        let p = PathBuf::from(home);
        if !p.as_os_str().is_empty() {
            return p;
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".jike-grok-desktop")
}

/// 密钥文件路径：`$GROK_HOME/.env`（用户主目录隔离区，**不在仓库内**）。
fn env_file_path() -> PathBuf {
    desktop_home_dir().join(".env")
}

/// 密钥文件绝对路径（供前端提示展示）。
#[tauri::command]
pub fn env_file_location() -> String {
    env_file_path().display().to_string()
}

/// API Key 设置状态（不含明文值）。
#[derive(serde::Serialize)]
pub struct EnvKeyStatus {
    pub key_name: String,
    pub is_set: bool,
}

/// 校验环境变量名：须为合法 shell 标识符，防止写入异常 .env 行。
fn validate_env_key_name(key_name: &str) -> Result<(), String> {
    let name = key_name.trim();
    if name.is_empty() {
        return Err("环境变量名不能为空".into());
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !(first.is_ascii_alphabetic() || first == '_') {
        return Err(format!("非法环境变量名: {name}（须以字母或 _ 开头）"));
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(format!("非法环境变量名: {name}（仅允许字母、数字、_）"));
    }
    Ok(())
}

/// 查询指定环境变量是否已设置（仅布尔状态，不回传明文）。
///
/// `key_name` 通常来自当前模型的 `env_key`（如 `DEEPSEEK_API_KEY`、`OPENAI_API_KEY`）。
#[tauri::command]
pub fn get_env_status(key_name: String) -> Result<EnvKeyStatus, String> {
    validate_env_key_name(&key_name)?;
    let name = key_name.trim().to_string();
    let is_set = std::env::var(&name)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);
    Ok(EnvKeyStatus {
        key_name: name,
        is_set,
    })
}

/// 写入/更新 **用户隔离目录** `$GROK_HOME/.env` 中的任意 key，并立即加载到进程环境。
///
/// 密钥不写入仓库内的 `crates/jike-grok-desktop/.env`。
#[tauri::command]
pub fn save_env_key(key_name: String, value: String) -> Result<(), String> {
    validate_env_key_name(&key_name)?;
    let name = key_name.trim().to_string();
    let prefix = format!("{name}=");
    let path = env_file_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建密钥目录失败: {e}"))?;
    }
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut found = false;
    let mut new_lines: Vec<String> = existing
        .lines()
        .map(|line| {
            if line.starts_with(&prefix) {
                found = true;
                format!("{name}={value}")
            } else {
                line.to_string()
            }
        })
        .collect();
    if !found {
        new_lines.push(format!("{name}={value}"));
    }
    let content = new_lines.join("\n") + "\n";
    // UTF-8 写入，避免 Windows 默认编码坑
    std::fs::write(&path, content.as_bytes()).map_err(|e| format!("写入密钥文件失败: {e}"))?;

    // 立即覆盖加载到当前进程环境变量，使后续 restart_session 使用新值。
    dotenvy::from_path_override(&path).map_err(|e| e.to_string())?;
    Ok(())
}

// ── 模型设置（第二批）──────────────────────────────────────────────

/// 桌面隔离配置 `config.toml` 路径（`$GROK_HOME/config.toml`）。
fn desktop_config_path() -> PathBuf {
    desktop_home_dir().join("config.toml")
}

/// 配置中一条 `[model.<id>]` 的可编辑字段（不含密钥明文）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelEntryDto {
    pub id: String,
    pub name: String,
    pub model: String,
    pub base_url: String,
    pub env_key: String,
    pub context_window: u64,
    pub system_prompt_label: String,
}

/// 设置页模型区：默认模型 + 已配置模型列表。
#[derive(Debug, serde::Serialize)]
pub struct ModelSettings {
    pub default_id: String,
    pub models: Vec<ModelEntryDto>,
    pub config_path: String,
}

fn table_str(t: &toml::map::Map<String, toml::Value>, key: &str) -> String {
    t.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn table_u64(t: &toml::map::Map<String, toml::Value>, key: &str) -> u64 {
    t.get(key)
        .and_then(|v| v.as_integer())
        .filter(|&n| n >= 0)
        .map(|n| n as u64)
        .unwrap_or(0)
}

fn parse_model_entries(root: &toml::Value) -> Vec<ModelEntryDto> {
    let Some(model_tbl) = root.get("model").and_then(|v| v.as_table()) else {
        return Vec::new();
    };
    let mut models: Vec<ModelEntryDto> = model_tbl
        .iter()
        .filter_map(|(id, entry)| {
            let t = entry.as_table()?;
            Some(ModelEntryDto {
                id: id.clone(),
                name: table_str(t, "name"),
                model: table_str(t, "model"),
                base_url: table_str(t, "base_url"),
                env_key: table_str(t, "env_key"),
                context_window: table_u64(t, "context_window"),
                system_prompt_label: table_str(t, "system_prompt_label"),
            })
        })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models
}

/// 校验模型 id：仅允许安全标识符，防止异常键写入 TOML。
fn validate_model_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("模型 id 不能为空".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(format!("非法模型 id: {id}"));
    }
    Ok(())
}

/// 读取桌面 `config.toml` 中的模型列表与默认模型。
#[tauri::command]
pub fn get_model_settings() -> Result<ModelSettings, String> {
    let path = desktop_config_path();
    let config_path = path.display().to_string();
    if !path.exists() {
        return Ok(ModelSettings {
            default_id: String::new(),
            models: Vec::new(),
            config_path,
        });
    }
    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取 config.toml 失败: {e}"))?;
    // toml 0.9：必须用 from_str，不能用 str::parse::<Value>()（后者会把 [table] 当成非法）
    let root: toml::Value = toml::from_str(&content)
        .map_err(|e| format!("解析 config.toml 失败: {e}"))?;
    let default_id = root
        .get("models")
        .and_then(|m| m.get("default"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let models = parse_model_entries(&root);
    Ok(ModelSettings {
        default_id,
        models,
        config_path,
    })
}

/// 校验单条模型字段（新增与编辑共用）。
fn validate_model_entry(entry: &ModelEntryDto) -> Result<(), String> {
    validate_model_id(&entry.id)?;
    if entry.model.trim().is_empty() {
        return Err(format!("模型 [{}]：API 模型名 (model) 不能为空", entry.id));
    }
    if entry.base_url.trim().is_empty() {
        return Err(format!("模型 [{}]：base_url 不能为空", entry.id));
    }
    if entry.context_window == 0 {
        return Err(format!("模型 [{}]：context_window 必须大于 0", entry.id));
    }
    Ok(())
}

/// 将一条模型写入 TOML 的 `[model.<id>]`（新建或更新，保留未暴露字段）。
fn upsert_model_entry(
    model_map: &mut toml::map::Map<String, toml::Value>,
    entry: &ModelEntryDto,
) -> Result<(), String> {
    let entry_val = model_map
        .entry(entry.id.clone())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    let entry_tbl = entry_val
        .as_table_mut()
        .ok_or_else(|| format!("[model.{}] 必须是 table", entry.id))?;

    entry_tbl.insert(
        "model".into(),
        toml::Value::String(entry.model.trim().into()),
    );
    entry_tbl.insert(
        "base_url".into(),
        toml::Value::String(entry.base_url.trim().into()),
    );
    entry_tbl.insert(
        "context_window".into(),
        toml::Value::Integer(entry.context_window as i64),
    );
    if !entry.env_key.trim().is_empty() {
        entry_tbl.insert(
            "env_key".into(),
            toml::Value::String(entry.env_key.trim().into()),
        );
    }
    if !entry.name.trim().is_empty() {
        entry_tbl.insert("name".into(), toml::Value::String(entry.name.trim().into()));
    } else {
        entry_tbl.remove("name");
    }
    if !entry.system_prompt_label.trim().is_empty() {
        entry_tbl.insert(
            "system_prompt_label".into(),
            toml::Value::String(entry.system_prompt_label.trim().into()),
        );
    } else {
        entry_tbl.remove("system_prompt_label");
    }
    Ok(())
}

/// 写入默认模型，并与提交列表**全量同步** `[model.*]`（支持新增 / 编辑 / 删除）。
///
/// - 提交列表中的 id：新建或更新（保留该段内未暴露字段）
/// - 磁盘上有、但不在本次列表中的 id：**删除**（与设置 UI 列表一致）
#[tauri::command]
pub fn save_model_settings(
    default_id: String,
    models: Vec<ModelEntryDto>,
) -> Result<(), String> {
    if models.is_empty() {
        return Err("至少需要配置一个模型".into());
    }
    validate_model_id(&default_id)?;
    if !models.iter().any(|m| m.id == default_id) {
        return Err(format!("默认模型 `{default_id}` 不在提交的模型列表中"));
    }

    // 列表内 id 不得重复
    let mut seen = std::collections::HashSet::new();
    for entry in &models {
        validate_model_entry(entry)?;
        if !seen.insert(entry.id.clone()) {
            return Err(format!("模型 id 重复: {}", entry.id));
        }
    }

    let path = desktop_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }

    let mut root: toml::Value = if path.exists() {
        let content =
            std::fs::read_to_string(&path).map_err(|e| format!("读取 config.toml 失败: {e}"))?;
        // toml 0.9：必须用 from_str，不能用 str::parse::<Value>()
        toml::from_str(&content).map_err(|e| format!("解析 config.toml 失败: {e}"))?
    } else {
        toml::Value::Table(toml::map::Map::new())
    };

    let root_tbl = root
        .as_table_mut()
        .ok_or_else(|| "config.toml 根节点必须是 table".to_string())?;

    // [models] default = "..."
    let models_tbl = root_tbl
        .entry("models".to_string())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    let models_map = models_tbl
        .as_table_mut()
        .ok_or_else(|| "[models] 必须是 table".to_string())?;
    models_map.insert(
        "default".to_string(),
        toml::Value::String(default_id.clone()),
    );

    // [model.<id>] … 全量同步
    let model_root = root_tbl
        .entry("model".to_string())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    let model_map = model_root
        .as_table_mut()
        .ok_or_else(|| "[model] 必须是 table".to_string())?;

    // 先删掉本次未提交的 id
    let keep: std::collections::HashSet<String> = models.iter().map(|m| m.id.clone()).collect();
    model_map.retain(|id, _| keep.contains(id));

    for entry in &models {
        upsert_model_entry(model_map, entry)?;
    }

    let serialized =
        toml::to_string_pretty(&root).map_err(|e| format!("序列化 config.toml 失败: {e}"))?;
    // 显式 UTF-8 写入，避免 Windows 默认编码坑
    std::fs::write(&path, serialized.as_bytes())
        .map_err(|e| format!("写入 config.toml 失败: {e}"))?;
    Ok(())
}

/// 热重载运行中 agent 的模型目录（写盘后调用，无需 restart_session）。
#[tauri::command]
pub async fn reload_models(state: State<'_, AppState>) -> Result<(), String> {
    send_cmd(&state, |reply| ActorCommand::ReloadModels { reply }).await
}

/// 会话摘要（前端友好字段，从官方 Summary 结构体裁剪而来）。
#[derive(serde::Serialize)]
pub struct SessionSummaryDto {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub num_messages: usize,
}

#[tauri::command]
pub async fn load_session(session_id: String, cwd: String, state: State<'_, AppState>) -> Result<(), String> {
    send_cmd(&state, |reply| ActorCommand::LoadSession { session_id, cwd, reply }).await
}

#[tauri::command]
pub async fn list_sessions(cwd: String) -> Result<Vec<SessionSummaryDto>, String> {
    let mut summaries = grok_session::list_sessions(&cwd)
        .await
        .map_err(|e| e.to_string())?;

    // 过滤从未说过话的空会话，避免「连点新建」堆一串「新对话」
    summaries.retain(|s| !grok_session::is_blank_session(s));

    // 按照真实活跃时间 (last_active_at 降级为 created_at) 降序排序，避开仅 load_session 导致的 updated_at 刷新重排
    summaries.sort_by(|a, b| {
        let time_a = a.last_active_at.unwrap_or(a.created_at);
        let time_b = b.last_active_at.unwrap_or(b.created_at);
        time_b.cmp(&time_a)
    });

    Ok(summaries
        .into_iter()
        .map(|s| {
            let title = s
                .display_title_opt()
                .or_else(|| grok_session::get_session_first_prompt(&s))
                .unwrap_or_else(|| "新对话".to_string());

            let active_time = s.last_active_at.unwrap_or(s.created_at);

            SessionSummaryDto {
                id: s.info.id.to_string(),
                title,
                updated_at: active_time.to_rfc3339(),
                num_messages: s.num_messages,
            }
        })
        .collect())
}

/// 删除会话：走 Actor，保证删当前会话时先释放再删盘，避免文件锁失败。
#[tauri::command]
pub async fn delete_session(
    session_id: String,
    cwd: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    send_cmd(&state, |reply| ActorCommand::DeleteSession {
        session_id,
        cwd,
        reply,
    })
    .await
}

/// 重命名会话标题（持久化到官方 summary.json）。
#[tauri::command]
pub async fn rename_session(
    session_id: String,
    cwd: String,
    title: String,
) -> Result<(), String> {
    grok_session::rename_session(&session_id, &cwd, &title)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_current_model(model_id: String, state: State<'_, AppState>) -> Result<(), String> {
    send_cmd(&state, |reply| ActorCommand::SetModel { model_id, reply }).await
}

