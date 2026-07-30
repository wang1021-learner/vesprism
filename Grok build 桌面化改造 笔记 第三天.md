# Grok Build 二次开发 —— 认证打通 + 架构升级为 GrokSession 模块（第三天）

> 承接《Grok build桌面化改造笔记第二天.md》上半场（GUI crate 骨架搭建、
> 内存双工管道验证成功、卡在 `Authentication required`）。
> 本文档记录：认证问题解决 + 从手写 JSON-RPC 升级为官方类型安全接口 + 封装 GrokSession 模块。

---

## 一、认证问题排查与解决

### 1.1 排查过程

通过源码搜索，确认了完整的认证判定链路：

1. **真正拦截我们的检查**位于 `agent_ops.rs` 的 `initialize_session` 函数：
   ```rust
   if self.auth_method_id.load().is_none() {
       return Err(acp::Error::auth_required().data("no auth method id provided"));
   }
   ```
   这是检查一个共享状态 `auth_method_id`——一个"被选中的认证方式标识"，
   不是直接检查有没有 API key。

2. **该字段的写入逻辑**在 `acp_agent.rs`，写入函数：
   ```rust
   pub(super) fn set_auth_method(&self, id: acp::AuthMethodId) {
       self.auth_method_id.store(Some(std::sync::Arc::new(id)));
   }
   ```
   有两条路径能触发写入：
   - **自动计算**（`initialize` 阶段）：根据环境变量/配置文件自动判断默认认证方式
   - **手动认证**：客户端显式调用 `authenticate` 方法

3. **自动计算成功的条件**（来自 `auth_method.rs` 的 `build_auth_methods`）：
   - API Key 校验未被禁用
   - 偏好认证模式不是强制 `Oidc`
   - 存在物理凭证：**环境变量 `XAI_API_KEY`（或旧版 `GROK_CODE_XAI_API_KEY`）**，
     或 `config.toml` 里某个模型声明了自己的 key

4. **真实的环境变量读取函数**（`auth_method.rs`）：
   ```rust
   pub fn read_xai_api_key_env() -> Result<String, std::env::VarError> {
       std::env::var(XAI_API_KEY_ENV_VAR).or_else(|_| std::env::var(LEGACY_XAI_API_KEY_ENV_VAR))
   }
   ```

### 1.2 结论：能否用 DeepSeek 的 key 代替？

**不行。** `XAI_API_KEY` 这个环境变量最终会被用去请求 xAI 官方 API 端点做鉴权，
格式和内容对不上会直接被拒绝。这一步认证只解决"能不能创建会话"，
跟"最终调用哪个模型"是完全不同的两层问题——想换模型，需要另外研究
`config.toml` 里 `models` 列表的 `base_url` 配置方式（尚未研究）。

### 1.3 实施方案：.env 本地配置文件（不硬编码进代码）

**记忆点（后续默认遵循）**：本项目中任何密钥/敏感配置，一律走
`.env` 文件 + `dotenvy` 读取 + `.gitignore` 排除的方式，不直接硬编码进源代码。

具体配置：

1. 新建 `D:\grokbuild\grok-build\crates\grok-gui-poc\.env`：
   ```
   XAI_API_KEY=真实的API密钥
   ```

2. `D:\grokbuild\grok-build\.gitignore` 追加：
   ```
   crates/grok-gui-poc/.env
   ```

3. `Cargo.toml` 追加依赖（不走 workspace 统一管理，单独声明版本）：
   ```toml
   dotenvy = "0.15"
   ```

4. 代码里加载（**注意**：必须用 `from_path` 指定路径，不能用裸 `dotenv()`——
   因为 `cargo run` 的工作目录是 workspace 根目录，`.env` 却放在子目录
   `crates/grok-gui-poc/` 下，`dotenvy` 默认只会向上（父目录）查找，
   找不到子目录里的文件）：
   ```rust
   dotenvy::from_path("crates/grok-gui-poc/.env").ok();
   ```

### 1.4 验证结果：认证成功，但账号本身无额度

设置好 `XAI_API_KEY` 后：
```json
"defaultAuthMethodId":"xai.api_key"   // 之前是 null
```
`session/new` 成功拿到 `sessionId`，`session/prompt` 也成功发出、被 agent 正确处理，
一路走到真正调用 `https://api.x.ai/v1/responses` 这一步，但收到：
```
API error (status 403 Forbidden): permission-denied: 
Your newly created team doesn't have any credits or licenses yet.
```

**这证明协议链路 100% 完全打通**，唯一卡住的是账号层面（团队没有购买额度/许可证），
需要去 `https://console.x.ai/team/xxx` 充值后才能看到真正的文字回复。
**这不是代码问题，暂不继续排查，等账号充值后重新验证即可。**

---

## 二、架构升级：从手写 JSON-RPC 到官方类型安全接口

### 2.1 升级动机

第一版最小闭环是手动拼 `serde_json::json!` 构造请求、手动读一行一行文本、
手动用字符串匹配判断 `"id":2` 来确认响应——这种写法脆弱且容易出错
（第二天上半场就因为读取时序问题，出现过 `sessionId` 解析成空字符串的 bug）。

调查发现，官方 `agent-client-protocol` crate 已经提供了完整的高层封装：
`ClientSideConnection`，可以直接以强类型 async 方法调用协议（`initialize()`、
`new_session()`、`prompt()`），不需要手写任何 JSON-RPC 编解码逻辑。

### 2.2 关键调查结果：`Client` trait 的必需方法

`agent-client-protocol` 的 `Client` trait 中，只有两个方法**没有默认实现**，
必须自己提供：

```rust
async fn request_permission(&self, args: RequestPermissionRequest) -> Result<RequestPermissionResponse>;
async fn session_notification(&self, args: SessionNotification) -> Result<()>;
```

其余方法（读写文件、终端操作等）均有默认实现（默认返回 `method_not_found`），
当前阶段不需要处理。

### 2.3 遇到的编译问题与修复

**问题 1**：`async-trait` 依赖版本不一致，导致
`error[E0195]: lifetime parameters or bounds ... do not match the trait declaration`。

修复：不要自己指定版本号，改用 workspace 统一版本：
```toml
async-trait = { workspace = true }
```
（这是延续第一次遇到 `windows` crate 版本冲突时学到的教训——
凡是要跟官方 crate 交互的依赖，一律用 `workspace = true`，不要自己指定版本。）

**问题 2**：`ProtocolVersion` 构造方式写错（瞎猜了个 `agent_client_protocol::VERSION`，
不存在）。

真实定义（来自 `agent-client-protocol-schema` 的 `version.rs`）：
```rust
pub struct ProtocolVersion(u16);
impl ProtocolVersion {
    pub const V0: Self = Self(0);
    pub const V1: Self = Self(1);
    pub const LATEST: Self = Self::V1;
}
```
正确写法：`ProtocolVersion::LATEST`。

### 2.4 最终架构：`GrokSession` 模块封装

新建 `crates/grok-gui-poc/src/session.rs`，把协议细节完全封装起来，
对外只暴露业务语义的接口：

```
┌─────────────────────────────────┐
│  main.rs（未来会被 GUI 代码取代） │
│  只需要：                        │
│  - GrokSession::start(cwd)       │
│  - session.send_prompt(text)     │
│  - session.next_event()          │
└──────────────┬────────────────────┘
               │
┌──────────────▼────────────────────┐
│  session.rs                        │
│  - GrokSession（对外句柄）          │
│  - SessionEvent（强类型事件枚举）    │
│  - GuiClient（内部 Client trait 实现）│
│    把协议通知转发进 mpsc channel     │
└──────────────┬────────────────────┘
               │
┌──────────────▼────────────────────┐
│  agent_client_protocol::           │
│    ClientSideConnection            │
│  （官方提供，负责 JSON-RPC 编解码）  │
└──────────────┬────────────────────┘
               │ tokio::io::duplex 内存管道
┌──────────────▼────────────────────┐
│  xai_grok_shell::spawn_agent_local │
│  （官方 agent 运行时，未改动逻辑）   │
└─────────────────────────────────┘
```

### 2.5 核心设计：事件转发（回调 → channel → 消费者）

`GuiClient` 实现 `Client::session_notification`，把协议层的 `SessionUpdate` 枚举
翻译成业务语义更清晰的 `SessionEvent`，通过 `mpsc::UnboundedSender` 发送出去：

```rust
#[derive(Debug)]
pub enum SessionEvent {
    AgentTextChunk(String),      // AI 回复的文本片段（流式）
    AgentThoughtChunk(String),   // AI 内部推理片段（流式）
    UserTextChunk(String),       // 用户消息回显
    TurnEnded,                   // 本轮对话结束（当前尚未在任何地方触发，见下方 TODO）
    Other(String),               // 未特别处理的通知，原样透出用于调试
}
```

`GrokSession::next_event()` 则是 `event_rx.recv().await` 的简单包装——
GUI 代码未来只需要 `while let Some(event) = session.next_event().await { match event { ... } }`
就能拿到结构化的、语义清晰的事件流，完全不需要接触任何 ACP 协议细节。

### 2.6 踩过的坑：借用逃逸（E0521）

**问题**：`send_prompt(&self, ...)` 内部把 `self.connection.prompt(...)` 这个 future
丢进 `tokio::task::spawn_local`（要求 `'static` 生命周期）去后台跑，但这个 future
借用了 `&self`，编译器报错"borrowed data escapes outside of method"。

**原因**：`&self` 只在方法调用期间有效，而后台任务的生命周期要求独立于调用者。

**修复**：把 `ClientSideConnection` 用 `Arc` 包起来（`Arc<ClientSideConnection>`），
`send_prompt` 内部 `Arc::clone(&self.connection)` 拿到一份独立所有权的克隆，
再移动进 `spawn_local` 的异步块——`Arc::clone` 只是增加引用计数，代价很低。

### 2.7 设计上的收益：健壮性提升

升级后一个意外的好处：`send_prompt` 把 `prompt()` 调用放进后台 `spawn_local` 任务，
即使这次调用因为 403 报错失败，也只是在后台任务里 `eprintln!` 打印错误，
**不会导致主事件循环/主程序崩溃退出**——跟第一版直接 `.await?` 导致整个程序退出
相比，健壮性明显提升，这对未来长时间运行的 GUI 应用来说是必需的特性。

---

## 三、最终验证结果

```
--- 会话已就绪
[其他] AvailableCommandsUpdate(...)          ← 强类型枚举的 Debug 输出，
[其他] AvailableCommandsUpdate(...)             不再是原始 JSON 字符串
[用户] 你好，请用一句话介绍一下你自己           ← UserTextChunk 事件正确转发
prompt error: Error { code: -32603, ... 403 ...}  ← 错误被优雅捕获，主循环未崩溃
```

确认：
1. ✅ `GrokSession::start()` 完整走完 initialize + session/new
2. ✅ 通知正确从协议层 → `GuiClient` 回调 → mpsc channel → `main.rs` 事件循环，全链路打通
3. ✅ 错误处理健壮，不会导致程序崩溃
4. ⚠️ 仍卡在账号额度问题（跟代码无关）

---

## 四、当前完整文件结构

```
D:\grokbuild\grok-build\
├── Cargo.toml                        （改动：members 追加一行 "crates/grok-gui-poc"）
├── .gitignore                        （改动：追加 "crates/grok-gui-poc/.env"）
└── crates\
    └── grok-gui-poc\                 （全新独立模块，物理隔离于官方代码）
        ├── Cargo.toml
        ├── .env                      （XAI_API_KEY，已被 .gitignore 排除）
        └── src\
            ├── main.rs                （精简版：启动会话→发消息→事件循环）
            └── session.rs             （GrokSession 封装：核心业务逻辑）
```

官方代码唯一改动（沿用第一天）：
```rust
// crates/codegen/xai-grok-shell/src/agent/app.rs 第 191 行
pub fn spawn_agent_local(...)   // 仅加了 pub 关键字
```

---

## 五、后续任务规划（更新）

1. ⬜ **（外部阻塞）** 等 xAI 账号充值/开通额度后，重新运行验证真正的文字流式回复
2. ⬜ 补全 `SessionEvent::TurnEnded` 的触发逻辑——目前 `prompt()` 返回的 `PromptResponse`
   （包含 `stop_reason`）没有被转发成事件，`send_prompt` 内部的后台任务收到
   `prompt()` 的返回结果后，应该额外发一个 `TurnEnded` 事件到 channel
3. ⬜ 处理 `request_permission` 的真实交互——目前是"自动同意第一个选项"的占位实现，
   GUI 阶段需要改成：发一个 `SessionEvent::PermissionRequest(...)` 事件，
   `GrokSession` 提供一个 `respond_permission(...)` 方法，等待 GUI 侧用户点击后再调用
4. ⬜ 研究 `config.toml` 里 `models` 列表的配置方式，实现切换到其他模型
   （如 DeepSeek）的能力——这是与认证完全独立的另一层配置
5. ⬜ GUI 技术选型讨论（`egui`/`iced` 原生 GUI，或 Tauri + React/Vue 前端）——
   目前 `GrokSession` 提供的接口形态（`start`/`send_prompt`/`next_event`）
   对两种技术路线都友好，可以等后续再决定
6. ⬜ 环境维护：确认 Windows Defender 实时防护当前状态，
   优先切换为进程级排除而非完全关闭

---

## 六、给未来自己的提醒（累积）

- **改造原则（当日）**：只加不改、不删除、不重构官方代码，降低合入冲突  
  **【已更新 2026-07-29】** → 好方案可改官方，见 `docs/官方代码修改原则.md`
- **协议细节必须以真实源码为准**，不采信未经验证的猜测性 JSON 示例
- **敏感配置一律走 `.env` + `.gitignore`**，不硬编码进源代码
- **跟官方 crate 交互的第三方依赖，一律用 `workspace = true`**，不要自己指定版本号，
  避免出现类似 `windows`/`async-trait` 版本冲突导致的诡异编译错误
- 上游仓库不接受 PR，只能自己 fork 维护，定期 `git fetch upstream` 手动同步