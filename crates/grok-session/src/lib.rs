//! Grok Build 桌面端 / 命令行前端共用的会话封装层。
//!
//! 在进程内通过 ACP 双工管道包装 `xai-grok-shell`，
//! 让 UI 代码不必直接处理 JSON-RPC 或 agent 接线细节。
//!
//! **运行时要求：** 调用方必须在 `tokio::task::LocalSet` 中运行
//! （或由 `current_thread` runtime 驱动 LocalSet），
//! 因为 ACP 客户端与 agent 任务都使用 `spawn_local`。

use agent_client_protocol::{
    Agent, CancelNotification, Client, ClientCapabilities, ClientSideConnection,
    InitializeRequest, NewSessionRequest, PromptRequest, ProtocolVersion,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionId, SessionNotification, SessionUpdate,
};
use futures::FutureExt;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::sync::watch;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use xai_grok_shell::agent::app::spawn_agent_local;
use xai_grok_shell::agent::config::Config as AgentConfig;

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

/// 面向 GUI / REPL 的业务层事件。
pub enum SessionEvent {
    /// AI 回复文本片段（流式）。
    AgentTextChunk(String),
    /// AI 思考过程片段（流式）。
    AgentThoughtChunk(String),
    /// 用户消息回显。
    UserTextChunk(String),
    /// 本轮对话结束。
    TurnEnded { stop_reason: String },
    /// 错误信息。
    Error(String),
    /// 其它未专门映射的通知（调试用）。
    Other(String),
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
            Self::UserTextChunk(t) => write!(f, "UserTextChunk({:?})", t),
            Self::TurnEnded { stop_reason } => {
                write!(f, "TurnEnded {{ stop_reason: {:?} }}", stop_reason)
            }
            Self::Error(e) => write!(f, "Error({:?})", e),
            Self::Other(o) => write!(f, "Other({:?})", o),
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
                .send(SessionEvent::Error("权限请求没有可选项".to_string()))
                .await;
            return Err(agent_client_protocol::Error::invalid_params());
        }

        let (respond_tx, respond_rx) = oneshot::channel();
        let description = format!("{:?}", args.tool_call);

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
        let event = session_update_to_event(args.update);
        let _ = self.event_tx.send(event).await;
        Ok(())
    }
}

fn content_block_to_text(block: &agent_client_protocol::ContentBlock) -> String {
    match block {
        agent_client_protocol::ContentBlock::Text(t) => t.text.clone(),
        other => format!("{:?}", other),
    }
}

/// 将 ACP 的 `SessionUpdate` 映射为业务层 `SessionEvent`（纯函数，有单元测试）。
pub fn session_update_to_event(update: SessionUpdate) -> SessionEvent {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) => {
            SessionEvent::AgentTextChunk(content_block_to_text(&chunk.content))
        }
        SessionUpdate::AgentThoughtChunk(chunk) => {
            SessionEvent::AgentThoughtChunk(content_block_to_text(&chunk.content))
        }
        SessionUpdate::UserMessageChunk(chunk) => {
            SessionEvent::UserTextChunk(content_block_to_text(&chunk.content))
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

    /// 发送用户消息（不等待完成；流式结果通过 [`Self::next_event`] 获取）。
    pub async fn send_prompt(&self, text: impl Into<String>) -> anyhow::Result<()> {
        let session_id = self.session_id.clone();
        let text = text.into();
        let connection = Arc::clone(&self.connection);
        let event_tx = self.event_tx.clone();
        let status_tx = self.status_tx.clone();

        // 立刻切到 Generating，方便界面显示加载态并禁用输入。
        let _ = status_tx.send(SessionStatus::Generating);

        tokio::task::spawn_local(async move {
            let result = connection
                .prompt(PromptRequest::new(session_id, vec![text.into()]))
                .await;
            match result {
                Ok(response) => {
                    let _ = event_tx
                        .send(SessionEvent::TurnEnded {
                            stop_reason: format!("{:?}", response.stop_reason),
                        })
                        .await;
                }
                Err(e) => {
                    let _ = event_tx
                        .send(SessionEvent::Error(format!("{:?}", e)))
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

    /// 订阅会话状态变化（如「正在生成中」指示器）。
    pub fn subscribe_status(&self) -> watch::Receiver<SessionStatus> {
        self.status_tx.subscribe()
    }

    /// 获取下一个会话事件（阻塞直到有事件或通道关闭）。
    pub async fn next_event(&mut self) -> Option<SessionEvent> {
        self.event_rx.recv().await
    }
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
        let event = session_update_to_event(update);
        match event {
            SessionEvent::AgentTextChunk(text) => assert_eq!(text, "你好"),
            other => panic!("期望 AgentTextChunk，实际 {:?}", other),
        }
    }

    #[test]
    fn agent_thought_chunk_becomes_agent_thought_chunk() {
        let update = SessionUpdate::AgentThoughtChunk(text_chunk("思考中"));
        let event = session_update_to_event(update);
        match event {
            SessionEvent::AgentThoughtChunk(text) => assert_eq!(text, "思考中"),
            other => panic!("期望 AgentThoughtChunk，实际 {:?}", other),
        }
    }

    #[test]
    fn user_message_chunk_becomes_user_text_chunk() {
        let update = SessionUpdate::UserMessageChunk(text_chunk("提问"));
        let event = session_update_to_event(update);
        match event {
            SessionEvent::UserTextChunk(text) => assert_eq!(text, "提问"),
            other => panic!("期望 UserTextChunk，实际 {:?}", other),
        }
    }
}
