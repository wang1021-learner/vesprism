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

        session.send_prompt(line).await?;
        print!("AI: ");
        std::io::stdout().flush().ok();

        loop {
            match session.next_event().await {
                Some(SessionEvent::AgentTextChunk(text)) => {
                    print!("{}", text);
                    std::io::stdout().flush().ok();
                }
                Some(SessionEvent::AgentThoughtChunk(_)) => {}
                Some(SessionEvent::UserTextChunk(_)) => {}
                Some(SessionEvent::TurnEnded { .. }) => {
                    println!("\n");
                    break;
                }
                Some(SessionEvent::Error(msg)) => {
                    println!("\n--- 出错了: {}\n", msg);
                    break;
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
                None => {
                    println!("\n--- 会话已断开 ---");
                    return Ok(());
                }
            }
        }
    }

    Ok(())
}
