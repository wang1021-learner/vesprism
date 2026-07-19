# Grok Build 二次开发 / 桌面化改造 —— 进度笔记

> 记录截至目前的所有已验证信息，供后续开发参考。所有代码片段均来自实际拉取的官方源码，非猜测。

---

## 一、项目背景与目标

- **目标**：不满足于套壳调用子进程，而是彻底把 TUI 层换成原生 GUI 渲染，把 `xai-grok-shell`（Agent 运行时）当作 Rust library 直接依赖进自己的桌面项目，实现"全部功能都能用"的深度集成桌面端。
- **仓库地址**：`https://github.com/xai-org/grok-build`
- **License**：Apache 2.0（允许自由修改、二次分发、商用），但官方仓库**不接受外部 PR**（`External contributions are not accepted`）。
- **本地路径**：`D:\grokbuild\grok-build`

---

## 二、核心架构结论

```
┌────────────────────────────────┐
│  xai-grok-pager (TUI 渲染)     │  ← 可以被替换/绕开
├────────────────────────────────┤
│  xai-grok-shell (Agent 引擎)   │  ← 核心复用，当作 library 依赖
│  xai-grok-tools (工具箱)       │  ← 核心复用
│  xai-grok-workspace (文件管理) │  ← 核心复用
└────────────────────────────────┘
```

**关键发现**：`xai-grok-pager`（TUI）本身就是把 `xai-grok-shell` 当作普通 Rust library 依赖引入的（`Cargo.toml` 里是 `xai-grok-shell = { workspace = true }`），**不是通过子进程调用**。这意味着我们的新 GUI crate 可以采用同样的方式，跟 TUI 处于同一架构地位，而不是"套壳调用子进程"。

### 关键函数：`spawn_agent_local`

位置：`crates/codegen/xai-grok-shell/src/agent/app.rs`（约 191 行）

```rust
fn spawn_agent_local(
    agent_config: AgentConfig,
    auth_manager: Arc<AuthManager>,
    prefetched_models: Option<IndexMap<String, ModelEntry>>,
    memory_config: Option<crate::config::MemoryConfig>,
    outgoing: impl futures::AsyncWrite + Unpin + 'static,
    incoming: impl futures::AsyncRead + Unpin + 'static,
) -> impl std::future::Future<Output = Result<(), acp::Error>>
```

- **`outgoing`/`incoming` 是泛型的**，不是写死绑定在真实进程 stdin/stdout 上的。
- 这意味着可以用 `tokio::io::duplex()` 做**内存里的双工管道**，一头连 shell，一头连自己的 GUI 代码——**同一个进程内运行，没有子进程，没有 IPC 序列化开销**。

### 唯一需要改动的官方代码

```rust
// 改动前
fn spawn_agent_local(...)
// 改动后
pub fn spawn_agent_local(...)
```

只加一个 `pub` 关键字。这是"最小侵入式"改造原则的体现：只加不改、不删除、不重构，最大程度降低未来跟官方仓库同步时的合并冲突成本。

---

## 三、Windows 环境搭建记录

### 已安装的工具链

1. **Rust 工具链**（通过 rustup）
   ```powershell
   winget install Rustlang.Rustup
   ```
   - 项目锁定的工具链版本是 `1.92.0-x86_64-pc-windows-msvc`（由 `rust-toolchain.toml` 指定），rustup 会自动下载安装，与系统默认版本并存。

2. **Visual Studio Build Tools 2022**（MSVC 链接器，Windows 编译 Rust 必需）
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools
   ```
   - 装完后必须手动进入 "Visual Studio Installer" → 点"修改" → 勾选 **"使用 C++ 的桌面开发"** 工作负载，否则缺少链接器。

3. **protoc（Protocol Buffers 编译器）**
   ```powershell
   winget install Google.Protobuf
   ```
   - 项目里 `xai-grok-tools-api` 这个 crate 需要用 protoc 编译 `.proto` 文件。

### 踩过的坑

#### 坑 1：官方代码里的 Windows 兼容性 bug（`/dev/stdout` 硬编码）

**文件**：`crates/build/xai-proto-build/src/lib.rs`，函数 `emit_rerun_if_changed`

**问题**：官方代码里硬编码使用 Unix 专属的特殊设备文件：
```rust
command
    .arg("--dependency_out=/dev/stdout")
    .arg("--descriptor_set_out=/dev/null");
```
`/dev/stdout` 和 `/dev/null` 在 Windows 上不存在，导致报错：
```
%1 不是有效的 Win32 应用程序
```

**修复方案**：改用临时文件代替：
```rust
let temp_dir = tempfile::tempdir()?;
let dep_file = temp_dir.path().join("deps.txt");
let desc_file = temp_dir.path().join("desc.pbbin");

let mut command = Command::new(protoc.unwrap_or(Path::new("protoc")));
command
    .arg(format!("--dependency_out={}", dep_file.display()))
    .arg(format!("--descriptor_set_out={}", desc_file.display()));
// ...
let output = command.output().context("protoc command failed")?;
if !output.status.success() {
    return Err(anyhow::anyhow!("protoc command failed"));
}
let dep_content = fs::read_to_string(&dep_file).context("failed to read dependency file")?;
let mut lines = dep_content.lines();
let first_line = lines.next().context("dependency file is empty")?;
let filename_with_colon = "desc.pbbin:";
let pos = first_line.find(filename_with_colon).with_context(|| {
    format!("dependency output must contain {filename_with_colon:?}: {dep_content:?}")
})?;
let rem = &first_line[pos + filename_with_colon.len()..];
// ... 后续逻辑不变
```
（该 crate 已自带 `tempfile` 依赖，无需额外添加）

用查找文件名子串（而非完整路径前缀匹配）的方式判断依赖输出的起始位置，比完整路径匹配更能兼容 Windows 路径分隔符差异。

#### 坑 2：国内网络下载 rustup 组件慢/卡住

如遇 `downloading N components` 长时间无进展，可切换国内镜像源（当前窗口有效）：
```powershell
$env:RUSTUP_DIST_SERVER = "https://mirrors.tuna.tsinghua.edu.cn/rustup"
$env:RUSTUP_UPDATE_ROOT = "https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup"
```

### 验证结果

```powershell
cd D:\grokbuild\grok-build
cargo check -p xai-grok-shell
```
最终成功输出：
```
Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 37s
```
（编译警告均为无关紧要的 `unused_mut`/`unused_imports` 等代码质量提示，不影响功能）

---

## 四、ACP（Agent Client Protocol）协议 —— 完整验证版

版本：`agent-client-protocol v0.10.4` + `agent-client-protocol-schema v0.11.4`

依赖链：
```
agent-client-protocol v0.10.4
└── xai-acp-lib v0.1.0（xAI 自己的封装层）
    └── xai-grok-shell v0.2.101
```

源码位置（Cargo 缓存）：
```
C:\Users\32438\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\
  ├── agent-client-protocol-0.10.4\src\        （RPC 传输层：agent.rs / client.rs / lib.rs / rpc.rs / stream_broadcast.rs）
  └── agent-client-protocol-schema-0.11.4\src\ （真正的字段/类型定义：agent.rs / client.rs / content.rs / tool_call.rs / plan.rs 等）
```

### 4.1 创建会话 —— `session/new`

请求类型：`NewSessionRequest`
```rust
pub struct NewSessionRequest {
    pub cwd: PathBuf,                 // JSON: cwd
    pub mcp_servers: Vec<McpServer>,  // JSON: mcpServers（camelCase，必填，可为空数组）
    pub meta: Option<Meta>,
}
```

真实 JSON：
```json
{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"D:/grokbuild/grok-build","mcpServers":[]}}
```

响应：
```json
{"jsonrpc":"2.0","id":1,"result":{"sessionId":"sess-xxxx"}}
```

### 4.2 发送消息 —— `session/prompt`

请求类型：`PromptRequest`
```rust
pub struct PromptRequest {
    pub session_id: SessionId,       // JSON: sessionId
    pub prompt: Vec<ContentBlock>,   // 注意：是数组，不是裸字符串！
    pub meta: Option<Meta>,
}
```

`ContentBlock`（tagged enum，`#[serde(tag = "type")]`）文本变体：
```rust
pub enum ContentBlock {
    Text(TextContent),       // {"type":"text","text":"..."}
    Image(ImageContent),
    Audio(AudioContent),
    ResourceLink(ResourceLink),
    Resource(EmbeddedResource),
}
```

真实 JSON（**这是之前一份分析里编造错误的地方**——`prompt` 绝不是裸字符串）：
```json
{"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{"sessionId":"sess-xxxx","prompt":[{"type":"text","text":"你好"}]}}
```

### 4.3 接收流式回复 —— `session/update` 通知

方法名常量确认：`SESSION_UPDATE_NOTIFICATION: &str = "session/update"`

通知类型：`SessionNotification`
```rust
pub struct SessionNotification {
    pub session_id: SessionId,
    pub update: SessionUpdate,   // tagged enum, tag = "sessionUpdate"
    pub meta: Option<Meta>,
}

pub enum SessionUpdate {
    UserMessageChunk(ContentChunk),      // sessionUpdate: "user_message_chunk"
    AgentMessageChunk(ContentChunk),     // sessionUpdate: "agent_message_chunk"  ← 流式回复文本在这里
    AgentThoughtChunk(ContentChunk),     // sessionUpdate: "agent_thought_chunk"
    ToolCall(ToolCall),
    ToolCallUpdate(ToolCallUpdate),
    Plan(Plan),
    AvailableCommandsUpdate(AvailableCommandsUpdate),
    CurrentModeUpdate(CurrentModeUpdate),
    ConfigOptionUpdate(ConfigOptionUpdate),
    SessionInfoUpdate(SessionInfoUpdate),
    UsageUpdate(UsageUpdate),  // unstable feature
}

pub struct ContentChunk {
    pub content: ContentBlock,
    pub meta: Option<Meta>,
}
```

真实 JSON（AI 回复的文本增量）：
```json
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess-xxxx","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"你"}}}}
```

### 4.4 判断本轮结束

当收到 `id` 匹配（不是通知，是带 `id` 的响应）的 `PromptResponse` 时，本轮结束：
```rust
pub struct PromptResponse {
    pub stop_reason: StopReason,   // JSON: stopReason
    pub meta: Option<Meta>,
}

pub enum StopReason {
    EndTurn,           // "end_turn"
    MaxTokens,         // "max_tokens"
    MaxTurnRequests,   // "max_turn_requests"
    Refusal,           // "refusal"
    Cancelled,         // "cancelled"
}
```

真实 JSON：
```json
{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}
```

---

## 五、Rust 桥接代码要点（内存双工管道）

`spawn_agent_local` 需要的是 `futures::AsyncWrite`/`futures::AsyncRead`，而 `tokio::io::duplex()` 产生的是 `tokio::io::DuplexStream`，需要用 `tokio_util::compat` 转换：

```rust
use tokio_util::compat::TokioAsyncReadCompatExt;

// 1. 创建内存双工管道
let (gui_stream, agent_stream) = tokio::io::duplex(65536);

// 2. 把 agent 端转换为 futures 的 Read/Write
let (agent_rx, agent_tx) = tokio::io::split(agent_stream);
let compat_rx = agent_rx.compat();
let compat_tx = agent_tx.compat();

// 3. 启动 Agent 运行时
tokio::task::spawn_local(async move {
    if let Err(e) = spawn_agent_local(
        agent_config,
        auth_manager,
        prefetched_models,
        memory_config,
        compat_tx,   // outgoing
        compat_rx,   // incoming
    ).await {
        eprintln!("Agent runtime error: {:?}", e);
    }
});

// 4. GUI 侧通过 gui_stream 读写 JSON-RPC 消息（换行符分隔）
let (mut gui_rx, mut gui_tx) = tokio::io::split(gui_stream);
```

> 注：以上桥接代码思路已确认可行（对照真实 `spawn_agent_local` 签名验证过 trait bound），但尚未实际编写并跑通，是下一阶段的任务。

---

## 六、后续任务规划

1. ✅ 环境搭建（Rust / MSVC / protoc）—— 已完成
2. ✅ 修复 Windows 兼容性 bug（`/dev/stdout`）—— 已完成
3. ✅ `spawn_agent_local` 加 `pub`，验证 `cargo check` 通过 —— 待最终确认（上次操作前已给出改法，需确认是否已应用）
4. ✅ ACP 协议格式完整验证（`session/new` / `session/prompt` / `session/update` / 结束判断）—— 已完成
5. ⬜ 新建 GUI crate 骨架（`xai-grok-gui`），配置依赖 `xai-grok-shell` + `agent-client-protocol` + `tokio` + `tokio-util`
6. ⬜ 编写并跑通"发消息收流式回复"最小闭环（纯命令行/无 UI 验证协议通不通）
7. ⬜ 选定 GUI 渲染方案：
   - 方案 A：纯 Rust GUI 框架（`egui` 或 `iced`）
   - 方案 B：Tauri 后端 + React/Vue 前端（复用现有前端技能，通过 Tauri Event/Channel 转发流式数据）
8. ⬜ 逐步接入更多功能：工具调用展示、权限确认弹窗、Plan 模式 UI、会话管理、文件树等
9. ⬜（按需）终端模拟器展示方案（如需要展示 shell 命令执行过程，需引入 `xterm.js` 等组件；如场景不需要可暂不接）
10. ⬜（按需）认证方案：个人使用可通过 `XAI_API_KEY` 环境变量绕过 OAuth

---

## 七、重要原则提醒（给未来的自己）

- **改造原则**：只加不改、不删除、不重构官方代码，最大限度降低与上游同步的合并冲突成本。
- **协议细节必须以真实源码为准**，不能采信任何未经验证的"看起来合理"的 JSON 示例（本项目开发过程中已踩过一次这个坑）。
- 上游仓库不接受 PR，只能自己 fork 维护，定期 `git fetch upstream` 手动同步。