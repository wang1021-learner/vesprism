//! 会话 Actor：在独立的 current-thread + LocalSet 线程上持有 `GrokSession`，
//! 保证 `spawn_local` / `?Send` 的 ACP 客户端可以正常工作。

use grok_session::{
    GrokSession, SessionEvent, SessionStatus, ToolCallInfo, ToolCallUpdateInfo,
};
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};

// 文本 chunk 合并交给官方 ReplayBuffer（grok-session initialize 的 bufferingSettings）。
// 桌面侧不再做第二层 33ms 合并，避免与官方策略叠床架屋。

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
    /// 获取当前会话累计 token 用量拆分。
    GetUsage {
        reply: oneshot::Sender<Result<serde_json::Value, String>>,
    },
}

/// 由 Tauri 托管的应用状态；命令侧可廉价克隆。
#[derive(Clone)]
pub struct AppState {
    /// 发往会话 Actor 的命令通道。
    pub cmd_tx: mpsc::UnboundedSender<ActorCommand>,
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
    /// 其它调试信息。
    Other { debug: String },
    /// 新工具调用（完整快照）。
    ToolCall { tool: ToolCallInfo },
    /// 工具调用增量更新。
    ToolCallUpdate { update: ToolCallUpdateInfo },
    /// 上下文 token 用量（累计估计）。
    TokenUsage { total_tokens: u64 },
    /// 权限请求（前端展示选项后通过 command 回传）。
    PermissionRequest {
        request_id: u64,
        description: String,
        options: Vec<PermissionOptionDto>,
    },
    /// 会话状态变更。
    StatusChanged { status: SessionStatus },
    /// 当前会话 ID 变化（新建/重启/恢复后广播）。
    SessionIdChanged { session_id: String },
    /// 历史回放事件已全部转发完毕（前端据此一次落盘 transcript）。
    ReplayComplete { session_id: String },
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

/// 向前端广播会话事件。
fn emit(app: &AppHandle, event: FrontendEvent) {
    if let Err(e) = app.emit("session-event", event) {
        eprintln!("发送 session-event 失败: {e}");
    }
}

/// 在会话线程内永久循环（处于 LocalSet 中）。
pub async fn run_actor(app: AppHandle, mut cmd_rx: mpsc::UnboundedReceiver<ActorCommand>) {
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
                    break;
                };
                handle_command(
                    cmd,
                    &app,
                    &mut session,
                    &mut status_rx,
                    &mut pending_permissions,
                    &mut next_perm_id,
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
                            &app,
                            ev,
                            &mut pending_permissions,
                            &mut next_perm_id,
                            current_session_id,
                        );
                    }
                    None => {
                        emit(&app, FrontendEvent::Error {
                            message: "会话已断开".into(),
                            prompt_id: None,
                        });
                        emit(&app, FrontendEvent::StatusChanged {
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
                        emit(&app, FrontendEvent::StatusChanged { status });
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
    session: &mut Option<GrokSession>,
    status_rx: &mut Option<tokio::sync::watch::Receiver<SessionStatus>>,
    pending_permissions: &mut HashMap<u64, oneshot::Sender<String>>,
    next_perm_id: &mut u64,
) {
    match cmd {
        ActorCommand::Start { cwd, reply } => {
            // 已有会话时按「新建」处理，避免前端报「会话已存在」
            if session.is_some() {
                begin_fresh_session(app, session, status_rx, pending_permissions, cwd, reply, true)
                    .await;
            } else {
                begin_fresh_session(app, session, status_rx, pending_permissions, cwd, reply, false)
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
        ActorCommand::GetUsage { reply } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.get_usage().await {
                Ok(usage) => match serde_json::to_value(&usage) {
                    Ok(v) => {
                        let _ = reply.send(Ok(v));
                    }
                    Err(e) => {
                        let _ = reply.send(Err(format!("序列化用量失败: {e}")));
                    }
                },
                Err(e) => {
                    let _ = reply.send(Err(e.to_string()));
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
        ActorCommand::Restart { cwd, reply } => {
            begin_fresh_session(app, session, status_rx, pending_permissions, cwd, reply, true)
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

            emit(app, FrontendEvent::StatusChanged { status: SessionStatus::Initializing });
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
                        pending_permissions,
                        next_perm_id,
                        true, /* skip_transcript */
                    )
                    .await;
                    *session = Some(s);
                    emit(app, FrontendEvent::StatusChanged { status: SessionStatus::Idle });
                    emit(app, FrontendEvent::SessionIdChanged { session_id: sid.clone() });
                    emit(app, FrontendEvent::ReplayComplete { session_id: sid });
                    let _ = reply.send(Ok(()));
                }
                Err(e) => {
                    emit(app, FrontendEvent::Error { message: format!("恢复会话失败: {e}"), prompt_id: None });
                    emit(app, FrontendEvent::StatusChanged { status: SessionStatus::Ended });
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
                FrontendEvent::StatusChanged {
                    status: SessionStatus::Idle,
                },
            );
            emit(app, FrontendEvent::SessionIdChanged { session_id: sid });
            let _ = reply.send(Ok(()));
        }
        Err(e) => {
            emit(
                app,
                FrontendEvent::Error {
                    message: format!("启动会话失败: {e}"),
                    prompt_id: None,
                },
            );
            emit(
                app,
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
            forward_event(app, ev, pending, next_id, current_session_id.clone());
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
    event: SessionEvent,
    pending: &mut HashMap<u64, oneshot::Sender<String>>,
    next_id: &mut u64,
    current_session_id: Option<String>,
) {
    let _ = app;
    match event {
        SessionEvent::AgentTextChunk(text) => {
            if !text.is_empty() {
                emit(app, FrontendEvent::AgentTextChunk { text });
            }
        }
        SessionEvent::AgentThoughtChunk(text) => {
            if !text.is_empty() {
                emit(app, FrontendEvent::AgentThoughtChunk { text });
            }
        }
        SessionEvent::UserTextChunk { text, prompt_id } => {
            emit(app, FrontendEvent::UserTextChunk { text, prompt_id });
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
                FrontendEvent::TurnEnded {
                    stop_reason,
                    prompt_id,
                },
            );
        }
        SessionEvent::Error { message, prompt_id } => {
            emit(app, FrontendEvent::Error { message, prompt_id });
        }
        SessionEvent::Other(debug) => {
            emit(app, FrontendEvent::Other { debug });
        }
        SessionEvent::ToolCall(tool) => {
            emit(app, FrontendEvent::ToolCall { tool });
        }
        SessionEvent::ToolCallUpdate(update) => {
            emit(app, FrontendEvent::ToolCallUpdate { update });
        }
        SessionEvent::TokenUsage { total_tokens } => {
            emit(app, FrontendEvent::TokenUsage { total_tokens });
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
    }
}

/// 启动专用会话 Actor 线程；在 Tauri `setup` 中只调用一次。
pub fn spawn_session_actor(app: AppHandle) -> mpsc::UnboundedSender<ActorCommand> {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
    std::thread::Builder::new()
        .name("grok-session-actor".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("创建会话 Actor 运行时失败");
            let local = tokio::task::LocalSet::new();
            rt.block_on(local.run_until(run_actor(app, cmd_rx)));
        })
        .expect("启动会话 Actor 线程失败");
    cmd_tx
}
