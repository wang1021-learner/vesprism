# Grok Build 用户指南（中文翻译）

> **⚠️ 免责声明**：本文件是对英文原版 `README.md` 的中文翻译，仅供参考。以英文原版 [`README.md`](README.md) 为准。

---

学习如何安装、配置和扩展 Grok Build — SpaceXAI 的终端 AI 编码助手。

---

## Tier 1：入门必读

从这里开始。这些指南覆盖您第一天使用所需了解的内容。

| # | 文档 | 描述 |
|---|------|------|
| 1 | [快速入门](01-getting-started.md) | 安装、首次启动、身份验证、基本交互和核心概念 |
| 2 | [身份验证](02-authentication.md) | 浏览器登录、API 密钥、OIDC/SSO、外部身份验证提供商和设备码流程 |
| 3 | [键盘快捷键](03-keyboard-shortcuts.md) | TUI 中每个键绑定和鼠标操作的参考 |
| 4 | [斜杠命令](04-slash-commands.md) | 用于会话、模型、内存、钩子和插件的每个 `/` 命令 |
| 5 | [配置](05-configuration.md) | `config.toml`、`pager.toml`、环境变量和文件位置 |

---

## Tier 2：核心功能

自定义和扩展 Grok Build。

| # | 文档 | 描述 |
|---|------|------|
| 6 | [主题与外观](06-theming.md) | 主题、`/theme` 命令、`pager.toml` 和颜色支持检测 |
| 7 | [MCP 服务器](07-mcp-servers.md) | 通过 Model Context Protocol 进行外部工具集成 |
| 8 | [技能](08-skills.md) | SKILL.md 格式的可复用提示包 |
| 9 | [插件](09-plugins.md) | 捆绑并共享技能、命令、代理、钩子和 MCP 服务器；从市场源安装 |
| 10 | [钩子](10-hooks.md) | 用于工具使用前后事件的生命周期脚本和 HTTP 回调 |
| 11 | [自定义模型](11-custom-models.md) | 自带密钥、Ollama 和 OpenAI 兼容端点 |
| 12 | [项目规则 (AGENTS.md)](12-project-rules.md) | 每目录 AGENTS.md 指令及其优先级 |
| 13 | [内存](13-memory.md) | 跨会话知识持久化，带 `/flush`、`/dream` 和混合搜索 |

---

## Tier 3：高级用法

自动化、脚本编写以及与其他系统的集成。

| # | 文档 | 描述 |
|---|------|------|
| 14 | [无头模式与脚本](14-headless-mode.md) | `grok -p`、输出格式、CI/CD 集成和管道 |
| 15 | [代理模式与 IDE 集成](15-agent-mode.md) | ACP stdio 传输、WebSocket 中继和 SDK 集成 |
| 16 | [子代理与角色](16-subagents.md) | 并行子会话、代理类型、角色和能力模式 |
| 17 | [会话管理](17-sessions.md) | 保存、加载、恢复、回放、压缩和会话持久化格式 |
| 18 | [沙箱模式](18-sandbox.md) | 操作系统级文件系统和网络隔离配置文件 |
| 19 | [计划模式](19-plan-mode.md) | 结构化规划、计划文件编辑和编码前审批 |
| 20 | [后台任务与监控](20-background-tasks.md) | `background: true`、`/loop`、`monitor` 和 `Ctrl+G` 降级 |
| 21 | [终端支持与故障排除](21-terminal-support.md) | tmux、SSH、真彩色、剪贴板和 OSC 52 |
| 22 | [权限与安全控制](22-permissions-and-safety.md) | `dontAsk` 模式、自动批准工具、安全 bash 列表和限制性 PreToolUse 钩子（如仅 git/gh） |
