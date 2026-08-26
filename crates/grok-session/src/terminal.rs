//! ACP 客户端终端：官方引擎通过反向请求 `terminal/create` 让客户端执行命令
//! （终端跑在客户端侧）。pull 模型：
//!
//! `create_terminal` → 引擎发 `ToolCallUpdate(Terminal)` →
//! `wait_for_terminal_exit` → `terminal_output` → `release_terminal`。
//!
//! 本模块持有终端注册表：每个终端一个子进程 + 累计输出（按 output_byte_limit
//! 头部截断）+ 退出状态；输出同时以 `SessionEvent::TerminalUpdate` 流式推给
//! 前端渲染终端视图（引擎侧只有 pull，桌面 UI 的流式体验来自这里）。

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use agent_client_protocol::{SessionId, TerminalExitStatus};
use tokio::sync::mpsc;

use crate::SessionEvent;

/// 卡片与默认累计输出上限（砍头留尾）。
pub const DEFAULT_OUTPUT_BYTE_LIMIT: u64 = 64 * 1024;

/// 终端注册表条目。
pub struct TerminalEntry {
    /// 累计输出（受字节上限截断）。
    pub output: String,
    /// 输出是否因超限被头部截断。
    pub truncated: bool,
    /// 退出状态；`None` = 仍在运行。
    pub exit: Option<TerminalExitStatus>,
    /// 引擎 `terminal/kill`（或仍在跑时被 release）掐掉，区别于命令自己非零退出。
    pub killed: bool,
    /// 子进程句柄（kill / release 用）。
    child: Option<tokio::process::Child>,
}

/// 线程本地终端注册表（ACP 连接为 !Send，用 Rc/RefCell）。
pub type TerminalRegistry = Rc<RefCell<HashMap<String, TerminalEntry>>>;

pub fn new_registry() -> TerminalRegistry {
    Rc::new(RefCell::new(HashMap::new()))
}

/// 追加输出并按 `limit` 从头部截断（按字符边界，宁可少留）。
pub fn append_output_with_limit(current: &mut String, chunk: &str, limit: Option<u64>) -> bool {
    if chunk.is_empty() {
        return false;
    }
    current.push_str(chunk);
    let Some(limit) = limit else { return false };
    let limit = limit as usize;
    if current.len() <= limit {
        return false;
    }
    // 从头部截断：找到第一个 char 边界使剩余 <= limit。
    let excess = current.len() - limit;
    let mut cut = excess;
    while cut < current.len() && !current.is_char_boundary(cut) {
        cut += 1;
    }
    let removed: String = current.drain(..cut).collect();
    let _ = removed;
    true
}

/// 启动命令解析：Windows 走 `cmd /C`（引擎发的是裸命令串），Unix 走 shlex。
fn build_command(command: &str) -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        (
            "cmd".to_string(),
            vec!["/C".to_string(), command.to_string()],
        )
    }
    #[cfg(not(windows))]
    {
        match shlex::split(command) {
            Some(parts) if !parts.is_empty() => (parts[0].clone(), parts[1..].to_vec()),
            _ => (
                "/bin/sh".to_string(),
                vec!["-c".to_string(), command.to_string()],
            ),
        }
    }
}

/// 在注册表中启动一个终端并返回其 id。
///
/// `event_tx` 非空时，输出与退出以 SessionEvent 流式推送（桌面 UI 用）。
/// 必须在 LocalSet 中调用（读取子进程输出使用 spawn_local）。
pub async fn spawn_terminal(
    registry: &TerminalRegistry,
    session_id: &SessionId,
    command: String,
    args: Vec<String>,
    env: Vec<agent_client_protocol::EnvVariable>,
    cwd: Option<std::path::PathBuf>,
    output_byte_limit: Option<u64>,
    event_tx: Option<mpsc::Sender<SessionEvent>>,
) -> Result<String, String> {
    let (program, extra_args) = build_command(&command);
    let mut cmd = tokio::process::Command::new(&program);
    cmd.args(&extra_args);
    cmd.args(&args);
    for var in &env {
        cmd.env(&var.name, &var.value);
    }
    if let Some(cwd) = &cwd {
        cmd.current_dir(cwd);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);

    // 引擎未指定上限时与卡片一致：64KB 砍头留尾。
    let output_byte_limit = Some(
        output_byte_limit
            .unwrap_or(DEFAULT_OUTPUT_BYTE_LIMIT)
            .min(DEFAULT_OUTPUT_BYTE_LIMIT),
    );

    let mut child = cmd.spawn().map_err(|e| format!("启动终端进程失败: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let terminal_id = format!("term-{}-{}", session_id.to_string(), uuid_simple(&command));

    let entry = TerminalEntry {
        output: String::new(),
        truncated: false,
        exit: None,
        killed: false,
        child: Some(child),
    };
    registry.borrow_mut().insert(terminal_id.clone(), entry);

    if let Some(tx) = &event_tx {
        let _ = tx
            .send(SessionEvent::TerminalOpened {
                terminal_id: terminal_id.clone(),
                command: command.clone(),
                session_id: session_id.to_string(),
            })
            .await;
    }

    // 流式读取 stdout/stderr → 累计输出 + UI 事件（先等两个流 EOF，再记退出状态）。
    let reg = registry.clone();
    let tid = terminal_id.clone();
    tokio::task::spawn_local(async move {
        let out_task = stdout.map(|s| {
            tokio::task::spawn_local(read_stream(
                s,
                tid.clone(),
                reg.clone(),
                output_byte_limit,
                event_tx.clone(),
            ))
        });
        let err_task = stderr.map(|s| {
            tokio::task::spawn_local(read_stream(
                s,
                tid.clone(),
                reg.clone(),
                output_byte_limit,
                event_tx.clone(),
            ))
        });
        if let Some(task) = out_task {
            let _ = task.await;
        }
        if let Some(task) = err_task {
            let _ = task.await;
        }
        // 先取出 child、放下 RefCell，再 wait。持 borrow_mut 跨 await
        // 会与 wait_for_exit / output / kill 的 borrow 冲突并 panic。
        let child = {
            let mut guard = reg.borrow_mut();
            match guard.get_mut(&tid) {
                Some(entry) => entry.child.take(),
                None => return,
            }
        };
        let status = match child {
            Some(mut child) => match child.wait().await {
                Ok(status) => TerminalExitStatus::new().exit_code(status.code().map(|c| c as u32)),
                Err(_) => TerminalExitStatus::new().exit_code(Some(1)),
            },
            None => TerminalExitStatus::new(),
        };
        let killed = {
            let mut guard = reg.borrow_mut();
            if let Some(entry) = guard.get_mut(&tid) {
                entry.exit = Some(status.clone());
                entry.killed
            } else {
                false
            }
        };
        if let Some(tx) = event_tx {
            let _ = tx
                .send(SessionEvent::TerminalExited {
                    terminal_id: tid,
                    exit_code: status.exit_code,
                    signal: status.signal,
                    killed,
                })
                .await;
        }
    });

    Ok(terminal_id)
}

async fn read_stream<R: tokio::io::AsyncRead + Unpin>(
    mut stream: R,
    terminal_id: String,
    registry: TerminalRegistry,
    limit: Option<u64>,
    event_tx: Option<mpsc::Sender<SessionEvent>>,
) {
    use tokio::io::AsyncReadExt;
    let mut buf = [0u8; 4096];
    loop {
        match stream.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                let chunk = String::from_utf8_lossy(&buf[..n]);
                let (snapshot, truncated) = {
                    let mut guard = registry.borrow_mut();
                    let Some(entry) = guard.get_mut(&terminal_id) else {
                        break;
                    };
                    let t = append_output_with_limit(&mut entry.output, &chunk, limit);
                    entry.truncated = entry.truncated || t;
                    (entry.output.clone(), entry.truncated)
                };
                if let Some(tx) = &event_tx {
                    let _ = tx
                        .send(SessionEvent::TerminalUpdate {
                            terminal_id: terminal_id.clone(),
                            text: snapshot,
                            truncated,
                        })
                        .await;
                }
            }
            Err(_) => break,
        }
    }
}

/// 读取累计输出（terminal/output）。
pub fn read_terminal_output(
    registry: &TerminalRegistry,
    terminal_id: &str,
) -> Option<(String, bool, Option<TerminalExitStatus>)> {
    let guard = registry.borrow();
    let entry = guard.get(terminal_id)?;
    Some((entry.output.clone(), entry.truncated, entry.exit.clone()))
}

/// 杀掉终端进程但不释放（terminal/kill）。
/// 尚未自然退出时打 `killed`，供 UI 显示「已终止」而不是「失败 exit 1」。
pub fn kill_terminal(registry: &TerminalRegistry, terminal_id: &str) -> bool {
    let mut guard = registry.borrow_mut();
    let Some(entry) = guard.get_mut(terminal_id) else {
        return false;
    };
    if entry.exit.is_none() {
        entry.killed = true;
    }
    if let Some(child) = entry.child.as_mut() {
        let _ = child.start_kill();
    }
    true
}

/// 释放终端：杀掉仍在运行的进程并移除注册表条目（terminal/release）。
/// 返回是否曾存在该条目（调用方据此发 `TerminalReleased`）。
pub fn release_terminal(registry: &TerminalRegistry, terminal_id: &str) -> bool {
    kill_terminal(registry, terminal_id);
    registry.borrow_mut().remove(terminal_id).is_some()
}

/// 终端 id 中的简单命名：命令首词 + 时间 + 序号（同毫秒并行也不撞）。
fn uuid_simple(command: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let word = command
        .split_whitespace()
        .next()
        .unwrap_or("cmd")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(24)
        .collect::<String>();
    format!("{word}-{millis}-{seq}")
}

/// 供 `wait_for_terminal_exit` 使用的退出状态观察（轮询注册表）。
pub async fn wait_terminal_exit(
    registry: &TerminalRegistry,
    terminal_id: &str,
) -> Option<TerminalExitStatus> {
    loop {
        {
            let guard = registry.borrow();
            let Some(entry) = guard.get(terminal_id) else {
                return None;
            };
            if let Some(exit) = &entry.exit {
                return Some(exit.clone());
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_with_limit_truncates_head_at_char_boundary() {
        let mut out = String::new();
        assert!(!append_output_with_limit(&mut out, "hello", Some(100)));
        assert_eq!(out, "hello");
        let truncated = append_output_with_limit(&mut out, " world", Some(8));
        assert!(truncated);
        assert_eq!(out.len(), 8, "must stay within the limit");
        assert!(!out.starts_with("hello"), "head was truncated: {out:?}");
    }

    #[test]
    fn append_without_limit_never_truncates() {
        let mut out = String::new();
        assert!(!append_output_with_limit(&mut out, "abcdef", None));
        assert_eq!(out, "abcdef");
    }

    #[test]
    fn multibyte_truncation_stays_on_char_boundary() {
        let mut out = String::from("中文中文");
        let truncated = append_output_with_limit(&mut out, "", Some(9));
        assert!(!truncated);
        assert_eq!(out, "中文中文");
        let truncated = append_output_with_limit(&mut out, "x", Some(9));
        assert!(truncated);
        assert!(
            out.len() <= 9,
            "must stay within the limit (got {} bytes): {out:?}",
            out.len()
        );
        assert!(
            out.is_char_boundary(out.len()),
            "output must stay valid UTF-8"
        );
    }

    #[test]
    fn default_card_limit_is_64kib() {
        assert_eq!(DEFAULT_OUTPUT_BYTE_LIMIT, 64 * 1024);
    }

    #[test]
    fn uuid_simple_takes_first_word_and_timestamp() {
        let id = uuid_simple("cargo build --release");
        assert!(id.starts_with("cargo-"));
    }
}
