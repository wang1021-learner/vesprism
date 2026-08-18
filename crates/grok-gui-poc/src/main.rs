use grok_session::{GrokSession, SessionEvent};
use tokio::io::{AsyncBufReadExt, BufReader};

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let local = tokio::task::LocalSet::new();
    local.run_until(run()).await
}

async fn run() -> anyhow::Result<()> {
    dotenvy::from_path("crates/grok-gui-poc/.env").ok();

    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "D:/grokbuild/grok-build".to_string());

    let mut session = GrokSession::start(cwd).await?;
    println!("--- 会话已就绪，输入消息并回车发送，输入 /exit 退出 ---\n");

    let stdin = tokio::io::stdin();
    let mut stdin_lines = BufReader::new(stdin).lines();

    loop {
        print!("你: ");
        use std::io::Write;
        std::io::stdout().flush().ok();

        let line = match stdin_lines.next_line().await? {
            Some(l) => l,
            None => break,
        };
        let line = line.trim();

        if line.is_empty() {
            continue;
        }
        if line == "/exit" {
            println!("--- 再见 ---");
            break;
        }

        if line == "/undo" {
            match session.get_rewind_points().await {
                Ok(points) if points.is_empty() => {
                    println!("--- 没有可撤销的历史点 ---\n");
                }
                Ok(points) => {
                    println!("--- 可撤销的历史点 ---");
                    for p in &points {
                        let preview = p.prompt_preview.as_deref().unwrap_or("(无预览)");
                        println!(
                            "  [{}] {} (文件快照: {}, 时间: {})",
                            p.prompt_index, preview, p.num_file_snapshots, p.created_at
                        );
                    }
                    print!("输入要撤销到的编号（回车取消）: ");
                    std::io::stdout().flush().ok();
                    if let Some(idx_line) = stdin_lines.next_line().await? {
                        let idx_line = idx_line.trim();
                        if idx_line.is_empty() {
                            println!("--- 已取消 ---\n");
                            continue;
                        }
                        match idx_line.parse::<usize>() {
                            Ok(target_index) => {
                                match session
                                    .execute_rewind(
                                        target_index,
                                        grok_session::RewindMode::All,
                                        false,
                                    )
                                    .await
                                {
                                    Ok(resp) if resp.success => {
                                        println!(
                                            "--- 已撤销到第 {} 轮，回滚文件: {:?} ---\n",
                                            resp.target_prompt_index, resp.reverted_files
                                        );
                                    }
                                    Ok(resp) => {
                                        if !resp.conflicts.is_empty() {
                                            println!("--- 撤销存在冲突 ---");
                                            for c in &resp.conflicts {
                                                println!("  {} ({})", c.path, c.conflict_type);
                                            }
                                            print!("是否强制撤销？(y/N): ");
                                            std::io::stdout().flush().ok();
                                            if let Some(ans) = stdin_lines.next_line().await? {
                                                if ans.trim().eq_ignore_ascii_case("y") {
                                                    match session
                                                        .execute_rewind(
                                                            target_index,
                                                            grok_session::RewindMode::All,
                                                            true,
                                                        )
                                                        .await
                                                    {
                                                        Ok(r) if r.success => println!(
                                                            "--- 已强制撤销，回滚文件: {:?} ---\n",
                                                            r.reverted_files
                                                        ),
                                                        Ok(r) => println!(
                                                            "--- 强制撤销仍失败: {} ---\n",
                                                            r.error.unwrap_or_else(
                                                                || "未知错误".into()
                                                            )
                                                        ),
                                                        Err(e) => {
                                                            println!("--- 撤销出错: {} ---\n", e)
                                                        }
                                                    }
                                                } else {
                                                    println!("--- 已取消强制撤销 ---\n");
                                                }
                                            }
                                        } else {
                                            println!(
                                                "--- 撤销失败: {} ---\n",
                                                resp.error.unwrap_or_else(|| "未知错误".into())
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        println!("--- 撤销出错: {} ---\n", e);
                                    }
                                }
                            }
                            Err(_) => {
                                println!("--- 无效编号 ---\n");
                            }
                        }
                    }
                }
                Err(e) => {
                    println!("--- 获取撤销点失败: {} ---\n", e);
                }
            }
            continue;
        }

        session
            .send_prompt(line, format!("poc-{}", uuid::Uuid::new_v4()))
            .await?;
        print!("AI: ");
        std::io::stdout().flush().ok();

        loop {
            match session.next_event().await {
                Some(SessionEvent::AgentTextChunk(text)) => {
                    print!("{}", text);
                    std::io::stdout().flush().ok();
                }
                Some(SessionEvent::AgentThoughtChunk(_)) => {}
                Some(SessionEvent::UserTextChunk { .. }) => {}
                Some(SessionEvent::TurnEnded { .. }) => {
                    println!("\n");
                    break;
                }
                Some(SessionEvent::Error { message: msg, .. }) => {
                    println!("\n--- 出错了: {}\n", msg);
                    break;
                }
                Some(SessionEvent::ContextOverflow { message }) => {
                    println!("\n--- 上下文超限: {}\n", message);
                    break;
                }
                Some(SessionEvent::RateLimitExceeded { message }) => {
                    println!("\n--- 速率限制，重试已耗尽: {}\n", message);
                    break;
                }
                Some(SessionEvent::AuthExpired { message }) => {
                    println!("\n--- 认证已失效，需要重新登录: {}\n", message);
                    break;
                }
                Some(SessionEvent::RetryInProgress {
                    attempt,
                    max_retries,
                    reason,
                }) => {
                    println!("\n--- 正在重试 ({}/{}): {}", attempt, max_retries, reason);
                }
                Some(SessionEvent::Other(_)) => {}
                Some(SessionEvent::PermissionRequest {
                    description,
                    options,
                    respond,
                }) => {
                    println!("\n--- 权限请求: {}", description);
                    for (id, name) in &options {
                        println!("    选项: {} ({})", name, id);
                    }
                    if let Some((first_id, _)) = options.first() {
                        println!("--- （自动选择第一项: {}）\n", first_id);
                        let _ = respond.send(first_id.clone());
                    }
                }
                // SessionEvent 新增工具事件；POC 不展示详情，忽略即可
                Some(SessionEvent::ToolCall(_)) | Some(SessionEvent::ToolCallUpdate(_)) => {}
                Some(SessionEvent::TokenUsage { .. }) => {}
                None => {
                    println!("\n--- 会话已断开 ---");
                    return Ok(());
                }
            }
        }
    }

    Ok(())
}
