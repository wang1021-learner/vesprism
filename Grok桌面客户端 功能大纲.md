# Grok Build 桌面客户端 —— 从 0 到 1 完整功能大纲

> 初稿整理：2026-07-23  
> **代码对照更新：2026-07-26**（对照 `crates/jike-grok-desktop`、`crates/grok-session` 源码与现有 Tauri command 清单）  
> 说明：本文档梳理 Grok Build 二次开发桌面端的功能范围，包括已完成、部分完成、明确不做、以及尚未开始的部分，供后续规划参考。

---

## 本次代码对照结论（相对 07-23 大纲）

| 条目 | 07-23 | 现码 | 依据（摘要） |
|------|-------|------|--------------|
| CWD 全局持久化 | ⬜ | ✅ | `set_workspace_cwd` / `load_persisted_workspace_cwd` → `config.toml` `[desktop].workspace_cwd`；Composer 工作区切换 + 必要时 `restart_session` |
| Composer 模型热切换 | 明确不做「Header 第二入口」 | ✅（改述） | 输入框模型下拉 → `set_current_model` / 协议层切换，**非** Header 设置双入口 |
| `context_window` GUI | 明确不做 | ✅ | 设置页「上下文窗口 (K)」可编辑并写回 config |
| `system_prompt_label` 自由编辑 | 明确不做 | 仍不做 | 保存时按 model 自动生成，无独立 GUI 字段 |
| 侧栏跨工作区分组 | 未单列 | ✅ | `list_sessions` 返回全量 + `cwd`；侧栏「工作空间 → 时间」两层 |
| 上下文 token 用量 | 未单列 | ✅ | `token_usage` 事件 + Composer 用量条 |
| 工具输出增量刷新 | 未单列 | ✅ 部分 | `tool_call_update` 合并 `preview`；可展开，截断文本，**非**完整终端/diff 高亮 |
| 思考折叠 | 部分 | 仍部分 | 有思考气泡，**无**点击折叠 |
| 全文搜索 / 密钥链 / 虚拟列表 等 | ⬜ | 仍 ⬜ | 见下文各表 |

---

## 一、核心引擎层（Agent Runtime 集成）

| 功能 | 状态 | 备注 |
|---|---|---|
| Library 依赖集成（非子进程套壳） | ✅ | `xai_grok_shell::spawn_agent_local` + workspace 成员 |
| 内存双工管道通信（`tokio::io::duplex`） | ✅ | `grok-session` |
| ACP 协议握手（`initialize` + `new_session`） | ✅ | |
| 流式事件转发（文本/思考/工具调用） | ✅ | 含前端打字机缓释 |
| 权限请求异步交互（`oneshot` 挂起等待） | ✅ | |
| 取消生成（`cancel`） | ✅ | |
| 会话恢复（`load_session`/`resume`） | ✅ | `GrokSession::resume` |
| 会话重启/新建（`Restart`，复用销毁重建套路） | ✅ | |
| 会话删除（含「当前会话」边界处理） | ✅ | Actor 内先释放再删盘 |
| 空会话判定与自动清理 | ✅ | `is_blank_session` / 列表过滤 |
| 会话重命名（`update_session_title`） | ✅ | `rename_session` |
| 会话模型热切换（不重启） | ✅ | `SetSessionModel` / `set_current_model` |
| 模型目录热重载 | ✅ | `reload_models` |
| 上下文 token 用量上报 | ✅ | `_meta.totalTokens` → `TokenUsage` |
| 多会话并行（同时开多个独立对话窗口/标签） | ⬜ 未做 | 单 Actor + 单一 `GrokSession` |
| 会话分支/Fork（从某一轮对话派生新会话） | ⬜ 未做 | 协议/官方层可能已支持，桌面未接入 |
| 流式响应中断续传/断线重连 | ⬜ 未做 | |

---

## 二、配置与模型管理

| 功能 | 状态 | 备注 |
|---|---|---|
| 独立 `GROK_HOME` 配置隔离（与命令行/官方目录分离） | ✅ | 默认 `~/.jike-grok-desktop` |
| 官方配置读写复用（`load_effective_config`/`update_config`） | ✅ | |
| 工作目录选择（原生对话框） | ✅ | `@tauri-apps/plugin-dialog` |
| CWD 全局统一持久化（跨会话记住上次工作目录） | ✅ | `config.toml` `[desktop].workspace_cwd`；内存 override 即时生效 |
| Composer / 设置内切换工作区 | ✅ | 空会话时可切换；有会话则 `restart_session` |
| API Key 状态展示（只读，不回显明文） | ✅ | `get_env_status` 仅 `is_set` |
| API Key 写入（`.env`，跟随模型 `env_key`） | ✅ | 仍为明文 `.env`，见工程化安全项 |
| 多模型配置（新增/编辑/删除，精简字段） | ✅ | 设置页左侧导航「模型」 |
| 默认模型切换 | ✅ | |
| Composer 模型下拉热切换（会话内） | ✅ | **不是** Header 旁第二套设置入口；与「避免双入口维护设置表单」一致 |
| `context_window` GUI（按 K 填写） | ✅ | 设置页可编辑并校验 |
| `system_prompt_label` 自由编辑 GUI | ⬜ 明确不做 | 保存时按模型名自动生成，防误填 |
| 配置导入/导出（备份、迁移到另一台机器） | ⬜ 未做 | |
| MCP 服务器配置管理（增删 MCP 连接） | ⬜ 未做 | 引擎侧有 MCP crate，桌面无 GUI |

---

## 三、界面与交互（桌面壳）

| 功能 | 状态 | 备注 |
|---|---|---|
| 浅色主题（Claude/Codex 风格） | ✅ | |
| 侧边栏历史列表（真实数据） | ✅ | |
| 侧边栏按**工作空间 → 时间**两层分组 | ✅ | 跨 cwd 会话列表；当前工作区优先 |
| 侧边栏折叠/展开 | ✅ | |
| 搜索弹层（本地**标题**过滤） | ✅ | |
| 搜索接入官方全文索引（`session_search.sqlite`） | ⬜ 未做 | 仍只匹配标题 |
| 会话重命名弹窗 | ✅ | |
| 删除会话（菜单+确认） | ✅ | |
| Header 显示当前对话标题 | ✅ | 无 Header 设置按钮；设置仅在侧栏 |
| 设置页（左侧分类：通用 / 模型） | ✅ | |
| 消息气泡（用户/AI/思考/系统统一视觉语言） | ✅ | |
| 思考过程展示 | ✅ 部分 | 有思考气泡；**无**折叠/展开交互 |
| Markdown 渲染（代码高亮/表格/引用） | ✅ | 流式时跳过高亮以减负 |
| 工具调用可视化卡片（状态/路径/命令摘要，可展开输出） | ✅ | |
| 工具调用输出增量更新 | ✅ 部分 | `tool_call_update` 刷新 `preview`；截断纯文本 |
| 工具调用 **diff 语法高亮**（编辑前后对比 UI） | ⬜ 未做 | 后端预览可能含 `diff path\n…` 片段，前端无 diff 组件 |
| 流式终端 stdout 专用展示 | ⬜ 未做 | 与「preview 增量」不同：无类终端实时滚动视图 |
| 权限确认弹窗（人类可读文案） | ✅ | |
| 悬浮输入框 + 发送/取消 | ✅ | |
| Composer 上下文用量条 | ✅ | 依赖 `context_window` 与 `token_usage` |
| 消息列表智能贴底滚动 | ✅ | 上滑暂停自动滚底 |
| 深色主题 | ⬜ 未做 | |
| 附件/图片输入（粘贴截图、拖拽文件） | ⬜ 未做 | TUI 侧有 `Alt+V`，桌面未接入 |
| 快捷键体系（如 Cmd+K 搜索、Cmd+N 新建） | ⬜ 未做 | 仅有 Escape 关弹层、Enter 发送等局部键 |
| 通知/提醒（生成完成时系统通知） | ⬜ 未做 | |
| 多语言/i18n | ⬜ 未做 | 中文写死 |
| 无障碍支持（键盘导航、屏幕阅读器） | ⬜ 未做 | 少量 `aria-*`，未体系化 |

---

## 四、稳定性与工程化

| 功能 | 状态 | 备注 |
|---|---|---|
| 浏览器误开引导页 | ✅ | |
| Windows 编译兼容性修复（`/dev/stdout` 等） | ✅ | |
| workspace 集成规范（依赖统一 `workspace = true`） | ✅ | |
| 单元测试（`session_update_to_event` 等） | ✅ | `grok-session` 内 `#[cfg(test)]` |
| 集成测试（端到端会话流程自动化） | ⬜ 未做 | 桌面 crate 无 e2e/playwright |
| 错误上报/崩溃日志收集 | ⬜ 未做 | `tauri-plugin-log` 仅本地 |
| 性能：超长对话历史虚拟滚动/分页加载 | ⬜ 未做 | 历史消息仍一次性进 `messages` 状态 |
| 安全：密钥从明文 `.env` 升级到系统密钥链 | ⬜ 未做 | 路径：`%USERPROFILE%\.jike-grok-desktop\.env` |
| 自动更新机制（Tauri updater） | ⬜ 未做 | |
| 安装包/分发（签名、安装向导） | ⬜ 未做 | |
| 跨平台验证（macOS/Linux） | ⬜ 未做 | 目前主验证 Windows |

---

## 五、协作与扩展能力（远期，非近期规划）

| 功能 | 状态 | 备注 |
|---|---|---|
| 会话导出（Markdown/PDF） | ⬜ 未做 | |
| 团队共享配置 | ⬜ 未做 | |
| 插件市场 GUI | ⬜ 未做 | 官方 `plugin-marketplace` 在配置层，无桌面管理 |
| Agent 定义/角色切换 | ⬜ 未做 | 仍偏向固定 plan/agent 路径，无 GUI 切换 |

---

## 六、建议的下一阶段优先级

按对**当前实际使用**影响排序（已完成项已从队列移除）：

1. **API Key 明文存储升级** —— 安全类；仍为 `.env` 明文，风险不该无限期搁置。  
2. **超长对话历史性能** —— 全量 `messages` 数组；长会话会卡，越晚越难拆。  
3. **搜索接入全文索引** —— 标题过滤在会话变多后会明显不够。  
4. **工具 diff 高亮 / 思考折叠定稿** —— 引擎已有 diff 预览片段与思考事件，差的是 GUI 打磨。  
5. **MCP 配置 GUI** —— 扩展能力入口；引擎已有能力，桌面零管理面。

其余（多会话并行、深色主题、插件市场、跨平台、自动更新）仍属锦上添花或用户增长后再做，不建议现在分散精力。

---

## 七、贯穿全程的核心原则（供后续协作者参考）

1. **只加不改、不删除、不重构官方代码**，最小化与上游同步的合并冲突成本。  
2. **动手写之前，先查官方是否已有对应能力**：通读真实源码（函数签名、可见性、依赖链），确认无现成能力后再自建。协议细节以源码为准。  
   - 案例：会话恢复——`load_session` + `MvpAgent` 已实现，避免自造读 `chat_history.jsonl`。  
   - 案例：会话列表——复用 `list_summaries` / `list_all_sessions`。  
   - 案例：配置读写——优先官方 `update_config` / `toml_edit` 路径，而非手写字符串拼接。  
3. **敏感配置不进仓库**；密钥一旦可能泄露应立即吊销重建。当前落盘为 `$GROK_HOME/.env`，后续应迁系统密钥链。  
4. **跟官方 crate 交互的第三方依赖，一律 `workspace = true`**。  
5. **测试/临时环境用独立的 `GROK_HOME` 隔离**。  
6. **每一次功能改动都要有独立可验证的步骤**；涉及删除/迁移需额外审查。  
7. **系统提示词等认知层配置，优先官方覆盖机制**，不 hack 底层。  
8. 上游仓库不接受 PR，只能自行 fork 维护，定期 `git fetch upstream` 手动同步。

---

## 八、主要代码锚点（便于下次对照）

| 区域 | 路径 |
|------|------|
| 桌面前端 | `crates/jike-grok-desktop/src/`（`App.tsx`、`components/*`） |
| Tauri 命令 | `crates/jike-grok-desktop/src-tauri/src/commands.rs` |
| 会话 Actor | `crates/jike-grok-desktop/src-tauri/src/state.rs` |
| 会话封装 / ACP | `crates/grok-session/src/lib.rs` |
| 桌面配置与密钥 | `$GROK_HOME` 默认 `~/.jike-grok-desktop`（`config.toml` + `.env`） |

下次更新建议：改完功能后同步改本表状态，并在「本次代码对照结论」追加一行日期与 diff 摘要。
