use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use xai_grok_shell::agent::app::spawn_agent_local;
use xai_grok_shell::agent::config::Config as AgentConfig;
use std::sync::Arc;

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let local = tokio::task::LocalSet::new();
    local.run_until(run()).await
}

async fn run() -> anyhow::Result<()> {
    // 本地最小化验证无需解析磁盘上的 TOML 配置，以默认空配置启动即可减少外部环境依赖
    let agent_config = AgentConfig::default();

    // 必须持有并传递 AuthManager 实例，以防 agent 在执行内置工具或鉴权接口时发生未初始化 panic
    let auth_manager = Arc::new(agent_config.create_auth_manager());

    // 使用内存双工管道模拟 stdio 进程间通信（IPC），避免依赖本地 TCP 端口或平台特定的命名管道
    let (gui_stream, agent_stream) = tokio::io::duplex(65536);
    let (agent_rx, agent_tx) = tokio::io::split(agent_stream);
    let compat_rx = agent_rx.compat();
    let compat_tx = agent_tx.compat_write();

    // spawn_agent_local 内部依赖非 Send 的 Futures，必须在 LocalSet 绑定下的本地任务中运行并驱动其 I/O loop
    let agent_handle = tokio::task::spawn_local(async move {
        let handle_io = spawn_agent_local(
            agent_config,
            auth_manager,
            None, // prefetched_models: 无需预热模型列表
            None, // memory_config: 暂不启用长期记忆组件
            compat_tx,
            compat_rx,
        );
        if let Err(e) = handle_io.await {
            eprintln!("Agent runtime error: {:?}", e);
        }
    });

    // 映射 GUI 端对应的读写流，用于后续模拟协议收发
    let (gui_read, gui_write) = tokio::io::split(gui_stream);
    let mut gui_reader = BufReader::new(gui_read).lines();
    let mut gui_writer = gui_write;

    // ACP 协议规定在进行任何会话级操作前，客户端必须先发送 initialize 请求以完成协议版本协商并交换 capabilities
    let initialize_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientCapabilities": {}
        }
    });
    let mut line = serde_json::to_string(&initialize_req)?;
    line.push('\n');
    gui_writer.write_all(line.as_bytes()).await?;
    gui_writer.flush().await?;
    println!(">>> 发送: {}", line.trim());

    // 握手必须是同步阻断的，必须确保收到 Agent 确认 initialize 响应后才能开始后续的业务消息流通
    if let Some(resp_line) = gui_reader.next_line().await? {
        println!("<<< 收到: {}", resp_line);
    }

    // 握手成功后，发送 session/new 创建独立的业务交互上下文。RPC 的 id 递增为 2 以维持正常的请求响应匹配关系
    let new_session_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "session/new",
        "params": {
            "cwd": "D:/grokbuild/grok-build",
            "mcpServers": []
        }
    });
    let mut line = serde_json::to_string(&new_session_req)?;
    line.push('\n');
    gui_writer.write_all(line.as_bytes()).await?;
    gui_writer.flush().await?;
    println!(">>> 发送: {}", line.trim());

    // 循环监听 Agent 返回的 JSON-RPC 响应及主动事件通知（例如编译心跳、MCP 注册进度等）
    while let Some(line) = gui_reader.next_line().await? {
        println!("<<< 收到: {}", line);
    }

    agent_handle.await?;
    Ok(())
}
