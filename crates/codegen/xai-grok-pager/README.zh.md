# xai-grok-pager（中文翻译）

> **⚠️ 免责声明**：本文件是对英文原版 `README.md` 的中文翻译，仅供参考。以英文原版 [`README.md`](README.md) 为准。

---

Grok Build 的终端 UI（TUI）。提供交互式全屏幕界面，包括滚动缓冲区视图、提示输入、会话管理和所有模态对话框。

## 架构

```
src/
├── app/                 # 应用状态和事件处理
│   ├── app_view.rs      # 顶层状态（欢迎屏幕、代理、配置）
│   ├── agent_view/      # 每个会话的代理视图（mod.rs 中的结构体 + 各域实现模块）
│   ├── dispatch/        # Action → Effect 调度器（路由器 + 各域模块）
│   ├── effects.rs       # 异步副作用（ACP 调用、文件 I/O）
│   └── event_loop.rs    # 主事件循环（输入、时钟、ACP 消息）
├── views/               # UI 组件
│   ├── prompt_widget.rs # 带文件搜索、斜杠、历史的文本编辑器
│   ├── welcome/         # 欢迎屏幕（logo、菜单、提示）
│   ├── extensions_modal.rs   # 扩展模态框（钩子、插件、市场、技能、MCP 服务器）
│   ├── file_search/     # @ 补全下拉菜单和行查看器
│   ├── slash_dropdown.rs# / 命令补全下拉菜单
│   └── ...              # 滚动缓冲区、状态栏、窗格等
├── scrollback/          # 消息历史渲染
├── slash/               # 斜杠命令注册表和内置命令
├── appearance/          # 主题和 pager.toml 配置
├── acp/                 # Agent Communication Protocol 客户端状态
└── render/              # 底层渲染助手（颜色、换行等）
```

## 核心概念

- **AppView** — 拥有欢迎屏幕、代理会话和全局配置
- **AgentView** — 每个会话一个实例；拥有提示区、滚动缓冲区、工具面板和模态框
- **PromptWidget** — 文本编辑器组件，支持文件搜索（`@`）、斜杠命令（`/`）、历史搜索和粘贴元素
- **Action/Effect** — Elm 风格架构：输入 → Action → 调度 → Effect → 状态更新

## 键盘快捷键

| 快捷键 | 上下文 | 操作 |
|--------|--------|------|
| `Ctrl+P` 或 `?` | 代理屏幕 | 打开命令面板 |
| `Ctrl+L` | 任意（非 VS Code 系列） | 打开插件/钩子模态框；在 VS Code / Cursor / Windsurf / Zed 上使用 `/plugins` 或 `/hooks`（`Ctrl+L` 在回合中途插入） |
| `Tab` | 提示区 | 切换到滚动缓冲区 |
| `Esc` | 回合运行中 | 无操作（不取消；使用 `Ctrl+C`） |
| `Esc` `Esc` | 空闲，提示区非空 | 清空提示区（800ms 内；首次按下显示提示） |
| `Esc` `Esc` | 空闲，提示区空 + 有消息 | 打开回放选择器（首次按下静默） |
| `Ctrl+M` | 提示区 | 切换多行模式 |
| `Shift+Enter` | 提示区 | 插入换行 |
| `/` | 提示区 | 开始斜杠命令 |
| `@` | 提示区 | 开始文件搜索 |
| `!` | 提示区（空） | 进入 bash 模式 |
| `Ctrl+C` | 提示区（有文本） | 清空提示区（即使回合运行中） |
| `Ctrl+C` | 提示区（空）+ 回合运行中 | 取消正在运行的回合 |

## 文档

- [终端支持与故障排除](docs/user-guide/21-terminal-support.md) — tmux/SSH 真彩色、剪贴板、鼠标、诊断、/terminal-setup
- [钩子和插件指南](docs/hooks-and-plugins.md) — 管理钩子、插件和市场来源
- [自定义钩子指南](docs/custom-hooks.md) — 创建、配置和编写您自己的钩子
- [钩子示例](../xai-grok-hooks/examples/README.md) — 常用工作流的示例钩子
- [钩子 Crate（`xai-grok-hooks`）](../xai-grok-hooks/) — 钩子运行时、事件类型和执行引擎
- [插件市场 Crate（`xai-grok-plugin-marketplace`）](../xai-grok-plugin-marketplace/) — 市场来源加载、扫描和安装
