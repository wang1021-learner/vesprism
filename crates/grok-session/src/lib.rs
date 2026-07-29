//! Grok Build 桌面端 / 命令行前端共用的会话封装层。
//!
//! 在进程内通过 ACP 双工管道包装 `xai-grok-shell`，
//! 让 UI 代码不必直接处理 JSON-RPC 或 agent 接线细节。
//!
//! **运行时要求：** 调用方必须在 `tokio::task::LocalSet` 中运行
//! （或由 `current_thread` runtime 驱动 LocalSet），
//! 因为 ACP 客户端与 agent 任务都使用 `spawn_local`。

use agent_client_protocol::{
    Agent, CancelNotification, Client, ClientCapabilities, ClientSideConnection, ExtRequest,
    InitializeRequest, LoadSessionRequest, ModelId, NewSessionRequest, PromptRequest,
    ProtocolVersion, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionId, SessionNotification,
    SessionUpdate, SetSessionModelRequest,
};
use futures::FutureExt;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::sync::watch;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use xai_grok_shell::agent::app::spawn_agent_local;
use xai_grok_shell::agent::config::Config as AgentConfig;

/// 会话摘要（来自官方持久化层，直接复用不重新定义）。
pub use xai_grok_shell::session::persistence::Summary;

/// 粗粒度会话生命周期，供 UI 指示器使用（转圈、禁用输入、取消按钮等）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    /// 握手或 `session/new` 进行中。
    Initializing,
    /// 已就绪，可接收用户输入。
    Idle,
    /// 正在流式生成某一轮回复。
    Generating,
    /// 会话已关闭或不可用。
    Ended,
}

/// 工具调用中的结构化 diff（来自 ACP `ToolCallContent::Diff`），供桌面侧栏高亮。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDiffInfo {
    pub path: String,
    /// 原内容；新建文件时为 `None`
    pub old_text: Option<String>,
    pub new_text: String,
}

/// 工具调用快照（供 GUI 卡片展示；字段尽量完整，更新事件可为部分字段）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallInfo {
    pub tool_call_id: String,
    /// read / edit / execute / search / fetch / delete / move / think / other
    pub kind: String,
    /// pending / in_progress / completed / failed
    pub status: String,
    pub title: String,
    /// 路径、命令等摘要（优先 raw_input）
    pub detail: String,
    /// 输出预览（截断）
    pub preview: String,
    /// 结构化 diff 列表（可能为空；编辑类工具优先用此字段做高亮）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diffs: Vec<ToolDiffInfo>,
}

/// 工具调用增量更新（仅包含本次有值的字段；`None` 表示不改）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallUpdateInfo {
    pub tool_call_id: String,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub title: Option<String>,
    pub detail: Option<String>,
    pub preview: Option<String>,
    /// 有 content 且含 Diff 时写入；无 diff 时为 `None`（不覆盖已有）
    pub diffs: Option<Vec<ToolDiffInfo>>,
}

/// 面向 GUI / REPL 的业务层事件。
pub enum SessionEvent {
    /// AI 回复文本片段（流式）。
    AgentTextChunk(String),
    /// AI 思考过程片段（流式）。
    AgentThoughtChunk(String),
    /// 用户消息回显。用户主动发送时会带上前端生成的 prompt_id，
    /// 用于前端做乐观 UI 精确核销；系统/回放/无 meta 来源时为 None。
    UserTextChunk {
        text: String,
        prompt_id: Option<String>,
    },
    /// 本轮对话结束。
    TurnEnded {
        stop_reason: String,
        prompt_id: Option<String>,
    },
    /// 错误信息。
    Error {
        message: String,
        prompt_id: Option<String>,
    },
    /// 其它未专门映射的通知（调试用）。
    Other(String),
    /// 新工具调用（或完整快照）。
    ToolCall(ToolCallInfo),
    /// 工具调用状态/内容更新。
    ToolCallUpdate(ToolCallUpdateInfo),
    /// 上下文用量（来自 session/update `_meta.totalTokens`，会话累计估计）。
    TokenUsage {
        total_tokens: u64,
    },
    /// 工具权限门控：通过 `respond` 发送选中的 `option_id` 作答。
    PermissionRequest {
        description: String,
        /// `(选项 id, 显示名称)`
        options: Vec<(String, String)>,
        respond: oneshot::Sender<String>,
    },
}

impl std::fmt::Debug for SessionEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AgentTextChunk(t) => write!(f, "AgentTextChunk({:?})", t),
            Self::AgentThoughtChunk(t) => write!(f, "AgentThoughtChunk({:?})", t),
            Self::UserTextChunk { text, prompt_id } => {
                write!(f, "UserTextChunk {{ text: {:?}, prompt_id: {:?} }}", text, prompt_id)
            }
            Self::TurnEnded { stop_reason, prompt_id } => {
                write!(f, "TurnEnded {{ stop_reason: {:?}, prompt_id: {:?} }}", stop_reason, prompt_id)
            }
            Self::Error { message, prompt_id } => {
                write!(f, "Error {{ message: {:?}, prompt_id: {:?} }}", message, prompt_id)
            }
            Self::Other(o) => write!(f, "Other({:?})", o),
            Self::ToolCall(t) => write!(
                f,
                "ToolCall {{ id: {:?}, kind: {:?}, status: {:?}, title: {:?} }}",
                t.tool_call_id, t.kind, t.status, t.title
            ),
            Self::ToolCallUpdate(t) => write!(
                f,
                "ToolCallUpdate {{ id: {:?}, status: {:?} }}",
                t.tool_call_id, t.status
            ),
            Self::TokenUsage { total_tokens } => {
                write!(f, "TokenUsage {{ total_tokens: {} }}", total_tokens)
            }
            Self::PermissionRequest {
                description,
                options,
                ..
            } => write!(
                f,
                "PermissionRequest {{ description: {:?}, options: {:?} }}",
                description, options
            ),
        }
    }
}

/// ACP 客户端：把 agent 推送转发到有界 mpsc，形成背压。
struct GuiClient {
    event_tx: mpsc::Sender<SessionEvent>,
}

#[async_trait::async_trait(?Send)]
impl Client for GuiClient {
    async fn request_permission(
        &self,
        args: RequestPermissionRequest,
    ) -> agent_client_protocol::Result<RequestPermissionResponse> {
        let options: Vec<(String, String)> = args
            .options
            .iter()
            .map(|o| (o.option_id.to_string(), o.name.clone()))
            .collect();

        if options.is_empty() {
            let _ = self
                .event_tx
                .send(SessionEvent::Error {
                    message: "权限请求没有可选项".to_string(),
                    prompt_id: None,
                })
                .await;
            return Err(agent_client_protocol::Error::invalid_params());
        }

        let (respond_tx, respond_rx) = oneshot::channel();
        // 人类可读摘要，避免 Debug dump 把权限弹窗撑爆/糊成一整屏
        let description = format_permission_description(&args.tool_call);

        let _ = self
            .event_tx
            .send(SessionEvent::PermissionRequest {
                description,
                options: options.clone(),
                respond: respond_tx,
            })
            .await;

        let chosen_id = match respond_rx.await {
            Ok(id) => id,
            Err(_) => {
                // 外部未作答（通道被 drop）：安全默认选第一项。
                options[0].0.clone()
            }
        };

        Ok(RequestPermissionResponse::new(
            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                agent_client_protocol::PermissionOptionId::new(chosen_id),
            )),
        ))
    }

    async fn session_notification(
        &self,
        args: SessionNotification,
    ) -> agent_client_protocol::Result<()> {
        let meta = args.meta.as_ref();
        let event = session_update_to_event(args.update, meta);
        let _ = self.event_tx.send(event).await;
        // 官方在 notification meta 里带 totalTokens（会话累计估计）
        if let Some(tokens) = meta
            .and_then(|m| m.get("totalTokens"))
            .and_then(|v| v.as_u64())
        {
            let _ = self
                .event_tx
                .send(SessionEvent::TokenUsage {
                    total_tokens: tokens,
                })
                .await;
        }
        Ok(())
    }
}

fn content_block_to_text(block: &agent_client_protocol::ContentBlock) -> String {
    match block {
        agent_client_protocol::ContentBlock::Text(t) => t.text.clone(),
        other => format!("{:?}", other),
    }
}

/// 把权限请求里的 tool_call 收成简短可读文案（命令 / 路径 / 标题）。
fn format_permission_description(tc: &agent_client_protocol::ToolCallUpdate) -> String {
    let fields = &tc.fields;
    let title = fields
        .title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let kind = fields.kind.map(tool_kind_str).unwrap_or_else(|| "other".into());
    let kind_label = match kind.as_str() {
        "execute" => "运行终端命令",
        "read" => "读取文件",
        "edit" => "编辑文件",
        "delete" => "删除文件",
        "search" => "搜索",
        "fetch" => "网络请求",
        "move" => "移动/重命名",
        _ => "执行工具",
    };

    let detail = match fields.kind {
        Some(k) => tool_detail(k, &fields.raw_input, title.unwrap_or("")),
        None => {
            // 无 kind 时仍尽量从 raw_input 抽
            raw_str_field(
                &fields.raw_input,
                &[
                    "command",
                    "cmd",
                    "file_path",
                    "filePath",
                    "target_file",
                    "path",
                    "query",
                    "url",
                ],
            )
            .or_else(|| title.map(|s| s.to_string()))
            .unwrap_or_default()
        }
    };

    let mut lines = vec![format!("类型：{kind_label}")];
    if let Some(t) = title {
        if t != detail {
            lines.push(format!("工具：{t}"));
        }
    }
    if !detail.is_empty() {
        let label = if kind == "execute" { "命令" } else { "目标" };
        // 权限弹窗只展示摘要，过长截断
        let shown = if detail.chars().count() > 800 {
            let mut s: String = detail.chars().take(800).collect();
            s.push('…');
            s
        } else {
            detail
        };
        lines.push(format!("{label}：\n{shown}"));
    }
    if lines.len() == 1 {
        lines.push(format!("工具调用 id：{}", tc.tool_call_id));
    }
    lines.join("\n")
}

const PREVIEW_MAX_CHARS: usize = 2500;
/// 单侧 diff 文本上限（字符），避免超大文件堵事件通道；侧栏仍够用。
const DIFF_TEXT_MAX_CHARS: usize = 80_000;

fn truncate_preview(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= PREVIEW_MAX_CHARS {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(PREVIEW_MAX_CHARS).collect();
    out.push_str("…");
    out
}

fn truncate_diff_text(s: &str) -> String {
    if s.chars().count() <= DIFF_TEXT_MAX_CHARS {
        return s.to_string();
    }
    let mut out: String = s.chars().take(DIFF_TEXT_MAX_CHARS).collect();
    out.push_str("\n…(truncated)");
    out
}

/// 从 ACP tool content 抽出结构化 diff。
fn extract_tool_diffs(content: &[agent_client_protocol::ToolCallContent]) -> Vec<ToolDiffInfo> {
    use agent_client_protocol::ToolCallContent;
    let mut out = Vec::new();
    for c in content {
        if let ToolCallContent::Diff(diff) = c {
            out.push(ToolDiffInfo {
                path: diff.path.display().to_string(),
                old_text: diff.old_text.as_ref().map(|t| truncate_diff_text(t)),
                new_text: truncate_diff_text(&diff.new_text),
            });
        }
    }
    out
}

/// 简易 unified 片段：供卡片 preview（完整高亮走 `diffs` 字段）。
fn format_diff_preview_snippet(
    path: &std::path::Path,
    old_text: Option<&str>,
    new_text: &str,
) -> String {
    let mut lines = Vec::new();
    lines.push(format!("diff {}", path.display()));
    if let Some(old) = old_text {
        for line in old.lines().take(40) {
            lines.push(format!("-{line}"));
        }
        if old.lines().count() > 40 {
            lines.push("-…".to_string());
        }
    }
    for line in new_text.lines().take(40) {
        lines.push(format!("+{line}"));
    }
    if new_text.lines().count() > 40 {
        lines.push("+…".to_string());
    }
    lines.join("\n")
}

fn tool_kind_str(kind: agent_client_protocol::ToolKind) -> String {
    use agent_client_protocol::ToolKind;
    match kind {
        ToolKind::Read => "read",
        ToolKind::Edit => "edit",
        ToolKind::Delete => "delete",
        ToolKind::Move => "move",
        ToolKind::Search => "search",
        ToolKind::Execute => "execute",
        ToolKind::Think => "think",
        ToolKind::Fetch => "fetch",
        ToolKind::SwitchMode => "switch_mode",
        ToolKind::Other => "other",
        _ => "other",
    }
    .to_string()
}

fn tool_status_str(status: agent_client_protocol::ToolCallStatus) -> String {
    use agent_client_protocol::ToolCallStatus;
    match status {
        ToolCallStatus::Pending => "pending",
        ToolCallStatus::InProgress => "in_progress",
        ToolCallStatus::Completed => "completed",
        ToolCallStatus::Failed => "failed",
        _ => "pending",
    }
    .to_string()
}

fn raw_str_field(raw: &Option<serde_json::Value>, keys: &[&str]) -> Option<String> {
    let obj = raw.as_ref()?.as_object()?;
    for key in keys {
        if let Some(v) = obj.get(*key) {
            if let Some(s) = v.as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            } else if !v.is_null() {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// 从 kind + raw_input + title 抽出一行摘要（路径 / 命令 / 查询）。
fn tool_detail(
    kind: agent_client_protocol::ToolKind,
    raw_input: &Option<serde_json::Value>,
    title: &str,
) -> String {
    use agent_client_protocol::ToolKind;
    let from_raw = match kind {
        ToolKind::Execute => raw_str_field(raw_input, &["command", "cmd"]),
        ToolKind::Read | ToolKind::Edit | ToolKind::Delete | ToolKind::Move => raw_str_field(
            raw_input,
            &["file_path", "filePath", "target_file", "path", "old_path", "new_path"],
        ),
        ToolKind::Search => raw_str_field(
            raw_input,
            &["pattern", "query", "glob", "path", "file_path"],
        ),
        ToolKind::Fetch => raw_str_field(raw_input, &["url", "uri", "href"]),
        _ => raw_str_field(raw_input, &["command", "path", "file_path", "query", "url"]),
    };
    from_raw
        .filter(|s| {
            // 避免把内部工具函数名当命令展示
            let lower = s.to_ascii_lowercase();
            !matches!(
                lower.as_str(),
                "run_terminal_command"
                    | "run_terminal_cmd"
                    | "bash"
                    | "shell"
                    | "execute"
                    | "read_file"
                    | "search_replace"
            )
        })
        .unwrap_or_else(|| title.trim().to_string())
}

fn tool_content_preview(content: &[agent_client_protocol::ToolCallContent]) -> String {
    use agent_client_protocol::ToolCallContent;
    let mut parts = Vec::new();
    for c in content {
        match c {
            ToolCallContent::Content(block) => {
                let t = content_block_to_text(&block.content);
                if !t.trim().is_empty() {
                    parts.push(t);
                }
            }
            ToolCallContent::Diff(diff) => {
                parts.push(format_diff_preview_snippet(
                    &diff.path,
                    diff.old_text.as_deref(),
                    &diff.new_text,
                ));
            }
            ToolCallContent::Terminal(_) => {
                parts.push("[terminal]".to_string());
            }
            _ => {}
        }
    }
    truncate_preview(&parts.join("\n"))
}

fn tool_raw_output_preview(raw: &Option<serde_json::Value>) -> String {
    let Some(v) = raw else {
        return String::new();
    };
    if let Some(s) = v.as_str() {
        return truncate_preview(s);
    }
    // bash / 终端常见结构：{ output, exit_code } 或嵌套 output
    if let Some(obj) = v.as_object() {
        if let Some(out) = obj.get("output").and_then(|x| x.as_str()) {
            let code = obj
                .get("exit_code")
                .or_else(|| obj.get("exitCode"))
                .and_then(|x| x.as_i64());
            let body = truncate_preview(out);
            return match code {
                Some(c) if c != 0 => format!("exit {c}\n{body}"),
                _ => body,
            };
        }
        if let Some(s) = obj.get("content").and_then(|x| x.as_str()) {
            return truncate_preview(s);
        }
        if let Some(s) = obj.get("raw_output").and_then(|x| x.as_str()) {
            return truncate_preview(s);
        }
    }
    truncate_preview(&v.to_string())
}

fn tool_call_to_info(tc: &agent_client_protocol::ToolCall) -> ToolCallInfo {
    let detail = tool_detail(tc.kind, &tc.raw_input, &tc.title);
    let mut preview = tool_content_preview(&tc.content);
    if preview.is_empty() {
        preview = tool_raw_output_preview(&tc.raw_output);
    }
    let diffs = extract_tool_diffs(&tc.content);
    ToolCallInfo {
        tool_call_id: tc.tool_call_id.to_string(),
        kind: tool_kind_str(tc.kind),
        status: tool_status_str(tc.status),
        title: tc.title.clone(),
        detail,
        preview,
        diffs,
    }
}

fn tool_call_update_to_info(tcu: &agent_client_protocol::ToolCallUpdate) -> ToolCallUpdateInfo {
    let fields = &tcu.fields;
    let kind = fields.kind.map(tool_kind_str);
    let status = fields.status.map(tool_status_str);
    let title = fields.title.clone();
    let detail = match (fields.kind, &fields.raw_input, &fields.title) {
        (Some(k), raw, Some(t)) => Some(tool_detail(k, raw, t)),
        (Some(k), raw, None) => Some(tool_detail(k, raw, "")),
        (None, raw, Some(t)) if raw.is_some() => {
            // kind 未知时仍尽量从 raw 抽
            Some(tool_detail(
                agent_client_protocol::ToolKind::Other,
                raw,
                t,
            ))
        }
        (None, Some(raw), None) => {
            raw_str_field(&Some(raw.clone()), &["command", "file_path", "path", "query", "url"])
        }
        _ => None,
    };
    let mut preview = fields
        .content
        .as_ref()
        .map(|c| tool_content_preview(c))
        .filter(|s| !s.is_empty());
    if preview.is_none() {
        preview = fields
            .raw_output
            .as_ref()
            .map(|v| tool_raw_output_preview(&Some(v.clone())))
            .filter(|s| !s.is_empty());
    }
    // 仅在 content 携带 Diff 时更新 diffs，避免空更新抹掉已有 diff
    let diffs = fields.content.as_ref().and_then(|c| {
        let d = extract_tool_diffs(c);
        if d.is_empty() {
            None
        } else {
            Some(d)
        }
    });
    ToolCallUpdateInfo {
        tool_call_id: tcu.tool_call_id.to_string(),
        kind,
        status,
        title,
        detail,
        preview,
        diffs,
    }
}

/// 将 ACP 的 `SessionUpdate` 映射为业务层 `SessionEvent`（纯函数，有单元测试）。
pub fn session_update_to_event(
    update: SessionUpdate,
    meta: Option<&serde_json::Map<String, serde_json::Value>>,
) -> SessionEvent {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) => {
            SessionEvent::AgentTextChunk(content_block_to_text(&chunk.content))
        }
        SessionUpdate::AgentThoughtChunk(chunk) => {
            SessionEvent::AgentThoughtChunk(content_block_to_text(&chunk.content))
        }
        SessionUpdate::UserMessageChunk(chunk) => {
            let prompt_id = meta
                .and_then(|m| m.get("promptId"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            SessionEvent::UserTextChunk {
                text: content_block_to_text(&chunk.content),
                prompt_id,
            }
        }
        SessionUpdate::ToolCall(tc) => SessionEvent::ToolCall(tool_call_to_info(&tc)),
        SessionUpdate::ToolCallUpdate(tcu) => {
            SessionEvent::ToolCallUpdate(tool_call_update_to_info(&tcu))
        }
        other => SessionEvent::Other(format!("{:?}", other)),
    }
}

/// 会话句柄：GUI / REPL 只需要与此类型交互。
pub struct GrokSession {
    connection: Arc<ClientSideConnection>,
    session_id: SessionId,
    /// 流式事件接收端（有界缓冲 256，提供背压）。
    event_rx: mpsc::Receiver<SessionEvent>,
    event_tx: mpsc::Sender<SessionEvent>,
    /// 状态广播：只关心最新值，支持多路订阅。
    status_tx: watch::Sender<SessionStatus>,
}

impl GrokSession {
    /// 当前会话的 session_id（字符串形式，供上层持久化/展示使用）。
    pub fn session_id(&self) -> String {
        self.session_id.to_string()
    }

    /// 启动 agent，完成 `initialize` + `session/new`，返回可用会话。
    ///
    /// 必须在 `LocalSet` 中调用。
    pub async fn start(cwd: impl Into<String>) -> anyhow::Result<Self> {
        // 从环境变量与配置目录加载合并后的有效配置。
        let raw_config = xai_grok_shell::config::load_effective_config()
            .map_err(|e| anyhow::anyhow!("加载配置失败: {}", e))?;
        let agent_config = AgentConfig::new_from_toml_cfg(&raw_config)
            .map_err(|e| anyhow::anyhow!("创建 agent 配置失败: {}", e))?;
        let auth_manager = Arc::new(agent_config.create_auth_manager());

        let (gui_stream, agent_stream) = tokio::io::duplex(65536);
        let (agent_rx, agent_tx) = tokio::io::split(agent_stream);
        let compat_rx = agent_rx.compat();
        let compat_tx = agent_tx.compat_write();

        tokio::task::spawn_local(async move {
            let handle_io = spawn_agent_local(
                agent_config,
                auth_manager,
                None,
                None,
                compat_tx,
                compat_rx,
            );
            if let Err(e) = handle_io.await {
                eprintln!("Agent 运行时错误: {:?}", e);
            }
        });

        let (gui_read, gui_write) = tokio::io::split(gui_stream);
        let compat_gui_read = gui_read.compat();
        let compat_gui_write = gui_write.compat_write();

        let (event_tx, event_rx) = mpsc::channel(256);
        let client = GuiClient {
            event_tx: event_tx.clone(),
        };

        let (connection, io_task) =
            ClientSideConnection::new(client, compat_gui_write, compat_gui_read, |fut| {
                tokio::task::spawn_local(fut);
            });

        tokio::task::spawn_local(io_task.map(|result| {
            if let Err(e) = result {
                eprintln!("IO 任务错误: {:?}", e);
            }
        }));

        connection
            .initialize(
                InitializeRequest::new(ProtocolVersion::LATEST)
                    .client_capabilities(ClientCapabilities::default()),
            )
            .await?;

        let (status_tx, _status_rx) = watch::channel(SessionStatus::Initializing);

        let session_response = connection
            .new_session(NewSessionRequest::new(cwd.into()))
            .await?;

        let _ = status_tx.send(SessionStatus::Idle);

        Ok(Self {
            connection: Arc::new(connection),
            session_id: session_response.session_id,
            event_rx,
            event_tx,
            status_tx,
        })
    }

    /// 恢复一个已有会话（通过 load_session），不影响 start() 原有逻辑。
    ///
    /// 必须在 `LocalSet` 中调用。
    pub async fn resume(session_id: impl Into<SessionId>, cwd: impl Into<String>) -> anyhow::Result<Self> {
        let raw_config = xai_grok_shell::config::load_effective_config()
            .map_err(|e| anyhow::anyhow!("加载配置失败: {}", e))?;
        let agent_config = AgentConfig::new_from_toml_cfg(&raw_config)
            .map_err(|e| anyhow::anyhow!("创建 agent 配置失败: {}", e))?;
        let auth_manager = Arc::new(agent_config.create_auth_manager());
        let (gui_stream, agent_stream) = tokio::io::duplex(65536);
        let (agent_rx, agent_tx) = tokio::io::split(agent_stream);
        let compat_rx = agent_rx.compat();
        let compat_tx = agent_tx.compat_write();
        tokio::task::spawn_local(async move {
            let handle_io = spawn_agent_local(
                agent_config,
                auth_manager,
                None,
                None,
                compat_tx,
                compat_rx,
            );
            if let Err(e) = handle_io.await {
                eprintln!("Agent 运行时错误: {:?}", e);
            }
        });
        let (gui_read, gui_write) = tokio::io::split(gui_stream);
        let compat_gui_read = gui_read.compat();
        let compat_gui_write = gui_write.compat_write();
        let (event_tx, event_rx) = mpsc::channel(256);
        let client = GuiClient {
            event_tx: event_tx.clone(),
        };
        let (connection, io_task) =
            ClientSideConnection::new(client, compat_gui_write, compat_gui_read, |fut| {
                tokio::task::spawn_local(fut);
            });
        tokio::task::spawn_local(io_task.map(|result| {
            if let Err(e) = result {
                eprintln!("IO 任务错误: {:?}", e);
            }
        }));
        connection
            .initialize(
                InitializeRequest::new(ProtocolVersion::LATEST)
                    .client_capabilities(ClientCapabilities::default()),
            )
            .await?;
        let (status_tx, _status_rx) = watch::channel(SessionStatus::Initializing);

        // 先克隆一份 session_id 自用，避免依赖 LoadSessionResponse 的具体字段结构。
        let session_id: SessionId = session_id.into();
        let load_session_id = session_id.clone();
        connection
            .load_session(LoadSessionRequest::new(load_session_id, cwd.into()))
            .await?;

        let _ = status_tx.send(SessionStatus::Idle);
        Ok(Self {
            connection: Arc::new(connection),
            session_id,
            event_rx,
            event_tx,
            status_tx,
        })
    }

    /// 发送用户消息（不等待完成；流式结果通过 [`Self::next_event`] 获取）。
    pub async fn send_prompt(
        &self,
        text: impl Into<String>,
        prompt_id: String,
    ) -> anyhow::Result<()> {
        let session_id = self.session_id.clone();
        let text = text.into();
        let connection = Arc::clone(&self.connection);
        let event_tx = self.event_tx.clone();
        let status_tx = self.status_tx.clone();

        // 立刻切到 Generating，方便界面显示加载态并禁用输入。
        let _ = status_tx.send(SessionStatus::Generating);

        let pid_for_task = prompt_id.clone();
        tokio::task::spawn_local(async move {
            let result = connection
                .prompt(
                    PromptRequest::new(session_id, vec![text.into()]).meta({
                        let mut m = serde_json::Map::new();
                        m.insert(
                            "promptId".to_string(),
                            serde_json::Value::String(pid_for_task.clone()),
                        );
                        m
                    }),
                )
                .await;
            match result {
                Ok(response) => {
                    let _ = event_tx
                        .send(SessionEvent::TurnEnded {
                            stop_reason: format!("{:?}", response.stop_reason),
                            prompt_id: Some(prompt_id.clone()),
                        })
                        .await;
                }
                Err(e) => {
                    let _ = event_tx
                        .send(SessionEvent::Error {
                            message: format!("{:?}", e),
                            prompt_id: Some(prompt_id.clone()),
                        })
                        .await;
                }
            }
            // 无论成功或失败都必须回到 Idle，避免界面永久锁在 Generating。
            let _ = status_tx.send(SessionStatus::Idle);
        });
        Ok(())
    }

    /// 取消当前正在进行的生成轮次（若有）。
    pub async fn cancel(&self) -> anyhow::Result<()> {
        self.connection
            .cancel(CancelNotification::new(self.session_id.clone()))
            .await?;
        Ok(())
    }

    /// 在不重启会话的情况下，切换当前会话使用的模型（协议原生支持，无需重建连接）。
    ///
    /// `reasoning_effort` 可选：官方 meta 键 `reasoningEffort`
    ///（none/minimal/low/medium/high/xhigh），仅当模型支持推理时生效。
    pub async fn set_model(
        &self,
        model_id: impl Into<String>,
        reasoning_effort: Option<&str>,
    ) -> anyhow::Result<()> {
        let mut req = SetSessionModelRequest::new(
            self.session_id.clone(),
            ModelId::new(model_id.into()),
        );
        if let Some(effort) = reasoning_effort.map(str::trim).filter(|s| !s.is_empty()) {
            let mut meta = serde_json::Map::new();
            meta.insert(
                "reasoningEffort".into(),
                serde_json::Value::String(effort.to_ascii_lowercase()),
            );
            req = req.meta(meta);
        }
        self.connection.set_session_model(req).await?;
        Ok(())
    }

    /// 热重载模型目录：从磁盘 `config.toml` 重新加载进运行中的 agent（官方
    /// `x.ai/internal/reload_models`），**不销毁会话、不清聊天**。
    ///
    /// 用于设置里「新增/修改模型」后立刻让 catalog 生效，体验对齐市面桌面端。
    pub async fn reload_models(&self) -> anyhow::Result<()> {
        let params = serde_json::value::to_raw_value(&serde_json::json!({}))
            .map_err(|e| anyhow::anyhow!("序列化 reload_models 参数失败: {e}"))?;
        self.connection
            .ext_method(ExtRequest::new(
                "x.ai/internal/reload_models",
                params.into(),
            ))
            .await
            .map_err(|e| anyhow::anyhow!("reload_models 失败: {e:?}"))?;
        Ok(())
    }

    /// 获取当前会话累计 token 用量与拆分明细（x.ai/session/usage 扩展方法）。
    /// 主动请求，非订阅；建议在收到 TurnEnded 后调用刷新。
    pub async fn get_usage(&self) -> anyhow::Result<xai_grok_shell::extensions::notification::PromptUsage> {
        let params = serde_json::value::to_raw_value(&serde_json::json!({
            "sessionId": self.session_id.to_string(),
        }))
        .map_err(|e| anyhow::anyhow!("序列化 get_usage 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/session/usage", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("get_usage 失败: {e:?}"))?;
        let value: serde_json::Value = serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 usage 响应失败: {e}"))?;
        let usage = value
            .get("usage")
            .ok_or_else(|| anyhow::anyhow!("usage 响应缺少 usage 字段"))?;
        serde_json::from_value(usage.clone())
            .map_err(|e| anyhow::anyhow!("反序列化 PromptUsage 失败: {e}"))
    }

    /// 订阅会话状态变化（如「正在生成中」指示器）。
    pub fn subscribe_status(&self) -> watch::Receiver<SessionStatus> {
        self.status_tx.subscribe()
    }

    /// 获取下一个会话事件（阻塞直到有事件或通道关闭）。
    pub async fn next_event(&mut self) -> Option<SessionEvent> {
        self.event_rx.recv().await
    }
}

/// 列出指定工作目录下的历史会话摘要（按官方持久化层的排序返回，通常是最近更新在前）。
pub async fn list_sessions(cwd: &str) -> anyhow::Result<Vec<Summary>> {
    xai_grok_shell::session::persistence::list_summaries(Some(cwd))
        .await
        .map_err(|e| anyhow::anyhow!("读取会话列表失败: {}", e))
}

/// 列出所有工作空间下的会话摘要（侧栏跨工作空间分组用）。
pub async fn list_all_sessions() -> anyhow::Result<Vec<Summary>> {
    xai_grok_shell::session::persistence::list_summaries(None)
        .await
        .map_err(|e| anyhow::anyhow!("读取全部会话列表失败: {}", e))
}

/// 删除指定 session_id 的本地持久化记录。
pub async fn delete_session(session_id: &str, cwd: &str) -> anyhow::Result<()> {
    let raw_config = xai_grok_shell::config::load_effective_config()
        .map_err(|e| anyhow::anyhow!("加载配置失败: {}", e))?;
    let agent_config = AgentConfig::new_from_toml_cfg(&raw_config)
        .map_err(|e| anyhow::anyhow!("创建 agent 配置失败: {}", e))?;
    let auth_manager = Arc::new(agent_config.create_auth_manager());

    xai_grok_shell::session::persistence::delete_session_history(session_id, Some(cwd), false, auth_manager)
        .await
        .map_err(|e| anyhow::anyhow!("删除会话失败: {}", e))?;
    Ok(())
}

/// 是否为「从未真正对话」的空会话（不应出现在历史列表、新建时可丢弃）。
///
/// **不要**用 `num_chat_messages`：官方在 session/new 时会写入 system +
/// system-reminder 等注入，空会话也会变成 `num_chat_messages >= 1/2`。
/// 只认：手动/展示标题、或磁盘上抽得出真实用户问题。
pub fn is_blank_session(summary: &Summary) -> bool {
    if summary.manual_title_opt().is_some() {
        return false;
    }
    if summary.display_title_opt().is_some() {
        return false;
    }
    if get_session_first_prompt(summary).is_some() {
        return false;
    }
    true
}

/// 按 id 判断会话是否为空（会话刚 drop 后磁盘记录仍在时调用）。
pub async fn is_blank_session_id(session_id: &str, cwd: &str) -> bool {
    match list_sessions(cwd).await {
        Ok(list) => list
            .iter()
            .find(|s| s.info.id.to_string() == session_id)
            .map(is_blank_session)
            // 列表里找不到：可能已删，或 cwd 不一致；有目录则再读 first prompt
            .unwrap_or_else(|| {
                let Some(dir) =
                    xai_grok_shell::session::persistence::find_session_dir_by_id(session_id)
                else {
                    return true;
                };
                !session_dir_has_real_user_prompt(&dir)
            }),
        Err(_) => {
            xai_grok_shell::session::persistence::find_session_dir_by_id(session_id).is_none()
        }
    }
}

/// 若会话为空则删除磁盘记录，返回是否已删除。
pub async fn delete_session_if_blank(session_id: &str, cwd: &str) -> bool {
    if !is_blank_session_id(session_id, cwd).await {
        return false;
    }
    match delete_session(session_id, cwd).await {
        Ok(()) => true,
        Err(e) => {
            eprintln!("删除空会话失败 ({session_id}): {e}");
            false
        }
    }
}

/// 清理 cwd 下所有空会话（新建会话时调用，清掉历史堆积的「新对话」空壳）。
pub async fn purge_blank_sessions(cwd: &str) -> usize {
    let Ok(list) = list_sessions(cwd).await else {
        return 0;
    };
    let mut n = 0;
    for s in list {
        if !is_blank_session(&s) {
            continue;
        }
        let id = s.info.id.to_string();
        if delete_session(&id, cwd).await.is_ok() {
            n += 1;
        }
    }
    n
}

/// 会话目录里是否已有真实用户提问（prompt 文件或 chat_history）。
fn session_dir_has_real_user_prompt(session_dir: &std::path::Path) -> bool {
    let prompt_file = session_dir.join("prompts").join("prompt_0.txt");
    if let Ok(content) = std::fs::read_to_string(prompt_file) {
        if content.lines().any(|l| extract_user_question_text(l).is_some()) {
            return true;
        }
    }
    let history_file = session_dir.join("chat_history.jsonl");
    if let Ok(file) = std::fs::File::open(history_file) {
        use std::io::BufRead;
        for line in std::io::BufReader::new(file).lines().flatten() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                if v.get("synthetic_reason").is_some_and(|s| !s.is_null()) {
                    continue;
                }
                let is_user = v.get("role").and_then(|r| r.as_str()) == Some("user")
                    || v.get("type").and_then(|t| t.as_str()) == Some("user");
                if !is_user {
                    continue;
                }
                if let Some(content) = v.get("content") {
                    if let Some(text) = content_value_to_text(content) {
                        if extract_user_question_text(&text).is_some() {
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}

/// 手动重命名会话标题（写入 summary.json 的 generated_title，并标记 title_is_manual）。
///
/// 与官方 TUI `/rename` 同一存储路径，重启后仍生效。
pub async fn rename_session(session_id: &str, cwd: &str, title: &str) -> anyhow::Result<()> {
    let title = title.trim();
    if title.is_empty() {
        return Err(anyhow::anyhow!("标题不能为空"));
    }

    let summaries = list_sessions(cwd).await?;
    let summary = summaries
        .iter()
        .find(|s| s.info.id.to_string() == session_id)
        .ok_or_else(|| anyhow::anyhow!("会话不存在: {session_id}"))?;

    use xai_grok_shell::session::storage::{JsonlStorageAdapter, StorageAdapter};
    let storage = JsonlStorageAdapter::default();
    storage
        .update_session_title(&summary.info, title.to_string())
        .await
        .map_err(|e| anyhow::anyhow!("重命名失败: {e}"))?;

    // 刷新本地会话搜索索引（与官方 rename 扩展一致）
    xai_grok_shell::session::storage::search::notify_session_updated(
        &summary.info.id.to_string(),
        &summary.info.cwd,
    );

    Ok(())
}

/// 从一段用户文本中抽出可展示的问题（优先 `<user_query>`）。
fn extract_user_question_text(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    // 官方用户消息常包在 <user_query>…</user_query>
    if let Some(start) = text.find("<user_query>") {
        let after = &text[start + "<user_query>".len()..];
        if let Some(end) = after.find("</user_query>") {
            let inner = after[..end].trim();
            if !inner.is_empty() {
                return Some(inner.chars().take(40).collect());
            }
        }
    }
    // 跳过纯系统注入块
    if text.contains("<user_info>")
        || text.contains("<system-reminder>")
        || text.contains("<git_status>")
    {
        return None;
    }
    Some(text.chars().take(40).collect())
}

fn content_value_to_text(content: &serde_json::Value) -> Option<String> {
    if let Some(s) = content.as_str() {
        return Some(s.to_string());
    }
    if let Some(arr) = content.as_array() {
        let mut parts = Vec::new();
        for item in arr {
            if let Some(t) = item.get("text").and_then(|x| x.as_str()) {
                parts.push(t);
            }
        }
        if parts.is_empty() {
            return None;
        }
        return Some(parts.join("\n"));
    }
    None
}

/// 尝试从会话目录抽取用户问 AI 的第一个问题（first prompt）作为备选标题。
pub fn get_session_first_prompt(summary: &Summary) -> Option<String> {
    let session_dir = xai_grok_shell::session::persistence::session_dir(&summary.info);

    // 1. 优先尝试读取 prompts/prompt_0.txt
    let prompt_file = session_dir.join("prompts").join("prompt_0.txt");
    if let Ok(content) = std::fs::read_to_string(prompt_file) {
        if let Some(line) = content.lines().find(|l| !l.trim().is_empty()) {
            if let Some(q) = extract_user_question_text(line) {
                return Some(q);
            }
        }
    }

    // 2. 读取 chat_history.jsonl 中的真实 user 消息
    let history_file = session_dir.join("chat_history.jsonl");
    if let Ok(file) = std::fs::File::open(history_file) {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(file);
        for line in reader.lines().flatten() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                // 跳过 synthetic 注入
                if v.get("synthetic_reason").is_some_and(|s| !s.is_null()) {
                    continue;
                }
                let is_user = v.get("role").and_then(|r| r.as_str()) == Some("user")
                    || v.get("type").and_then(|t| t.as_str()) == Some("user");
                if !is_user {
                    continue;
                }
                if let Some(content) = v.get("content") {
                    if let Some(text) = content_value_to_text(content) {
                        if let Some(q) = extract_user_question_text(&text) {
                            return Some(q);
                        }
                    }
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::{ContentBlock, ContentChunk};

    fn text_chunk(text: &str) -> ContentChunk {
        ContentChunk::new(ContentBlock::from(text))
    }

    #[test]
    fn agent_message_chunk_becomes_agent_text_chunk() {
        let update = SessionUpdate::AgentMessageChunk(text_chunk("你好"));
        let event = session_update_to_event(update, None);
        match event {
            SessionEvent::AgentTextChunk(text) => assert_eq!(text, "你好"),
            other => panic!("期望 AgentTextChunk，实际 {:?}", other),
        }
    }

    #[test]
    fn agent_thought_chunk_becomes_agent_thought_chunk() {
        let update = SessionUpdate::AgentThoughtChunk(text_chunk("思考中"));
        let event = session_update_to_event(update, None);
        match event {
            SessionEvent::AgentThoughtChunk(text) => assert_eq!(text, "思考中"),
            other => panic!("期望 AgentThoughtChunk，实际 {:?}", other),
        }
    }

    #[test]
    fn user_message_chunk_becomes_user_text_chunk() {
        let update = SessionUpdate::UserMessageChunk(text_chunk("提问"));
        let mut meta = serde_json::Map::new();
        meta.insert("promptId".to_string(), serde_json::Value::String("p-123".to_string()));
        let event = session_update_to_event(update, Some(&meta));
        match event {
            SessionEvent::UserTextChunk { text, prompt_id } => {
                assert_eq!(text, "提问");
                assert_eq!(prompt_id, Some("p-123".to_string()));
            }
            other => panic!("期望 UserTextChunk，实际 {:?}", other),
        }
    }
}
