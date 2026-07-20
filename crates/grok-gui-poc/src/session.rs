use agent_client_protocol::{
    Agent, Client, ClientCapabilities, ClientSideConnection, InitializeRequest,
    NewSessionRequest, PromptRequest, ProtocolVersion, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionId, SessionNotification, SessionUpdate,
};
use futures::FutureExt;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use xai_grok_shell::agent::app::spawn_agent_local;
use xai_grok_shell::agent::config::Config as AgentConfig;

/// 对外暴露的会话事件，GUI 层只需要消费这个枚举，
/// 不需要知道底层 ACP 协议的任何细节。
#[derive(Debug)]
pub enum SessionEvent {
    /// AI 回复的文本片段（流式）
    AgentTextChunk(String),
    /// AI 的内部推理片段（流式，如果模型支持展示思考过程）
    AgentThoughtChunk(String),
    /// 用户消息回显
    UserTextChunk(String),
    /// 本轮对话结束
    TurnEnded,
    /// 其他未特别处理的通知，先原样透出，方便调试
    Other(String),
}

/// 内部：负责接收 agent 推送、转发到 mpsc 通道
struct GuiClient {
    event_tx: mpsc::UnboundedSender<SessionEvent>,
}

#[async_trait::async_trait(?Send)]
impl Client for GuiClient {
    async fn request_permission(
        &self,
        args: RequestPermissionRequest,
    ) -> agent_client_protocol::Result<RequestPermissionResponse> {
        // 最小验证阶段：自动同意第一个选项。
        // TODO: 接入真正 GUI 后，改成发一个 SessionEvent 请求用户确认，
        // 并等待用户在界面上点击后再返回结果。
        let option_id = args
            .options
            .first()
            .map(|o| o.option_id.clone())
            .ok_or_else(agent_client_protocol::Error::invalid_params)?;
        Ok(RequestPermissionResponse::new(
            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(option_id)),
        ))
    }

    async fn session_notification(
        &self,
        args: SessionNotification,
    ) -> agent_client_protocol::Result<()> {
        let event = match args.update {
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
        };
        let _ = self.event_tx.send(event);
        Ok(())
    }
}

fn content_block_to_text(block: &agent_client_protocol::ContentBlock) -> String {
    match block {
        agent_client_protocol::ContentBlock::Text(t) => t.text.clone(),
        other => format!("{:?}", other),
    }
}

/// 封装好的会话句柄，GUI 代码只需要跟这个类型打交道
pub struct GrokSession {
    connection: Arc<ClientSideConnection>,
    session_id: SessionId,
    event_rx: mpsc::UnboundedReceiver<SessionEvent>,
}

impl GrokSession {
    /// 启动 agent、完成 initialize + session/new，返回一个可用的会话
    pub async fn start(cwd: impl Into<String>) -> anyhow::Result<Self> {
        let agent_config = AgentConfig::default();
        let auth_manager = Arc::new(agent_config.create_auth_manager());

        let (gui_stream, agent_stream) = tokio::io::duplex(65536);
        let (agent_rx, agent_tx) = tokio::io::split(agent_stream);
        let compat_rx = agent_rx.compat();
        let compat_tx = agent_tx.compat_write();

        tokio::task::spawn_local(async move {
            let handle_io = spawn_agent_local(
                agent_config, auth_manager, None, None, compat_tx, compat_rx,
            );
            if let Err(e) = handle_io.await {
                eprintln!("Agent runtime error: {:?}", e);
            }
        });

        let (gui_read, gui_write) = tokio::io::split(gui_stream);
        let compat_gui_read = gui_read.compat();
        let compat_gui_write = gui_write.compat_write();

        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let client = GuiClient { event_tx };

        let (connection, io_task) =
            ClientSideConnection::new(client, compat_gui_write, compat_gui_read, |fut| {
                tokio::task::spawn_local(fut);
            });

        tokio::task::spawn_local(io_task.map(|result| {
            if let Err(e) = result {
                eprintln!("IO task error: {:?}", e);
            }
        }));

        connection
            .initialize(
                InitializeRequest::new(ProtocolVersion::LATEST)
                    .client_capabilities(ClientCapabilities::default()),
            )
            .await?;

        let session_response = connection.new_session(NewSessionRequest::new(cwd.into())).await?;

        Ok(Self {
            connection: Arc::new(connection),
            session_id: session_response.session_id,
            event_rx,
        })
    }

    /// 发送一条用户消息（不等待完成，流式回复通过 next_event() 持续获取）
    pub async fn send_prompt(&self, text: impl Into<String>) -> anyhow::Result<()> {
        let session_id = self.session_id.clone();
        let text = text.into();
        // prompt() 会一直等到本轮结束才返回，所以这里 spawn 到后台跑，
        // 好让调用方能立刻回到事件循环去消费 next_event()
        let connection = Arc::clone(&self.connection);
        tokio::task::spawn_local(async move {
            let result = connection
                .prompt(PromptRequest::new(session_id, vec![text.into()]))
                .await;
            if let Err(e) = result {
                eprintln!("prompt error: {:?}", e);
            }
        });
        Ok(())
    }

    /// 持续获取下一个会话事件（GUI 的事件循环应该反复调用这个方法）
    pub async fn next_event(&mut self) -> Option<SessionEvent> {
        self.event_rx.recv().await
    }
}
