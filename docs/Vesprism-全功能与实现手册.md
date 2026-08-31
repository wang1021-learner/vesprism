# Vesprism 全功能与实现手册

> **写给接手的 AI / 工程师。** 读完应能改功能、追 bug、判断该动哪一层，而不是再扫一遍仓库。  
> **对照日期：** 2026-08-31  
> **官方壳：** Grok Build **1.0.12**（`SOURCE_REV` `d5a0335a`，同步说明见 `docs/官方同步-1.0.12合并说明.md`）  
> **代码根：** 本仓库 `grok-build/`（fork 自 `xai-org/grok-build`，本地产品在 `crates/vesprism-desktop`）  
> **产品名：** Vesprism（`package.json` `productName`、`tauri.conf.json` `identifier: com.vesprism.desktop`）  
> **用户数据：** `~/.vesprism`（环境变量 `GROK_HOME`；与 CLI `grok` 的 `~/.grok` 隔离）

**以本文 + 源码为准。**

---

## 0. 30 秒定位

这是 **Grok Build 官方 agent 运行时** 外包一层 **Tauri 2 桌面工作台**：

| 层 | 是什么 | 改不改 |
|----|--------|--------|
| 官方引擎 | `crates/codegen/xai-grok-shell` 等 `xai-grok-*` | 能改，但先查有没有现成 ACP / `x.ai/*` 扩展；原则见 `docs/官方代码修改原则.md` |
| 会话桥 | `crates/grok-session` | 自建。把官方 agent 包进进程内 ACP 双工，给桌面用 |
| 桌面壳 | `crates/vesprism-desktop` | 自建。UI、Tab、工作台（流程画布 / Agent 编制）、侧栏、设置 |

**不要**再写一套 agent 循环、工具执行器、工作流引擎。对话、斜杠、Rhai workflow、MCP、子 agent、排队、插话、Rewind、Fork 都走官方。桌面只做：IPC、状态投影、UI、以及工作台资产（画布 JSON → 官方 sidecar）。

远程：

- `origin` = `wang1021-learner/grokbuild`（日常推送）
- `upstream` = `xai-org/grok-build`（定期 merge）

---

## 1. 技术栈

### 1.1 桌面前端（`crates/vesprism-desktop`）

| 用途 | 库 | 备注 |
|------|-----|------|
| UI | React 19 + TypeScript | 入口 `src/main.tsx` |
| 打包 | Vite 8，端口 **9527** | 仅浏览器打开会显示 `BrowserNotDesktopGate` |
| 桌面桥 | `@tauri-apps/api` 2.11 + `plugin-dialog` | 全部 `invoke` 集中在 `src/bridge.ts` |
| 状态 | **nanostores** + `@nanostores/react` | **TabState map 是事实源**；活跃 Tab 投影到 `$messages` 等全局 atom |
| 聊天虚拟列表 | `@tanstack/react-virtual` + `use-stick-to-bottom` | `MessageList.tsx` |
| Markdown | Streamdown + `@streamdown/code|math|mermaid` + KaTeX | `AssistantMarkdown.tsx` |
| 流程图 | `@xyflow/react` 12 | 仅流程画布 |
| 终端 | `@xterm/xterm` + `addon-fit` | `SessionTermDock` / `pty.rs` |
| 图标 | `@tabler/icons-react` | |
| 测试 | Vitest | `npm test`；另有 `scripts/verify.mjs` |
| 样式 | 自写 CSS（`src/styles/*.css` + `workbench/flow-canvas.css`） | Tailwind 在依赖里，主界面主要不是 Tailwind 组件库 |

### 1.2 桌面后端（同 crate 的 `src-tauri`）

| 用途 | 库 |
|------|-----|
| 壳 | Tauri 2.11，`decorations: true` |
| 异步 | tokio |
| 会话 | `grok-session`（workspace） |
| 引擎 | `xai-grok-shell`（workspace，**进程内** spawn，不是另起 grok 子进程） |
| 索引 | `rusqlite` bundled → `$GROK_HOME/sessions/threads.sqlite` |
| 配置 | `toml` + `~/.vesprism/config.toml` |
| PTY | `portable-pty` |
| 沙箱 worktree | `xai-fast-worktree` |

### 1.3 官方运行时（不要重造）

| Crate | 职责 |
|-------|------|
| `xai-grok-shell` | Agent 循环、ACP server、session/new、prompt、工具、workflow |
| `xai-grok-tools` | 文件/终端/搜索等工具实现 |
| `xai-grok-workspace` | 工作区、VCS、checkpoint |
| `xai-workflow` | Rhai 工作流解释 |
| `xai-grok-mcp` | MCP 客户端 |
| `xai-grok-config` | `config.toml`、模型、hooks |
| `xai-prompt-queue` | 官方排队 |
| `xai-interjection-core` | 插话（`x.ai/interject`） |

ACP 是 Agent Client Protocol。桌面通过 `grok-session` 当 **ACP Client**，官方 shell 当 **ACP Agent**。扩展方法形如 `x.ai/mcp/list`、`x.ai/interject`、`x.ai/rewind/*`、`x.ai/session/update_flows`。

### 1.4 启动

```bash
cd crates/vesprism-desktop
npm run desktop          # cargo tauri dev（先 vite :9527）
npm run desktop:build    # 安装包
npm run typecheck && npm test
```

密钥与模型：`~/.vesprism/config.toml` + `~/.vesprism/.env`。**禁止**把 API key 写进仓库。设置里加模型（如 LongCat）与改 `config.toml` 等价；改完需**重启进程**才会被引擎读到。

---

## 2. 进程与会话架构

```
┌─ Vesprism 窗口 (WebView) ─────────────────────────────────┐
│  React：Sidebar / TabBar / AppMainBody / Composer / 画布     │
│  store.ts：tabStates Map  +  活跃 Tab 投影 atom              │
│  bridge.ts  invoke(tabId, ...)                               │
└──────────────────────────────┬──────────────────────────────┘
                               │ Tauri IPC
┌──────────────────────────────▼──────────────────────────────┐
│  vesprism-desktop src-tauri                                  │
│  Supervisor 线程：每 Tab 一个 Actor（独立 LocalSet）          │
│  commands.rs / workbench/{flows,agents,bindings}.rs          │
│  session_index.rs（SQLite 侧栏）                              │
└──────────────────────────────┬──────────────────────────────┘
                               │ grok-session ACP duplex
┌──────────────────────────────▼──────────────────────────────┐
│  GrokSession：ACP ClientSideConnection                       │
│  spawn_agent_local(xai-grok-shell)                           │
│  session/new · prompt · cancel · 扩展方法                     │
└─────────────────────────────────────────────────────────────┘
```

要点：

1. **多 Tab = 多会话。** `open_tab` 向 Supervisor 要一个 Actor；`start_session(tabId, cwd, {modelId, reasoningEffort})` 对该 Actor `session/new`。
2. 事件带 `tab_id`。`handleSessionEvent`（`src/lib/sessionEvents.ts`）写入**对应 Tab 的 map**，即使该 Tab 不在前台。只有活跃 Tab 会投影到 `$messages`。
3. 崩溃重建：官方 `tab_recovering` → `replayTabAfterCrash`，按 map 里该 Tab 的 sessionId/model 重放。
4. `GROK_HOME` 在 `src-tauri/src/lib.rs` **任何 grok_home() 之前** 设为 `~/.vesprism`。旧目录 `~/.jike-grok-desktop` 会一次性改名过来。

---

## 3. 前端状态模型（改 UI 必读）

文件：`src/store.ts`。

**事实源**是 `tabStates: Map<tabId, TabState>`。全局 atom（`$messages`、`$composerInput`、`$generating`、`$permission`、`$workspaceCwd`、`$defaultModelId`、`$utilityKind`…）只是**当前活跃 Tab 的投影**。

`patchTab(id, patch)`：写 map；若 `id === $activeTabId` 再 `projectPatch`。  
`patchActiveTab` = 对活跃 Tab 的快捷方式。  
`switchTab`：切投影；会回收空白闲置 Tab。

`TabState` 关键字段：

| 字段 | 含义 |
|------|------|
| `sessionId` | 引擎会话 id |
| `chatId` | 侧栏历史 id（常与 sessionId 相同；空白新对话可空） |
| `messages` | 展示用消息（user/assistant/thought/tool） |
| `status` | `idle` / `generating` / … |
| `phase` | 壳层 `idle` / `ready` / `loading` / `booting` / `failed` |
| `composerInput` | 输入草稿 |
| `cwd` | **本 Tab 工作区**。`tabWorkspaceCwd()` 只认这个，不借别的 Tab |
| `modelId` / `reasoningEffort` | 本 Tab 模型 |
| `utilityKind` | 见下一节；`null` = 普通对话 |
| `queuedPrompts` | 官方队列的乐观+服务器合并 |
| `permission` / `userQuestion` / `subagents` | 审批、问卷、子 agent |
| `sandboxCwd` / `goal` / `workflows` / `terminals` | 沙箱、Goal、workflow 进度、PTY |

**工作区规则：** 新 Tab 用 `resolveNewTabCwd()` = 当前 Tab 绝对 cwd → `$preferredWorkspaceCwd` → 兜底。画布 Tab 一旦有绝对 cwd，**不再被主聊天换仓拖走**（`openChatTab` 注释写明）。

`UtilityKind`：

```
'mcp' | 'skills' | 'tools' | 'workflows' | 'flow-canvas' | 'flow-run' | 'agents' | null
```

`AppMainBody`（`App.tsx`）按 kind 切换整页。`flow-canvas` 时**不挂载**主界面 `AppComposer`，避免两个输入框写同一份草稿。

同 kind 只保留一个 Tab：`openChatTab` → `findTabByUtilityKind` → `switchTab`。

---

## 4. 功能总表

下面每一节都是「用户能做什么 → 怎么实现 → 改哪里」。

---

## 5. 主聊天（普通对话）

### 5.1 用户能做什么

多行输入、附件（文件/文件夹）、`@` 引用路径、斜杠命令（`/goal` `/sandbox` 以及技能/工作流名）、Enter 发送、生成中 Enter 排队、Ctrl+Enter 插话、停、切模型与思考强度、切工作区（空白会话才能切）。

### 5.2 实现

| 步骤 | 文件 |
|------|------|
| UI | `src/components/Composer.tsx` |
| `@` / 斜杠补全 | `ComposerAssist.tsx` |
| 发送 | `src/lib/sendSessionPrompt.ts` → `sendPrompt` / `interjectPrompt` |
| 乐观气泡 | 先往 `messages` 塞 user 行（带 `promptId`），再 IPC |
| 排队 | 生成中且非 interject：写入 `queuedPrompts`，仍 `sendPrompt`；官方 `queue_changed` 对齐 |
| 插话 | `x.ai/interject`（`commands.rs` `interject_prompt`） |
| 停止 | `src/lib/cancelActiveTurn.ts`：先 deny 挂起审批，再 `cancel_turn`，乐观 idle |
| 事件→气泡 | `sessionEvents.ts` → `sessionTranscript.ts` `applyTranscriptEvent` |
| 渲染 | `MessageList.tsx` + `MessageItem.tsx` + Streamdown |

`sendSessionPrompt` 参数：

- `text`：用户看见的原文（气泡/队列）
- `wireText`：真正发给引擎的字符串（画布会把说明书包进去；主聊天不传则等于 text）
- `hidden`：自愈用，不进气泡
- `promptId`：预发 id，画布认图要赶在 IPC 返回前挂上

流式：引擎 ReplayBuffer 合帧；前端 **不再 rAF 二次合帧**。跟滚只允许 `use-stick-to-bottom` 写 `scrollTop`。

Markdown：`AssistantMarkdown.tsx` 增量解析；工具卡里的 diff 不在会话里展开全文，只摘要 `+N −M`，详情在右栏。

### 5.3 权限审批

`Permission.tsx`：

- 主路径：挂在「发起审批的工具行」下方
- 兜底：`PendingApprovalFallback` 浮在输入框上（`force` 时画布工作栏没有工具行也弹）
- 按钮：运行 once / 本次会话允许 / 总是允许（确认）/ 拒绝
- 记忆：`permissionMemory.ts`（session 按 tab，always 在 localStorage）
- 子 agent：`grok-session` 里 `session_id ≠ 父会话` 的权限请求自动 AllowOnce，不弹父窗口

### 5.4 AI 问卷

官方 `ask_user_question`。前端 `UserQuestion.tsx` + `respond_user_question`。工具卡与浮层两处都能答。

### 5.5 子 Agent

引擎 spawn 子会话。父会话消息流里有 scaffold 行；点开 `openSubagentTab.ts` attach 子 Tab。  
`session_notification` 按 `session_id` 过滤，子内容不混进父气泡。  
启动对账：`list_running_subagents`（`x.ai/subagent/list_running`）。  
官方已有工具 `send_subagent_message`（父会话给仍在跑的子 agent 发跟进）。模型可直接调；桌面不必再写一条 IPC。

### 5.6 Goal / Workflow 进度 / 沙箱条

- `GoalStrip.tsx` ← 官方 `GoalUpdated`
- `$workflows` ← `workflow_updated`（`prompt_id` 以 `workflow-completed-` 开头的唤醒消息不展示）
- `SandboxBanner.tsx` + `sandbox.rs`：隔离 worktree；`enable_tab_sandbox` / `sync_sandbox_to_origin`

### 5.7 Rewind / Fork

已接 UI：`RewindPicker.tsx`，IPC `get_rewind_points` / `execute_rewind`（官方 `x.ai/rewind/*`）。  
Fork：`forkSession.ts` → `x.ai/session/fork`。

---

## 6. 侧栏会话记录（隔离规则）

文件：`src/components/Sidebar.tsx`、`src-tauri/src/session_index.rs`。

### 6.1 三组

| 分组 | 数据源 | 点进去 |
|------|--------|--------|
| **工作台** | `list_workbench_sessions` = `threads` ∩ `thread_workbench_artifacts` | `openWorkbenchHistory.ts`：切到画布/编制 Tab，`loadSession` + `getSessionMessages` + `requestFlowFocus` |
| **闲聊** | `list_sessions` 且 cwd 是 scratch | 普通对话 |
| **项目 cwd** | 同上，按仓库名分组 | 普通对话 |

主列表 SQL：

```sql
WHERE id NOT IN (SELECT id FROM thread_tool_sessions)
```

### 6.2 工具会话怎么标上

`session_id_changed` 且该 Tab 有 `utilityKind` → `markToolSession(sessionId)` → 表 `thread_tool_sessions`。  
因此**流程画布 / Agent 编制的会话不进普通历史**。

有产物（保存过 Flow / Agent）才进「工作台」：`bind_workbench_artifact`。

未绑定产物的画布会话：主列表没有、工作台也没有，只活在当前 Tab。这是设计，不是丢失。

启动时 `mark_legacy_canvas_sessions()` 把旧标题像「生成流程图：」的脏数据补标成工具会话。

### 6.3 标题

`src/lib/sessionTitle.ts` + Rust `clean_session_title`：取最内层 `<user_query>`，剥 `<instructions>` / `<current_graph>`。画布首轮说明书不会变成侧栏标题。

`title_changed`：技能/工具等面板标题固定；**画布和编制允许清洗后的 title_changed**。

### 6.4 搜索

`search_sessions` 走官方 FTS。过滤：非工具会话全可搜；工具会话只有绑过产物的进结果，点开走工作台。

---

## 7. 专用面板（非画布）

侧栏「技能 / 工具 / MCP / 自动化任务」→ `openChatTab({ utilityKind })`。

| kind | 面板 | 官方 API | 行为 |
|------|------|----------|------|
| `mcp` | `McpPanel.tsx` | `x.ai/mcp/list\|toggle\|upsert\|delete` | 可视化加 stdio/HTTP |
| `tools` | `ToolsPanel.tsx` | `x.ai/commands/list` | 浏览不执行 |
| `skills` | `SkillsPanel.tsx` | commands/list（cwd 扫描） | 「使用」填 `/name` 回普通对话 |
| `workflows` | `WorkflowsPanel.tsx` | `x.ai/workflows/list` | 浏览 `.grok/workflows/*.rhai`；执行仍走斜杠 |

这些面板会 `startSession`（需要 cwd）。`flow-run` 例外，见 §10。

---

## 8. 右栏 / 命令面板 / 设置 / 终端

### 8.1 右栏

`src/components/RightPanel/index.tsx`：文件树、源码、工作区 diff。  
`file_working_diff(path)` = 磁盘 vs `git show HEAD`。渲染共用 `DiffLines.tsx`（块级 +/-，非 LCS）。

### 8.2 命令面板

`CommandPalette/`：`cmdk`。搜会话、动作、切 Tab。

### 8.3 设置

`Settings.tsx` + `EngineSettings.tsx` + `HooksSettings.tsx`。  
模型：`get_model_settings` / `save_model_settings` / `reload_models`。  
引擎偏好：`engine_prefs.rs`。  
密钥：`save_env_key` 写 `~/.vesprism/.env`，harden 权限。

模型是 `config.toml` 里的列表，不是改桌面映射表。用户在设置里加 LongCat（`base_url` + `chat_completions` + `/openai/v1`）即可。**不要**为接模型去改 `resolveEngineModelId` 之类的硬编码（曾经加过又撤回）。

系统提示词模板官方是 `You are ${system_prompt_label} released by xAI`，所以第三方模型也会自称 xAI，这是模板不是事实。

### 8.4 组装单 Composition

`CompositionPanel.tsx`：会话级模型/工具停用/权限/挂载流程。IPC `get/save/apply_composition`。与工作台 Agent 资产不是同一套（见 §11）。

### 8.5 终端 Dock

`SessionTermDock.tsx` + `pty.rs`：`start_pty` / `pty_write` / `pty_resize` / `stop_pty`。ACP 也有 CreateTerminal。`$terminals` 投影。

---

## 9. 流程画布（第二主聊天 + 拓扑）

这是相对官方 Grok Build **最大的自建产品**。定位：和主界面同一套聊天能力（附件、@、多行、排队、插话、切模型），额外要求模型输出 **FlowGraph / FlowPatch JSON**，画到 React Flow 上；发布成官方 Rhai sidecar，试跑走斜杠 `/{flowId}`。

### 9.1 入口与 Tab

侧栏「流程画布」→ `openChatTab({ utilityKind: 'flow-canvas' })`。  
页面：`src/workbench/canvas/index.tsx`（`FlowCanvas`，lazy）。  
CSS：`src/workbench/flow-canvas.css`。

布局（从左到右）：

1. 节点库（拖拽/点击添加）
2. 画布舞台（React Flow）
3. 右侧工作栏：运行状态 + 对话协同（**没有输入框**）
4. 输入框：React Flow `<Panel position="bottom-center">` 里的 `CanvasComposer`

顶栏：`FlowToolbar.tsx`（保存/发布/试跑/导入导出/工作栏开关）。  
选中节点：`NodeInspector.tsx`（绝对定位在画布左下，抬到输入框上方）。

### 9.2 数据模型

`src/workbench/flow/types.ts`

节点类型：`start | agent | tool | flow | branch | parallel | join | end`。  
草稿 `FlowDraft`：**含坐标**。  
发布包：**不含坐标**，只有官方两文件。

磁盘：

| 路径 | 内容 |
|------|------|
| `~/.vesprism/flow-drafts/<id>.json` | 草稿（坐标、dirty） |
| `$GROK_HOME/workflows/<id>.rhai` | 官方工作流脚本 |
| `$GROK_HOME/workflows/<id>.flow.yaml` | id/name/schema/version |
| 旧 `~/.vesprism/flows/<id>/` | 只读回退，不再写入 |

IPC：`src/workbench/bridge.ts` → `workbench/flows.rs`（`save_flow` / `list_flows` / `export_flow` zip 等）。

`ephemeral: true`：试跑子图只写 sidecar，不落草稿、不进流程列表（`purge_rerun_sidecars`）。

### 9.3 画布聊天（务必与主聊天对齐的部分）

`CanvasComposer.tsx`：

- 同一套 `Composer`，`enableSlash={false}`（避免和试跑 `/{id}` 撞车）
- `showWorkspace={false}`（不要「闲聊」芯片；工作区只读）
- `canSwitchWorkspace={false}`，`onSelectWorkspace` 空函数
- 发送：`sendSessionPrompt({ text, wireText: buildDialoguePrompt(...), promptId })`
- 审批：`PendingApprovalFallback force`
- `memo`，避免拖节点时跟着 React Flow 重绘

`wireText` 才带编排说明书；气泡只显示用户原话。`visibleMessages.ts` 再剥一层给工作栏对话列表（说明书、纯 JSON、斜杠试跑、自愈 prompt 不可见）。

### 9.4 编排契约（Prompt Engineering）

`src/workbench/flow/prompt.ts`

- `FLOW_GENERATE_SYSTEM`：**英文 TS schema**（`FlowGraph` / `FlowPatch`），标签语言跟随用户。
- **每个 session 只在首轮**下发完整契约（`isCanvasContractPrimed` / `markCanvasContractPrimed`）。
- 后续轮：XML `<instructions>` + `<current_graph>` + `<user_query>` + `Current Topology: id1  id2 …`
- 语义 kebab-case id；禁止随机后缀；DAG、无孤儿、start 能到 end。
- 局部改用 `FlowPatch`（`update_nodes` 浅合并，保留坐标）。
- 非法 JSON：静默 1-shot `buildHealPrompt`（`hidden: true`），工作栏不显示。
- 严格重试按钮：`FLOW_RETRY_STRICT`。

解析：`schema.ts` `parseCanvasModelOutput` / `extractJsonObject`（围栏 + 括号平衡）。`validateFlowGraph` 走全 children 查 DAG/孤儿/end-reach。

落图：`graph.ts` `applyFlowPatch`、`draftFromGraph`。新节点会 `flashDiff` 高亮。

### 9.5 认图状态机（最容易改坏）

模块级（**不是 React state**）：`src/workbench/generateWait.ts`

```
expectCanvasGraph(promptId)   // 发送前
isPendingCanvasGraph(pid)
consumeCanvasGraph(pid)       // 应用或放弃后
inheritCanvasPromptId()       // 助手气泡没带 pid 时继承
resetCanvasGraphWait()        // 卸载画布、开始试跑
```

`applyCanvasOutput.ts`：

- `pickCanvasApplyTargets`：只认**当前 pending pid** 的最后一条助手；**跳过**用户文本匹配 `isFlowRunUserText`（`/^\/[A-Za-z][\w-]*(?:\s|\{|$)/`）的试跑回合。
- `decideCanvasApply`：JSON 合法 → `apply`（生成中也可以，边出边画）；未闭合且 generating → `wait`；看起来像图但非法且已结束 → `heal`；否则 `drop`。

`CanvasGraphApplier.tsx`：**单独订阅** `$messages`/`$generating`，不要让 React Flow 每 token 重绘。应用后 `consumeCanvasGraph`。

`sessionTranscript` 给 assistant 盖 `promptId`：`ev.prompt_id || inheritCanvasPromptId(lastUserPromptId)`。历史上「她说画了但没图」就是 assistant 没 pid、认图跳过。

**禁止：** 用会话里第一份旧 JSON 去满足新的 expect（质检图盖外呼就是这样修的）。

### 9.6 性能（拖拽/滚轮）

- `selectionOnDrag={false}`，`panOnDrag`，`zoomOnScroll`（不要 `panOnScroll`，会吃掉滚轮缩放）
- Shift 才框选
- MiniMap `position="top-right"`；拖拽忙时（`rfBusy`）或节点 >80 不渲染 MiniMap
- 工作栏 `nowheel` + `stopWheel`
- 输入 Panel `nowheel nopan nodrag`，并 `stopPropagation` 滚轮/指针
- `FlowToolbar` / `NodeInspector` / `WorkbenchDock` / `CanvasComposer` 均 `memo`；回调用 ref 稳定

### 9.7 编译发布

`flow/rhai.ts`：草稿 → 官方 Rhai（`agent()` / `parallel()` 等）。Agent 节点 `presetId` 解析成 `AgentOpts`（capability、isolation_worktree、disabled_tools、permission_rules、skills、output_schema）。缺 preset 直接抛错，不静默空跑。

发布：`PublishFlowModal` → `save_flow({ publish: true, rhai, ... })`。  
挂载到当前会话：`update_session_flows`（官方 `x.ai/session/update_flows`），之后 `/{flowId}` 才能被引擎当 workflow 跑。

导出 zip：根目录只有 `.rhai` + `.flow.yaml`。

### 9.8 工作栏

`workbench-dock.tsx`：运行状态（步骤、时空快照、Mock 产物重跑）+ `DockChatList`。  
空态提示去画布下方输入。无试跑时运行区默认收起。

---

## 10. 试跑与试跑详情

### 10.1 试跑（同一画布会话）

`startRun`（`canvas/index.tsx`）：

1. `resetCanvasGraphWait()` —— 防止试跑输出被认成新图
2. 可选从某节点切子图（临时 id `*-rerun`，`ephemeral` sidecar）
3. `persist({ stage: true })` + `updateSessionFlows`
4. `sendPrompt(tabId, \`/${flowId} ${jsonInput}\`)` —— **不是** `sendSessionPrompt` 的画布契约

认图侧：`isFlowRunUserText` 为真则不 `expectCanvasGraph`，pick 时也跳过。

工作栏用户气泡：斜杠行显示为「试跑」。

### 10.2 试跑详情 Tab

`openChatTab({ title: '试跑详情', utilityKind: 'flow-run', skipSession: true })`  
`openChatTab`：**`skipSession` 或 kind===`flow-run` 都不 `startSession`**。这是只读查看页 `RunDetailPanel.tsx`，不能再开一层 agent 去改画布。

历史上详情页自己 startSession + 残留 expect，会把画布图盖掉。已修。

---

## 11. Agent 编制

侧栏「Agent 编制」→ `utilityKind: 'agents'` → `AgentsPanel.tsx`。

磁盘：`~/.vesprism/agents/<id>/agent.yaml` + `system-prompt.md`（`workbench/agents.rs`）。

字段：人设段落、capability（read-only/read-write/execute/all）、isolation、disabled_tools、permission_rules、skills、挂载的 flows、input/output contract。

画布 Agent 节点用 `presetId` 引用这里的 id。编制更新后流程包可能 stale：`$flowStaleEpoch` / `stale.ts`，画布顶栏提示重新发布。

从画布节点「升级为编制」：`PromoteAgentModal`。

绑定：`bind_workbench_artifact({ kind: 'agent', id })`，进侧栏工作台。

---

## 12. 发送 / 事件关键路径（抄作业用）

### 12.1 主聊天发送

```
Composer.onSend
  → sendSessionPrompt({ text, attachments, mode })
  → send_prompt | interject_prompt (tabId, wire, promptId, attach)
  → grok-session PromptRequest / ExtRequest interject
  → 官方 agent
  → SessionNotification 流
  → FrontendEvent (tab_id)
  → handleSessionEvent → applyTranscriptEvent → patchTab.messages
```

### 12.2 画布发送

```
CanvasComposer.onSend
  → expectCanvasGraph(promptId)   // 除非文本是 /flowId
  → sendSessionPrompt({ text: 原话, wireText: XML+契约, promptId })
  → 同上事件流
  → CanvasGraphApplier：pick → decide → parse → applyDraft / heal
  → consumeCanvasGraph
```

### 12.3 排队与 turn_ended

`queue_changed`：服务器队列 + 本地尚未出现的乐观项。队列非空则保持 `generating`。  
`turn_ended`：按 `prompt_id` 匹配最后 user 气泡收尾；若队列仍有条目**不要**置 idle（否则会把下一轮卡住）。见 `sessionEvents.ts` + `sessionTranscript.ts`。

停止按钮：`aria-disabled` 而不是 `disabled`（避免点到被禁用的 textarea 穿透）；hit 区 `::after` 外扩。

---

## 13. 落盘路径一览

| 路径 | 用途 |
|------|------|
| `~/.vesprism/` | `GROK_HOME` |
| `config.toml` | 模型、默认模型、hooks、sandbox |
| `.env` | API keys |
| `sessions/threads.sqlite` | 侧栏索引、tool_sessions、workbench artifacts |
| `sessions/` 官方 session 目录 | 成绩单 jsonl |
| `scratch/` | 闲聊 cwd（`session/new` 仍要绝对路径） |
| `flow-drafts/` | 画布草稿 |
| `workflows/*.rhai` + `*.flow.yaml` | 已发布/试跑流程（引擎发现） |
| `agents/<id>/` | 编制资产 |
| `compositions/` | 会话组装单 yml |

---

## 14. 给接手 AI 的硬约束

1. **先查官方。** 排队、插话、MCP、rewind、fork、workflow、update_flows、list_running 都已有 `x.ai/*`。不要平行实现。
2. **官方 crate vs 桌面。** 优先 `vesprism-desktop` + `grok-session`。动 `xai-grok-*` 必须满足 `docs/官方代码修改原则.md`，并在同步说明里记账。
3. **根 `Cargo.toml` 是生成的**，当只读。改各 crate 自己的 `Cargo.toml`。
4. **密钥不进 git。** 用户 `config.toml` 不是仓库代码。
5. **Tab 状态不要写全局 atom 当事实源。** 用 `patchTab` / `tabWorkspaceCwd`。
6. **画布认图只认当前 pending promptId**；试跑斜杠永不 apply；卸载和 startRun 要 `resetCanvasGraphWait`。
7. **画布输入不要挂回工作栏**，不要显示工作区「闲聊」芯片。
8. **`flow-run` 禁止 startSession。**
9. **同 utilityKind 复用 Tab**，不要叠三个「流程画布」。
10. **中文提交信息**沿用：`功能(流程画布)：…` / `功能(桌面端)：…`。
11. **改 UI 后**在 Tauri 窗口里点一遍；没有浏览器工具就说清楚未手测。
12. 用户说「不是加模型吗」时：只改设置/config，不要加模型 id 映射表。

---

## 15. 文件索引（按任务跳转）

| 想改… | 打开 |
|--------|------|
| Tab / cwd / 投影 | `src/store.ts` |
| IPC 列表 | `src/bridge.ts`、`src-tauri/src/lib.rs` invoke_handler |
| 会话事件 | `src/lib/sessionEvents.ts`、`sessionTranscript.ts` |
| 发送/排队/插话 | `src/lib/sendSessionPrompt.ts`、`commands.rs` `send_prompt`/`interject_prompt` |
| 停止 | `src/lib/cancelActiveTurn.ts` |
| 输入框 | `src/components/Composer.tsx` |
| 主布局切换 | `src/App.tsx` `AppMainBody` |
| 侧栏历史 | `src/components/Sidebar.tsx`、`session_index.rs` |
| 工作台回载 | `src/lib/openWorkbenchSession.ts` |
| 开 Tab | `src/lib/openChatTab.ts` |
| 画布页 | `src/workbench/canvas/index.tsx` |
| 画布输入 | `src/workbench/canvas/CanvasComposer.tsx` |
| 认图 | `generateWait.ts`、`applyCanvasOutput.ts`、`CanvasGraphApplier.tsx` |
| 契约/校验/补丁/Rhai | `workbench/flow/{prompt,schema,graph,rhai}.ts` |
| 工作栏 | `workbench/canvas/workbench-dock.tsx` |
| 流程磁盘 | `src-tauri/src/workbench/flows.rs` |
| Agent 磁盘 | `src-tauri/src/workbench/agents.rs` |
| 绑定/工具会话 | `workbench/bindings.rs`、`bindings.ts` |
| ACP 包装 | `crates/grok-session/src/lib.rs` |
| 官方原则 | `docs/官方代码修改原则.md` |

---

## 16. 当前已知产品边界（不是 bug）

- 画布试跑**共用画布会话**，靠斜杠过滤认图，不是单独 session。
- 未绑定产物的画布会话不出现在侧栏。
- 第三方模型会读到官方系统提示「released by xAI」。
- `config.toml` 改模型需重启 Vesprism 进程。
- 根 workspace 全量 `cargo build` 极慢；桌面开发用 `npm run desktop`。
- 官方 TUI（`grok` CLI）与 Vesprism 数据目录隔离，互不影响。
