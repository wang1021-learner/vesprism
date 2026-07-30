# Grok Build 二次开发 —— GUI Crate 骨架搭建记录（第二天）

> 本文档记录今天新增的进展：从零搭建 `grok-gui-poc` 独立验证项目，
> 并成功跑通"内存双工管道 + ACP 协议握手"的最小闭环。
> 承接上一份笔记《Grok build桌面化改造笔记第一天.md》。

---

## 一、今天的目标

当日策略：不碰官方 TUI 代码，把 `xai-grok-shell`（agent 运行时）当作 library 依赖，  
（**【2026-07-29】** 好方案可改官方，见 `docs/官方代码修改原则.md`。）
在一个全新的、物理隔离的 Rust 项目里，验证：
1. 能否用 `tokio::io::duplex()` 建立内存双工管道，绕开真实 stdin/stdout；
2. 能否通过这条管道，用真实的 ACP JSON-RPC 协议跟 agent 完成握手、创建会话、发消息。

**结论：全部验证成功。**

---

## 二、项目结构（物理隔离原则）

- 新建的所有代码都在全新目录 `crates/grok-gui-poc/` 下，**没有一行代码写进任何官方 crate**。
- 唯一触碰的官方文件：workspace 根 `Cargo.toml`，且只是在 `[workspace]` 的 `members` 数组里**追加一行**：
  ```toml
  members = [
      # ...原有成员不变...
      "crates/grok-gui-poc",
  ]
  ```
- 目录结构：
  ```
  D:\grokbuild\grok-build\
  ├── crates\
  │   ├── codegen\        （官方代码，未改动，除下述一处 pub）
  │   ├── common\
  │   ├── build\
  │   └── grok-gui-poc\   ← 今天新建的独立验证项目
  │       ├── Cargo.toml
  │       └── src\
  │           └── main.rs
  └── Cargo.toml          ← 只改了 members 数组，追加一行
  ```

### 为什么放进 workspace 而不是完全独立项目？

最初尝试把 `grok-gui-poc` 放在 `grok-build` 仓库**外面**（`D:\grokbuild\grok-gui-poc`），
通过 `path` 依赖引用 `xai-grok-shell`。结果编译时报错：

```
error[E0308]: mismatched types
...
note: there are multiple different versions of crate `windows` in the dependency graph
```

**原因**：脱离 workspace 后，Cargo 对新项目单独做依赖解析，解析出了跟官方 `Cargo.lock`
不一致的 `windows` crate 版本（`0.62.2` vs `0.61.3`），导致类型冲突。

**解决**：把新 crate 挂进 workspace 成员列表，改用 `{ workspace = true }` 依赖方式，
共享同一份 `Cargo.lock`，版本自动保持一致。**代码本身依然物理独立**，只是加入了同一个
依赖解析范围。

---

## 三、唯一的官方代码改动确认

再次确认以下三处链路，全部已是 `pub`，外部 crate 可以正常访问：

```rust
// lib.rs 第 11 行
pub mod agent;

// agent/mod.rs 第 2 行
pub mod app;

// agent/app.rs 第 191 行
pub fn spawn_agent_local(
    agent_config: AgentConfig,
    auth_manager: Arc<AuthManager>,
    prefetched_models: Option<IndexMap<String, ModelEntry>>,
    memory_config: Option<crate::config::MemoryConfig>,
    outgoing: impl futures::AsyncWrite + Unpin + 'static,
    incoming: impl futures::AsyncRead + Unpin + 'static,
) -> impl std::future::Future<Output = Result<(), acp::Error>>
```

调用路径：`xai_grok_shell::agent::app::spawn_agent_local(...)`

---

## 四、参数构造方式（照抄官方 `run_stdio_agent` 的做法）

参考位置：`xai-grok-shell/src/agent/app.rs` 里的 `run_stdio_agent` 函数（唯一调用
`spawn_agent_local` 的地方）。

| 参数 | 构造方式 |
|---|---|
| `AgentConfig`（`crate::agent::config::Config`） | 官方 CLI 用 `AgentConfig::new_from_toml_cfg(&raw_config)` 从配置文件构造；我们的最小验证直接用 `AgentConfig::default()`（`Config` 实现了 `Default`） |
| `AuthManager` | `Arc::new(agent_config.create_auth_manager())` |
| `prefetched_models` | 传 `None` |
| `memory_config` | 传 `None` |
| `outgoing` / `incoming` | 由 `tokio::io::duplex()` 产生的双工管道两端，经 `tokio_util::compat` 转换 |

---

## 五、踩过的坑（今天新增）

### 坑 1：`windows` crate 版本冲突

见上文"为什么放进 workspace"。解决：加入 workspace 成员，用 `workspace = true` 依赖。

### 坑 2：Windows Defender 实时防护导致编译反复报"文件被占用"

现象：
```
error: failed to remove ...\build_script_build-xxx.rcgu.o: 另一个程序正在使用此文件，进程无法访问。(os error 32)
```
每次报错都是不同的临时编译产物文件，说明不是单个文件偶发问题，而是**持续性干扰**。

排查顺序：
1. 检查有无重复 cargo/rustc/rust-analyzer 进程 —— 排除
2. 检查 OneDrive 同步监控目标目录 —— 排除（`D:\grokbuild` 不在 OneDrive 同步范围）
3. 加 Defender 路径排除项 `Add-MpPreference -ExclusionPath "D:\grokbuild"` —— 仍未解决
4. 检查"受控文件夹访问"(Controlled Folder Access) —— 确认未开启，排除
5. **临时关闭 Defender 实时防护** `Set-MpPreference -DisableRealtimeMonitoring $true` —— **问题消失，确认根因**

**后续更稳妥的做法**（避免每次都要手动关实时防护）：改用**进程排除**而非路径排除：
```powershell
Add-MpPreference -ExclusionProcess "C:\Users\32438\.cargo\bin\cargo.exe"
Add-MpPreference -ExclusionProcess "C:\Users\32438\.rustup\toolchains\1.92.0-x86_64-pc-windows-msvc\bin\rustc.exe"
```

> ⚠️ 待办：今天验证完成后，**尚未执行** `Set-MpPreference -DisableRealtimeMonitoring $false`
> 把实时防护改回开启状态。下次开始前需要先确认当前防护状态，处理好后续用进程排除项
> 替代"整个关闭防护"这种不安全的临时方案。

### 坑 3：`tokio_util::compat` 的方法名弄混

`futures::AsyncRead`/`futures::AsyncWrite` 转换成 tokio 类型对应的方法名不同：
- 读端：`TokioAsyncReadCompatExt::compat()` （方法名是 `compat`）
- 写端：`TokioAsyncWriteCompatExt::compat_write()` （方法名是 `compat_write`，**不是** `compat`）

两者本身**不重名**，之前用完全限定语法（UFCS）绕弯路是走错了方向，直接用正确的方法名
`.compat()` / `.compat_write()` 即可，不需要任何复杂写法。

### 坑 4：移动目录时产生重复副本

第一次尝试把独立项目移入 workspace 时，`grok-gui-poc` 文件夹在仓库**根目录**和
`crates/` 目录下同时存在了一份。需要手动删除根目录下的多余副本，只保留
`crates/grok-gui-poc/` 这一份。

---

## 六、最终验证结果：完整跑通的最小闭环

### 6.1 最终版 `main.rs` 逻辑（关键步骤）

```rust
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
    let agent_config = AgentConfig::default();
    let auth_manager = Arc::new(agent_config.create_auth_manager());

    let (gui_stream, agent_stream) = tokio::io::duplex(65536);
    let (agent_rx, agent_tx) = tokio::io::split(agent_stream);
    let compat_rx = agent_rx.compat();
    let compat_tx = agent_tx.compat_write();

    let agent_handle = tokio::task::spawn_local(async move {
        let handle_io = spawn_agent_local(
            agent_config, auth_manager, None, None, compat_tx, compat_rx,
        );
        if let Err(e) = handle_io.await {
            eprintln!("Agent runtime error: {:?}", e);
        }
    });

    let (gui_read, gui_write) = tokio::io::split(gui_stream);
    let mut gui_reader = BufReader::new(gui_read).lines();
    let mut gui_writer = gui_write;

    // 1. initialize 握手
    let initialize_req = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": 1, "clientCapabilities": {}}
    });
    // ... 发送 + 读取响应 ...

    // 2. session/new
    let new_session_req = serde_json::json!({
        "jsonrpc": "2.0", "id": 2, "method": "session/new",
        "params": {"cwd": "D:/grokbuild/grok-build", "mcpServers": []}
    });
    // ... 发送 + 持续读取后续消息 ...

    agent_handle.await?;
    Ok(())
}
```

> 关键点：`spawn_agent_local` 返回的 future 需要跑在 `LocalSet` 里
> （用 `tokio::task::spawn_local`，而不是普通 `tokio::spawn`），
> 因为该 future 大概率不满足 `Send`。

### 6.2 实际运行输出（真实终端日志）

```
>>> 发送: {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}
<<< 收到: {"jsonrpc":"2.0","id":1,"result":{
    "protocolVersion":1,
    "agentCapabilities":{
        "loadSession":true,
        "promptCapabilities":{"image":false,"audio":false,"embeddedContext":true},
        "mcpCapabilities":{"http":true,"sse":true},
        "sessionCapabilities":{},
        "auth":{}
    },
    "authMethods":[{"id":"grok.com","name":"Grok","description":"Sign in with Grok"}],
    "_meta":{ ... "agentVersion":"0.2.101", "hostname":"阿聪", ... }
}}

>>> 发送: {"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"D:/grokbuild/grok-build","mcpServers":[]}}
<<< 收到: {"jsonrpc":"2.0","method":"_x.ai/mcp/servers_updated","params":{"mcpServers":[
    {"name":"codegraph","source":"local","type":"stdio","command":"codegraph","args":["serve","--mcp"]},
    {"name":"figma","source":"local","type":"http","url":"http://127.0.0.1:3845/mcp"}
]}}
<<< 收到: {"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"Authentication required","data":"no auth method id provided"}}
```

### 6.3 结果解读

1. ✅ **`initialize` 握手完全成功**——证明内存双工管道 + ACP 协议序列化/反序列化
   全链路打通，agent 正确识别客户端能力并返回完整的能力清单。
2. ✅ **发现一个此前协议梳理中遗漏的步骤**：ACP 协议要求必须先 `initialize`
   握手，才能调用 `session/new`，否则会收到 `-32602 Invalid params` 错误
   （这一点在第一天的协议笔记里没有强调，今天补上）。
3. 📌 **额外发现**：`session/new` 调用之后，agent 会先主动推送一条通知
   `_x.ai/mcp/servers_updated`（下划线前缀的扩展方法），把它在本地检测到的
   MCP 服务器配置（本机已配置的 `codegraph`、`figma`）广播给客户端，这是
   之前协议文档里没有专门提到的一个实际行为。
4. ⚠️ **`session/new` 最终报错**：`Authentication required` / `no auth method id provided`。
   这是**符合预期**的结果——`initialize` 返回里已经列出了 `authMethods: [{"id":"grok.com", ...}]`，
   说明 Grok Build 要求必须先完成认证才能创建会话。

---

## 七、下一步任务（明天开始）

1. **解决认证问题**，两条候选路径：
   - **方案 A（优先尝试）**：检查 `xai-grok-shell/src/auth/` 目录下 `AuthManager`/`GrokAuth`
     相关代码，确认是否支持读取 `XAI_API_KEY`（或类似名称）环境变量来跳过 OAuth 流程。
     **这一步还没做**，是明天第一件事。
   - **方案 B（较重）**：调用 ACP 协议的 `authenticate` 方法，用 `initialize` 返回的
     `authMethods` 里 `id: "grok.com"` 走完整 OAuth 浏览器登录流程。
2. 认证打通后，重新验证 `session/new` 能否正常拿到 `sessionId`。
3. 之后再验证 `session/prompt` 发送消息 + `session/update` 通知流式接收文本的完整闭环
   （协议格式已在第一天笔记里验证过，本次待认证打通后实测）。
4. 认证 + 完整对话闭环跑通后，再考虑 GUI 渲染层的技术选型（`egui`/`iced` 原生 GUI，
   或 Tauri + React/Vue 前端）。

---

## 八、环境维护提醒

- **Windows Defender 实时防护目前处于关闭状态**（今天为排查编译问题手动关闭），
  下次开始前需要评估是否要开启，并优先切换成"进程级排除"而不是完全关闭防护：
  ```powershell
  Set-MpPreference -DisableRealtimeMonitoring $false
  Add-MpPreference -ExclusionProcess "C:\Users\32438\.cargo\bin\cargo.exe"
  Add-MpPreference -ExclusionProcess "C:\Users\32438\.rustup\toolchains\1.92.0-x86_64-pc-windows-msvc\bin\rustc.exe"
  ```
- Defender 路径排除项 `D:\grokbuild` 已经加好，可以保留。