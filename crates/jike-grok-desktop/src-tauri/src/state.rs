//! 会话 Actor：在独立的 current-thread + LocalSet 线程上持有 `GrokSession`，
//! 保证 `spawn_local` / `?Send` 的 ACP 客户端可以正常工作。

use grok_session::{GrokSession, SessionEvent, SessionStatus};
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};

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
}

/// 由 Tauri 托管的应用状态；命令侧可廉价克隆。
#[derive(Clone)]
pub struct AppState {
    /// 发往会话 Actor 的命令通道。
    pub cmd_tx: mpsc::UnboundedSender<ActorCommand>,
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
    UserTextChunk { text: String },
    /// 本轮结束。
    TurnEnded { stop_reason: String },
    /// 错误。
    Error { message: String },
    /// 其它调试信息。
    Other { debug: String },
    /// 权限请求（前端展示选项后通过 command 回传）。
    PermissionRequest {
        request_id: u64,
        description: String,
        options: Vec<PermissionOptionDto>,
    },
    /// 会话状态变更。
    StatusChanged { status: SessionStatus },
}

/// 权限选项（可序列化）。
#[derive(Clone, Debug, Serialize)]
pub struct PermissionOptionDto {
    pub id: String,
    pub name: String,
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
                ).await;
            }
            // 消费会话流式事件并转发给前端。
            event = async {
                match session.as_mut() {
                    Some(s) => s.next_event().await,
                    None => std::future::pending::<Option<SessionEvent>>().await,
                }
            }, if has_session => {
                match event {
                    Some(ev) => {
                        forward_event(
                            &app,
                            ev,
                            &mut pending_permissions,
                            &mut next_perm_id,
                        );
                    }
                    None => {
                        emit(&app, FrontendEvent::Error {
                            message: "会话已断开".into(),
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
) {
    match cmd {
        ActorCommand::Start { cwd, reply } => {
            if session.is_some() {
                let _ = reply.send(Err("会话已存在，请先重启应用再开新会话".into()));
                return;
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
                    *session = Some(s);
                    emit(
                        app,
                        FrontendEvent::StatusChanged {
                            status: SessionStatus::Idle,
                        },
                    );
                    let _ = reply.send(Ok(()));
                }
                Err(e) => {
                    emit(
                        app,
                        FrontendEvent::Error {
                            message: format!("启动会话失败: {e}"),
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
        ActorCommand::SendPrompt { text, reply } => {
            let Some(s) = session.as_ref() else {
                let _ = reply.send(Err("会话未启动".into()));
                return;
            };
            match s.send_prompt(text).await {
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
    }
}

/// 把业务事件转成可序列化的前端事件；权限请求会登记 oneshot。
fn forward_event(
    app: &AppHandle,
    event: SessionEvent,
    pending: &mut HashMap<u64, oneshot::Sender<String>>,
    next_id: &mut u64,
) {
    match event {
        SessionEvent::AgentTextChunk(text) => {
            emit(app, FrontendEvent::AgentTextChunk { text });
        }
        SessionEvent::AgentThoughtChunk(text) => {
            emit(app, FrontendEvent::AgentThoughtChunk { text });
        }
        SessionEvent::UserTextChunk(text) => {
            emit(app, FrontendEvent::UserTextChunk { text });
        }
        SessionEvent::TurnEnded { stop_reason } => {
            emit(app, FrontendEvent::TurnEnded { stop_reason });
        }
        SessionEvent::Error(message) => {
            emit(app, FrontendEvent::Error { message });
        }
        SessionEvent::Other(debug) => {
            emit(app, FrontendEvent::Other { debug });
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
                        .map(|(id, name)| PermissionOptionDto { id, name })
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
