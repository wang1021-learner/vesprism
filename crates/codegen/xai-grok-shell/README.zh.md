# Grok（中文翻译 — 快速参考）

> **⚠️ 免责声明**：本文件是对英文原版 `README.md` 的中文翻译摘要，仅供参考。
> 完整文档见英文原版 [`README.md`](README.md)（约 2500+ 行），这里仅翻译核心内容。

---

一个基于终端的 AI 编码助手和代理线束。

可作为 TUI 交互使用，或通过无头模式和 Agent Client Protocol (ACP) 集成到您的应用中。

## 快速入门

```bash
# 安装
curl -fsSL https://x.ai/cli/install.sh | bash

# 交互式 TUI
grok

# 无头模式（用于脚本/自动化）
grok -p "Explain this codebase"

# 代理模式（用于 IDE/应用集成）
grok agent stdio
```

## 目录

- [安装](#安装)
- [身份验证](#身份验证) — 浏览器登录、API 密钥、OIDC、外部身份验证提供商
- **使用 Grok**
  - [交互式 TUI](#交互式-tui) — 快捷键、斜杠命令、文件引用
  - [无头模式](#无头模式) — 脚本、CI/CD、输出格式
  - [代理模式](#代理模式) — stdio、ACP 集成
  - [SSH 透传](#ssh-透传) — Apple Terminal 剪贴板支持
- **配置**
  - [配置文件](#配置文件) — 通用设置、遥测、LSP、企业部署
  - [自定义模型](#自定义模型) — BYOK、Ollama、OpenAI、自定义端点
  - [MCP 服务器](#mcp-服务器) — 外部工具集成
- **自定义**
  - [项目规则 (AGENTS.md)](#agentsmd) — 项目级系统提示指令
  - [技能](#技能) — 可复用提示包
  - [代理配置](#agent-profiles) — 自定义代理定义
  - [子代理](#子代理) — 并行子会话、角色、人设
  - [插件](#plugins) — 外部工具/技能包
  - [钩子](#hooks) — 项目生命周期脚本
- **特性**
  - [内存](#memory) — 跨会话知识持久化
  - [沙箱](#sandbox) — 操作系统级文件系统/网络隔离
- **参考**
  - [内省 (`grok inspect`)](#introspection)
  - [Claude Code 兼容性](#claude-code-compatibility)
  - [内置工具](#built-in-tools)
  - [会话持久化](#session-persistence) — 存储布局、恢复
  - [文件位置](#file-locations)
  - [环境变量](#environment-variables)
  - [故障排除](#troubleshooting)
- [使用 Grok 构建](#building-with-grok) — 无头 API、ACP SDK 集成

---

## 安装

```bash
# 安装最新稳定版
curl -fsSL https://x.ai/cli/install.sh | bash

# 安装特定版本
curl -fsSL https://x.ai/cli/install.sh | bash -s 0.1.42
```

验证安装：

```bash
grok --version
```

更新到最新版本：

```bash
grok update
```

---

## 身份验证

### 浏览器登录（默认）

首次启动时，Grok 会打开浏览器向 grok.com 进行身份验证：

```bash
grok
```

凭据存储在 `~/.grok/auth.json` 中，跨会话持久。令牌 7 天后过期；
当需要时会提示您重新进行身份验证。

### 重新身份验证

如需切换账户或修复身份验证Issue：

```bash
grok login
```

---

## 交互式 TUI

启动 Grok 时，会出现全屏幕终端 UI。

### 会话

- **新会话**：`Ctrl+N`
- **会话列表**：`Ctrl+L`
- **重命名会话**：选中会话时按 `F2`
- **删除会话**：选中会话时按 `Delete`
- **恢复先前会话**：按 `↑` 查看会话列表并从历史中选择
- **回放模式**：`Esc Esc`（当提示区为空且存在消息时）— 返回到先前状态

### 提示区输入

| 快捷键 | 操作 |
|--------|------|
| `Enter` | 提交 |
| `Shift+Enter` 或 `Ctrl+M` | 插入换行 |
| `Ctrl+U` | 清空行 |
| `Ctrl+W` | 回删一个词 |
| `↑` / `↓` | 浏览提示历史 |
| `Ctrl+P` | 打开命令面板 |
| `Tab` | 切换到滚动缓冲区 |

### 滚动缓冲区

| 快捷键 | 操作 |
|--------|------|
| `j` / `k` 或 `↓` / `↑` | 下/上滚动 |
| `g` / `G` | 跳到顶部/底部 |
| `Ctrl+F` / `Ctrl+B` | 向下/上翻页 |
| `/` | 在缓冲区内搜索 |
| `n` / `N` | 下一个/上一个搜索结果 |
| `m` | 标记位置（a-z） |
| `'` | 跳转到标记位置 |
| `Shift+Tab` | 切换回提示区 |

### 模态窗口

| 快捷键 | 操作 |
|--------|------|
| `Ctrl+L` | 插件/钩子模态窗口 |
| `Ctrl+P` | 命令面板 |
| `Esc` | 关闭模态窗口 |

---

## 无头模式

通过 `-p` 或 `--print` 标志以无头（纯文本）模式运行 Grok，
适用于脚本编写和自动化：

```bash
# 运行单个提示
grok -p "Fix the off-by-one error in src/main.rs"

# 从 stdin 读取
cat error.log | grok -p "What caused these errors?"

# 作为 PR 评论的代码审查
git diff main...feature | grok -p "Review this diff"
```

### 输出格式

`--format` 标志控制输出格式：

```bash
# 默认：纯文本 + 工具结果
grok -p "list all TODOs"

# JSON 输出
grok -p "list all TODOs" --format json

# Markdown 输出
grok -p "list all TODOs" --format markdown
```

---

## 代理模式

代理模式通过 stdio 或 WebSocket 公开 ACP（Agent Client Protocol）友好接口，
以便 IDE 和其他应用可以与 Grok 集成：

```bash
# stdio 传输（推荐在 IDE 扩展中使用）
grok agent stdio

# WebSocket 中继（用于 Web 应用）
grok agent --relay 8080

# TCP 套接字
grok agent tcp --port 9000
```

---

## 配置文件

配置文件位于 `~/.grok/config.toml`（用户级）和 `.grok/config.toml`（项目级）。

### 示例

```toml
# config.toml
[model]
# 默认模型
name = "grok-4"

[telemetry]
# 禁用遥测
enabled = false

[sandbox]
# 沙箱模式
mode = "auto"
```

### 常用设置

| 设置 | 描述 | 默认值 |
|------|------|--------|
| `model.name` | 默认模型 | `grok-4` |
| `telemetry.enabled` | 启用匿名遥测 | `true` |
| `sandbox.mode` | 沙箱模式（`auto`、`off`、`readonly`） | `auto` |
| `memory.enabled` | 启用跨会话内存 | `true` |

---

## 环境变量

| 变量 | 描述 |
|------|------|
| `XAI_API_KEY` | API 密钥（无头模式） |
| `GROK_HOME` | 配置根目录（默认 `~/.grok`） |
| `GROK_MODEL` | 默认模型覆盖 |
| `GROK_TELEMETRY` | `false` 禁用遥测 |
| `GROK_SANDBOX` | 沙箱模式覆盖 |
| `RUST_LOG` | 日志级别（用于调试） |

---

## 内置工具

| 工具 | 描述 |
|------|------|
| `read_file` | 读取文件内容 |
| `search_replace` | 搜索和替换文件内容 |
| `run_terminal_cmd` | 运行终端命令 |
| `grep` | 在文件中搜索模式 |
| `list_dir` | 列出目录内容 |
| `web_search` | 搜索网络 |
| `skill` | 执行已安装的技能 |
| `todo_write` | 管理任务列表 |

---

## 完整文档

完整英文文档（约 2500+ 行，包含每个命令、配置选项和集成模式的详细文档）
请见 [`README.md`](README.md)。
