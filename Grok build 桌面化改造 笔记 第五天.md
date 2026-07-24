# Grok Build 二次开发 —— 桌面体验与稳定性（第五天）

> 日期：2026-07-23  
> 承接《完整归档》与第一～四天笔记。  
> 本文记录今日桌面端（`jike-grok-desktop` / `grok-session`）的改动、遇到的问题与解决方式。

---

## 一、今天的目标与结论

| 目标 | 结果 |
|------|------|
| 梳理项目与桌面端现状 | 完成 |
| 侧栏时间分组 / 搜索 / 标题 / 重命名 | 完成 |
| 工具调用可视化 | 完成（依赖官方 ACP ToolCall 事件） |
| 新建会话稳定性 + 空会话不进历史 | 完成（含二次修复） |
| 权限弹窗可读性（D 盘查空间时整屏模糊） | 完成 |

**总评：** 桌面端从「能聊」推进到「侧栏产品体验 + 工具可见 + 会话生命周期可控」；坚持**依赖官方能力、桌面只做展示与策略**的原则。

---

## 二、架构原则（今日再次确认）

```
React (WebView)
  ↕ Tauri invoke / emit
GrokSession 封装层
  ↕ ACP ClientSideConnection
tokio::io::duplex 内存双工
  ↕
xai_grok_shell::spawn_agent_local
```

| 依赖官方 | 桌面自己做 |
|----------|------------|
| `load_session` 历史回放 | 侧栏 UI、搜索弹层、标题展示 |
| ToolCall / 权限 ACP | 工具卡片、权限弹窗文案与样式 |
| `delete_session_history` / summary 落盘 | 「空会话」判定与列表过滤策略 |
| `update_session_title` | 重命名弹窗 |

**结论：** 历史消息「打开能看」本身走官方回放，**不必**再读 `chat_history.jsonl` 重做一套；今天未改任何 `chat_history.jsonl` 文件内容。

---

## 三、今日修改清单

### 3.1 侧栏时间分组

**改动文件：**

- `crates/jike-grok-desktop/src/App.tsx` — 列表映射补上 `rawTimestamp`
- `crates/jike-grok-desktop/src/components/Sidebar/index.tsx` — 分组逻辑

**行为：**

| 时间 | 分组标题 |
|------|----------|
| 当天 | 今天 |
| 前一天 | 昨天 |
| 再前一天 | 前天 |
| 更早 | 具体年月日（如 `2026年7月20日`），按日分组、新的在前 |

**问题：** 原先只用格式化后的「3分钟前」当时间源，且依赖未赋值的 `rawTimestamp`，几乎全部掉进 Older。  
**解决：** 写入 ISO `rawTimestamp`，按本地日历日 00:00 切分。

---

### 3.2 删除菜单上下弹出

**改动文件：** `Sidebar/index.tsx`、`App.css`

**问题：** 菜单固定向下，列表底部项被裁切、难看。  
**解决：** 根据按钮在侧栏滚动容器内的上下剩余空间，自动选择 `place-above` / `place-below`。

---

### 3.3 Header 显示对话标题

**改动文件：** `Header/index.tsx`、`App.tsx`、`App.css`

**行为：**

- Header 不再显示模型下拉，改为当前**对话标题**
- 标题来源：侧栏摘要（含重命名）> 本会话用户第一句话 > 「新对话」
- 过长省略号；侧栏历史标题同样加强 ellipsis

**问题：** 原先显示模型名，不符合「对话标题」产品预期。  
**解决：** 去掉模型选择器，改 `chatTitle`；模型仍在设置页配置。

---

### 3.4 会话重命名

**改动文件：**

- `crates/grok-session/src/lib.rs` — `rename_session`
- `commands.rs` / `lib.rs` — Tauri 命令
- `Sidebar` — 菜单「重命名」+ 弹窗

**行为：** 写入官方 `summary.json` 的 `generated_title`（与 TUI `/rename` 同源），标记手动标题。

---

### 3.5 搜索：图标 + 弹层

**改动文件：** `Sidebar/index.tsx`、`App.css`

**行为：**

- 删除侧栏内联「搜索会话…」输入框
- 顶栏增加搜索图标；点击打开类 ChatGPT 居中搜索弹层
- 可过滤标题、点击打开会话；Esc / 遮罩 / ✕ 关闭

---

### 3.6 工具调用可视化

**改动文件：**

- `grok-session` — 映射 `SessionUpdate::ToolCall` / `ToolCallUpdate`
- `state.rs` — 转发 `tool_call` / `tool_call_update`
- 前端 — `ToolCallCard`、消息 `role: 'tool'`

**行为：**

- 展示 kind（读/编/终端/搜索…）、status（等待/运行/完成/失败）、路径或命令摘要
- 有输出可展开预览（截断）
- 同一 `toolCallId` 就地更新
- **历史回放**里的工具事件同样可见（官方 load 回放同一条 ACP 链）

**原则：** 只接官方 ACP 工具事件，不自己猜执行过程。

---

### 3.7 新建会话稳定性 + 空会话不进历史

**改动文件：** `grok-session`、`state.rs`、`commands.rs`、`App.tsx`

**预期行为：**

- 新对话未说话 → 再点 New chat → **不**在历史里累加空「新对话」
- `Start` 时若已有会话，按新建处理，**不再**报「会话已存在」
- 防连点（`starting` / `loading` 时忽略）

**第一轮实现的问题与二次修复：** 见下一节。

---

### 3.8 权限弹窗（查 D 盘空间时整屏模糊）

**改动文件：**

- `grok-session` — `format_permission_description`
- `PermissionModal.tsx`、`App.css`

**行为：**

- 文案：类型 + 命令/路径（可读），不再 `Debug` dump
- 遮罩模糊减弱；卡片可滚动；允许/拒绝按钮样式区分

---

## 四、遇到的问题与解决

### 4.1 侧栏分组全部落在「更早 / Older」

| 项 | 说明 |
|----|------|
| **现象** | 今天的会话也进 Older |
| **原因** | 分组读 `rawTimestamp`，刷新列表时没赋值 |
| **解决** | `list_sessions` 映射时写入 `rawTimestamp: updated_at` |

---

### 4.2 误判「历史回放没做」

| 项 | 说明 |
|----|------|
| **现象** | 分析时认为打开旧会话看不到历史 |
| **事实** | 用户一直能看见；官方 `load_session` 会回放 `updates.jsonl` 到 ACP，前端靠 `session-event` 填消息 |
| **结论** | **没有为「回放」再写一套读 `chat_history.jsonl` 的实现**；也未修改任何会话数据文件 |
| **教训** | 以用户实测 + 官方路径为准，不要只看「前端有没有自己读 history」 |

---

### 4.3 空会话仍堆「新对话」+ 删除当前对话失败

| 项 | 说明 |
|----|------|
| **现象** | 连点 New chat 侧栏一串「新对话」；删当前对话异常 |
| **根因 1** | 官方 `session/new` 会写入 system / system-reminder，空会话 `num_chat_messages` 常为 **1～2**，不是 0。第一版用 `num_chat_messages > 0` 判断「有内容」→ 空会话被当成有效会话 |
| **根因 2** | 删除时会话仍被 Actor 占用，Windows 上文件锁导致删盘失败；前端删完又调 New chat，流程打架 |
| **解决** | ① 空会话判定改为：无真实用户提问、无展示/手动标题（**忽略** `num_chat_messages`）② 新建时 `delete_session_if_blank` + `purge_blank_sessions` ③ 删除走 Actor：先 drop 会话再删盘；删当前则自动开新会话 |

真实空会话 `summary.json` 示例特征：

```json
{
  "num_messages": 0,
  "num_chat_messages": 2,
  "session_summary": "",
  "generated_title": null
}
```

---

### 4.4 查 D 盘空间后界面「糊掉」

| 项 | 说明 |
|----|------|
| **现象** | 整屏变暗、模糊，像坏了 |
| **原因** | 终端命令触发官方 **权限确认**；`modal-backdrop` 全屏 `backdrop-filter: blur` + 描述为 `format!("{:?}", tool_call)` 超长难读 |
| **解决** | 人类可读权限摘要；弹窗布局与按钮样式；减弱模糊 |

**使用方式：** 出现「需要权限」→ 点允许 → Agent 继续执行。

---

## 五、涉及文件一览

| 区域 | 路径 |
|------|------|
| 会话封装 | `crates/grok-session/src/lib.rs` |
| Tauri 后端 | `crates/jike-grok-desktop/src-tauri/src/{lib,commands,state}.rs` |
| 前端总控 | `crates/jike-grok-desktop/src/App.tsx` |
| 类型 | `crates/jike-grok-desktop/src/types/index.ts` |
| 侧栏 | `.../components/Sidebar/index.tsx` |
| Header | `.../components/Header/index.tsx` |
| 工具卡片 | `.../components/Chat/ToolCallCard.tsx`、`MessageItem.tsx` |
| 权限弹窗 | `.../components/Modals/PermissionModal.tsx` |
| 样式 | `crates/jike-grok-desktop/src/App.css` |

**未改：** 官方 `crates/codegen/*` 业务逻辑；未改用户 `chat_history.jsonl` 内容。

---

## 六、验证建议

1. **时间分组：** 侧栏出现「今天 / 昨天 / 前天 / 年月日」。  
2. **重命名 / 搜索：** ⋮ 重命名；顶栏搜索图标打开弹层并点开会话。  
3. **工具卡片：** 让 Agent 读文件 / 跑命令，聊天区出现工具卡片并可展开输出。  
4. **空会话：** 连点 New chat，侧栏不堆空「新对话」。  
5. **删除当前：** ⋮ 删除当前会话，应成功并进入新空白会话。  
6. **权限：** 「看一下 D 盘空间」→ 清晰权限卡 → 允许后继续。

编译抽查：

```text
cargo check -p grok-session -p jike-grok-desktop
```

---

## 七、明确未做 / 后续可做

| 项 | 状态 |
|----|------|
| 工具 diff 高亮 / 流式终端 stdout | 未做（仅卡片 + 预览） |
| Header 快捷切模型 | 未做（设置页已有） |
| CWD 全局统一持久化 | 未做 |
| 附件 / 图片 | 未做 |
| 深色主题 / 多会话并行 | 未做 |

**建议优先级：** 权限与工具体验验收 → CWD 统一 → 模型快捷切换。

---

## 八、一句话总结

今天把桌面端侧栏与会话生命周期补齐，并接上官方工具/权限链路的可视化；最大的坑是**空会话被系统消息计数伪装成有内容**，以及**权限弹窗模糊+Debug 文案**造成「界面坏了」的错觉——均已按官方数据 + 桌面策略修复。
