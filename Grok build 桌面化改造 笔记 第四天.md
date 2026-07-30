# Grok Build 二次开发 —— 桌面联调与 polish（第四天）

> 承接《完整归档》与第一～三天笔记。  
> 本文记录今天完成的工作、验证结论，以及明确**不做**的事项。

---

## 一、今天的目标与结论

| 目标 | 结果 |
|------|------|
| 梳理项目架构与桌面二次开发进度 | 完成 |
| 抽出共享会话层并接入 Tauri | 完成 |
| 最小桌面聊天可用 | 完成并验收通过 |
| Markdown / cwd / 浏览器误开 | 完成并验收通过 |
| 工具调用可视化（方案 A） | **暂缓，今天不做** |

**总评：** 进程内 Agent + Tauri 桌面聊天主链路已跑通；DeepSeek 真实对话验证成功。

---

## 二、架构与进度回顾（讨论结论）

### 2.1 官方仓库是什么

- SpaceXAI **Grok Build**：Rust 实现的终端 AI 编程 Agent（TUI）。
- 核心分层：`xai-grok-pager`（UI）/ `xai-grok-shell`（运行时）/ `xai-grok-tools` / `xai-grok-workspace`。
- 官方 TUI 本身也是把 shell **当 library** 用，不是子进程套壳。

### 2.2 二次开发路线（未改）

```
React (WebView)
  ↕ Tauri invoke / emit
GrokSession 封装层
  ↕ ACP ClientSideConnection
tokio::io::duplex 内存双工
  ↕
xai_grok_shell::spawn_agent_local
```

原则：

- **物理隔离**：新代码只在自有目录，不写入官方 `codegen/*` 业务逻辑。
- **当日策略**：最小侵入官方；workspace 仅追加 members。  
  **【已更新 2026-07-29】** 好方案可改官方，见 `docs/官方代码修改原则.md`。
- 新 crate 必须进 workspace，依赖 `workspace = true`，避免 lock 分裂。

### 2.3 与「cwd 固定仓库根」的关系

- **物理隔离** = 代码放哪。
- **cwd** = agent 工作区路径。  
  二者无关；cwd 是运行时配置问题，不是模块划分错误。

---

## 三、今天落地的代码改动

### 3.1 新 crate：`crates/grok-session`

- 从 `grok-gui-poc` 抽出共享会话封装。
- API：`start` / `send_prompt` / `next_event` / `cancel` / `subscribe_status`。
- 能力：有界 mpsc(256)、权限 `oneshot`、`SessionStatus`、`TurnEnded`/`Error`。
- 配置：`load_effective_config` + `AgentConfig::new_from_toml_cfg`（支持 DeepSeek 等）。
- 单测：`session_update_to_event` 映射 3 条。
- 注释：**中文**。

### 3.2 `crates/grok-gui-poc`

- 改为依赖 `grok-session`，删除本地 `session.rs`。
- 保留 CLI 多轮 REPL，用于无 UI 对照验证。

### 3.3 `crates/jike-grok-desktop`（Tauri 真接线）

**后端：**

- 专用线程 + `current_thread` + `LocalSet`（解决 `spawn_local` / `?Send`）。
- Commands：`workspace_cwd` / `start_session` / `send_prompt` / `cancel_turn` / `respond_permission`。
- 事件：`app.emit("session-event", …)`；权限用 `request_id` + 后端 oneshot 表。

**前端：**

- 最小聊天：消息列表、流式拼接、状态点、取消、权限弹窗。
- 依赖：`@tauri-apps/api`。

### 3.4 三项 polish（验收通过）

| 项 | 实现要点 |
|----|----------|
| **Markdown** | AI 气泡：`react-markdown` + `remark-gfm` + `rehype-highlight`；用户/系统/思考仍纯文本 |
| **默认 cwd** | `workspace_cwd`：由 `CARGO_MANIFEST_DIR`（src-tauri）向上三级到 monorepo 根；可用 `GROK_DESKTOP_CWD` 覆盖；**不再**用进程 `current_dir()`（避免落在 `src-tauri`） |
| **浏览器误开** | 检测 Tauri 运行时；普通浏览器打开 `127.0.0.1:1420` 显示引导页，不调 `invoke` |

### 3.5 其它

- 新建/修改文件的注释统一为中文；后续回答与计划默认中文。
- `.gitignore` 增加 `crates/jike-grok-desktop/.env`。
- workspace `Cargo.toml` members 增加 `crates/grok-session`。

---

## 四、验证记录

### 4.1 成功（桌面 WebView）

- 状态「就绪」；系统消息会话已启动。
- 用户问「你是什么模型」→ DeepSeek V4 Flash + Grok Build 框架身份正确。
- 思考流 + AI 回复流式正常。
- polish 后：cwd 应为仓库根；Markdown 加粗/代码块应正确渲染（已确认验收没问题）。

### 4.2 已知「假失败」

- **浏览器直接打开** `http://127.0.0.1:1420` → 旧版会 `Cannot read properties of undefined (reading 'invoke')`。
- 原因：Vite 页在普通浏览器，无 Tauri 桥接。
- 正确方式：`cargo tauri dev` 弹出的**桌面窗口**。
- 现已有引导页，避免红错。

### 4.3 图片粘贴（Grok TUI 侧）

- Windows 上截图粘贴到 Grok 输入框优先用 **`Alt+V`**（`Ctrl+V` 常被终端只贴文本）。
- 或拖入图片文件 / 复制文件再粘贴。

### 4.4 编译检查（开发过程中）

```text
cargo check -p grok-session -p grok-gui-poc -p jike-grok-desktop  → Finished
cargo test -p grok-session --lib  → 3 passed
前端 tsc  → 通过
```

---

## 五、当前目录结构（二次开发相关）

```
D:\grokbuild\grok-build\
├── Cargo.toml                    # members 追加 grok-session、gui-poc、desktop
├── crates\
│   ├── codegen\ …                # 官方（原则不改业务）
│   ├── grok-session\             # 共享会话层 ★
│   ├── grok-gui-poc\             # CLI 验证
│   └── jike-grok-desktop\        # Tauri + React 桌面 ★
│       ├── src\                  # 前端
│       └── src-tauri\src\        # commands / state / lib
└── Grok build 桌面化改造 笔记 第四天.md  # 本文
```

---

## 六、明确暂缓 / 不做（今天）

| 项 | 说明 |
|----|------|
| **A. 工具调用可视化** | 已讨论方案与风险；用户决定**先不做** |
| 会话重建 / 设置页 | 仍在 backlog，未开工 |
| 大改官方 pager / tools | 不符合物理隔离原则 |

工具可视化若以后要做：在 `session_update_to_event` 映射 `ToolCall` / `ToolCallUpdate`，前端按 `tool_call_id` 合并状态；权限文案去掉整段 Debug。主要风险是 update 局部字段合并与大输出刷屏。

---

## 七、协作约定（今天达成）

- 默认**先出计划**，不直接改代码；明确说「开始 / 实现」再动手。
- 说明类问题（怎么做、有什么风险）用中文讲清楚即可。
- 注释与文档优先中文。

---

## 八、本地常用命令

```powershell
# CLI 对照
cargo run -p grok-gui-poc

# 桌面（务必用弹出的窗口，不要只用浏览器开 1420）
cd D:\grokbuild\grok-build\crates\jike-grok-desktop
cargo tauri dev

# 测试 / 检查
cargo test -p grok-session --lib
cargo check -p grok-session -p grok-gui-poc -p jike-grok-desktop
```

密钥：`crates/grok-gui-poc/.env` 或 `crates/jike-grok-desktop/.env`（已 gitignore）。  
可选：`GROK_HOME` 隔离配置；`GROK_DESKTOP_CWD` 覆盖 agent 工作区。

---

## 九、后续 backlog（未排期）

1. 工具调用卡片 + 权限可读化（A，暂缓）  
2. 新会话 / 重启会话（不必杀进程）  
3. 设置页（模型、目录、key）  
4. git 提交整理当前二次开发改动  
5. 同步更新《完整归档》里的目录结构描述（仍写 poc 内 session.rs 的部分已过时）

---

## 十、给未来自己的提醒

1. 测桌面必须用 **Tauri 窗口**，浏览器 1420 只是前端 dev server。  
2. cwd 已固定仓库根；若异常先查是否设了错误的 `GROK_DESKTOP_CWD`。  
3. 继续保持物理隔离，新功能优先落在 `grok-session` / `jike-grok-desktop`。  
4. 上游同步时关注 `spawn_agent_local` 可见性与 ACP 版本。
