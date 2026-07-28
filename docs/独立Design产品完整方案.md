# Grok · 独立 Design 产品完整方案（最优 / 可改官方）

> 版本：v2.0（最优架构）  
> 日期：2026-07-28  
> 对标：Anthropic Claude Design  
> 前提：**允许修改官方 crate**（`xai-grok-agent` / `xai-grok-shell` / `xai-grok-tools` / `grok-session` 等）  
> 决策：Design 是 **引擎一等公民**，不是桌面壳上的临时拼装。

---

## 0. 一页纸摘要

| 项 | 最优结论 |
|----|----------|
| 产品 | 桌面侧栏 **对话 \| 设计** 平级；设计为独立工作台 |
| 引擎 | 新增内置 **`grok-design` agent** + **design toolset** + **design 会话种类** |
| 协议 | ACP 扩展：`sessionKind=design`、画布推送、项目 CRUD |
| 存储 | 官方统一 `$GROK_HOME/design-projects/` + session 绑定 |
| 画布同步 | **写盘即推送**（`design_canvas` session update），GUI 不靠猜 tool_call |
| 桌面 | 薄 UI：模式切换、项目列表、DesignCanvas、handoff |
| 原则 | 能力进官方、体验在桌面；TUI/CLI 日后可复用同一引擎路径 |

**与 v1 的本质区别：**  
v1 只在桌面拼 cwd + AGENTS.md；v2 把 **agent / 工具 / 会话语义 / 画布事件 / 项目模型** 做进官方，桌面只消费。

---

## 1. 为什么这是「最优」

| 方案 | 优点 | 缺点 | 判定 |
|------|------|------|------|
| A. 仅桌面 + AGENTS.md | 零改官方 | 约束软、无画布协议、难复用、易被模型忽略 | 过渡用 |
| B. 仅自定义 `.grok/agents/design.md` | 正规 agent 路径 | 每项目复制、无内置 toolset/事件、产品感弱 | 半吊子 |
| **C. 官方一等 Design（本方案）** | 与 plan/goal 同级工程品质；画布可靠；TUI 可复用；权限/工具硬约束 | 改官方、需测 | **采用** |

最优标准：

1. **硬约束在引擎**：工具白名单、路径沙箱，不只靠 prompt  
2. **画布有协议**：客户端可靠刷新，不解析聊天猜 HTML  
3. **项目有模型**：官方 list/create/delete，多端一致  
4. **与 coding 清晰 handoff**：协议级「实现」动作，非纯文案  
5. **可演进**：多页、品牌、批注挂在同一会话类型上扩展  

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Desktop (jike-grok-desktop)                                     │
│  ModeSwitch | DesignSidebar | DesignChat | DesignCanvas          │
└────────────────────────────┬────────────────────────────────────┘
                             │ ACP + x.ai/* extensions
┌────────────────────────────▼────────────────────────────────────┐
│  xai-grok-shell                                                  │
│  · sessionKind: code | design                                    │
│  · design project store                                          │
│  · canvas update emitter                                         │
│  · handoff helper                                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  xai-grok-agent                                                  │
│  BuiltinAgentName::GrokDesign                                    │
│  design_toolset + DESIGN_SYSTEM_PROMPT                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  xai-grok-tools                                                  │
│  既有: read/edit/write/image_gen/...                             │
│  新增: publish_design_page（可选但推荐）                         │
│  路径闸: design sandbox root                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 官方层设计（核心）

### 3.1 内置 Agent：`grok-design`

**位置：** `xai-grok-agent`

```rust
// BuiltinAgentName 新增
GrokDesign,  // strum: "grok-design"
```

**职责：**

- 对话式生成 / 迭代 **可交互 HTML 原型**（主）、SVG、简单多页  
- 默认写到项目 `canvas/` 约定路径  
- **不**做仓库级重构、不默认跑测试套件、不随便 `git commit`

**`AgentDefinition::grok_design()` 要点：**

| 字段 | 值 |
|------|-----|
| `name` | `grok-design` |
| `tool_config` | `design_toolset()` |
| `inject_default_tools` | `true`（保留 image_gen / web_fetch；按白名单裁） |
| `agents_md` | `true`（读项目 AGENTS.md / brand 说明） |
| `permission_mode` | `Default`（或略严） |
| `prompt_body` | `DESIGN_SYSTEM_PROMPT` |
| `disallowed_tools` | 高风险/无关：如部分 task/orchestrator；可禁 `enter_plan_mode` 等 |
| `discover_skills` | `true`（可挂 design skill） |

**`design_toolset()`（建议）：**

| 保留 | 原因 |
|------|------|
| read / list / search（轻量） | 读 brand、既有页 |
| write / edit（hashline 或等价） | 改 HTML/CSS/JS |
| image_gen / image_edit | 视觉素材 |
| web_fetch / web_search | 灵感与竞品参考 |
| publish_design_page（新） | 原子：写页 + 发画布事件 |

| 默认去掉或高门槛 | 原因 |
|------------------|------|
| 任意 bash / 重型 execute | 设计沙箱，防扫盘 |
| spawn_subagent 全家桶 | MVP 单 agent 足够；P1 可开 explore |
| goal / plan 编排工具 | 与 Design 产品正交 |

**沙箱：**  
session cwd = 项目根时，edit/write **额外校验** path 必须在项目 root 下（官方 `ToolContext` 增加 `sandbox_root` 或 design session 专用 path guard）。  
比 prompt「请不要写外面」可靠一个数量级。

### 3.2 Design System Prompt（官方模板）

**位置：** `xai-grok-agent/src/prompt/design_prompt.md`（或 `templates/`）

必须写死的约定：

1. 你是 **Grok Design**，产出可交互视觉原型，不是 coding agent  
2. 主交付物：`canvas/pages/{name}.html`；资源：`canvas/assets/`  
3. **每次有效视觉变更必须落盘**；优先调用 `publish_design_page`  
4. 单文件优先（自包含 CSS/JS）；多页时保持导航可点  
5. 若存在 `brand.json` / AGENTS.md 品牌段，严格遵循  
6. 输出给用户：简短变更说明 + 页路径；不要把整页 HTML 只贴在聊天里  
7. 不要修改 `project.json` 的 id 字段；可用工具更新 entry_page  

### 3.3 新工具：`publish_design_page`（强烈推荐）

**位置：** `xai-grok-tools`

```text
publish_design_page(
  path: string,          // 相对项目根，如 canvas/pages/home.html
  content: string,       // 完整 HTML
  title?: string,        // 页面标题
  set_as_entry?: bool    // 是否设为入口页
)
```

**行为：**

1. 校验 path ∈ sandbox  
2. 写文件  
3. 可选：写入 `canvas/versions/{ts}_{name}.html` 快照（上限 N）  
4. 更新 `project.json` pages / entry  
5. **发出 session update：** `design_canvas`（见 3.5）  

这样 GUI **不依赖** 解析 `edit` tool_call 是否碰到 html。

> 备选：在 design session 里 hook 所有 write/edit，若 path 匹配 `canvas/**/*.{html,svg}` 自动 emit。  
> **最优仍是专用工具 + hook 双保险**（模型忘了 publish 时 hook 兜底）。

### 3.4 会话种类：`sessionKind`

**session/new `_meta`：**

```json
{
  "x.ai/sessionKind": "design",
  "x.ai/designProjectId": "dp_01H..."
}
```

| kind | agent 默认 | cwd | 列表 |
|------|------------|-----|------|
| `code`（默认） | 模型 `agent_type` | 用户工作区 | 现有 sessions |
| `design` | **强制/默认 `grok-design`** | design project 根 | design 项目维度 |

**实现要点（shell）：**

- `new_session` 读 meta → 设 `session_info.kind`  
- kind=design 时：  
  - resolve project path by id  
  - cwd = project root  
  - active agent = `grok-design`（即使模型 catalog 写了别的 agent_type，design 会话优先；模型切换仍允许，但 harness 保持 design）  
- kind 持久化进 session summary，避免 resume 丢语义  

**模型切换：**  
design 会话内允许换模型 id，但 **agent harness 锁在 grok-design**（避免切到 codex toolset 破坏画布约定）。  
参考现有 `agent_type mismatch` 逻辑，为 design kind 增加「允许模型变、禁止 harness 变」。

### 3.5 ACP：画布推送（客户端最优路径）

**session/update 扩展**（或 `_meta` 扩展 notification）：

```json
{
  "sessionUpdate": "x.ai/design_canvas",
  "projectId": "dp_...",
  "pagePath": "canvas/pages/home.html",
  "versionId": "v_20260728T120000",
  "title": "首页",
  "language": "html",
  "content": "<!DOCTYPE html>...",
  "contentHash": "sha256:...",
  "isEntry": true
}
```

**规则：**

- content 可截断超大文件：先推 path+hash，客户端 `read` 拉全文  
- MVP：< 1.5MB 直接带 content；更大只带 path  
- 桌面 `DesignCanvas` 只订这一种事件即可刷新  

**可选反向：**  
客户端 `x.ai/design/select_page` / `x.ai/design/annotate`（P2 批注）。

### 3.6 Design Project Store（官方）

**路径：**

```text
$GROK_HOME/design-projects/
  {project_id}/
    project.json
    brand.json                 # optional
    AGENTS.md                  # optional project instructions
    canvas/
      pages/
      assets/
      versions/
    .grok/                     # optional local overrides
```

**`project.json`：**

```json
{
  "id": "dp_01HZX...",
  "title": "登录页原型",
  "schema_version": 1,
  "created_at": "...",
  "updated_at": "...",
  "entry_page": "canvas/pages/home.html",
  "pages": [
    { "id": "page_home", "title": "首页", "path": "canvas/pages/home.html" }
  ],
  "active_page_id": "page_home",
  "session_id": "sess_...",
  "linked_workspace": null,
  "settings": {
    "device_frame": "desktop",
    "auto_publish": true
  }
}
```

**官方 API（ACP ext 或 shell 内部 + desktop command 封装）：**

| 方法 | 说明 |
|------|------|
| `x.ai/design/list_projects` | 摘要列表 |
| `x.ai/design/create_project` | 建目录 + 默认页 + 空 brand |
| `x.ai/design/get_project` | 详情 |
| `x.ai/design/rename_project` | |
| `x.ai/design/delete_project` | 删目录；可选删绑定 session |
| `x.ai/design/open_project` | = new/load design session |
| `x.ai/design/export_page` | 读出版本/页内容 |

桌面 Tauri 可 **薄封装** 这些扩展；逻辑不放 React。

### 3.7 创建项目时的官方模板

`create_project` 写入：

1. `project.json`  
2. `canvas/pages/home.html`（极简占位骨架）  
3. `AGENTS.md`（品牌/路径约定）  
4. 可选 `brand.json` 空壳  

**不**再依赖用户手动塞 agent 文件——内置 `grok-design` 已全局可用。

### 3.8 Handoff：官方动作

**`x.ai/design/handoff_to_code`**

```json
{
  "projectId": "dp_...",
  "targetCwd": "D:/work/app",
  "notes": "请用现有 React 组件实现",
  "copyStrategy": "write_to_target"  
}
```

**行为：**

1. 复制 entry（及 assets）到 `{targetCwd}/.grok/design-handoff/{projectId}/`  
2. 返回 `handoffPrompt` 文本（实现说明 + 路径）  
3. 桌面：切 chat 模式 → `set_workspace_cwd` → `new_session` → `send(handoffPrompt)`  

引擎负责 **产物打包与 prompt 生成**；桌面负责 **模式与会话切换**。  
这是最优切分：handoff 语义稳定，UI 可换。

### 3.9 权限与安全

| 层 | 策略 |
|----|------|
| Path sandbox | design session 所有 FS 工具限制在 project root |
| Shell | design toolset 默认无 bash；若保留则强制 cwd=project 且 deny `..` |
| 外网 | web_fetch 允许（灵感）；可配置关闭 |
| iframe 桌面 | `sandbox=allow-scripts`，同 v1 |
| 删除项目 | 二次确认；可选同时 `delete_session` |

### 3.10 与 Plan / Goal 的边界

| 模式 | 用途 |
|------|------|
| **Design** | 视觉原型工作台 |
| Plan | 实现前架构规划（coding） |
| Goal | 长任务 DEV 循环 |

三者 **不要合并**。Handoff 后用户在 code 会话里可再 `/goal`。

---

## 4. 桌面层设计（薄但完整）

### 4.1 信息架构

```
侧栏顶部: [ 对话 ] [ 设计 ]
设计侧栏: + 新建设计 | 项目列表
主区:     设计对话 | DesignCanvas（默认宽）
```

### 4.2 DesignCanvas

消费 `x.ai/design_canvas`：

- 预览 / 源码  
- 版本列表（来自 versions/ 或事件 versionId）  
- 设备框 Fluid / Desktop / Tablet / Mobile  
- 分栏拖拽  
- 下载 / 打开项目文件夹  
- Header：**用 Agent 实现** → 调 handoff  

### 4.3 会话 Actor

**最优桌面演进：**

| 阶段 | Actor |
|------|--------|
| MVP | 仍单 Actor；切模式时 switch session（可接受短暂中断） |
| P1 | **双 Actor**（chat + design 各一），模式秒切、后台可生成 |

官方已支持多 session 句柄；瓶颈在桌面 `AppState` 单通道——P1 值得改。

### 4.4 附图

引擎已支持 `ContentBlock::Image`。  
Design Composer **优先接线** 粘贴截图 / 拖拽（比 code 模式更刚需）。

### 4.5 Chat 模式 Artifact

保留轻量 Artifact 预览；与 DesignCanvas **共享渲染组件**，状态分离。

---

## 5. 端到端主路径（最优）

```
用户点「设计」→「新建设计」
  → desktop invoke design_create
  → shell: 建 project + 占位 html
  → desktop open: session/new meta { sessionKind:design, projectId }
  → shell: cwd=project, agent=grok-design
  → 用户: 「深色登录页，含 OAuth」
  → model: publish_design_page(home.html, ...)
  → shell: 写盘 + version + design_canvas update
  → DesignCanvas 即时显示
  → 用户改需求 → 新 version
  → 「用 Agent 实现」→ handoff_to_code → 切对话 → 自动实现 prompt
```

---

## 6. 官方改动清单（按 crate）

### 6.1 `xai-grok-agent`

| 改动 | 说明 |
|------|------|
| `BuiltinAgentName::GrokDesign` | 枚举 + tests exhaustive match |
| `AgentDefinition::grok_design()` | |
| `design_toolset()` | |
| `prompt/design_*.md` | system prompt |
| discovery | 内置可解析 `grok-design` 名 |

### 6.2 `xai-grok-tools`

| 改动 | 说明 |
|------|------|
| `PublishDesignPageTool` | 写页 + 回调/事件钩子 |
| ToolContext sandbox | design 时 path guard |
| （可选）write/edit hook | canvas 路径自动 notify |

### 6.3 `xai-grok-shell`

| 改动 | 说明 |
|------|------|
| `session_info.kind` | code \| design |
| new_session meta 解析 | projectId、kind |
| design project store 模块 | `session/design_projects.rs` |
| ACP ext methods | list/create/open/delete/handoff |
| `design_canvas` update 发送 | Gateway → client |
| agent lock | design 会话锁定 harness |
| resume | 恢复 kind + project 绑定 |
| 单测 | path 穿越、create、publish、handoff prompt |

### 6.4 `grok-session`（桌面桥）

| 改动 | 说明 |
|------|------|
| start/resume 传 meta | sessionKind + projectId |
| 事件映射 | `design_canvas` → FrontendEvent |
| 封装 design_* 高层 API | 供 Tauri 调用 |

### 6.5 `jike-grok-desktop`

| 改动 | 说明 |
|------|------|
| ModeSwitch + DesignShell | |
| 订 design_canvas | |
| Composer 图片 | Design 优先 |
| Handoff UI | |
| 双 Actor（P1） | |

### 6.6 文档 / 技能

| 改动 | 说明 |
|------|------|
| 用户指南：Design | |
| bundled skill `design-ui`（可选） | 多页/幻灯片约定补充 |
| CHANGELOG | |

---

## 7. 分阶段交付（最优路径仍分期）

### Phase 0 — 骨架协议（官方）

- [ ] `GrokDesign` agent + prompt + design_toolset（可先无 publish 工具）  
- [ ] sessionKind=design + cwd=project + harness 锁定  
- [ ] design project store：create/list/get/delete  
- [ ] 单测：沙箱拒绝 `../`

**验收：** CLI/测试里能 `new_session(design)` 并只改项目内文件。

### Phase 1 — 画布协议（官方 + 桌面最小）

- [ ] `publish_design_page` + canvas hook  
- [ ] `design_canvas` session update  
- [ ] 桌面 Design 模式壳 + Canvas 消费事件  
- [ ] 版本目录  

**验收：** 对话改一版 → 画布自动变，无需点「预览」。

### Phase 2 — 桌面产品化

- [ ] 侧栏项目列表、重命名、删除  
- [ ] 设备框、分栏、源码 tab、下载  
- [ ] Design Composer 附图  
- [ ] 空状态与引导  

### Phase 3 — Handoff

- [ ] `handoff_to_code`  
- [ ] 桌面切 chat + 自动 prompt  
- [ ] handoff 目录约定写入用户仓  

### Phase 4 — 增强

- [ ] 双 Actor  
- [ ] brand.json 抽取工具  
- [ ] 多页 tabs  
- [ ] 批注回灌  
- [ ] PDF/PPTX 导出  
- [ ] TUI 最小 design 入口（可选）  

---

## 8. PR 切片（官方优先）

| PR | 范围 | 可演示 |
|----|------|--------|
| **O1** | `GrokDesign` agent + toolset + prompt + 单测 | 配置 agent_type=grok-design 能跑 |
| **O2** | design project store + sessionKind | 创建项目、design session cwd 正确 |
| **O3** | path sandbox for design | 写 `../` 失败 |
| **O4** | publish_design_page + design_canvas 事件 | 集成测试断言 update |
| **O5** | handoff_to_code | 单测 prompt/路径 |
| **D1** | 桌面 ModeSwitch + 空 DesignShell | UI 可切 |
| **D2** | 接 O2 open project | 真会话 |
| **D3** | DesignCanvas 接 O4 事件 | 自动预览 |
| **D4** | 产品打磨 + 附图 | |
| **D5** | 接 O5 handoff | 闭环 |

O* 可先于 D* 合入；D 不阻塞 O 的引擎正确性。

---

## 9. 测试策略

### 官方

- Agent 枚举 exhaustive / toolset 快照  
- Project CRUD tempdir  
- Sandbox 路径穿越  
- publish → 文件存在 + 发出 canvas event（mock gateway）  
- handoff 复制与 prompt 字段  
- resume design session 恢复 kind  

### 桌面

- 模式切换不丢 chat last session id  
- 收到 design_canvas 更新 iframe  
- handoff 切模式后 workspace 正确  

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 改官方回归面大 | 小 PR、agent 枚举编译期强制补全、design 代码模块隔离 |
| 模型不调 publish | write/edit canvas hook 兜底 |
| 与上游合并冲突 | design 集中新文件；少改热路径；记录 SOURCE_REV |
| harness 锁定 vs 用户自定义 agent | design kind 默认锁；高级配置可 `design.allow_custom_agent=true` |
| 大 HTML 堵事件通道 | hash + 客户端拉取 |
| 单 Actor 切换卡顿 | Phase4 双 Actor |

---

## 11. 明确不做（仍最优边界）

- 不在引擎内嵌 Chromium 设计器  
- 不做云同步协作  
- 不把 Goal 的 Design-Execute-Verify 改名冒充产品 Design  
- 不强制所有模型 agent_type 全局改成 grok-design（仅 design 会话）  

---

## 12. 与 v1 对照

| 点 | v1（不改官方） | **v2 最优** |
|----|----------------|-------------|
| Agent | 外置 md / prompt 凑 | **内置 grok-design** |
| 工具 | 全套 coding 工具 | **design toolset + 沙箱** |
| 画布刷新 | 猜 edit / 点按钮 | **design_canvas 协议** |
| 项目 | 桌面自管目录 | **官方 store + API** |
| Handoff | 桌面拼 prompt | **官方 handoff 动作** |
| 复用 | 仅本桌面 | **TUI/CLI/未来客户端** |

---

## 13. 建议拍板项（v2 默认）

| # | 项 | 默认 |
|---|-----|------|
| Q1 | 内置 agent 名 | `grok-design` |
| Q2 | 专用 publish 工具 | **要**（+ edit hook 兜底） |
| Q3 | design 会话锁定 harness | **要** |
| Q4 | 默认无 bash | **要**（P1 可配置放开） |
| Q5 | 双 Actor | MVP 单 Actor 切换；P1 双 |
| Q6 | 项目根为 cwd | **要** |
| Q7 | Chat 保留 Artifact | **要** |

---

## 14. 里程碑体感

| 里程碑 | 内容 | 约略（熟手） |
|--------|------|----------------|
| O1–O3 | 官方 agent + 项目 + 沙箱 | 3–5 天 |
| O4–O5 | 画布事件 + handoff | 2–3 天 |
| D1–D3 | 桌面可演示闭环 | 3–4 天 |
| D4–D5 | 打磨 + handoff UI | 2 天 |
| **可演示最优闭环** | | **约 2–3 周** |

---

## 15. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-07-28 | 桌面为主、不改官方 |
| v2.0 | 2026-07-28 | **最优：官方一等 Design**；agent/toolset/sessionKind/canvas 协议/project store/handoff |

---

## 附录 A · 关键代码落点（便于开工）

```
crates/codegen/xai-grok-agent/src/config.rs          # BuiltinAgentName + grok_design()
crates/codegen/xai-grok-agent/src/prompt/design_*.md # 新人设
crates/codegen/xai-grok-tools/src/implementations/
  grok_build/publish_design_page.rs                  # 新工具
crates/codegen/xai-grok-shell/src/session/
  design_projects.rs                                 # store
  design_canvas.rs                                   # emit helper
crates/codegen/xai-grok-shell/src/agent/mvp_agent/   # new_session meta
crates/grok-session/src/lib.rs                       # 事件映射
crates/jike-grok-desktop/src/app/DesignApp.tsx       # UI
```

## 附录 B · `session/new` 示例

```json
{
  "cwd": "/home/u/.jike-grok-desktop/design-projects/dp_xxx",
  "_meta": {
    "x.ai/sessionKind": "design",
    "x.ai/designProjectId": "dp_xxx"
  }
}
```

## 附录 C · 首版 `DESIGN_SYSTEM_PROMPT` 提纲

```markdown
You are Grok Design — a visual product designer that ships interactive HTML prototypes.

Workspace rules:
- Only modify files under the current design project root.
- Primary deliverable: canvas/pages/*.html (self-contained when possible).
- Assets: canvas/assets/.
- After every visual change, call publish_design_page (or write the file under canvas/).
- Follow brand.json and AGENTS.md when present.
- Prefer clear hierarchy, accessible contrast, and real interactive states (hover/focus).
- Do not run broad refactors, git commits, or tools outside the design sandbox.
- Reply to the user in the same language they use; keep chat short; put the design on disk.
```

---

**文档结束。** 确认 Q1–Q7 后，建议从 **PR O1（内置 grok-design agent）** 开工。
