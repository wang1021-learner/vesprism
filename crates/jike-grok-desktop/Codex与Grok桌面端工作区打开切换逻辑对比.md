# Codex 与 Grok 桌面端：工作区打开 / 切换逻辑对比

> 文档目的：归纳 **OpenAI Codex 桌面端** 的工作区（Project / Thread / cwd）打开与切换逻辑，并与 **jike-grok-desktop** 现状对照，便于后续对齐产品与实现。  
> 整理日期：2026-07-25  
> 对照代码：`src/App.tsx`、`src/components/Sidebar`、`src/components/Composer`、`src-tauri/src/commands.rs`、`src-tauri/src/state.rs`

---

## 目录

1. [Codex 桌面端逻辑](#1-codex-桌面端逻辑)
2. [Grok 桌面端逻辑（现状）](#2-grok-桌面端逻辑现状)
3. [概念与能力对照表](#3-概念与能力对照表)
4. [打开逻辑对比](#4-打开逻辑对比)
5. [切换逻辑对比](#5-切换逻辑对比)
6. [侧栏列表 / 分组对比](#6-侧栏列表--分组对比)
7. [流程对照](#7-流程对照)
8. [相同点](#8-相同点)
9. [关键差异](#9-关键差异)
10. [结合代码的细节](#10-结合代码的细节)
11. [结论与改动优先级建议](#11-结论与改动优先级建议)
12. [参考来源](#12-参考来源)

---

## 1. Codex 桌面端逻辑

### 1.1 核心数据模型

| 概念 | 含义 | 关键字段 / 存储 |
|------|------|----------------|
| **Project（侧栏项目）** | 本地文件夹根路径（可登记） | 保存的 project root |
| **Thread（会话）** | 一次对话 | `threads.cwd`、`rollout_path`、`archived` 等 |
| **Workspace roots** | Agent 可读写范围 | 默认 = project cwd（可 multi-folder / worktree） |

持久化大致为：

- 会话索引：`~/.codex/state_*.sqlite` 的 `threads` 表（含 `cwd`）
- 完整对话：`~/.codex/sessions/.../rollout-*.jsonl`
- 桌面 UI 通过 **app-server**（stdio JSON-RPC）访问，而非直接扫文件

App Server 关键约定：

- `thread/list` 支持按 **`cwd` 精确匹配**（也可传 path 数组）
- `thread/start` 需带 **`cwd`（绝对路径）**
- 若 sandbox 为 `workspace-write` / full access，会把该 project **标为 trusted** 写入 `config.toml`

### 1.2 打开逻辑

#### 打开 / 添加项目

入口大致：

- **Add new project**（侧栏）
- 快捷键 **Cmd/Ctrl + O**
- 系统文件夹选择器

结果：

1. 目录被登记为 **Project root**
2. 侧栏出现项目条目（显示名多为文件夹名）
3. 不立刻销毁旧会话，只是注册「可归组的根路径」
4. 侧栏 **Remove** 只移出列表；再 Add / Cmd+O 同一路径可恢复

#### 在项目下开新对话

```text
thread/start { cwd: "<project root>", model, sandbox/permissions... }
```

- 新 thread 的 cwd = 当前 project 的 **primary root**
- 若是 Git 仓库：可走 **worktree**（隔离 checkout），仍挂在该 project 下
- 可写 sandbox 时自动 **trust** 该项目
- 从 primary root 加载 `AGENTS.md`、`.codex/config.toml`、skills 等

#### 打开已有对话

- `thread/resume` / `thread/read`
- 使用 thread 自己的 **`cwd` + rollout_path`**
- UI 切到该 thread 所属 project
- **打开会话 = 恢复会话绑定的 cwd，而不是先切 UI 再改 cwd**

#### 多文件夹项目（较新）

- **Edit project** 可加多个 folder，选一个 **primary**
- **新聊天 / Git / AGENTS.md / skills / config.toml → primary**
- **次要 folder** 参与搜索、读、写，不当主 cwd
- 「工作区切换」仍以 **primary cwd** 为准

### 1.3 切换逻辑

#### 侧栏组织

- **By project** / **In one list** / **By connection**（远程）等

By project 时：

```text
Project root (saved path)
  └── Threads where threads.cwd === projectRoot   // 精确匹配
```

约束与坑：

- 匹配是 **cwd 字符串精确相等**，不是「子目录也算」
- Windows 上 `D:\foo` / `\\?\D:\foo` / `d:\foo` 会被当成不同 cwd → 侧栏空或「会话消失」
- 文件夹挪路径后旧 thread 的 cwd 对不上 → 列表丢失（数据可能仍在 sqlite/rollout）

#### 点项目

1. `active project` = 该 root  
2. 展示该 project 下 threads  
3. 新开聊天默认用该 root 作 cwd  
4. File explorer / git 理想上绑定到该 root（实现上偶有不同步，见 issue）

#### 点会话

1. `thread/resume` 加载历史  
2. **active cwd = thread.cwd**  
3. 侧栏高亮对应 project  
4. Agent 工具、终端、sandbox 在此 cwd（或 worktree）下  

**不会**因为先点了 Project A，再打开 Project B 的旧会话，就强行改成 A 的 cwd。

#### 侧栏 hydrate（实现细节，issue 归纳）

历史上常见路径接近：

```text
启动 / 刷新
  → thread/list（全局 recent，常有窗口，如 ~50）
  → 用 threads.cwd 把 recent 线程「归」到已保存 projects
  → 展开 project 时，有时并没有再按 cwd 做完整分页查询
```

因此会出现：

| 现象 | 原因 |
|------|------|
| 项目显示 **No chats** | 该 project 的会话不在「全局 recent 窗口」里 |
| 搜索能找到，侧栏没有 | 搜索与 By project 归组路径不同 |
| `thread/list({ cwd })` 有数据，UI 仍空 | UI 未按 project 做 cwd 分页 hydrate |
| 重启后侧栏变少 | 只加载 recent / 映射漂移 / 路径规范化不一致 |

更合理的产品逻辑应是：

```text
通用 Chats：全局 recent
展开 Project：thread/list({ cwd: projectRoot, archived: false, cursor, limit })
```

### 1.4 Codex 流程总览

```text
[启动桌面端]
    → 起 app-server
    → thread/list(recent) + 读已保存 projects
    → 用 cwd 精确匹配，把 thread 挂到 project 下

[打开项目 Add / Cmd+O]
    → 选文件夹 path
    → 登记 project root
    → 侧栏出现；可展开看匹配 cwd 的 threads

[切换项目]
    → activeProject = root
    → 列表过滤/展示该 root 下 threads
    → 新 thread 默认 cwd = primary root

[打开/切换会话]
    → resume thread
    → cwd = thread.cwd（固定绑定）
    → 工具/沙箱/终端在此 cwd（或 worktree）

[新会话]
    → thread/start(cwd=primary root)
    → 写入 state DB + rollout
    → 若可写 sandbox → trust 该 project
```

### 1.5 Codex 一句话

- **打开项目** = 注册本地 **root path**  
- **打开/切换会话** = 恢复会话绑定的 **`cwd`**  
- **切换项目** = 换 active root，并用 **`threads.cwd === projectRoot`（精确匹配）** 归组；新对话默认用 primary root  
- **侧栏** 历史上常对 **全局 recent 子集** 做分组，而非每次按 cwd 全量 `thread/list`

---

## 2. Grok 桌面端逻辑（现状）

### 2.1 核心概念

| 概念 | 含义 | 存储 / 状态 |
|------|------|-------------|
| **当前工作区 `workspaceCwd`** | Agent 当前工作目录 | UI state + `[desktop] workspace_cwd`（config.toml）+ 内存 override |
| **Session** | 一次对话 | `summary.info.cwd` 等（`grok_session`） |
| **工作区列表** | 无独立 Project 注册表 | 由 **当前 cwd ∪ 历史会话 cwd** 去重派生 |

特点：

- **单一全局当前 cwd**（进程内一份）
- **单活跃会话**（同时只有一个 ready session）
- 侧栏按 **工作区 → 日期 → 会话** 两层分组
- 列表来自 **`list_all_sessions` 全量**（过滤空会话），当前 cwd 排前

### 2.2 当前 cwd 解析优先级

见 `commands.rs` → `resolve_workspace_cwd`：

1. `AppState.workspace_cwd_override`（内存，设置后立即生效）  
2. `$GROK_HOME/config.toml` → `[desktop] workspace_cwd`  
3. monorepo 仓库根 / 进程 cwd 兜底  

`set_workspace_cwd`：

- 校验路径存在且为目录  
- `canonicalize`，Windows 尽量剥掉 `\\?\` 前缀便于展示  
- 写回 config + 更新内存 override  

### 2.3 打开逻辑

```text
启动
  → resolve workspace_cwd
  → start_session({ cwd })
  → list_sessions（全工作区会话，当前 cwd 排前）

浏览文件夹 / 下拉选已知工作区
  → set_workspace_cwd
  → 若 ready → restart_session（清空当前对话）
  → 否则只保存，下次 start 生效

打开历史会话
  → load_session({ sessionId, cwd: 会话自己的 cwd })
  → UI setWorkspaceCwd(cwd)
  // 注意：未必调用 set_workspace_cwd 写回 config
```

### 2.4 切换逻辑（两条路径）

#### A. 主动切工作区

入口：Composer 下拉 / 浏览 / 设置保存。

```text
applyWorkspaceCwd / saveSettings
  → set_workspace_cwd 持久化
  → 若会话 ready → restart_session（清空消息，新空会话）
```

Composer 限制（空会话才允许切）：

```tsx
canSwitchWorkspace =
  ready && !loadingSession && !starting && !messages.some((m) => m.role === 'user')
```

- 一旦有用户消息，Composer 工作区 pill 隐藏  
- 设置里改 cwd：有会话也会 **restart 清对话**

#### B. 侧栏点历史会话（可跨工作区）

```text
handleSelectChat(id, sessionCwd)
  → cwd = sessionCwd || list.cwd || workspace_cwd
  → load_session({ id, cwd })      // Agent 绑到会话 cwd
  → setWorkspaceCwd(cwd)           // UI 当前工作区跟随
  // 通常不调用 set_workspace_cwd → 不一定写入 config.toml
```

要点：**会话强绑定自己的 cwd**；跨工作区打开必须用会话路径（代码注释已明确）。

### 2.5 侧栏分组

- `list_sessions`：返回 **全部工作空间** 会话，`cwd` 仅用于把当前工作空间排前  
- 前端 `groupChatsByWorkspaceThenDate`：工作区 → 今天/昨天/… → 会话  
- 路径 key 规范化：`\`→`/`、去尾 `/`、比较时 `toLowerCase`  
- `workspaceOptions`：当前 `workspaceCwd` + `recentChats[].cwd` 去重  

### 2.6 Grok 一句话

- **当前工作区** = 单一 `workspaceCwd`（config + 内存）  
- **新对话 / 主动切区** = `start` / `restart`（常清空）  
- **打开历史** = `load_session(session.cwd)`，UI cwd 跟随  
- **侧栏工作区组** = 从全部 sessions 的 cwd **派生**，无独立 Project 注册表  

---

## 3. 概念与能力对照表

| 维度 | Codex 桌面端 | Grok 桌面端（jike-grok-desktop） |
|------|-------------|----------------------------------|
| 顶层对象 | **Project**（登记的项目根） | **工作区 cwd**（当前 Agent 目录） |
| 会话对象 | **Thread**（绑定 `threads.cwd`） | **Session**（`summary.info.cwd`） |
| 项目注册表 | 有：Add / Remove / Cmd+O | **无**；从会话 cwd 派生 |
| 工作区列表来源 | 用户登记 projects + thread 归组 | 当前 cwd ∪ 历史会话 cwd |
| 多文件夹 | primary + secondary roots | 单 cwd |
| Worktree | Git worktree 并行隔离 | 无 |
| 远程 | SSH / By connection | 无 |
| 列表 API | app-server `thread/list`（可按 cwd） | `list_all_sessions`（全量） |
| 并发会话 | 多 thread 并行 | **单进程单活跃会话** |
| 列表截断 | recent 窗口问题多 | 全量，更完整 |

形态对比：

- Codex：**先有 Project 容器，再往里挂 Thread**  
- Grok：**一个全局当前 cwd + 按会话 cwd 分组展示**  

---

## 4. 打开逻辑对比

| 能力 | Codex | Grok |
|------|-------|------|
| 打开新文件夹 | 登记 Project，不强制清会话 | `set_workspace_cwd` + 常 **restart 新空会话** |
| 打开历史会话 | resume，cwd 固定 | `load_session`，**必须传会话 cwd**（已对齐） |
| 路径校验 | 路径/存在性（实现细节多） | 必须存在且是目录；canonicalize；剥 `\\?\` |
| 持久化 | project 列表 + thread cwd | **单一** `[desktop] workspace_cwd` + 各会话 cwd |
| multi-root | 有 primary/secondary | 无 |

---

## 5. 切换逻辑对比

| 操作 | Codex | Grok |
|------|-------|------|
| 点「项目 / 工作区」 | 设 active project；新对话默认该 root | 侧栏标题主要是展开/折叠；真正切 cwd 在 Composer/设置 |
| 点历史会话 | resume，`cwd = thread.cwd` | `load_session(session.cwd)`，UI `workspaceCwd` 跟随 |
| 主动换目录 | 新 thread 用新 root；旧 thread 仍在 | 空会话：Composer 可切；设置：强制 restart 清屏 |
| 有内容时能否换 cwd | 可另开 thread，不丢旧对话 | Composer 禁止；设置会丢当前对话 |

---

## 6. 侧栏列表 / 分组对比

| 点 | Codex | Grok |
|----|-------|------|
| 数据范围 | 常是 recent 窗口再按 cwd 挂 project | **`list_all_sessions` 全量**（空会话过滤） |
| 分组 | Project → threads；可 flat / connection | **工作区 → 日期 → 会话** |
| 当前项 | active project / thread | `isCurrent` +「· 当前」 |
| 匹配规则 | cwd **字符串精确**（`\\?\` 易踩坑） | 统一斜杠、去尾 `/`、**toLowerCase** |
| 派生工作区 | 独立 project 列表 | `workspaceOptions` 从会话派生 |
| 老会话可见性 | 易被 recent 截断 | **更好**：全量列表 |

Grok 在「侧栏不丢老会话」上通常比 Codex 常见实现更稳。

---

## 7. 流程对照

```text
Codex
  Project registry ──分组──► Threads(cwd)
       │                      │
  新对话 thread/start(cwd)    resume(thread.cwd)
       │                      │
       └──── Agent workspace ─┘

Grok
  单一 current workspace_cwd（config + 内存）
       │
       ├─ 新对话 / 切工作区 → start/restart(cwd)   // 常清空
       │
       └─ 历史会话 → load_session(session.cwd)     // UI cwd 跟随
              │
  侧栏工作区组 ◄── 从全部 sessions.cwd 派生（无独立 registry）
```

---

## 8. 相同点

1. **会话绑定 cwd**，跨工作区打开历史必须用会话自己的路径（Grok 的 `handleSelectChat` 已做）。  
2. **侧栏按工作区折叠分组**，形态接近 Codex By project。  
3. **路径规范化意识**（Grok：大小写、斜杠、`\\?\`），Windows 更稳妥。  
4. **切工作区会重建 Agent 上下文**（Codex 新 thread 新 cwd；Grok restart 空会话）。  
5. **cwd 变更必须落到运行中 session**，否则工具仍在旧目录。

---

## 9. 关键差异

| # | 差异 | Codex | Grok | 影响 |
|---|------|-------|------|------|
| 1 | 项目是否一等公民 | 是，可 Add/Remove | 否，从会话派生 | 空项目、无会话的「收藏目录」做不了 |
| 2 | 有内容时切工作区 | 可开新 thread 并行 | Composer 仅空会话；设置强制 restart | 不能「保留当前对话却换 cwd」 |
| 3 | 多会话并行 | 多 thread（可 worktree） | **单活跃会话** | 不能同屏多 Agent |
| 4 | 点历史是否写持久 cwd | project 列表独立 | UI 跟随，**未必 `set_workspace_cwd`** | 重启后可能回到 config 旧 cwd |
| 5 | 列表截断 | recent 窗口问题多 | 全量 | Grok 更完整 |
| 6 | multi-root / worktree | 有 | 无 | monorepo 多仓场景弱 |
| 7 | 删工作区 | Remove project | 无；会话删光组就没了 | 行为不同但可接受 |
| 8 | 信任模型 | start 可写时 trust project | Grok 自己的权限流 | 不直接可比 |

---

## 10. 结合代码的细节

### 10.1 Grok 更好的地方

- **`list_sessions` 全量 + 当前 cwd 优先排序**，避免 Codex「No chats」类问题  
- **Windows 路径规范化**（canonicalize + 剥 `\\?\` + 比较时 lower）  
- **空会话清理**（blank 不进列表、切走可删）  
- **Composer 限制空会话才切工作区**，避免「聊到一半 cwd 悄悄变了」——更保守、更安全  

### 10.2 值得留意的缺口

1. **跨工作区打开会话不持久化 cwd**  
   `handleSelectChat` 只 `setWorkspaceCwd`，不调 `set_workspace_cwd`。  
   → 本次会话在新目录跑，重启 App 可能仍用 config 里旧目录。

2. **没有 Project 注册表**  
   从未开过会话的文件夹不会出现在侧栏；Codex 可「先加项目再聊」。

3. **切工作区 = 丢当前对话**（restart）  
   Codex 是「同 project 下多 thread 并存」；Grok 是「换 cwd 就新开空会话」。

4. **侧栏点工作区标题**  
   目前主要是展开/折叠；真正切 cwd 在 Composer/设置。  
   Codex 点 project 即切 active project，心智更统一。

5. **`LoadSession` 清理 blank 时的 cwd**  
   `delete_session_if_blank(&old_id, &cwd)` 使用的是**目标**会话 cwd。  
   跨工作区切走时，旧空会话清理是否依赖正确 cwd，需结合 `grok_session` 落盘路径再确认。

### 10.3 关键代码锚点

| 逻辑 | 位置 |
|------|------|
| `canSwitchWorkspace` | `src/App.tsx` |
| `workspaceOptions` 派生 | `src/App.tsx` |
| `applyWorkspaceCwd` / `browseWorkspace` | `src/App.tsx` |
| `handleSelectChat` / `load_session` | `src/App.tsx` + `commands.rs` + `state.rs` |
| `resolve_workspace_cwd` / `set_workspace_cwd` | `src-tauri/src/commands.rs` |
| `list_sessions` 全量 + 排序 | `src-tauri/src/commands.rs` |
| 侧栏两层分组 | `src/components/Sidebar/index.tsx` |
| Composer 工作区 pill | `src/components/Composer/index.tsx` |

---

## 11. 结论与改动优先级建议

### 11.1 结论

| | |
|--|--|
| **Codex** | Project 容器 + Thread 绑定 cwd；多会话并行；侧栏归组依赖 cwd 精确匹配，列表有时只 recent |
| **Grok** | 单一当前 cwd + 全量会话按 cwd 派生分组；单活跃会话；空会话才允许 Composer 切区；跨会话打开已正确带会话 cwd |

Grok 已在 **「会话强绑 cwd」** 和 **「全量侧栏分组」** 上与 Codex 同向，列表完整性往往更好。

与 Codex 最大的产品差：

1. **没有独立 Project 注册 / 多会话并行**  
2. **切工作区偏「重建空会话」而不是「同 App 多 thread」**  
3. **从历史会话跳工作区时，持久化 cwd 不完整**

### 11.2 若对齐 Codex，建议优先级

| 优先级 | 改动 | 原因 |
|--------|------|------|
| **P0** | 跨工作区 `load_session` 后也 `set_workspace_cwd` | 重启行为与 UI 一致 |
| **P1** | 侧栏点工作区标题 = `applyWorkspaceCwd`（空会话）或「在此新建」 | 交互更接近 Codex 点 project |
| **P2** | 可选：`[desktop] recent_workspaces = []` 注册表 | 无会话也能钉住常用目录 |
| **P3** | 多活跃会话 / worktree | 大工程，才真正像 Codex 并行 |

### 11.3 若只抄 Codex 的三条底线

1. **会话强绑定 cwd**，跨工作区打开必须用会话自己的 cwd（已基本做到）  
2. **项目/工作区列表用规范化 path 当 key**（已做 lower + 斜杠；可持续加强）  
3. **展开工作区时按 cwd 拉列表，不要只靠全局 recent 截断**（Grok 全量列表已更好）

---

## 12. 参考来源

### 公开文档 / 协议

- OpenAI：Introducing the Codex app、ChatGPT Work and Codex 帮助文档  
- App Server：`thread/list`（`cwd` 过滤）、`thread/start`（`cwd` 必填/信任 project）  
- Worktrees / Local environments / Multi-folder project changelog（primary folder 语义）  
- Troubleshooting：Remove project → Add new project / Cmd+O 恢复  

### 社区与 issue（行为归纳，非官方实现源码）

- 侧栏 recent 窗口 / No chats / hydrate：如 `#21128`、`#25500`、`#27314`、`#23609` 等  
- Windows 路径 / cwd 精确匹配：如 `#20254`、`#17540` 等  
- Workspace explorer 与 project/thread 不同步：如 `#23797`  
- Reddit：移动 working directory 后 threads 消失、需改 `threads.cwd` 等讨论  

### 本地对照

- Codex 本机状态库示例：`~/.codex/state_5.sqlite` → `threads.cwd`  
- Grok 实现：`crates/jike-grok-desktop/`  

---

*本文档描述的是产品与协议层面的逻辑归纳，Codex 桌面闭源 UI 的内部实现可能随时变更；以官方 App Server 文档与当前可观察行为为准。*
