//! Grok Build 桌面端 / 命令行前端共用的会话封装层。
//!
//! 在进程内通过 ACP 双工管道包装 `xai-grok-shell`，
//! 让 UI 代码不必直接处理 JSON-RPC 或 agent 接线细节。
//!
//! **运行时要求：** 调用方必须在 `tokio::task::LocalSet` 中运行
//! （或由 `current_thread` runtime 驱动 LocalSet），
//! 因为 ACP 客户端与 agent 任务都使用 `spawn_local`。

mod display_messages;
pub use display_messages::{load_display_messages, load_display_messages_from_session_dir, DisplayMessage};

use agent_client_protocol::{
    Agent, CancelNotification, Client, ClientCapabilities, ClientSideConnection, ExtNotification,
    ExtRequest, ExtResponse, InitializeRequest, LoadSessionRequest, ModelId, NewSessionRequest,
    PromptRequest, ProtocolVersion, RequestPermissionOutcome, RequestPermissionRequest,
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
use xai_grok_shell::extensions::notification::RetryState;
pub use xai_grok_shell::session::{RewindConflictInfo, RewindMode, RewindPointInfo, RewindResponse};

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

/// todo_write 快照（从 raw_output 的 `TodosUpdated.todos` 解析，供前端清单卡渲染）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoSnapshotDto {
    pub summary: String,
    pub todos: Vec<TodoItemDto>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TodoItemDto {
    pub content: String,
    pub status: String,
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
    /// todo_write 快照（raw_output 含 `TodosUpdated` 时解析；否则 `None`）
    pub todo: Option<TodoSnapshotDto>,
}

/// 运行中子 agent 快照（`x.ai/subagent/list_running` 响应项；camelCase 对齐官方 DTO）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningSubagentInfo {
    pub subagent_id: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub subagent_type: String,
    pub description: String,
    pub started_at_epoch_ms: u64,
    pub duration_ms: u64,
    pub turn_count: u32,
    pub tool_call_count: u32,
    pub tokens_used: u64,
    pub context_window_tokens: u64,
    pub context_usage_pct: u8,
    pub tools_used: Vec<String>,
    pub error_count: u32,
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
    /// 上下文超限（不可重试的终态失败，error_type == "context_length"）。
    ContextOverflow {
        message: String,
    },
    /// 速率限制耗尽重试（HTTP 429）。
    RateLimitExceeded {
        message: String,
    },
    /// 认证失效，需要重新登录（error_type == "auth"）。
    AuthExpired {
        message: String,
    },
    /// 正在重试中，用于前端展示重试进度而非静默等待。
    RetryInProgress {
        attempt: u32,
        max_retries: u32,
        reason: String,
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
    /// 会话标题已生成/更新（官方引擎 LLM 自动生成，或用户手动改名）。
    TitleChanged {
        title: String,
    },
    /// 官方 git HEAD 变化通知（`x.ai/git_head_changed`；分支切换等）。
    GitHeadChanged {
        session_id: String,
        branch: Option<String>,
    },
    /// bash 命令转入后台执行（官方 `x.ai/task_backgrounded` 通知）。
    TaskBackgrounded {
        /// 对应工具行（bash 工具调用）
        tool_call_id: String,
        /// 后台任务注册表 ID（kill 用）
        task_id: String,
        command: String,
        cwd: String,
        output_file: String,
        monitor_description: Option<String>,
        description: Option<String>,
    },
    /// 工具权限门控：通过 `respond` 发送选中的 `option_id` 作答。
    PermissionRequest {
        description: String,
        /// `(选项 id, 显示名称)`
        options: Vec<(String, String)>,
        /// 安全预检发现（官方分类器/评估经请求 meta `x.ai/security_findings` 下发）
        security_findings: Vec<String>,
        respond: oneshot::Sender<String>,
    },
    /// 子 agent 已创建（父会话 `x.ai/session_notification`）。
    SubagentSpawned {
        subagent_id: String,
        parent_session_id: String,
        child_session_id: String,
        subagent_type: String,
        description: String,
        model: Option<String>,
        #[allow(dead_code)]
        parent_prompt_id: Option<String>,
    },
    /// 子 agent 进度（运行中周期性推送）。
    SubagentProgress {
        subagent_id: String,
        parent_session_id: String,
        child_session_id: String,
        duration_ms: u64,
        turn_count: u32,
        tool_call_count: u32,
        tokens_used: u64,
        context_usage_pct: u8,
        tools_used: Vec<String>,
        error_count: u32,
    },
    /// 子 agent 结束（completed / failed / cancelled）。
    SubagentFinished {
        subagent_id: String,
        child_session_id: String,
        status: String,
        error: Option<String>,
        tool_calls: u32,
        turns: u32,
        duration_ms: u64,
        tokens_used: u64,
        output: Option<String>,
    },
    /// AI 问卷（`x.ai/ask_user_question` 扩展方法）。
    /// `respond` 回传 JSON 字符串（AskUserQuestionExtResponse 形态）。
    UserQuestionRequest {
        tool_call_id: String,
        mode: String,
        questions: Vec<UserQuestionItem>,
        respond: oneshot::Sender<String>,
    },
}

/// 问卷选项（与 ACP camelCase 对齐）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserQuestionOption {
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

/// 单道问卷题。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserQuestionItem {
    pub question: String,
    pub options: Vec<UserQuestionOption>,
    #[serde(default)]
    pub multi_select: Option<bool>,
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
            Self::ContextOverflow { message } => {
                write!(f, "ContextOverflow {{ message: {:?} }}", message)
            }
            Self::RateLimitExceeded { message } => {
                write!(f, "RateLimitExceeded {{ message: {:?} }}", message)
            }
            Self::AuthExpired { message } => {
                write!(f, "AuthExpired {{ message: {:?} }}", message)
            }
            Self::RetryInProgress { attempt, max_retries, reason } => {
                write!(
                    f,
                    "RetryInProgress {{ attempt: {}, max_retries: {}, reason: {:?} }}",
                    attempt, max_retries, reason
                )
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
            Self::TitleChanged { title } => write!(f, "TitleChanged {{ title: {:?} }}", title),
            Self::GitHeadChanged { session_id, branch } => write!(
                f,
                "GitHeadChanged {{ session_id: {:?}, branch: {:?} }}",
                session_id, branch
            ),
            Self::TaskBackgrounded { task_id, command, .. } => write!(
                f,
                "TaskBackgrounded {{ task_id: {:?}, command: {:?} }}",
                task_id, command
            ),
            Self::PermissionRequest {
                description,
                options,
                ..
            } => write!(
                f,
                "PermissionRequest {{ description: {:?}, options: {:?} }}",
                description, options
            ),
            Self::SubagentSpawned {
                subagent_id,
                subagent_type,
                description,
                ..
            } => write!(
                f,
                "SubagentSpawned {{ id: {:?}, type: {:?}, desc: {:?} }}",
                subagent_id, subagent_type, description
            ),
            Self::SubagentProgress {
                subagent_id,
                turn_count,
                tool_call_count,
                ..
            } => write!(
                f,
                "SubagentProgress {{ id: {:?}, turns: {}, tools: {} }}",
                subagent_id, turn_count, tool_call_count
            ),
            Self::SubagentFinished {
                subagent_id,
                status,
                ..
            } => write!(
                f,
                "SubagentFinished {{ id: {:?}, status: {:?} }}",
                subagent_id, status
            ),
            Self::UserQuestionRequest {
                tool_call_id,
                mode,
                questions,
                ..
            } => write!(
                f,
                "UserQuestionRequest {{ tool_call_id: {:?}, mode: {:?}, n: {} }}",
                tool_call_id,
                mode,
                questions.len()
            ),
        }
    }
}

/// ACP 客户端：把 agent 推送转发到有界 mpsc，形成背压。
struct GuiClient {
    event_tx: mpsc::Sender<SessionEvent>,
    /// 本客户端的会话 id（initialize/new_session 或 load_session 后写入）：
    /// 用于过滤子会话（workflow）推来的更新
    session_id: std::sync::Arc<std::sync::Mutex<Option<SessionId>>>,
}

#[async_trait::async_trait(?Send)]
impl Client for GuiClient {
    async fn request_permission(
        &self,
        args: RequestPermissionRequest,
    ) -> agent_client_protocol::Result<RequestPermissionResponse> {
        // 子会话（workflow 子 agent）的工具权限：自动选 AllowOnce（运行一次），
        // 不打扰父会话用户。官方 pager 对后台 turn 同样走 auto-approve。
        let own_id = self.session_id.lock().unwrap_or_else(|e| e.into_inner());
        if own_id.as_ref().is_some_and(|id| *id != args.session_id) {
            let allow_once = args
                .options
                .iter()
                .find(|o| o.kind == agent_client_protocol::PermissionOptionKind::AllowOnce)
                .or_else(|| args.options.first());
            if let Some(opt) = allow_once {
                return Ok(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                        opt.option_id.clone(),
                    )),
                ));
            }
        }

        let options: Vec<(String, String)> = args
            .options
            .iter()
            .map(|o| (o.option_id.to_string(), o.name.clone()))
            .collect();

        // 安全预检发现（官方注入请求 meta 的 `x.ai/security_findings` token 列表）
        let security_findings = args
            .meta
            .as_ref()
            .and_then(|m| m.get("x.ai/security_findings"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

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
                security_findings,
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
        // 子会话（workflow 子 agent / 后台任务）的更新会推送到父会话连接，
        // 但 session_id 不同。丢弃它们，避免子 agent 的任务提示/思考/正文
        // 混进父会话消息流（子 agent 状态走 SubagentSpawned/Progress/Finished）。
        let own_id = self.session_id.lock().unwrap_or_else(|e| e.into_inner());
        if own_id.as_ref().is_some_and(|id| *id != args.session_id) {
            return Ok(());
        }
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

    async fn ext_notification(
        &self,
        args: ExtNotification,
    ) -> agent_client_protocol::Result<()> {
        match args.method.as_ref() {
            "x.ai/session_notification" => {}
            "x.ai/git_head_changed" => {
                // 官方 git HEAD 变化通知（分支切换等）；前端用于自动刷新右栏差异。
                #[derive(serde::Deserialize)]
                struct GitHeadChangedParams {
                    session_id: String,
                    branch: Option<String>,
                }
                if let Ok(p) = serde_json::from_str::<GitHeadChangedParams>(args.params.get()) {
                    let _ = self
                        .event_tx
                        .send(SessionEvent::GitHeadChanged {
                            session_id: p.session_id,
                            branch: p.branch,
                        })
                        .await;
                }
                return Ok(());
            }
            _ => return Ok(()),
        }

        #[derive(serde::Deserialize)]
        struct XaiNotificationEnvelope {
            update: xai_grok_shell::extensions::notification::SessionUpdate,
        }

        match serde_json::from_str::<XaiNotificationEnvelope>(args.params.get()) {
            Ok(env) => match env.update {
                xai_grok_shell::extensions::notification::SessionUpdate::RetryState(retry_state) => {
                    let event = match retry_state {
                        RetryState::Failed { error_type, message } if error_type == "context_length" => {
                            SessionEvent::ContextOverflow { message }
                        }
                        RetryState::Failed { error_type, message } if error_type == "auth" => {
                            SessionEvent::AuthExpired { message }
                        }
                        RetryState::Exhausted { reason, is_rate_limited: true, .. } => {
                            SessionEvent::RateLimitExceeded { message: reason }
                        }
                        RetryState::Retrying { attempt, max_retries, reason } => {
                            SessionEvent::RetryInProgress { attempt, max_retries, reason }
                        }
                        other_retry_state => {
                            SessionEvent::Other(format!("{:?}", other_retry_state))
                        }
                    };
                    let _ = self.event_tx.send(event).await;
                }
                // 官方 LLM 标题生成完成通知（`x.ai/session_notification` 扩展，
                // 与标准 SessionInfoUpdate 双路送达；此前落入 other 被丢弃）。
                xai_grok_shell::extensions::notification::SessionUpdate::SessionSummaryGenerated {
                    session_summary,
                } => {
                    let _ = self
                        .event_tx
                        .send(SessionEvent::TitleChanged {
                            title: session_summary,
                        })
                        .await;
                }
                xai_grok_shell::extensions::notification::SessionUpdate::SubagentSpawned {
                    subagent_id,
                    parent_session_id,
                    parent_prompt_id,
                    child_session_id,
                    subagent_type,
                    description,
                    model,
                    ..
                } => {
                    let _ = self
                        .event_tx
                        .send(SessionEvent::SubagentSpawned {
                            subagent_id,
                            parent_session_id,
                            child_session_id,
                            subagent_type,
                            description,
                            model,
                            parent_prompt_id,
                        })
                        .await;
                }
                xai_grok_shell::extensions::notification::SessionUpdate::SubagentProgress {
                    subagent_id,
                    parent_session_id,
                    child_session_id,
                    duration_ms,
                    turn_count,
                    tool_call_count,
                    tokens_used,
                    context_usage_pct,
                    tools_used,
                    error_count,
                    ..
                } => {
                    let _ = self
                        .event_tx
                        .send(SessionEvent::SubagentProgress {
                            subagent_id,
                            parent_session_id,
                            child_session_id,
                            duration_ms,
                            turn_count,
                            tool_call_count,
                            tokens_used,
                            context_usage_pct,
                            tools_used,
                            error_count,
                        })
                        .await;
                }
                xai_grok_shell::extensions::notification::SessionUpdate::SubagentFinished {
                    subagent_id,
                    child_session_id,
                    status,
                    error,
                    tool_calls,
                    turns,
                    duration_ms,
                    tokens_used,
                    output,
                    ..
                } => {
                    let _ = self
                        .event_tx
                        .send(SessionEvent::SubagentFinished {
                            subagent_id,
                            child_session_id,
                            status,
                            error,
                            tool_calls,
                            turns,
                            duration_ms,
                            tokens_used,
                            output,
                        })
                        .await;
                }
                xai_grok_shell::extensions::notification::SessionUpdate::TaskBackgrounded {
                    tool_call_id,
                    task_id,
                    command,
                    cwd,
                    output_file,
                    monitor_description,
                    description,
                } => {
                    let _ = self
                        .event_tx
                        .send(SessionEvent::TaskBackgrounded {
                            tool_call_id,
                            task_id,
                            command,
                            cwd,
                            output_file,
                            monitor_description,
                            description,
                        })
                        .await;
                }
                other => {
                    let _ = self.event_tx.send(SessionEvent::Other(format!("{:?}", other))).await;
                }
            },
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    raw_params = %args.params.get(),
                    "failed to parse x.ai/session_notification envelope"
                );
            }
        }

        Ok(())
    }

    async fn ext_method(
        &self,
        args: ExtRequest,
    ) -> agent_client_protocol::Result<ExtResponse> {
        if args.method.as_ref() != "x.ai/ask_user_question" {
            // 未实现的扩展方法：返回 null，与 ACP Client 默认行为一致。
            return Ok(ExtResponse::new(
                serde_json::value::RawValue::NULL.to_owned().into(),
            ));
        }

        // 解析 camelCase 请求参数（对齐 AskUserQuestionExtRequest）。
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct AskParams {
            tool_call_id: String,
            #[serde(default)]
            questions: Vec<UserQuestionItem>,
            #[serde(default)]
            mode: Option<String>,
        }

        let params: AskParams = match serde_json::from_str(args.params.get()) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!(error = %e, "failed to parse x.ai/ask_user_question params");
                return Err(agent_client_protocol::Error::invalid_params());
            }
        };

        let mode = params
            .mode
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("default")
            .to_string();

        let (respond_tx, respond_rx) = oneshot::channel();
        let _ = self
            .event_tx
            .send(SessionEvent::UserQuestionRequest {
                tool_call_id: params.tool_call_id,
                mode,
                questions: params.questions,
                respond: respond_tx,
            })
            .await;

        // 前端回传 JSON 字符串；通道被 drop 时按取消处理（非错误）。
        let response_json = match respond_rx.await {
            Ok(s) if !s.trim().is_empty() => s,
            _ => r#"{"outcome":"cancelled"}"#.to_string(),
        };

        let raw = match serde_json::value::RawValue::from_string(response_json) {
            Ok(r) => r,
            Err(e) => {
                tracing::error!(error = %e, "ask_user_question response is not valid JSON");
                match serde_json::value::to_raw_value(&serde_json::json!({
                    "outcome": "cancelled"
                })) {
                    Ok(r) => r,
                    Err(_) => {
                        return Err(agent_client_protocol::Error::internal_error());
                    }
                }
            }
        };
        Ok(ExtResponse::new(raw.into()))
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

    // 前端 Hermes 风格审批条只依赖：类型 + 命令/目标。
    // 不要再塞「工具：Execute `整段命令`」——与 detail 重复，UI 会糊成一墙。
    let mut lines = vec![format!("类型：{kind_label}")];
    if let Some(t) = title {
        let is_execute_wrap = t.starts_with("Execute ")
            || t.starts_with("execute ")
            || (t.starts_with('`') && t.ends_with('`'));
        let duplicates_detail = !detail.is_empty()
            && (t == detail
                || t.contains(detail.as_str())
                || detail.contains(t.trim_matches('`')));
        if !is_execute_wrap && !duplicates_detail {
            lines.push(format!("工具：{t}"));
        }
    }
    if !detail.is_empty() {
        let label = if kind == "execute" { "命令" } else { "目标" };
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
    // todo_write：raw_output 形如 {"TodosUpdated": {summary_for_prompt, todos, state}}
    let todo = fields.raw_output.as_ref().and_then(|v| {
        let ok = v.get("TodosUpdated");
        let body = ok.or_else(|| v.get("todos_updated")).or_else(|| v.get("todosUpdated"));
        let Some(body) = body else { return None };
        let summary = body
            .get("summary_for_prompt")
            .or_else(|| body.get("summaryForPrompt"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let todos = body
            .get("todos")
            .and_then(|t| t.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|it| {
                        let content = it.get("content")?.as_str()?.to_string();
                        let status = it
                            .get("status")
                            .and_then(|x| x.as_str())
                            .unwrap_or("pending")
                            .to_string();
                        Some(TodoItemDto { content, status })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Some(TodoSnapshotDto { summary, todos })
    });
    ToolCallUpdateInfo {
        tool_call_id: tcu.tool_call_id.to_string(),
        kind,
        status,
        title,
        detail,
        preview,
        diffs,
        todo,
    }
}

/// 桌面 / 嵌入式客户端的 `initialize` 请求。
///
/// 通过 `meta.bufferingSettings` 打开官方 shell 的 `ReplayBuffer`，
/// 合并高频 `agent_message_chunk` / `agent_thought_chunk`，减少 ACP 与下游 IPC 次数。
/// 不修改 shell 源码，仅使用官方已有扩展点。
fn desktop_initialize_request() -> InitializeRequest {
    let mut meta = serde_json::Map::new();
    // camelCase 与 shell `BufferingSettings` 对齐；约 1 帧窗口，兼顾跟手与合并。
    meta.insert(
        "bufferingSettings".into(),
        serde_json::json!({
            "maxItems": 32,
            "maxBytes": 2048,
            "maxDurationMs": 16
        }),
    );
    InitializeRequest::new(ProtocolVersion::LATEST)
        .client_capabilities(ClientCapabilities::default())
        .meta(Some(meta))
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
        // 官方引擎 LLM 自动生成标题后经 SessionInfoUpdate 通知（grok-session 之前
        // 落入 other 被丢弃，导致前端 header 永远显示首句而非聪明标题）。
        SessionUpdate::SessionInfoUpdate(update) => match update.title.value() {
            Some(title) => SessionEvent::TitleChanged {
                title: title.clone(),
            },
            None => SessionEvent::Other(format!("SessionInfoUpdate({update:?})")),
        },
        other => SessionEvent::Other(format!("{other:?}")),
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

        // 历史回放可能瞬时灌入大量 session/update；256 易反压卡住 load_session
        let (event_tx, event_rx) = mpsc::channel(4096);
        let client_session_id = std::sync::Arc::new(std::sync::Mutex::new(None));
        let client = GuiClient {
            event_tx: event_tx.clone(),
            session_id: client_session_id.clone(),
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
            .initialize(desktop_initialize_request())
            .await?;

        let (status_tx, _status_rx) = watch::channel(SessionStatus::Initializing);

        let session_response = connection
            .new_session(NewSessionRequest::new(cwd.into()))
            .await?;
        *client_session_id.lock().unwrap_or_else(|e| e.into_inner()) = Some(session_response.session_id.clone());

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
    pub async fn resume(
        session_id: impl Into<SessionId>,
        cwd: impl Into<String>,
        restore_code: Option<bool>,
    ) -> anyhow::Result<Self> {
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
        let (event_tx, event_rx) = mpsc::channel(4096);
        // 先转换参数（impl Into<SessionId> 无法 clone）
        let session_id: SessionId = session_id.into();
        let client_session_id = std::sync::Arc::new(std::sync::Mutex::new(Some(session_id.clone())));
        let client = GuiClient {
            event_tx: event_tx.clone(),
            session_id: client_session_id,
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
            .initialize(desktop_initialize_request())
            .await?;
        let (status_tx, _status_rx) = watch::channel(SessionStatus::Initializing);
        let load_session_id = session_id.clone();
        let mut load_req = LoadSessionRequest::new(load_session_id, cwd.into());
        if let Some(rc) = restore_code {
            // 官方 `--restore-code` 等价：resume 时是否恢复代码快照
            // （conversation-only 回滚后传 false，避免覆盖工作区改动）
            let mut m = agent_client_protocol::Meta::new();
            m.insert("x.ai/restore_code".into(), serde_json::Value::Bool(rc));
            load_req = load_req.meta(Some(m));
        }
        connection.load_session(load_req).await?;

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

    /// 获取当前会话可回滚的历史点列表（x.ai/rewind/points 扩展方法）。
    /// 用于前端渲染"撤销到哪一轮"的选择器。
    pub async fn get_rewind_points(
        &self,
    ) -> anyhow::Result<Vec<RewindPointInfo>> {
        let params = serde_json::value::to_raw_value(&serde_json::json!({
            "session_id": self.session_id.to_string(),
        }))
        .map_err(|e| anyhow::anyhow!("序列化 get_rewind_points 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/rewind/points", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("get_rewind_points 失败: {e:?}"))?;
        let value: serde_json::Value = serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 rewind points 响应失败: {e}"))?;
        let points = value
            .get("rewind_points")
            .ok_or_else(|| anyhow::anyhow!("rewind points 响应缺少 rewind_points 字段"))?;
        serde_json::from_value(points.clone())
            .map_err(|e| anyhow::anyhow!("反序列化 RewindPointInfo 列表失败: {e}"))
    }

    /// 执行回滚（撤销）操作（x.ai/rewind/execute 扩展方法）。
    ///
    /// `target_prompt_index`：回滚到该 prompt 之前的状态（0-based，语义是
    /// "恢复 prompt N 运行前的状态"，prompt 0..N-1 保留）。
    /// `mode`：`all` / `conversation_only` / `files_only`。
    /// `force`：是否强制回滚（忽略冲突）。
    pub async fn execute_rewind(
        &self,
        target_prompt_index: usize,
        mode: RewindMode,
        force: bool,
    ) -> anyhow::Result<RewindResponse> {
        let params = serde_json::value::to_raw_value(&serde_json::json!({
            "session_id": self.session_id.to_string(),
            "target_prompt_index": target_prompt_index,
            "mode": mode,
            "force": force,
        }))
        .map_err(|e| anyhow::anyhow!("序列化 execute_rewind 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/rewind/execute", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("execute_rewind 失败: {e:?}"))?;
        serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("反序列化 RewindResponse 失败: {e}"))
    }

    /// 取消运行中的子 agent（`x.ai/subagent/cancel`）。
    pub async fn cancel_subagent(&self, subagent_id: &str) -> anyhow::Result<serde_json::Value> {
        let params = serde_json::value::to_raw_value(&serde_json::json!({
            "subagentId": subagent_id,
        }))
        .map_err(|e| anyhow::anyhow!("序列化 cancel_subagent 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/subagent/cancel", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("cancel_subagent 失败: {e:?}"))?;
        serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 cancel_subagent 响应失败: {e}"))
    }

    /// 查询子 agent 快照（`x.ai/subagent/get`）。
    ///
    /// `block` 为 true 时阻塞等待结束；`timeout_ms` 默认 30000。
    pub async fn get_subagent(
        &self,
        subagent_id: &str,
        block: bool,
        timeout_ms: Option<u64>,
    ) -> anyhow::Result<serde_json::Value> {
        let params = serde_json::value::to_raw_value(&serde_json::json!({
            "subagentId": subagent_id,
            "block": block,
            "timeoutMs": timeout_ms.unwrap_or(30_000),
        }))
        .map_err(|e| anyhow::anyhow!("序列化 get_subagent 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/subagent/get", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("get_subagent 失败: {e:?}"))?;
        serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 get_subagent 响应失败: {e}"))
    }

    /// 派生新会话（`x.ai/session/fork`），返回新会话 id。
    ///
    /// `cwd` 为父会话工作目录（子会话落盘同目录）；`new_session_id` 可省略让引擎自选。
    /// 对应官方 pager 的 `fork_session_params`（非 worktree 场景不携带 `sourceWorkspaceDir`）。
    pub async fn fork_session(
        &self,
        source_session_id: &str,
        cwd: &std::path::Path,
        new_session_id: Option<&str>,
    ) -> anyhow::Result<String> {
        let cwd_str = cwd.to_string_lossy().into_owned();
        // 官方语义：sourceCwd 是父会话的真实落盘目录（可能不在当前 cwd 下，
        // 如跨 cwd 恢复的历史会话）；解析不到时回退传入的 cwd。
        let source_cwd =
            xai_grok_shell::session::resolve_local_session_any_cwd(source_session_id)
                .unwrap_or_else(|| cwd_str.clone());
        let mut payload = serde_json::json!({
            "sourceSessionId": source_session_id,
            "sourceCwd": source_cwd,
            "newCwd": cwd_str,
            "sessionKind": "fork",
        });
        if let Some(nid) = new_session_id {
            payload["newSessionId"] = serde_json::Value::String(nid.to_string());
        }
        // worktree 会话：官方要求携带 sourceWorkspaceDir（对齐 parent_session_is_worktree）
        if Self::parent_session_is_worktree(source_session_id, cwd) {
            payload["sourceWorkspaceDir"] = serde_json::Value::String(cwd_str);
        }
        let params = serde_json::value::to_raw_value(&payload)
            .map_err(|e| anyhow::anyhow!("序列化 fork 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/session/fork", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("fork 失败: {e:?}"))?;
        // 响应形如 {"newSessionId": "..."} 或 {"result": {"newSessionId": "..."}}；error 优先
        let v: serde_json::Value = serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 fork 响应失败: {e}"))?;
        if let Some(err) = v.get("error").filter(|e| !e.is_null()) {
            anyhow::bail!("fork 失败: {err}");
        }
        v.get("newSessionId")
            .and_then(|x| x.as_str())
            .or_else(|| {
                v.get("result")
                    .and_then(|r| r.get("newSessionId"))
                    .and_then(|x| x.as_str())
            })
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("fork 响应缺少 newSessionId"))
    }

    /// 会话是否为 worktree 派生（对齐官方 pager `parent_session_is_worktree` 的
    /// summary.json 检测：session_kind / source_workspace_dir / worktree_label）。
    fn parent_session_is_worktree(session_id: &str, cwd: &std::path::Path) -> bool {
        use xai_grok_shell::util::grok_home::{encode_cwd_dirname, grok_home};
        let cwd_str = cwd.to_string_lossy();
        let summary_path = grok_home()
            .join("sessions")
            .join(encode_cwd_dirname(&cwd_str))
            .join(session_id)
            .join("summary.json");
        if let Ok(bytes) = std::fs::read(&summary_path)
            && let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes)
        {
            if v.get("session_kind").and_then(|k| k.as_str()) == Some("worktree") {
                return true;
            }
            if v.get("source_workspace_dir")
                .and_then(|k| k.as_str())
                .is_some_and(|s| !s.is_empty())
            {
                return true;
            }
            if v.get("worktree_label")
                .and_then(|k| k.as_str())
                .is_some_and(|s| !s.is_empty())
            {
                return true;
            }
        }
        false
    }

    /// 终止后台任务（`x.ai/task/kill`）。
    pub async fn kill_task(&self, task_id: &str) -> anyhow::Result<serde_json::Value> {
        let params = xai_grok_shell::extensions::task::KillTaskRequest {
            session_id: self.session_id.to_string(),
            task_id: task_id.to_string(),
        };
        let raw = serde_json::value::to_raw_value(&params)
            .map_err(|e| anyhow::anyhow!("序列化 kill_task 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/task/kill", raw.into()))
            .await
            .map_err(|e| anyhow::anyhow!("kill_task 失败: {e:?}"))?;
        serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 kill_task 响应失败: {e}"))
    }

    /// 查询仍在运行的子 agent（`x.ai/subagent/list_running`；重启/重连对账用）。
    pub async fn list_running_subagents(&self) -> anyhow::Result<Vec<RunningSubagentInfo>> {
        let params = serde_json::value::to_raw_value(&serde_json::json!({
            "sessionId": self.session_id.to_string(),
        }))
        .map_err(|e| anyhow::anyhow!("序列化 list_running 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/subagent/list_running", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("list_running 失败: {e:?}"))?;
        let value: serde_json::Value = serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 list_running 响应失败: {e}"))?;
        let subs = value
            .get("subagents")
            .or_else(|| value.get("result").and_then(|r| r.get("subagents")))
            .ok_or_else(|| anyhow::anyhow!("list_running 响应缺少 subagents 字段"))?;
        serde_json::from_value(subs.clone())
            .map_err(|e| anyhow::anyhow!("反序列化 RunningSubagentInfo 失败: {e}"))
    }

    /// 列出 MCP 服务器（官方 `x.ai/mcp/list`）。
    ///
    /// `cache=false` 时绕过缓存并刷新到 live session（对齐官方 pager 扩展面板）。
    pub async fn list_mcp_servers(&self, cache: bool) -> anyhow::Result<serde_json::Value> {
        let params = serde_json::value::to_raw_value(&serde_json::json!({
            "sessionId": self.session_id.to_string(),
            "cache": cache,
        }))
        .map_err(|e| anyhow::anyhow!("序列化 list_mcp_servers 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/mcp/list", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("list_mcp_servers 失败: {e:?}"))?;
        let value: serde_json::Value = serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 mcp/list 响应失败: {e}"))?;
        // 兼容直接 body / 包一层 result
        if value.get("servers").is_some() {
            Ok(value)
        } else if let Some(inner) = value.get("result").cloned() {
            Ok(inner)
        } else {
            Ok(value)
        }
    }

    /// 启用/禁用 MCP 服务器（官方 `x.ai/mcp/toggle`，无需重启会话）。
    pub async fn toggle_mcp_server(
        &self,
        server_name: &str,
        enabled: bool,
    ) -> anyhow::Result<serde_json::Value> {
        let params = serde_json::value::to_raw_value(&serde_json::json!({
            "session_id": self.session_id.to_string(),
            "server_name": server_name,
            "enabled": enabled,
        }))
        .map_err(|e| anyhow::anyhow!("序列化 toggle_mcp_server 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/mcp/toggle", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("toggle_mcp_server 失败: {e:?}"))?;
        serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 mcp/toggle 响应失败: {e}"))
    }

    /// 新增/更新 MCP 服务器（官方 `x.ai/mcp/upsert`）。
    ///
    /// `config` 为扁平配置（与 config.toml `[mcp_servers.x]` 一致），例如：
    /// `{ "command": "npx", "args": ["-y", "..."], "enabled": true }`
    /// 或 `{ "url": "https://…", "enabled": true }`。
    pub async fn upsert_mcp_server(
        &self,
        server_name: &str,
        config: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        let mut body = config;
        if !body.is_object() {
            return Err(anyhow::anyhow!("MCP 配置必须是 JSON 对象"));
        }
        let obj = body.as_object_mut().expect("object");
        obj.insert(
            "session_id".into(),
            serde_json::Value::String(self.session_id.to_string()),
        );
        obj.insert(
            "server_name".into(),
            serde_json::Value::String(server_name.to_string()),
        );
        let params = serde_json::value::to_raw_value(&body)
            .map_err(|e| anyhow::anyhow!("序列化 upsert_mcp_server 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/mcp/upsert", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("upsert_mcp_server 失败: {e:?}"))?;
        serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 mcp/upsert 响应失败: {e}"))
    }

    /// 删除本地配置的 MCP 服务器（官方 `x.ai/mcp/delete`，不可删 managed）。
    pub async fn delete_mcp_server(&self, server_name: &str) -> anyhow::Result<serde_json::Value> {
        let params = serde_json::value::to_raw_value(&serde_json::json!({
            "session_id": self.session_id.to_string(),
            "server_name": server_name,
        }))
        .map_err(|e| anyhow::anyhow!("序列化 delete_mcp_server 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/mcp/delete", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("delete_mcp_server 失败: {e:?}"))?;
        serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 mcp/delete 响应失败: {e}"))
    }

    /// 列出当前会话可用斜杠命令 + 工具名（官方 `x.ai/commands/list`）。
    ///
    /// - 仅 `session_id`：会话内 catalog（含 tools）
    /// - 仅 `cwd`：按工作区发现技能 / 命令（技能面板用）
    /// - 两者皆有时以 session 为准（与官方 handler 一致）
    ///
    /// 响应含 `commands` 与可选 `tools`（与 AvailableCommandsUpdate.meta.tools 同源）。
    pub async fn list_session_commands(
        &self,
        cwd: Option<&str>,
    ) -> anyhow::Result<serde_json::Value> {
        let params = if let Some(c) = cwd.filter(|s| !s.is_empty()) {
            // 技能发现：按 cwd 扫磁盘 skills（不绑 session tools）
            serde_json::value::to_raw_value(&serde_json::json!({
                "cwd": c,
            }))
        } else {
            serde_json::value::to_raw_value(&serde_json::json!({
                "sessionId": self.session_id.to_string(),
            }))
        }
        .map_err(|e| anyhow::anyhow!("序列化 list_session_commands 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/commands/list", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("list_session_commands 失败: {e:?}"))?;
        let value: serde_json::Value = serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 commands/list 响应失败: {e}"))?;
        if value.get("commands").is_some() || value.get("tools").is_some() {
            Ok(value)
        } else if let Some(inner) = value.get("result").cloned() {
            Ok(inner)
        } else {
            Ok(value)
        }
    }

    /// 列出已发现的自动化工作流（官方 `x.ai/workflows/list`）。
    ///
    /// 响应形如 `{ "workflows": [ { name, description, when_to_use?, source, path? }, … ] }`。
    /// 若会话关闭了 workflow 启动能力，可能返回空列表。
    pub async fn list_workflows(&self) -> anyhow::Result<serde_json::Value> {
        let params = serde_json::value::to_raw_value(&serde_json::json!({
            "sessionId": self.session_id.to_string(),
        }))
        .map_err(|e| anyhow::anyhow!("序列化 list_workflows 参数失败: {e}"))?;
        let resp = self
            .connection
            .ext_method(ExtRequest::new("x.ai/workflows/list", params.into()))
            .await
            .map_err(|e| anyhow::anyhow!("list_workflows 失败: {e:?}"))?;
        let value: serde_json::Value = serde_json::from_str(resp.0.get())
            .map_err(|e| anyhow::anyhow!("解析 workflows/list 响应失败: {e}"))?;
        if value.get("workflows").is_some() {
            Ok(value)
        } else if let Some(inner) = value.get("result").cloned() {
            Ok(inner)
        } else {
            Ok(value)
        }
    }

    /// 订阅会话状态变化（如「正在生成中」指示器）。
    pub fn subscribe_status(&self) -> watch::Receiver<SessionStatus> {
        self.status_tx.subscribe()
    }

    /// 获取下一个会话事件（阻塞直到有事件或通道关闭）。
    pub async fn next_event(&mut self) -> Option<SessionEvent> {
        self.event_rx.recv().await
    }

    /// 非阻塞取一条事件（历史回放 drain 用）。
    pub fn try_next_event(&mut self) -> Option<SessionEvent> {
        self.event_rx.try_recv().ok()
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

/// 按 session id 查询单条最新摘要，供索引增量更新使用，避免为了刷新一条记录去拉全量列表。
pub fn get_session_summary(session_id: &str) -> Option<Summary> {
    // 官方已将该查询函数收为 pub(crate)，这里改用公开的 find_session_dir_by_id
    // 自行读取 summary.json，语义与官方原实现一致（2026-08-10 合并 upstream 适配）。
    let dir = xai_grok_shell::session::persistence::find_session_dir_by_id(session_id)?;
    let bytes = std::fs::read(dir.join("summary.json")).ok()?;
    serde_json::from_slice(&bytes).ok()
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
