//! 会话 Actor：在独立的 current-thread + LocalSet 线程上持有 `GrokSession`，
//! 保证 `spawn_local` / `?Send` 的 ACP 客户端可以正常工作。

use grok_session::{
    GrokSession, SessionEvent, SessionStatus, ToolCallInfo, ToolCallUpdateInfo, UserQuestionItem,
};
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};

// 文本 chunk 合并交给官方 ReplayBuffer（grok-session initialize 的 bufferingSettings）。
// 桌面侧不再做第二层 33ms 合并，避免与官方策略叠床架屋。

/// 多会话 tab 的标识（如 `tab-1`、`tab-2`）。
pub type TabId = String;

/// 发往 Supervisor 的生命周期管理命令。
pub enum SupervisorCommand {
    /// 打开一个新 tab（起一个 TabActor，注册进共享表）。
    OpenTab {
        reply: oneshot::Sender<Result<TabId, String>>,
    },
    /// 关闭一个 tab（从共享表移除 sender，对应 TabActor 会因 channel 关闭自动优雅退出）。
    CloseTab {
        tab_id: TabId,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// 手动重启一个 tab（与 panic 自动重建走同一条路径：关旧、起空壳、通知前端重放）。
    RestartTab {
        tab_id: TabId,
        reply: oneshot::Sender<Result<(), String>>,
    },
}

/// 从前端 invoke 发往会话 Actor 线程的命令。
pub enum ActorCommand {
    /// 启动会话。
    Start {
        cwd: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// 发送用户消息。
    SendPrompt {
        text: String,
        prompt_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// 取消当前生成。
    Cancel {
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// 回答权限请求。
    RespondPermission {
        request_id: u64,
        option_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// 重启会话（销毁旧会话并以新 cwd 启动）。
    Restart {
        cwd: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// 恢复一个已有历史会话。
    LoadSession {
        session_id: String,
        cwd: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// 删除会话（若删的是当前会话，会先释放再开新会话）。
    DeleteSession {
        session_id: String,
        cwd: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// 切换当前会话使用的模型（不重启，协议原生支持）。
    SetModel {
        model_id: String,
        /// 可选推理强度：none/minimal/low/medium/high/xhigh
        reasoning_effort: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// 从磁盘热重载模型列表（不重启会话）。
    ReloadModels {
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// 获取可撤销的历史点列表
    GetRewindPoints {
        reply: oneshot::Sender<Result<Vec<grok_session::RewindPointInfo>, String>>,
    },
    /// 执行会话撤销回滚
    ExecuteRewind {
        target_prompt_index: usize,
        mode: grok_session::RewindMode,
        force: bool,
        reply: oneshot::Sender<Result<grok_session::RewindResponse, String>>,
    },
    /// 取消子 agent
    CancelSubagent {
        subagent_id: String,
        reply: oneshot::Sender<Result<serde_json::Value, String>>,
    },
    /// 查询子 agent 快照
    GetSubagent {
        subagent_id: String,
        block: bool,
        timeout_ms: Option<u64>,
        reply: oneshot::Sender<Result<serde_json::Value, String>>,
    },
    /// 回答 AI 问卷（response_json 为 AskUserQuestionExtResponse JSON）
    RespondUserQuestion {
        request_id: u64,
        response_json: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// 列出 MCP 服务器（x.ai/mcp/list）
    ListMcpServers {
        cache: bool,
        reply: oneshot::Sender<Result<serde_json::Value, String>>,
    },
    /// 启用/禁用 MCP 服务器（x.ai/mcp/toggle）
    ToggleMcpServer {
        server_name: String,
        enabled: bool,
        reply: oneshot::Sender<Result<serde_json::Value, String>>,
    },
    /// 新增/更新 MCP（x.ai/mcp/upsert）
    UpsertMcpServer {
        server_name: String,
        config: serde_json::Value,
        reply: oneshot::Sender<Result<serde_json::Value, String>>,
    },
    /// 删除本地 MCP（x.ai/mcp/delete）
    DeleteMcpServer {
        server_name: String,
        reply: oneshot::Sender<Result<serde_json::Value, String>>,
    },
    /// 列出会话可用命令/工具/技能（x.ai/commands/list）
    /// `cwd` 有值时按工作区发现技能；否则用 sessionId 拉会话 catalog。
    ListSessionCommands {
        cwd: Option<String>,
        reply: oneshot::Sender<Result<serde_json::Value, String>>,
    },
}

/// 由 Tauri 托管的应用状态；命令侧可廉价克隆。
#[derive(Clone)]
pub struct AppState {
    /// tab_id -> 对应 TabActor 的命令发送端（跨线程安全，句柄本身 Send）。
    pub tabs: std::sync::Arc<std::sync::Mutex<HashMap<TabId, mpsc::UnboundedSender<ActorCommand>>>>,
    /// 生命周期管理命令通道（Open/Close，Phase 2 会加 Restart/Shutdown）。
    pub supervisor_tx: mpsc::UnboundedSender<SupervisorCommand>,
    /// 进程内覆盖的工作目录（通过设置页设置后写入，代替 unsafe 的环境变量）
    pub workspace_cwd_override: std::sync::Arc<std::sync::Mutex<Option<std::path::PathBuf>>>,
}

/// 推给前端 `session-event` 监听器的 JSON 载荷。
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FrontendEvent {
    /// AI 文本片段。
    AgentTextChunk { text: String },
    /// AI 思考片段。
    AgentThoughtChunk { text: String },
    /// 用户消息回显。
    UserTextChunk {
        text: String,
        prompt_id: Option<String>,
    },
    /// 本轮结束。
    TurnEnded {
        stop_reason: String,
        prompt_id: Option<String>,
    },
    /// 错误。
    Error {
        message: String,
        prompt_id: Option<String>,
    },
    /// 上下文超限（终态失败，需要用户压缩会话或开始新会话）。
    ContextOverflow { message: String },
    /// 速率限制重试已耗尽。
    RateLimitExceeded { message: String },
    /// 认证已失效，需要重新登录。
    AuthExpired { message: String },
    /// 正在自动重试中（非终态，仅用于前端展示进度）。
    RetryInProgress {
        attempt: u32,
        max_retries: u32,
        reason: String,
    },
    /// 其它调试信息。
    Other { debug: String },
    /// 新工具调用（完整快照）。
    ToolCall { tool: ToolCallInfo },
    /// 工具调用增量更新。
    ToolCallUpdate { update: ToolCallUpdateInfo },
    /// 上下文 token 用量（累计估计）。
    TokenUsage { total_tokens: u64 },
    /// 会话标题更新（引擎 LLM 生成 / 手动改名）。
    TitleChanged { title: String },
    /// 权限请求（前端展示选项后通过 command 回传）。
    PermissionRequest {
        request_id: u64,
        description: String,
        options: Vec<PermissionOptionDto>,
    },
    /// 子 agent 已创建。
    SubagentSpawned {
        subagent_id: String,
        parent_session_id: String,
        child_session_id: String,
        subagent_type: String,
        description: String,
        model: Option<String>,
    },
    /// 子 agent 进度。
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
    /// 子 agent 结束。
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
    /// AI 问卷请求（前端展示后通过 respond_user_question 回传 JSON）。
    UserQuestionRequest {
        request_id: u64,
        tool_call_id: String,
        mode: String,
        questions: Vec<UserQuestionItem>,
    },
    /// 会话状态变更。
    StatusChanged { status: SessionStatus },
    /// 当前会话 ID 变化（新建/重启/恢复后广播）。
    SessionIdChanged { session_id: String },
    /// 历史回放事件已全部转发完毕（前端据此一次落盘 transcript）。
    ReplayComplete { session_id: String },
    /// TabActor 已重建为空壳（第 attempt 次，手动 RestartTab 为 0 或 panic 自动重建），
    /// 前端需要用自己保存的该 tab 状态（cwd/session_id/model）重放会话，并清理挂起的 UI 状态。
    TabRecovering { attempt: u32 },
    /// 连续 panic 超过重试上限，不再自动重建，需要用户手动操作重连。
    TabFailed { attempts: u32 },
}

/// 权限选项（可序列化）。
#[derive(Clone, Debug, Serialize)]
pub struct PermissionOptionDto {
    pub id: String,
    pub name: String,
    /// allow | deny | other — 前端按钮样式与 Esc 默认拒绝用
    pub kind: String,
}

fn permission_option_kind(id: &str, name: &str) -> &'static str {
    let i = id.to_ascii_lowercase();
    let n = name.to_ascii_lowercase();
    if i.contains("reject")
        || i.contains("deny")
        || i.contains("cancel")
        || n.contains("reject")
        || n.contains("deny")
        || n.contains("cancel")
        || name.contains("拒绝")
        || name.contains("取消")
        || name.contains("不允许")
    {
        return "deny";
    }
    if i.contains("allow")
        || i.contains("approve")
        || i.contains("accept")
        || n.contains("allow")
        || n.contains("approve")
        || n.contains("yes")
        || name.contains("允许")
        || name.contains("同意")
        || name.contains("始终")
    {
        return "allow";
    }
    "other"
}

/// 向前端广播会话事件（带 tab_id 信封，前端据此路由到对应 tab）。
#[derive(Clone, Debug, Serialize)]
pub struct FrontendEventEnvelope {
    pub tab_id: TabId,
    #[serde(flatten)]
    pub event: FrontendEvent,
}

fn emit(app: &AppHandle, tab_id: &str, event: FrontendEvent) {
    let payload = FrontendEventEnvelope {
        tab_id: tab_id.to_string(),
        event,
    };
    if let Err(e) = app.emit("session-event", payload) {
        eprintln!("发送 session-event 失败: {e}");
    }
}

/// 单个 tab 的会话 Actor：在 tab 专属线程的 LocalSet 中永久循环。
/// 当 cmd_rx 的所有 sender 被释放（CloseTab 已从共享表移除）时优雅退出。
pub async fn run_tab_actor(app: AppHandle, tab_id: TabId, mut cmd_rx: mpsc::UnboundedReceiver<ActorCommand>) {
    let mut session: Option<GrokSession> = None;
    let mut status_rx: Option<tokio::sync::watch::Receiver<SessionStatus>> = None;
    // 待处理的权限 oneshot，key 为 request_id。
    let mut pending_permissions: HashMap<u64, oneshot::Sender<String>> = HashMap::new();
    let mut next_perm_id: u64 = 1;

    loop {
        let has_session = session.is_some();

        tokio::select! {
            // 处理来自 Tauri 命令的控制消息。
            cmd = cmd_rx.recv() => {
                let Some(cmd) = cmd else {
                    break; // 所有 sender 已释放（CloseTab 已从共享表移除）→ 优雅退出
                };
                handle_command(
                    cmd, &app, &tab_id, &mut session, &mut status_rx,
                    &mut pending_permissions, &mut next_perm_id,
                ).await;
            }
            // 消费会话流式事件并转发给前端（透传；合并由官方 ReplayBuffer 负责）。
            event = async {
                match session.as_mut() {
                    Some(s) => s.next_event().await,
                    None => std::future::pending::<Option<SessionEvent>>().await,
                }
            }, if has_session => {
                match event {
                    Some(ev) => {
                        let current_session_id = session.as_ref().map(|s| s.session_id());
                        forward_event(
                            &app, &tab_id, ev, &mut pending_permissions,
                            &mut next_perm_id, current_session_id,
                        );
                    }
                    None => {
                        emit(&app, &tab_id, FrontendEvent::Error {
                            message: "会话已断开".into(),
                            prompt_id: None,
                        });
                        emit(&app, &tab_id, FrontendEvent::StatusChanged {
                            status: SessionStatus::Ended,
                        });
                        session = None;
                        status_rx = None;
                        pending_permissions.clear();
                    }
                }
            }
            // 状态 watch 变化时同步给前端。
            changed = async {
                match status_rx.as_mut() {
                    Some(rx) => rx.changed().await,
                    None => std::future::pending().await,
                }
            }, if has_session => {
                if changed.is_ok() {
                    if let Some(rx) = status_rx.as_ref() {
                        let status = *rx.borrow();
                        emit(&app, &tab_id, FrontendEvent::StatusChanged { status });
                    }
                }
            }
        }
    }
}

/// 处理单条 Actor 命令。
async fn handle_command(
    cmd: ActorCommand,
    app: &AppHandle,
    tab_id: &TabId,
    session: &mut Option<GrokSession>,
    status_rx: &mut Option<tokio::sync::watch::Receiver<SessionStatus>>,
    pending_permissions: &mut HashMap<u64, oneshot::Sender<String>>,
    next_perm_id: &mut u64,
) {
    match cmd {
        ActorCommand::Start { cwd, reply } => {
            // 已有会话时按「新建」处理，避免前端报「会话已存在」
            if session.is_some() {
                begin_fresh_session(app, tab_id, session, status_rx, pending_permissions, cwd, reply, true)
                    .await;
            } else {
                begin_fresh_session(app, tab_id, session, status_rx, pending_permissions, cwd, reply, false)
                    .await;
            }
        }
        ActorCommand::SendPrompt { text, prompt_id, reply } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.send_prompt(text, prompt_id).await {
                Ok(()) => {
                    let _ = reply.send(Ok(()));
                }
                Err(e) => {
                    let _ = reply.send(Err(e.to_string()));
                }
            }
        }
        ActorCommand::Cancel { reply } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.cancel().await {
                Ok(()) => {
                    let _ = reply.send(Ok(()));
                }
                Err(e) => {
                    let _ = reply.send(Err(e.to_string()));
                }
            }
        }
        ActorCommand::SetModel {
            model_id,
            reasoning_effort,
            reply,
        } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s
                .set_model(model_id, reasoning_effort.as_deref())
                .await
            {
                Ok(()) => {
                    let _ = reply.send(Ok(()));
                }
                Err(e) => {
                    let _ = reply.send(Err(e.to_string()));
                }
            }
        }
        ActorCommand::ReloadModels { reply } => {
            let Some(s) = session.as_ref() else {
                // 无会话时无需 reload；配置已在磁盘，下次 start 会读到
                let _ = reply.send(Ok(()));
                return;
            };
            match s.reload_models().await {
                Ok(()) => {
                    let _ = reply.send(Ok(()));
                }
                Err(e) => {
                    let _ = reply.send(Err(e.to_string()));
                }
            }
        }
        ActorCommand::GetRewindPoints { reply } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.get_rewind_points().await {
                Ok(points) => {
                    let _ = reply.send(Ok(points));
                }
                Err(e) => {
                    let _ = reply.send(Err(format!("获取回滚点失败: {e}")));
                }
            }
        }
        ActorCommand::ExecuteRewind {
            target_prompt_index,
            mode,
            force,
            reply,
        } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.execute_rewind(target_prompt_index, mode, force).await {
                Ok(resp) => {
                    let _ = reply.send(Ok(resp));
                }
                Err(e) => {
                    let _ = reply.send(Err(format!("执行回滚失败: {e}")));
                }
            }
        }
        ActorCommand::CancelSubagent { subagent_id, reply } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.cancel_subagent(&subagent_id).await {
                Ok(v) => {
                    let _ = reply.send(Ok(v));
                }
                Err(e) => {
                    let _ = reply.send(Err(format!("取消子 agent 失败: {e}")));
                }
            }
        }
        ActorCommand::GetSubagent {
            subagent_id,
            block,
            timeout_ms,
            reply,
        } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.get_subagent(&subagent_id, block, timeout_ms).await {
                Ok(v) => {
                    let _ = reply.send(Ok(v));
                }
                Err(e) => {
                    let _ = reply.send(Err(format!("查询子 agent 失败: {e}")));
                }
            }
        }
        ActorCommand::ListMcpServers { cache, reply } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.list_mcp_servers(cache).await {
                Ok(v) => {
                    let _ = reply.send(Ok(v));
                }
                Err(e) => {
                    let _ = reply.send(Err(format!("列出 MCP 失败: {e}")));
                }
            }
        }
        ActorCommand::ToggleMcpServer {
            server_name,
            enabled,
            reply,
        } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.toggle_mcp_server(&server_name, enabled).await {
                Ok(v) => {
                    let _ = reply.send(Ok(v));
                }
                Err(e) => {
                    let _ = reply.send(Err(format!("切换 MCP 失败: {e}")));
                }
            }
        }
        ActorCommand::UpsertMcpServer {
            server_name,
            config,
            reply,
        } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.upsert_mcp_server(&server_name, config).await {
                Ok(v) => {
                    let _ = reply.send(Ok(v));
                }
                Err(e) => {
                    let _ = reply.send(Err(format!("保存 MCP 失败: {e}")));
                }
            }
        }
        ActorCommand::DeleteMcpServer {
            server_name,
            reply,
        } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.delete_mcp_server(&server_name).await {
                Ok(v) => {
                    let _ = reply.send(Ok(v));
                }
                Err(e) => {
                    let _ = reply.send(Err(format!("删除 MCP 失败: {e}")));
                }
            }
        }
        ActorCommand::ListSessionCommands { cwd, reply } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.list_session_commands(cwd.as_deref()).await {
                Ok(v) => {
                    let _ = reply.send(Ok(v));
                }
                Err(e) => {
                    let _ = reply.send(Err(format!("列出命令/技能失败: {e}")));
                }
            }
        }
        ActorCommand::RespondPermission {
            request_id,
            option_id,
            reply,
        } => match pending_permissions.remove(&request_id) {
            Some(tx) => {
                if tx.send(option_id).is_err() {
                    let _ = reply.send(Err("权限请求已失效".into()));
                } else {
                    let _ = reply.send(Ok(()));
                }
            }
            None => {
                let _ = reply.send(Err(format!("未知权限请求 id={request_id}")));
            }
        },
        ActorCommand::RespondUserQuestion {
            request_id,
            response_json,
            reply,
        } => match pending_permissions.remove(&request_id) {
            Some(tx) => {
                if tx.send(response_json).is_err() {
                    let _ = reply.send(Err("问卷请求已失效".into()));
                } else {
                    let _ = reply.send(Ok(()));
                }
            }
            None => {
                let _ = reply.send(Err(format!("未知问卷请求 id={request_id}")));
            }
        },
        ActorCommand::Restart { cwd, reply } => {
            begin_fresh_session(app, tab_id, session, status_rx, pending_permissions, cwd, reply, true)
                .await;
        }
        ActorCommand::LoadSession { session_id, cwd, reply } => {
            // 切到历史会话前：若当前是空会话则删掉，避免列表残留
            if let Some(old_session) = session.take() {
                let old_id = old_session.session_id();
                drop(old_session);
                let _ = grok_session::delete_session_if_blank(&old_id, &cwd).await;
            }
            *status_rx = None;
            pending_permissions.clear();

            emit(app, tab_id, FrontendEvent::StatusChanged { status: SessionStatus::Initializing });
            match GrokSession::resume(session_id, cwd).await {
                Ok(mut s) => {
                    *status_rx = Some(s.subscribe_status());
                    let sid = s.session_id();
                    // 前端已用 get_session_messages 磁盘投影秒开 UI；回放 chunk 在 attaching
                    // 阶段会被丢弃。此处仍 drain channel（避免污染后续实时事件），但跳过
                    // 与投影重复的 transcript 类 forward，省 IPC/序列化/前端无效处理。
                    drain_session_events_until_quiet(
                        &mut s,
                        app,
                        tab_id,
                        pending_permissions,
                        next_perm_id,
                        true, /* skip_transcript */
                    )
                    .await;
                    *session = Some(s);
                    emit(app, tab_id, FrontendEvent::StatusChanged { status: SessionStatus::Idle });
                    emit(app, tab_id, FrontendEvent::SessionIdChanged { session_id: sid.clone() });
                    emit(app, tab_id, FrontendEvent::ReplayComplete { session_id: sid });
                    let _ = reply.send(Ok(()));
                }
                Err(e) => {
                    emit(app, tab_id, FrontendEvent::Error { message: format!("恢复会话失败: {e}"), prompt_id: None });
                    emit(app, tab_id, FrontendEvent::StatusChanged { status: SessionStatus::Ended });
                    let _ = reply.send(Err(e.to_string()));
                }
            }
        }
        ActorCommand::DeleteSession {
            session_id,
            cwd,
            reply,
        } => {
            let was_active = session
                .as_ref()
                .is_some_and(|s| s.session_id() == session_id);

            // 必须先释放当前会话再删磁盘，否则 Windows 上文件锁会导致删除失败
            if was_active {
                if let Some(old) = session.take() {
                    drop(old);
                }
                *status_rx = None;
                pending_permissions.clear();
            }

            match grok_session::delete_session(&session_id, &cwd).await {
                Ok(()) => {
                    if was_active {
                        // 删的是当前会话：开一个新的空会话（不再尝试删 blank，目录已没了）
                        begin_fresh_session(
                            app,
                            tab_id,
                            session,
                            status_rx,
                            pending_permissions,
                            cwd,
                            reply,
                            false,
                        )
                        .await;
                    } else {
                        let _ = reply.send(Ok(()));
                    }
                }
                Err(e) => {
                    // 删除失败时若已 drop 当前会话，尽量恢复一个新会话避免卡死
                    if was_active && session.is_none() {
                        begin_fresh_session(
                            app,
                            tab_id,
                            session,
                            status_rx,
                            pending_permissions,
                            cwd,
                            reply,
                            false,
                        )
                        .await;
                        emit(
                            app,
                            tab_id,
                            FrontendEvent::Error {
                                message: format!("删除会话失败（已新建会话）: {e}"),
                                prompt_id: None,
                            },
                        );
                    } else {
                        let _ = reply.send(Err(e.to_string()));
                    }
                }
            }
        }
    }
}

/// 丢弃当前会话（若有）并启动全新 `GrokSession`。
///
/// - `discard_blank_old`：若旧会话从未有用户输入，删除磁盘记录，避免历史列表堆「空对话」。
async fn begin_fresh_session(
    app: &AppHandle,
    tab_id: &TabId,
    session: &mut Option<GrokSession>,
    status_rx: &mut Option<tokio::sync::watch::Receiver<SessionStatus>>,
    pending_permissions: &mut HashMap<u64, oneshot::Sender<String>>,
    cwd: String,
    reply: oneshot::Sender<Result<(), String>>,
    discard_blank_old: bool,
) {
    // 销毁旧会话：drop 关闭内存双工管道，底层 agent 任务应随之退出
    if let Some(old_session) = session.take() {
        let old_id = old_session.session_id();
        drop(old_session);
        if discard_blank_old {
            // 未说过话的会话不进历史；删除失败不阻断新建
            let _ = grok_session::delete_session_if_blank(&old_id, &cwd).await;
        }
    }
    *status_rx = None;
    // oneshot::Sender 随 clear 被 drop，对端收到 RecvError 而非 panic
    pending_permissions.clear();

    // 批量清掉历史上堆积的空「新对话」（仅在无占用会话时安全）
    if discard_blank_old {
        let n = grok_session::purge_blank_sessions(&cwd).await;
        if n > 0 {
            eprintln!("[jike-grok-desktop] 已清理 {n} 个空会话");
        }
    }

    emit(
        app,
        tab_id,
        FrontendEvent::StatusChanged {
            status: SessionStatus::Initializing,
        },
    );
    match GrokSession::start(cwd).await {
        Ok(s) => {
            *status_rx = Some(s.subscribe_status());
            let sid = s.session_id();
            *session = Some(s);
            emit(
                app,
                tab_id,
                FrontendEvent::StatusChanged {
                    status: SessionStatus::Idle,
                },
            );
            emit(app, tab_id, FrontendEvent::SessionIdChanged { session_id: sid });
            let _ = reply.send(Ok(()));
        }
        Err(e) => {
            emit(
                app,
                tab_id,
                FrontendEvent::Error {
                    message: format!("启动会话失败: {e}"),
                    prompt_id: None,
                },
            );
            emit(
                app,
                tab_id,
                FrontendEvent::StatusChanged {
                    status: SessionStatus::Ended,
                },
            );
            let _ = reply.send(Err(e.to_string()));
        }
    }
}

/// 将 channel 中已有（及短窗内陆续到达）的会话事件 drain 掉。
///
/// `load_session` 在 resume 完成时，回放通知往往已在 `event_rx` 里排队；
/// 必须在此 drain 完毕后再 `reply Ok` / `ReplayComplete`，避免回放残留进实时流。
///
/// `skip_transcript`：前端已用磁盘投影展示历史时为 true，只透传权限/错误等关键事件。
async fn drain_session_events_until_quiet(
    session: &mut GrokSession,
    app: &AppHandle,
    tab_id: &TabId,
    pending: &mut HashMap<u64, oneshot::Sender<String>>,
    next_id: &mut u64,
    skip_transcript: bool,
) {
    use std::time::{Duration, Instant};
    let deadline = Instant::now() + Duration::from_secs(8);
    let quiet = Duration::from_millis(40);
    let mut idle_rounds = 0u32;
    // 连续若干轮 try_recv 为空则认为本批回放结束
    const QUIET_ROUNDS: u32 = 3;

    let current_session_id = Some(session.session_id());

    while Instant::now() < deadline {
        let mut n = 0u32;
        while let Some(ev) = session.try_next_event() {
            if skip_transcript && is_projection_redundant(&ev) {
                // 消费即丢：agent 仍需回放到正确状态，但不必再推前端
                n += 1;
                continue;
            }
            forward_event(app, tab_id, ev, pending, next_id, current_session_id.clone());
            n += 1;
        }
        if n > 0 {
            idle_rounds = 0;
            continue;
        }
        idle_rounds += 1;
        if idle_rounds >= QUIET_ROUNDS {
            break;
        }
        tokio::time::sleep(quiet).await;
    }
}

/// 磁盘投影已覆盖的回放事件（LoadSession + skip_transcript 时不 forward）。
/// 仍透传：Error、PermissionRequest、TokenUsage（用量条）。
fn is_projection_redundant(event: &SessionEvent) -> bool {
    matches!(
        event,
        SessionEvent::AgentTextChunk(_)
            | SessionEvent::AgentThoughtChunk(_)
            | SessionEvent::UserTextChunk { .. }
            | SessionEvent::ToolCall(_)
            | SessionEvent::ToolCallUpdate(_)
            | SessionEvent::TurnEnded { .. }
            | SessionEvent::Other(_)
    )
}

/// 把业务事件转成可序列化的前端事件；权限请求会登记 oneshot。
/// 文本合并由官方 shell `bufferingSettings` / ReplayBuffer 负责，此处透传。
fn forward_event(
    app: &AppHandle,
    tab_id: &TabId,
    event: SessionEvent,
    pending: &mut HashMap<u64, oneshot::Sender<String>>,
    next_id: &mut u64,
    current_session_id: Option<String>,
) {
    let _ = app;
    match event {
        SessionEvent::AgentTextChunk(text) => {
            if !text.is_empty() {
                emit(app, tab_id, FrontendEvent::AgentTextChunk { text });
            }
        }
        SessionEvent::AgentThoughtChunk(text) => {
            if !text.is_empty() {
                emit(app, tab_id, FrontendEvent::AgentThoughtChunk { text });
            }
        }
        SessionEvent::UserTextChunk { text, prompt_id } => {
            emit(app, tab_id, FrontendEvent::UserTextChunk { text, prompt_id });
        }
        SessionEvent::TurnEnded {
            stop_reason,
            prompt_id,
        } => {
            if let Some(sid) = current_session_id.clone() {
                tauri::async_runtime::spawn_blocking(move || {
                    if let Some(row) = crate::commands::build_thread_row_by_id(&sid) {
                        let _ = crate::session_index::upsert_thread(&row);
                    }
                });
            }
            emit(
                app,
                tab_id,
                FrontendEvent::TurnEnded {
                    stop_reason,
                    prompt_id,
                },
            );
        }
        SessionEvent::Error { message, prompt_id } => {
            emit(app, tab_id, FrontendEvent::Error { message, prompt_id });
        }
        SessionEvent::ContextOverflow { message } => {
            emit(app, tab_id, FrontendEvent::ContextOverflow { message });
        }
        SessionEvent::RateLimitExceeded { message } => {
            emit(app, tab_id, FrontendEvent::RateLimitExceeded { message });
        }
        SessionEvent::AuthExpired { message } => {
            emit(app, tab_id, FrontendEvent::AuthExpired { message });
        }
        SessionEvent::RetryInProgress {
            attempt,
            max_retries,
            reason,
        } => {
            emit(
                app,
                tab_id,
                FrontendEvent::RetryInProgress {
                    attempt,
                    max_retries,
                    reason,
                },
            );
        }
        SessionEvent::Other(debug) => {
            emit(app, tab_id, FrontendEvent::Other { debug });
        }
        SessionEvent::ToolCall(tool) => {
            emit(app, tab_id, FrontendEvent::ToolCall { tool });
        }
        SessionEvent::ToolCallUpdate(update) => {
            emit(app, tab_id, FrontendEvent::ToolCallUpdate { update });
        }
        SessionEvent::TokenUsage { total_tokens } => {
            emit(app, tab_id, FrontendEvent::TokenUsage { total_tokens });
        }
        SessionEvent::TitleChanged { title } => {
            emit(app, tab_id, FrontendEvent::TitleChanged { title });
        }
        SessionEvent::PermissionRequest {
            description,
            options,
            respond,
        } => {
            let request_id = *next_id;
            *next_id += 1;
            pending.insert(request_id, respond);
            emit(
                app,
                tab_id,
                FrontendEvent::PermissionRequest {
                    request_id,
                    description,
                    options: options
                        .into_iter()
                        .map(|(id, name)| {
                            let kind = permission_option_kind(&id, &name).to_string();
                            PermissionOptionDto { id, name, kind }
                        })
                        .collect(),
                },
            );
        }
        SessionEvent::SubagentSpawned {
            subagent_id,
            parent_session_id,
            child_session_id,
            subagent_type,
            description,
            model,
            ..
        } => {
            emit(
                app,
                tab_id,
                FrontendEvent::SubagentSpawned {
                    subagent_id,
                    parent_session_id,
                    child_session_id,
                    subagent_type,
                    description,
                    model,
                },
            );
        }
        SessionEvent::SubagentProgress {
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
        } => {
            emit(
                app,
                tab_id,
                FrontendEvent::SubagentProgress {
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
                },
            );
        }
        SessionEvent::SubagentFinished {
            subagent_id,
            child_session_id,
            status,
            error,
            tool_calls,
            turns,
            duration_ms,
            tokens_used,
            output,
        } => {
            emit(
                app,
                tab_id,
                FrontendEvent::SubagentFinished {
                    subagent_id,
                    child_session_id,
                    status,
                    error,
                    tool_calls,
                    turns,
                    duration_ms,
                    tokens_used,
                    output,
                },
            );
        }
        SessionEvent::UserQuestionRequest {
            tool_call_id,
            mode,
            questions,
            respond,
        } => {
            // 与权限共用 pending map；回传的是 JSON 字符串而非 option_id。
            let request_id = *next_id;
            *next_id += 1;
            pending.insert(request_id, respond);
            emit(
                app,
                tab_id,
                FrontendEvent::UserQuestionRequest {
                    request_id,
                    tool_call_id,
                    mode,
                    questions,
                },
            );
        }
    }
}

/// 启动 Supervisor 线程：管理所有 tab 的 TabActor 生命周期。
/// 返回 (SupervisorCommand 发送端, 共享 tab 表)，在 Tauri `setup` 中只调用一次。
pub fn spawn_supervisor(
    app: AppHandle,
) -> (
    mpsc::UnboundedSender<SupervisorCommand>,
    std::sync::Arc<std::sync::Mutex<HashMap<TabId, mpsc::UnboundedSender<ActorCommand>>>>,
) {
    let (sup_tx, sup_rx) = mpsc::unbounded_channel::<SupervisorCommand>();
    let tabs = std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()));
    let tabs_for_thread = tabs.clone();
    let app_for_thread = app.clone();

    std::thread::Builder::new()
        .name("grok-supervisor".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("创建 Supervisor 运行时失败");
            let local = tokio::task::LocalSet::new();
            rt.block_on(local.run_until(run_supervisor(app_for_thread, sup_rx, tabs_for_thread)));
        })
        .expect("启动 Supervisor 线程失败");

    (sup_tx, tabs)
}

/// Supervisor 主循环：处理 tab 打开/关闭/重启，监视每个 TabActor 的退出，
/// panic 自动重建为空壳（带重试上限），并广播 TabRecovering / TabFailed 给前端。
async fn run_supervisor(
    app: AppHandle,
    mut sup_rx: mpsc::UnboundedReceiver<SupervisorCommand>,
    tabs: std::sync::Arc<std::sync::Mutex<HashMap<TabId, mpsc::UnboundedSender<ActorCommand>>>>,
) {
    static NEXT_TAB_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

    /// 连续 panic 自动重建的上限；超过后标记 Failed，等待用户手动 RestartTab。
    const MAX_PANIC_RESTARTS: u32 = 3;

    /// 每个 tab 的重启计数（手动 RestartTab 清零）。
    struct SupervisorTabEntry {
        restart_count: u32,
    }

    /// TabActor 退出通知：result 为 Err 表示 panic（JoinHandle 已捕获），Ok 表示正常退出。
    struct TabExitedMsg {
        tab_id: TabId,
        result: Result<(), tokio::task::JoinError>,
    }

    let (exited_tx, mut exited_rx) = mpsc::unbounded_channel::<TabExitedMsg>();
    let mut entries: HashMap<TabId, SupervisorTabEntry> = HashMap::new();

    /// 起一个 TabActor 并挂一个专职"上报者"任务：await JoinHandle
    /// （tokio 已在任务边界捕获 panic），无论正常结束还是 panic 都转发一条 Exited 消息。
    fn spawn_tab(
        app: &AppHandle,
        tab_id: TabId,
        tabs: &std::sync::Arc<std::sync::Mutex<HashMap<TabId, mpsc::UnboundedSender<ActorCommand>>>>,
        exited_tx: &mpsc::UnboundedSender<TabExitedMsg>,
    ) {
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<ActorCommand>();
        tabs.lock().unwrap().insert(tab_id.clone(), cmd_tx);

        let app2 = app.clone();
        let tab_id2 = tab_id.clone();
        let handle = tokio::task::spawn_local(async move {
            run_tab_actor(app2, tab_id2, cmd_rx).await;
        });

        let exited_tx2 = exited_tx.clone();
        let tab_id3 = tab_id.clone();
        tokio::task::spawn_local(async move {
            let result = handle.await;
            let _ = exited_tx2.send(TabExitedMsg { tab_id: tab_id3, result });
        });
    }

    loop {
        tokio::select! {
            cmd = sup_rx.recv() => {
                let Some(cmd) = cmd else { break };
                match cmd {
                    SupervisorCommand::OpenTab { reply } => {
                        let n = NEXT_TAB_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let tab_id: TabId = format!("tab-{n}");
                        entries.insert(tab_id.clone(), SupervisorTabEntry { restart_count: 0 });
                        spawn_tab(&app, tab_id.clone(), &tabs, &exited_tx);
                        let _ = reply.send(Ok(tab_id));
                    }
                    SupervisorCommand::CloseTab { tab_id, reply } => {
                        tabs.lock().unwrap().remove(&tab_id);
                        entries.remove(&tab_id);
                        let _ = reply.send(Ok(()));
                    }
                    SupervisorCommand::RestartTab { tab_id, reply } => {
                        // 手动重启和 panic 自动重建走同一条路径：关旧、起空壳、通知前端重放。
                        tabs.lock().unwrap().remove(&tab_id);
                        entries
                            .entry(tab_id.clone())
                            .and_modify(|e| e.restart_count = 0)
                            .or_insert(SupervisorTabEntry { restart_count: 0 });
                        spawn_tab(&app, tab_id.clone(), &tabs, &exited_tx);
                        emit(&app, &tab_id, FrontendEvent::TabRecovering { attempt: 0 });
                        let _ = reply.send(Ok(()));
                    }
                }
            }
            msg = exited_rx.recv() => {
                let Some(TabExitedMsg { tab_id, result }) = msg else { continue };
                if let Err(_join_err) = result {
                    let restart_count = entries.get(&tab_id).map(|e| e.restart_count).unwrap_or(0);
                    if restart_count < MAX_PANIC_RESTARTS {
                        let attempt = restart_count + 1;
                        eprintln!("[supervisor] tab {tab_id} panic，静默重建为空壳（第 {attempt} 次）");
                        entries.entry(tab_id.clone()).and_modify(|e| e.restart_count = attempt);
                        spawn_tab(&app, tab_id.clone(), &tabs, &exited_tx);
                        emit(&app, &tab_id, FrontendEvent::TabRecovering { attempt });
                    } else {
                        eprintln!("[supervisor] tab {tab_id} 连续 panic 超过 {MAX_PANIC_RESTARTS} 次，标记 Failed");
                        tabs.lock().unwrap().remove(&tab_id);
                        emit(&app, &tab_id, FrontendEvent::TabFailed { attempts: restart_count });
                    }
                }
                // Ok(()) 是 CloseTab 触发的正常退出，entries 已在 CloseTab 分支清过
            }
        }
    }
}
