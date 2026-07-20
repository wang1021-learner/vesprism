mod session;

use session::{GrokSession, SessionEvent};

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let local = tokio::task::LocalSet::new();
    local.run_until(run()).await
}

async fn run() -> anyhow::Result<()> {
    dotenvy::from_path("crates/grok-gui-poc/.env").ok();

    let mut session = GrokSession::start("D:/grokbuild/grok-build").await?;
    println!("--- 会话已就绪");

    session.send_prompt("你好，请用一句话介绍一下你自己").await?;

    while let Some(event) = session.next_event().await {
        match event {
            SessionEvent::AgentTextChunk(text) => print!("{}", text),
            SessionEvent::AgentThoughtChunk(text) => print!("[思考] {}", text),
            SessionEvent::UserTextChunk(text) => println!("[用户] {}", text),
            SessionEvent::TurnEnded => {
                println!("\n--- 本轮结束");
                break;
            }
            SessionEvent::Other(debug) => println!("[其他] {}", debug),
        }
    }

    Ok(())
}
