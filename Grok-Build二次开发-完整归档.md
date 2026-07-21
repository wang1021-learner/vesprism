# Grok Build 二次开发 —— 完整归档（第一天 ~ 第三天）

> 本文档归档 Grok Build（xAI 开源编程 Agent CLI）二次开发为桌面端的完整过程，
> 供后续查阅、新协作者上手、以及作为项目文档的一部分保存。

---

## 项目目标

将 xAI 开源的 Grok Build（编程 Agent CLI，Apache 2.0 协议）改造成一个真正的、
深度集成的桌面应用——不是简单的"套壳调用子进程/终端"，而是把核心 agent
运行时（`xai-grok-shell`）当作 Rust 库直接依赖，在同一进程内通过内存管道
通信，实现零 IPC 开销的桌面 GUI。

---

## 一、架构决策

### 1.1 为什么不走"套壳子进程"这条路

最初讨论时排除了两种更简单但受限的方案：
- **路径 A**：Tauri/Electron 套壳，通过 `grok agent stdio` 子进程 + stdin/stdout
  管道通信 —— 简单但有 IPC 开销，且受限于 ACP 协议暴露的能力边界
- **路径 C**：完全重写 TUI 层（用 egui/iced 从零打造 GUI）—— 工作量巨大，
  需要吃透 `xai-grok-pager` 内部复杂的状态管理

### 1.2 采用的方案：Library 依赖 + 内存双工管道

关键发现：`xai-grok-pager`（官方 TUI）本身就是把 `xai-grok-shell` 当作
**普通 Rust library 依赖**引入的（`Cargo.toml` 里是
`xai-grok-shell = { workspace = true }`），不是子进程调用。

核心函数 `spawn_agent_local` 接收的是泛型的 `impl futures::AsyncWrite` /
`impl futures::AsyncRead`，不是写死绑定在真实 stdin/stdout 上的：

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

这意味着可以用 `tokio::io::duplex()` 做内存里的双工管道，一头连 shell，
一头连自己的 GUI 代码——同一个进程内运行，没有子进程，没有 IPC 序列化开销。

**唯一改动的官方代码**：把这个函数从 `fn` 改成 `pub fn`（一行改动），
遵循"只加不改，不删除、不重构"的原则，最大限度降低与上游同步的合并冲突成本。

### 1.3 最终架构图

```
┌─────────────────────────────────────────┐
│   一个单一的应用进程（未来是 Tauri 桌面应用） │
│                                           │
│  ┌─────────────────────────────────┐    │
│  │   界面层（React，运行在 WebView）  │    │
│  └──────────────┬────────────────────┘    │
│                 │ Tauri invoke/emit       │
│                 │ （进程内直接调用，非网络） │
│  ┌──────────────▼────────────────────┐    │
│  │   GrokSession（Rust，已验证可用）  │    │
│  │   - start() / send_prompt()       │    │
│  │   - next_event() / cancel()       │    │
│  └──────────────┬────────────────────┘    │
│                 │ agent_client_protocol   │
│                 │ ::ClientSideConnection  │
│  ┌──────────────▼────────────────────┐    │
│  │  tokio::io::duplex 内存双工管道     │    │
│  └──────────────┬────────────────────┘    │
│  ┌──────────────▼────────────────────┐    │
│  │  xai_grok_shell::spawn_agent_local │    │
│  │  （官方 agent 运行时，库函数直接调用） │    │
│  └────────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

---

## 二、环境搭建（Windows）

### 2.1 工具链清单

- **Rust**：通过 rustup 安装，项目锁定工具链版本 `1.92.0-x86_64-pc-windows-msvc`
  （由仓库自带的 `rust-toolchain.toml` 决定，与系统默认版本 `1.97.1` 并存）
- **Visual Studio Build Tools 2022**：勾选"使用 C++ 的桌面开发"工作负载
  （MSVC 链接器，Windows 编译 Rust 必需）
- **protoc**（Protocol Buffers 编译器）：`winget install Google.Protobuf`
- **Node.js**：v22.14.0（前端 React 项目需要）
- **Tauri CLI**：`cargo install tauri-cli --version "^2" --locked`

### 2.2 官方代码里的真实 Windows 兼容性 Bug

`crates/build/xai-proto-build/src/lib.rs` 硬编码使用 Unix 专属设备文件：
```rust
.arg("--dependency_out=/dev/stdout")
.arg("--descriptor_set_out=/dev/null")
```
在 Windows 上报错 `%1 不是有效的 Win32 应用程序`。**修复方案**：改用
`tempfile::tempdir()` 生成的临时文件路径代替，用文件名子串匹配
（而非完整路径前缀匹配）判断依赖输出起始位置，更能兼容 Windows 路径分隔符差异。

### 2.3 编译期"文件被占用"问题排查记录

反复出现 `failed to remove ...rcgu.o: 另一个程序正在使用此文件` 错误，
排查顺序：进程冲突（排除）→ OneDrive 同步（排除）→ Defender 路径排除项
（未解决）→ 受控文件夹访问（确认未开启）→ **临时关闭 Defender 实时防护
（确认根因，问题消失）**。

更稳妥的长期方案（避免每次都要关闭防护）：
```powershell
Add-MpPreference -ExclusionProcess "C:\Users\<user>\.cargo\bin\cargo.exe"
Add-MpPreference -ExclusionProcess "C:\Users\<user>\.rustup\toolchains\1.92.0-x86_64-pc-windows-msvc\bin\rustc.exe"
```

### 2.4 关于 `rust-version` 字段的教训

一度尝试把新建 crate 的 `rust-version` 设为系统最新版本（1.97.1），
导致报错 `rustc 1.92.0 is not supported`——**workspace 被 `rust-toolchain.toml`
锁定在 1.92.0，任何子 crate 声明的 `rust-version` 都不能高于这个锁定版本**，
新 crate 的 `rust-version` 应与 workspace 实际使用的编译器版本对齐，不是系统
里装的最新版本。

---

## 三、workspace 集成的关键原则

### 3.1 新项目必须挂进 workspace，不能独立在外

第一次尝试把新项目（`grok-gui-poc`）放在仓库**外面**，通过 `path` 依赖引用
`xai-grok-shell`，导致 `windows` crate 出现多版本冲突（`0.62.2` vs `0.61.3`）
—— 脱离 workspace 后 Cargo 单独做依赖解析，解析结果与官方 `Cargo.lock`
不一致。

**解决**：把新 crate 目录物理独立（`crates/grok-gui-poc/`），但在 workspace
根 `Cargo.toml` 的 `[workspace] members` 数组里追加一行路径，共享同一份
`Cargo.lock`，依赖统一用 `{ workspace = true }` 而不是自己指定版本号。

同样的教训后来在 `async-trait` 版本不一致（导致 trait 实现"生命周期不匹配"
的诡异报错）时再次验证：**凡是要跟官方 crate 交互的依赖，一律 `workspace = true`**。

### 3.2 物理隔离原则

所有新代码都放在独立的新目录（`crates/grok-gui-poc/`、
`crates/jike-grok-desktop/`），没有一行代码写进任何官方 crate 目录。
唯一触碰的官方文件是 workspace 根 `Cargo.toml`，且只是追加成员列表，
不改动任何已有内容。

---

## 四、ACP（Agent Client Protocol）协议 —— 经源码验证的真实格式

协议库：`agent-client-protocol v0.10.4` + `agent-client-protocol-schema v0.11.4`。

### 4.1 完整流程

1. **initialize 握手**（必须先做，否则后续报错 "initialize must be called
   before new_session"）：
   ```json
   {"jsonrpc":"2.0","id":1,"method":"initialize",
    "params":{"protocolVersion":1,"clientCapabilities":{}}}
   ```

2. **创建会话** `session/new`：
   ```json
   {"jsonrpc":"2.0","id":2,"method":"session/new",
    "params":{"cwd":"D:/path","mcpServers":[]}}
   ```
   （`mcpServers` 字段必填，可为空数组）

3. **发送消息** `session/prompt`（`prompt` 字段是 `ContentBlock` **数组**，
   不是裸字符串！）：
   ```json
   {"jsonrpc":"2.0","id":3,"method":"session/prompt",
    "params":{"sessionId":"...","prompt":[{"type":"text","text":"你好"}]}}
   ```

4. **接收流式回复** —— `session/update` 通知，`update` 字段是 tagged enum
   （`sessionUpdate` 字段区分类型），文本增量对应 `agent_message_chunk` 变体。

5. **判断结束** —— 收到 `id` 匹配的最终响应，带 `stopReason`
   （`end_turn`/`max_tokens`/`cancelled` 等）。

### 4.2 推荐用官方高层封装，不要手写 JSON-RPC

`agent-client-protocol` 提供 `ClientSideConnection`，可以直接用强类型
async 方法调用协议（`connection.initialize(...)`、`.new_session(...)`、
`.prompt(...)`），底层的 JSON-RPC 编解码、`id` 匹配、错误处理全部自动处理，
不需要手动拼字符串/手动判断 `"id":2` 这种脆弱写法（第一版手写实现时曾因为
读取时序问题，出现过 `sessionId` 解析成空字符串的 bug）。

`Client` trait 中只有两个方法**没有默认实现**，必须自己提供：
```rust
async fn request_permission(&self, args: RequestPermissionRequest) -> Result<RequestPermissionResponse>;
async fn session_notification(&self, args: SessionNotification) -> Result<()>;
```

---

## 五、GrokSession 模块设计（核心会话层）

最终封装出的 `crates/*/src/session.rs`，对外暴露业务语义清晰的接口：

```rust
pub enum SessionEvent {
    AgentTextChunk(String),        // AI 回复文本片段（流式）
    AgentThoughtChunk(String),     // AI 思考过程片段（流式）
    UserTextChunk(String),         // 用户消息回显
    TurnEnded { stop_reason: String },
    Error(String),
    Other(String),
    PermissionRequest {            // 真正的异步等待权限交互
        description: String,
        options: Vec<(String, String)>,
        respond: oneshot::Sender<String>,
    },
}

pub enum SessionStatus { Initializing, Idle, Generating, Ended }

impl GrokSession {
    pub async fn start(cwd: impl Into<String>) -> anyhow::Result<Self>;
    pub async fn send_prompt(&self, text: impl Into<String>) -> anyhow::Result<()>;
    pub async fn next_event(&mut self) -> Option<SessionEvent>;
    pub fn subscribe_status(&self) -> watch::Receiver<SessionStatus>;
    pub async fn cancel(&self) -> anyhow::Result<()>;
}
```

### 关键设计点

- **事件转发**：内部 `GuiClient` 实现 `Client` trait，把协议通知通过
  `mpsc::channel(256)`（有界，防止背压堆积内存）转发成 `SessionEvent`
- **权限交互**：用 `oneshot::channel` 实现真正的"挂起等待外部决定"，而非
  早期版本"自动同意第一个选项"的占位实现
- **借用逃逸问题**：`ClientSideConnection` 需要用 `Arc` 包裹
  （`Arc<ClientSideConnection>`），`send_prompt` 内部 `Arc::clone` 后再移入
  `spawn_local` 后台任务，否则会遇到 `E0521 borrowed data escapes` 编译错误
- **健壮性**：`send_prompt` 把 `prompt()` 放入后台任务执行，即使调用失败也
  只是发一个 `Error` 事件，不会导致主事件循环/主程序崩溃

### 单元测试

把"协议 `SessionUpdate` → 业务 `SessionEvent`"的转换逻辑抽成独立纯函数
`session_update_to_event`，配三条单元测试脱离真实连接验证映射正确性。

---

## 六、认证与模型接入

### 6.1 xAI 官方认证机制（`XAI_API_KEY`）

真实的认证判定链路：`initialize_session` 检查 `auth_method_id` 是否已设置
→ 该字段在 `initialize` 阶段根据环境变量自动计算 → 满足以下条件即可自动
成功：API Key 校验未禁用 + 偏好模式非强制 OIDC + 存在环境变量
`XAI_API_KEY`（或 `GROK_CODE_XAI_API_KEY`）。

**注意**：`XAI_API_KEY` 只解决"能不能创建会话"，不能用别家的 key 替代
（格式/鉴权对象不同，会直接被拒绝）。

### 6.2 接入 DeepSeek（绕开 xAI 账号额度限制）

**关键发现**：`AgentConfig::default()` 完全不读取任何磁盘配置文件
（内存中写死默认值），必须切换成
`AgentConfig::new_from_toml_cfg(&raw_config)`（配合
`xai_grok_shell::config::load_effective_config()`）才能让自定义模型配置生效。

**用 `GROK_HOME` 环境变量实现完全隔离的测试环境**（不碰用户真实的
`~/.grok/` 目录）：
```bash
GROK_HOME=<项目内独立目录>
DEEPSEEK_API_KEY=真实密钥
```

`config.toml`：
```toml
[models]
default = "deepseek"

[model.deepseek]
model = "deepseek-v4-flash"
base_url = "https://api.deepseek.com"
context_window = 1000000
env_key = "DEEPSEEK_API_KEY"
name = "DeepSeek V4 Flash"
system_prompt_label = "DeepSeek V4 Flash（由 xAI Grok Build 框架驱动）"
```

**参数核实教训**：最初凭印象猜测 `base_url` 带 `/v1`、模型名用
`deepseek-chat`、`context_window` 用 65536，经查阅官方文档全部有误——
`base_url` 不带 `/v1`，`deepseek-chat` 即将弃用（改用 `deepseek-v4-flash`），
`context_window` 真实值为 1M。**接入第三方服务前必须核实官方最新文档**，
不能凭记忆配置。

`system_prompt_label` 字段用于覆盖模型自我认知文案（系统提示词模板里
`{{ system_prompt_label }}` 占位符），官方设计好的正规覆盖机制，
优先级：环境变量 `GROK_SYSTEM_PROMPT_LABEL` > per-model 配置
> 全局配置 > 内置默认值（`"Grok"`）。

### 6.3 验证结果

DeepSeek V4 Flash 完整接入成功，实现了连续多轮真实对话（命令行 REPL 版本），
包含流式文本、思考过程展示、正确的模型身份认知，且验证了 agent 对真实
git 状态的完整感知能力。

---

## 七、命令行版本（REPL）

从"一次性验证脚本"升级为持续对话循环：
```
读取一行用户输入 → send_prompt() → 消费事件直到 TurnEnded/Error → 回到读下一行
```
支持 `/exit` 退出，权限请求命令行阶段自动选第一项（走真实事件+oneshot机制，
非简化跳过）。三轮连续真实对话验证通过，markdown 格式化输出正常。

---

## 八、GUI 技术选型：Tauri

### 8.1 结论

选择 Tauri（React + TypeScript 前端），而非 `egui`/`iced` 纯 Rust GUI 方案。

### 8.2 纯技术角度的理由（不预设开发者背景）

- `egui` 立即模式渲染对流式文本场景不友好
- Rust 原生 GUI 生态的富文本/Markdown 渲染能力薄弱，AI 聊天场景大量依赖
  代码高亮、Markdown 格式化，需要自造轮子
- Web 生态在这一细分场景（流式打字机效果、聊天气泡、Markdown 渲染）成熟度
  是压倒性优势，这是场景适配问题，不只是开发者技能偏好

### 8.3 架构澄清（重要）

Tauri **不是**"前端套壳调用外部终端/子进程"模式。前端 JS 通过
`invoke()`/`emit()` 与 Rust 主进程直接函数调用（进程内，无网络、无端口、
无子进程），`GrokSession` 完全不需要改动，只需在 Rust 后端把它的方法包装成
`#[tauri::command]`，事件通过 `app.emit(...)` 推送给前端。

### 8.4 环境搭建记录

- 项目命名：`jike-grok-desktop`（体现"基于 Grok Build 二次开发"但用自己
  的品牌标识）
- `cargo tauri init` 生成的 `src-tauri` 会直接落在当前目录，不会自动创建
  外层文件夹，需要手动 `mkdir` + `move` 保持与 `grok-gui-poc` 一致的目录
  组织结构
- `src-tauri/Cargo.toml` 需要统一 `edition = "2024"`（与 workspace 一致），
  依赖尽量 `workspace = true`
- `cargo tauri init` 生成的默认 `[lib] name = "app_lib"` 及 `main.rs` 里
  `app_lib::run()` 调用，若改了包名需要**同步修改两处**（crate 名连字符
  自动转下划线）
- Vite 初始化时若目录已有 `src-tauri` 子目录，需先临时
  `rename-item src-tauri src-tauri-backup`，`npm create vite` 完成后选择
  "Ignore files and continue"，再 `rename-item` 还原，避免脚手架清空已有文件
- **端口对齐坑**：`vite.config.ts` 默认监听 `localhost:5173`，需手动配置
  `server: { port: 1420, strictPort: true }` 匹配 `tauri.conf.json` 的
  `devUrl`。仍遇到 `Waiting for your frontend dev server to start` 卡死
  问题，原因是 Windows 上 `localhost` 可能解析成 IPv6 `::1` 而 Tauri 期望
  IPv4，需要 `vite.config.ts` 显式设置 `host: '127.0.0.1'`，同时
  `tauri.conf.json` 的 `devUrl` 也要改成 `http://127.0.0.1:1420`
  （两处必须统一，不能一边用 `localhost` 一边用 `127.0.0.1`）

---

## 九、通用原则（贯穿全程，持续验证有效）

1. **改造原则**：只加不改、不删除、不重构官方代码，最小化与上游同步的
   合并冲突成本
2. **协议细节必须以真实源码为准**，不采信未经验证的猜测性 JSON/参数示例
   （教训不止一次：ACP 协议格式、DeepSeek 官方参数）
3. **敏感配置一律走 `.env` + `.gitignore`**，不硬编码进源代码
4. **跟官方 crate 交互的第三方依赖，一律 `workspace = true`**，不自己指定
   版本号（`windows`、`async-trait` 两次版本冲突的教训）
5. **测试/临时环境用独立的 `GROK_HOME` 隔离**，不碰用户真实配置目录
6. **系统提示词等"认知层"配置，优先查找官方设计好的覆盖机制**
   （`system_prompt_label`），而非 hack 底层实现
7. **`rust-version` 字段要与 workspace 实际锁定的工具链版本对齐**，不是
   系统装的最新版本
8. 上游仓库不接受 PR，只能自己 fork 维护，定期 `git fetch upstream`
   手动同步

---

## 十、当前进度快照

已完成：
- ✅ 环境搭建、Windows 兼容性 bug 修复
- ✅ 内存双工管道 + ACP 协议握手验证
- ✅ `GrokSession` 模块完整封装（事件驱动、权限交互、状态跟踪、取消能力、
  单元测试）
- ✅ DeepSeek V4 Flash 完整接入，绕开 xAI 账号额度限制
- ✅ 命令行多轮对话 REPL 验证通过
- ✅ Tauri + React 项目骨架搭建，Rust 后端编译通过

进行中：
- 🔄 Tauri 开发服务器启动（`cargo tauri dev`），正在排查
  `127.0.0.1` host 配置问题，等待下一轮验证

待办：
- ⬜ 把 `GrokSession` 接入 Tauri 后端（`#[tauri::command]` 包装）
- ⬜ 前端聊天界面（消息列表、输入框、流式打字机效果、Markdown 渲染）
- ⬜ 真实权限确认弹窗（替换命令行占位逻辑）
- ⬜ `SessionStatus` 状态指示器接入前端
- ⬜（外部阻塞）xAI 账号额度问题，需自行前往
  `console.x.ai` 充值后可切回官方 Grok 模型验证
