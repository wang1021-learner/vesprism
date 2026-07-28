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

/// 编译期推算 monorepo 仓库根（兜底默认工作区）。
fn default_repo_root() -> PathBuf {
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

/// 从 `$GROK_HOME/config.toml` 的 `[desktop] workspace_cwd` 读取用户保存的工作目录。
fn load_persisted_workspace_cwd() -> Option<PathBuf> {
    let path = desktop_config_path();
    if !path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;
    let root: toml::Value = toml::from_str(&content).ok()?;
    let s = root
        .get("desktop")
        .and_then(|d| d.get("workspace_cwd"))
        .and_then(|v| v.as_str())?
        .trim();
    if s.is_empty() {
        return None;
    }
    let p = PathBuf::from(s);
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

/// 将工作目录写入 config.toml（保留其它表，如 model 配置）。
fn save_persisted_workspace_cwd(cwd: &std::path::Path) -> Result<(), String> {
    let path = desktop_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let mut root: toml::Value = if path.exists() {
        let content =
            std::fs::read_to_string(&path).map_err(|e| format!("读取 config.toml 失败: {e}"))?;
        toml::from_str(&content).map_err(|e| format!("解析 config.toml 失败: {e}"))?
    } else {
        toml::Value::Table(toml::map::Map::new())
    };
    let root_tbl = root
        .as_table_mut()
        .ok_or_else(|| "config.toml 根节点必须是 table".to_string())?;
    let desktop = root_tbl
        .entry("desktop".to_string())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    let desktop_tbl = desktop
        .as_table_mut()
        .ok_or_else(|| "[desktop] 必须是 table".to_string())?;
    desktop_tbl.insert(
        "workspace_cwd".to_string(),
        toml::Value::String(cwd.display().to_string()),
    );
    let serialized = toml::to_string_pretty(&root).map_err(|e| format!("序列化 config 失败: {e}"))?;
    std::fs::write(&path, serialized.as_bytes()).map_err(|e| format!("写入 config.toml 失败: {e}"))?;
    Ok(())
}

/// 解析 agent 工作区路径。
///
/// 优先级：
/// 1. AppState 内存覆盖路径（设置页保存后立即写入）
/// 2. `config.toml` → `[desktop] workspace_cwd`（持久化保存）
/// 3. monorepo 仓库根 / 进程 cwd（兜底）
fn resolve_workspace_cwd(state: &AppState) -> PathBuf {
    if let Some(p) = state.workspace_cwd_override.lock().unwrap().clone() {
        if p.is_dir() {
            return p;
        }
    }
    if let Some(p) = load_persisted_workspace_cwd() {
        return p;
    }
    default_repo_root()
}

/// 返回当前 agent 工作目录（已解析后的绝对/规范化路径字符串）。
#[tauri::command]
pub fn workspace_cwd(state: State<'_, AppState>) -> String {
    resolve_workspace_cwd(&state).display().to_string()
}

/// 设置并持久化工作目录；校验必须是已存在的目录。
///
/// 成功后同步更新 AppState 内存覆盖，使本进程内后续 `workspace_cwd` 立即生效。
/// 调用方若已有进行中的会话，应自行 `restart_session` 以绑定新 cwd。
#[tauri::command]
pub fn set_workspace_cwd(cwd: String, state: State<'_, AppState>) -> Result<String, String> {
    let raw = cwd.trim();
    if raw.is_empty() {
        return Err("工作目录不能为空".into());
    }
    let path = PathBuf::from(raw);
    if !path.exists() {
        return Err(format!("路径不存在: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("不是目录: {}", path.display()));
    }
    let canonical = path
        .canonicalize()
        .unwrap_or_else(|_| path.clone());
    // Windows 上 canonicalize 可能带 \\?\ 前缀，尽量剥掉便于展示
    let display_path = {
        let s = canonical.display().to_string();
        s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
    };
    let store = PathBuf::from(&display_path);
    save_persisted_workspace_cwd(&store)?;
    // 进程内立即生效（不依赖再次读盘），用共享状态代替环境变量，
    // 避免多线程环境下 unsafe 的 env::set_var 潜在竞态
    *state.workspace_cwd_override.lock().unwrap() = Some(store);
    Ok(display_path)
}

/// 在进程内为指定 `cwd` 启动 Grok agent 会话。
#[tauri::command]
pub async fn start_session(cwd: String, state: State<'_, AppState>) -> Result<(), String> {
    send_cmd(&state, |reply| ActorCommand::Start { cwd, reply }).await
}

/// 发送用户消息；流式回复通过 `session-event` 推送。
#[tauri::command]
pub async fn send_prompt(
    text: String,
    prompt_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("消息不能为空".into());
    }
    send_cmd(&state, |reply| ActorCommand::SendPrompt {
        text,
        prompt_id,
        reply,
    })
    .await
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
pub(crate) fn env_file_path() -> PathBuf {
    desktop_home_dir().join(".env")
}

/// 收紧 `.env` 文件的 Windows ACL：移除继承权限，仅授权当前登录用户完全控制。
/// 这是尽力而为的安全加固——失败时只记录警告，不阻断密钥保存流程。
pub(crate) fn harden_env_file_permissions(path: &std::path::Path) {
    let username = match std::env::var("USERNAME") {
        Ok(u) if !u.trim().is_empty() => u,
        _ => {
            eprintln!("[security] 无法获取当前用户名，跳过 .env 权限收紧");
            return;
        }
    };
    let path_str = path.display().to_string();
    let output = std::process::Command::new("icacls")
        .arg(&path_str)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(format!("{username}:F"))
        .output();

    match output {
        Ok(o) if o.status.success() => {
            eprintln!("[security] .env 权限已收紧至当前用户: {path_str}");
        }
        Ok(o) => {
            eprintln!(
                "[security] icacls 收紧 .env 权限失败（非阻断）: {}",
                String::from_utf8_lossy(&o.stderr)
            );
        }
        Err(e) => {
            eprintln!("[security] 无法执行 icacls（非阻断）: {e}");
        }
    }
}

/// 密钥文件绝对路径（供前端提示展示）。
#[tauri::command]
pub fn env_file_location() -> String {
    env_file_path().display().to_string()
}

/// 读取指定文件的完整文本内容，仅用于 Artifact 预览等按需读取场景。
/// 安全约束：拒绝任何解析后不在 workspace_root 之内的路径（防止越界读取）。
#[tauri::command]
pub fn read_file_for_preview(path: String, workspace_root: String) -> Result<String, String> {
    let requested = std::path::Path::new(&path);
    let root = std::path::Path::new(&workspace_root);

    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("工作区路径无效: {e}"))?;
    let canonical_requested = requested
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;

    if !canonical_requested.starts_with(&canonical_root) {
        return Err("拒绝访问：目标文件不在当前工作区范围内".to_string());
    }

    const MAX_PREVIEW_FILE_BYTES: u64 = 2 * 1024 * 1024; // 2MB 上限，避免超大文件卡死渲染
    let metadata = std::fs::metadata(&canonical_requested)
        .map_err(|e| format!("读取文件信息失败: {e}"))?;
    if metadata.len() > MAX_PREVIEW_FILE_BYTES {
        return Err(format!(
            "文件过大（{} bytes），超过预览上限 {} bytes",
            metadata.len(),
            MAX_PREVIEW_FILE_BYTES
        ));
    }

    std::fs::read_to_string(&canonical_requested).map_err(|e| format!("读取文件失败: {e}"))
}

/// 把 Artifact 预览内容写入用户通过系统"另存为"对话框选择的路径。
/// 与 read_file_for_preview 不同，这里的目标路径完全由用户在
/// 系统对话框中主动选择，不做工作区范围校验。
#[tauri::command]
pub fn save_artifact_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("保存文件失败: {e}"))
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
    harden_env_file_permissions(&path);

    // 立即覆盖加载到当前进程环境变量，使后续 restart_session 使用新值。
    dotenvy::from_path_override(&path).map_err(|e| e.to_string())?;
    Ok(())
}

// ── 模型设置（第二批）──────────────────────────────────────────────

/// 桌面隔离配置 `config.toml` 路径（`$GROK_HOME/config.toml`）。
fn desktop_config_path() -> PathBuf {
    desktop_home_dir().join("config.toml")
}

/// 配置中一条 `[model.<id>]` 的可编辑字段（对齐官方 ModelEntryConfig 用户可配子集）。
/// `name` 与 `model` 同步：展示名即 API 模型 id，不单独维护。
/// 密钥明文不在此结构：走 `env_key` + `.env`。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelEntryDto {
    pub id: String,
    /// 始终等于 model（兼容旧前端/列表展示）
    pub name: String,
    /// 官方 model：路由/API 模型 id，同时作为展示名
    pub model: String,
    pub base_url: String,
    pub env_key: String,
    pub context_window: u64,
    pub system_prompt_label: String,
    /// chat_completions | responses | messages
    #[serde(default = "default_api_backend")]
    pub api_backend: String,
    #[serde(default)]
    pub description: String,
    /// 0 = 不写盘
    #[serde(default)]
    pub temperature: f64,
    #[serde(default)]
    pub top_p: f64,
    #[serde(default)]
    pub max_completion_tokens: u64,
    #[serde(default)]
    pub extra_headers: std::collections::BTreeMap<String, String>,
    /// API key 鉴权专用 base（空 = 与 base_url 相同）
    #[serde(default)]
    pub api_base_url: String,
    /// 0 = 不写盘
    #[serde(default)]
    pub max_retries: u64,
    /// 0 = 不写盘
    #[serde(default)]
    pub inference_idle_timeout_secs: u64,
    /// null/缺省 = 不写；Some(true/false) 写入
    #[serde(default)]
    pub stream_tool_calls: Option<bool>,
    /// 官方 agent_type，默认 grok-build
    #[serde(default = "default_agent_type")]
    pub agent_type: String,
    #[serde(default)]
    pub use_concise: bool,
    /// 0 = 不写盘；1–100
    #[serde(default)]
    pub auto_compact_threshold_percent: u8,
    /// 是否支持推理档位（官方 supports_reasoning_effort）
    #[serde(default)]
    pub supports_reasoning_effort: bool,
    /// 默认推理强度：none|minimal|low|medium|high|xhigh（空 = 不写）
    #[serde(default)]
    pub reasoning_effort: String,
    /// picker 隐藏
    #[serde(default)]
    pub hidden: bool,
    /// false 时仅 OAuth 用户可见（官方 supported_in_api）
    #[serde(default = "default_true")]
    pub supported_in_api: bool,
    /// laziness_detector.enabled
    #[serde(default)]
    pub laziness_enabled: bool,
    /// laziness_detector.max_nudges_per_session
    #[serde(default)]
    pub laziness_max_nudges: u32,
    /// compactions_remaining："" | "dynamic" | "off" | 数字字符串
    #[serde(default)]
    pub compactions_remaining: String,
    /// compaction_at_tokens："" | "dynamic" | "off" | 数字字符串
    #[serde(default)]
    pub compaction_at_tokens: String,
}

fn default_true() -> bool {
    true
}

fn normalize_reasoning_effort(s: &str) -> Result<String, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "" => Ok(String::new()),
        "none" | "off" => Ok("none".into()),
        "minimal" => Ok("minimal".into()),
        "low" => Ok("low".into()),
        "medium" => Ok("medium".into()),
        "high" => Ok("high".into()),
        "xhigh" | "max" => Ok("xhigh".into()),
        other => Err(format!(
            "reasoning_effort 无效: {other}（none/minimal/low/medium/high/xhigh）"
        )),
    }
}

fn default_agent_type() -> String {
    "grok-build".into()
}

fn default_api_backend() -> String {
    "chat_completions".into()
}

fn normalize_api_backend(s: &str) -> Result<String, String> {
    match s.trim() {
        "" | "chat_completions" => Ok("chat_completions".into()),
        "responses" => Ok("responses".into()),
        "messages" => Ok("messages".into()),
        other => Err(format!(
            "api_backend 无效: {other}（可选 chat_completions / responses / messages）"
        )),
    }
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

fn table_f64(t: &toml::map::Map<String, toml::Value>, key: &str) -> f64 {
    t.get(key)
        .and_then(|v| v.as_float().or_else(|| v.as_integer().map(|i| i as f64)))
        .unwrap_or(0.0)
}

fn table_extra_headers(
    t: &toml::map::Map<String, toml::Value>,
) -> std::collections::BTreeMap<String, String> {
    let mut out = std::collections::BTreeMap::new();
    let Some(h) = t.get("extra_headers").and_then(|v| v.as_table()) else {
        return out;
    };
    for (k, v) in h {
        if let Some(s) = v.as_str() {
            out.insert(k.clone(), s.to_string());
        } else if let Some(n) = v.as_integer() {
            out.insert(k.clone(), n.to_string());
        } else if let Some(f) = v.as_float() {
            out.insert(k.clone(), f.to_string());
        }
    }
    out
}

fn table_opt_bool(t: &toml::map::Map<String, toml::Value>, key: &str) -> Option<bool> {
    t.get(key).and_then(|v| v.as_bool())
}

fn parse_model_entries(root: &toml::Value) -> Vec<ModelEntryDto> {
    let Some(model_tbl) = root.get("model").and_then(|v| v.as_table()) else {
        return Vec::new();
    };
    let mut models: Vec<ModelEntryDto> = model_tbl
        .iter()
        .filter_map(|(id, entry)| {
            let t = entry.as_table()?;
            let model = table_str(t, "model");
            let backend = table_str(t, "api_backend");
            let api_backend = if backend.is_empty() {
                default_api_backend()
            } else {
                backend
            };
            // 展示名统一为 model；旧配置里单独 name 仅作兼容回退
            let name = if model.is_empty() {
                table_str(t, "name")
            } else {
                model.clone()
            };
            let agent_type = {
                let a = table_str(t, "agent_type");
                if a.is_empty() {
                    default_agent_type()
                } else {
                    a
                }
            };
            let laziness = t
                .get("laziness_detector")
                .and_then(|v| v.as_table());
            let laziness_enabled = laziness
                .and_then(|l| l.get("enabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let laziness_max_nudges = laziness
                .and_then(|l| l.get("max_nudges_per_session"))
                .and_then(|v| v.as_integer())
                .filter(|&n| n >= 0)
                .map(|n| n as u32)
                .unwrap_or(0);

            let supports_reasoning = table_opt_bool(t, "supports_reasoning_effort").unwrap_or(false)
                || t.get("reasoning_effort").is_some()
                || t.get("reasoning_efforts")
                    .and_then(|v| v.as_array())
                    .is_some_and(|a| !a.is_empty());

            Some(ModelEntryDto {
                id: id.clone(),
                name,
                model,
                base_url: table_str(t, "base_url"),
                env_key: table_str(t, "env_key"),
                context_window: table_u64(t, "context_window"),
                system_prompt_label: table_str(t, "system_prompt_label"),
                api_backend,
                description: table_str(t, "description"),
                temperature: table_f64(t, "temperature"),
                top_p: table_f64(t, "top_p"),
                max_completion_tokens: table_u64(t, "max_completion_tokens"),
                extra_headers: table_extra_headers(t),
                api_base_url: table_str(t, "api_base_url"),
                max_retries: table_u64(t, "max_retries"),
                inference_idle_timeout_secs: table_u64(t, "inference_idle_timeout_secs"),
                stream_tool_calls: table_opt_bool(t, "stream_tool_calls"),
                agent_type,
                use_concise: table_opt_bool(t, "use_concise").unwrap_or(false),
                auto_compact_threshold_percent: table_u64(t, "auto_compact_threshold_percent")
                    .min(100) as u8,
                supports_reasoning_effort: supports_reasoning,
                reasoning_effort: table_str(t, "reasoning_effort"),
                hidden: table_opt_bool(t, "hidden").unwrap_or(false),
                supported_in_api: table_opt_bool(t, "supported_in_api").unwrap_or(true),
                laziness_enabled,
                laziness_max_nudges,
                compactions_remaining: parse_tri_mode(t, "compactions_remaining"),
                compaction_at_tokens: parse_tri_mode(t, "compaction_at_tokens"),
            })
        })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models
}

/// 读 untagged bool|integer 为 UI 字符串："" | "dynamic" | "off" | "123"
fn parse_tri_mode(t: &toml::map::Map<String, toml::Value>, key: &str) -> String {
    let Some(v) = t.get(key) else {
        return String::new();
    };
    if let Some(b) = v.as_bool() {
        return if b {
            "dynamic".into()
        } else {
            "off".into()
        };
    }
    if let Some(n) = v.as_integer() {
        if n >= 0 {
            return n.to_string();
        }
    }
    String::new()
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
    normalize_api_backend(&entry.api_backend)?;
    if entry.temperature < 0.0 || entry.temperature > 2.0 {
        return Err(format!(
            "模型 [{}]：temperature 应在 0–2 之间（0 表示不设置）",
            entry.id
        ));
    }
    if entry.top_p < 0.0 || entry.top_p > 1.0 {
        return Err(format!(
            "模型 [{}]：top_p 应在 0–1 之间（0 表示不设置）",
            entry.id
        ));
    }
    if entry.auto_compact_threshold_percent > 100 {
        return Err(format!(
            "模型 [{}]：auto_compact_threshold_percent 应在 0–100",
            entry.id
        ));
    }
    if entry.supports_reasoning_effort {
        let e = normalize_reasoning_effort(&entry.reasoning_effort)?;
        if e.is_empty() {
            // 允许空，默认 medium 在 upsert 时写入
        }
    }
    for (k, v) in &entry.extra_headers {
        if k.trim().is_empty() {
            return Err(format!("模型 [{}]：extra_headers 键不能为空", entry.id));
        }
        if v.contains('\n') || v.contains('\r') {
            return Err(format!(
                "模型 [{}]：extra_headers 值不能含换行（键 {k}）",
                entry.id
            ));
        }
    }
    Ok(())
}

fn insert_opt_string(
    tbl: &mut toml::map::Map<String, toml::Value>,
    key: &str,
    value: &str,
) {
    let v = value.trim();
    if v.is_empty() {
        tbl.remove(key);
    } else {
        tbl.insert(key.into(), toml::Value::String(v.into()));
    }
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

    let backend = normalize_api_backend(&entry.api_backend)?;
    let model_id = entry.model.trim();

    entry_tbl.insert("model".into(), toml::Value::String(model_id.into()));
    // 展示名与 API 模型 id 一致（官方 name 字段同步写入，避免旧 name 残留）
    entry_tbl.insert("name".into(), toml::Value::String(model_id.into()));
    entry_tbl.insert(
        "base_url".into(),
        toml::Value::String(entry.base_url.trim().into()),
    );
    entry_tbl.insert(
        "context_window".into(),
        toml::Value::Integer(entry.context_window as i64),
    );
    entry_tbl.insert("api_backend".into(), toml::Value::String(backend));

    if !entry.env_key.trim().is_empty() {
        entry_tbl.insert(
            "env_key".into(),
            toml::Value::String(entry.env_key.trim().into()),
        );
    }

    insert_opt_string(entry_tbl, "description", &entry.description);
    insert_opt_string(entry_tbl, "system_prompt_label", &entry.system_prompt_label);
    insert_opt_string(entry_tbl, "api_base_url", &entry.api_base_url);

    let agent = entry.agent_type.trim();
    if agent.is_empty() || agent == "grok-build" {
        // 官方默认；仍写入便于桌面读回一致，或省略亦可——写入更明确
        entry_tbl.insert(
            "agent_type".into(),
            toml::Value::String(if agent.is_empty() {
                "grok-build".into()
            } else {
                agent.into()
            }),
        );
    } else {
        entry_tbl.insert("agent_type".into(), toml::Value::String(agent.into()));
    }

    if entry.temperature > 0.0 {
        entry_tbl.insert(
            "temperature".into(),
            toml::Value::Float(entry.temperature),
        );
    } else {
        entry_tbl.remove("temperature");
    }
    if entry.top_p > 0.0 {
        entry_tbl.insert("top_p".into(), toml::Value::Float(entry.top_p));
    } else {
        entry_tbl.remove("top_p");
    }
    if entry.max_completion_tokens > 0 {
        entry_tbl.insert(
            "max_completion_tokens".into(),
            toml::Value::Integer(entry.max_completion_tokens as i64),
        );
    } else {
        entry_tbl.remove("max_completion_tokens");
    }
    if entry.max_retries > 0 {
        entry_tbl.insert(
            "max_retries".into(),
            toml::Value::Integer(entry.max_retries as i64),
        );
    } else {
        entry_tbl.remove("max_retries");
    }
    if entry.inference_idle_timeout_secs > 0 {
        entry_tbl.insert(
            "inference_idle_timeout_secs".into(),
            toml::Value::Integer(entry.inference_idle_timeout_secs as i64),
        );
    } else {
        entry_tbl.remove("inference_idle_timeout_secs");
    }
    if entry.auto_compact_threshold_percent > 0 {
        entry_tbl.insert(
            "auto_compact_threshold_percent".into(),
            toml::Value::Integer(entry.auto_compact_threshold_percent as i64),
        );
    } else {
        entry_tbl.remove("auto_compact_threshold_percent");
    }

    match entry.stream_tool_calls {
        Some(v) => {
            entry_tbl.insert("stream_tool_calls".into(), toml::Value::Boolean(v));
        }
        None => {
            entry_tbl.remove("stream_tool_calls");
        }
    }
    if entry.use_concise {
        entry_tbl.insert("use_concise".into(), toml::Value::Boolean(true));
    } else {
        entry_tbl.remove("use_concise");
    }

    if entry.hidden {
        entry_tbl.insert("hidden".into(), toml::Value::Boolean(true));
    } else {
        entry_tbl.remove("hidden");
    }
    if entry.supported_in_api {
        entry_tbl.remove("supported_in_api"); // 默认 true，省略
    } else {
        entry_tbl.insert("supported_in_api".into(), toml::Value::Boolean(false));
    }

    // 推理
    if entry.supports_reasoning_effort {
        entry_tbl.insert("supports_reasoning_effort".into(), toml::Value::Boolean(true));
        let effort = normalize_reasoning_effort(&entry.reasoning_effort)
            .unwrap_or_default();
        let effort = if effort.is_empty() {
            "medium".to_string()
        } else {
            effort
        };
        entry_tbl.insert(
            "reasoning_effort".into(),
            toml::Value::String(effort.clone()),
        );
        // 标准档位菜单（官方支持 bare 字符串数组）
        let efforts = vec![
            "none", "minimal", "low", "medium", "high", "xhigh",
        ]
        .into_iter()
        .map(|s| toml::Value::String(s.into()))
        .collect();
        entry_tbl.insert("reasoning_efforts".into(), toml::Value::Array(efforts));
        let _ = effort;
    } else {
        entry_tbl.remove("supports_reasoning_effort");
        entry_tbl.remove("reasoning_effort");
        entry_tbl.remove("reasoning_efforts");
    }

    // laziness_detector 子表
    if entry.laziness_enabled || entry.laziness_max_nudges > 0 {
        let mut laz = toml::map::Map::new();
        laz.insert(
            "enabled".into(),
            toml::Value::Boolean(entry.laziness_enabled),
        );
        if entry.laziness_max_nudges > 0 {
            laz.insert(
                "max_nudges_per_session".into(),
                toml::Value::Integer(entry.laziness_max_nudges as i64),
            );
        }
        entry_tbl.insert("laziness_detector".into(), toml::Value::Table(laz));
    } else {
        entry_tbl.remove("laziness_detector");
    }

    write_tri_mode(entry_tbl, "compactions_remaining", &entry.compactions_remaining);
    write_tri_mode(entry_tbl, "compaction_at_tokens", &entry.compaction_at_tokens);

    let headers: toml::map::Map<String, toml::Value> = entry
        .extra_headers
        .iter()
        .filter(|(k, v)| !k.trim().is_empty() && !v.trim().is_empty())
        .map(|(k, v)| (k.trim().to_string(), toml::Value::String(v.trim().into())))
        .collect();
    if headers.is_empty() {
        entry_tbl.remove("extra_headers");
    } else {
        entry_tbl.insert("extra_headers".into(), toml::Value::Table(headers));
    }
    Ok(())
}

fn write_tri_mode(
    tbl: &mut toml::map::Map<String, toml::Value>,
    key: &str,
    raw: &str,
) {
    let s = raw.trim().to_ascii_lowercase();
    match s.as_str() {
        "" => {
            tbl.remove(key);
        }
        "off" | "false" => {
            tbl.insert(key.into(), toml::Value::Boolean(false));
        }
        "dynamic" | "true" | "on" => {
            tbl.insert(key.into(), toml::Value::Boolean(true));
        }
        n if n.chars().all(|c| c.is_ascii_digit()) => {
            if let Ok(v) = n.parse::<i64>() {
                tbl.insert(key.into(), toml::Value::Integer(v));
            } else {
                tbl.remove(key);
            }
        }
        _ => {
            tbl.remove(key);
        }
    }
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
    /// 会话所属工作空间路径（`summary.info.cwd`）
    pub cwd: String,
}

#[tauri::command]
pub async fn load_session(session_id: String, cwd: String, state: State<'_, AppState>) -> Result<(), String> {
    send_cmd(&state, |reply| ActorCommand::LoadSession { session_id, cwd, reply }).await
}

/// 列出会话。
///
/// - 传入 `cwd` 时仍会返回 **全部工作空间** 的会话（带 `cwd` 字段），供侧栏
///   「工作空间 → 时间」两层分组；`cwd` 仅用于把当前工作空间排到前面。
/// - 空会话已过滤。
#[tauri::command]
pub async fn list_sessions(cwd: String) -> Result<Vec<SessionSummaryDto>, String> {
    let mut summaries = grok_session::list_all_sessions()
        .await
        .map_err(|e| e.to_string())?;

    // 过滤从未说过话的空会话，避免「连点新建」堆一串「新对话」
    summaries.retain(|s| !grok_session::is_blank_session(s));

    // 当前工作空间优先，组内按活跃时间降序
    let current = cwd.trim().replace('\\', "/").to_ascii_lowercase();
    summaries.sort_by(|a, b| {
        let a_cwd = a.info.cwd.replace('\\', "/").to_ascii_lowercase();
        let b_cwd = b.info.cwd.replace('\\', "/").to_ascii_lowercase();
        let a_cur = a_cwd == current;
        let b_cur = b_cwd == current;
        match (a_cur, b_cur) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => {
                let time_a = a.last_active_at.unwrap_or(a.created_at);
                let time_b = b.last_active_at.unwrap_or(b.created_at);
                time_b.cmp(&time_a)
            }
        }
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
                cwd: s.info.cwd,
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
pub async fn set_current_model(
    model_id: String,
    reasoning_effort: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    send_cmd(&state, |reply| ActorCommand::SetModel {
        model_id,
        reasoning_effort,
        reply,
    })
    .await
}

