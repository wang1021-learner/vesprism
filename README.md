<div align="center">

<img src="crates/vesprism-desktop/public/vesprism-logo.png" alt="Vesprism" width="96">

# Vesprism

**AI 原生桌面开发工作台。**

同一个窗口里做两件事：**编码**对着你的 Git 仓库改代码，**工作台**用自然语言编排多 Agent 流程。  
模型循环、工具、权限、MCP、子 Agent、计划、记忆、工作流跑在本机进程里的 [Grok Build](https://github.com/xai-org/grok-build) 官方运行时上；外面这一层是自研 **Tauri 2 + React** 桌面壳——不是套终端，也不是官方 CLI 的安装页。

[它是什么](#它是什么) ·
[能做什么](#能做什么) ·
[两套界面](#两套界面) ·
[启动](#启动) ·
[登录与配置](#登录与配置) ·
[本机数据](#本机数据) ·
[仓库结构](#仓库结构) ·
[和上游的关系](#和上游的关系) ·
[文档](#文档) ·
[许可证](#许可证)

<br>

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.94-dea584.svg?logo=rust)](rust-toolchain.toml)
[![Tauri](https://img.shields.io/badge/Tauri-2-24c8db.svg?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61dafb.svg?logo=react)](https://react.dev)
[![Node](https://img.shields.io/badge/Node-%3E%3D20.12-339933.svg?logo=node.js)](crates/vesprism-desktop/package.json)

</div>

---

## 它是什么

Vesprism 面向「一个人 + 一个仓库 + 一台电脑」：把编码 Agent 做成真正的桌面应用，而不是浏览器页或终端包装。

- **对话即工作。** 在输入框里说要改什么，Agent 读文件、搜索、跑命令、改代码。危险操作会弹出审批，而不是默默全盘执行。
- **流程也能对话生成。** 工作台里用自然语言画出节点、编制岗位、发布成可调用的自动化任务；试跑进度和对话都在画布上。
- **引擎不另起炉灶。** 会话、斜杠命令、MCP、子 Agent、计划模式、记忆、排队、插话、Rewind / Fork 都走官方 `xai-grok-shell`。桌面负责窗口、多 Tab、侧栏，以及把官方事件画出来。
- **配置和官方 CLI 隔离。** 用户数据在 `~/.vesprism`，不会和本机已装的 `grok`（`~/.grok`）抢同一份密钥和会话。同一套 xAI 账号可以两边都登，**文件不是同一份**。

本仓是 [`xai-org/grok-build`](https://github.com/xai-org/grok-build) 的 fork，定期合并上游。日常开发推到 [`wang1021-learner/grokbuild`](https://github.com/wang1021-learner/grokbuild)。

### 不是什么

| 容易误会 | 实际 |
|----------|------|
| 官方 `grok` 命令行 / TUI 的发行包 | 不是。官方安装说明在 [上游 README](https://github.com/xai-org/grok-build) 和 [x.ai/cli](https://x.ai/cli) |
| 用浏览器打开就能聊天 | 开发地址 `127.0.0.1:9527` 只给桌面窗口加载 UI；浏览器里没有会话、没有 IPC |
| 再写一套 Agent 循环 | 没有。工具执行、工作流解释、MCP 客户端都在官方运行时里 |
| 和命令行共用 `~/.grok` | 没有。桌面强制 `GROK_HOME=~/.vesprism` |

---

## 能做什么

侧栏、斜杠命令、设置页都对着同一套官方能力。下面按使用场景列，不是营销清单。

### 编码壳

| 能力 | 说明 |
|------|------|
| 多会话 Tab | 每个 Tab 独立会话、工作区、模型、草稿；后台 Tab 照样收流式事件 |
| 流式对话 | Markdown、代码块、公式（按需加载）、Mermaid；工具行单独订阅，避免整表刷新 |
| 附件与 `@` | 文件 / 文件夹 / 粘贴图；路径限制在当前工作区或系统临时目录的 `vesprism-paste` |
| 斜杠命令 | 以引擎 `commands/list` 为唯一源（`/plan` `/review` `/commit` `/sandbox` …），桌面只补自己的入口 |
| 工具审批 | 允许这次 / 本会话允许 / 总是允许 / 拒绝；只读工具可自动放行；子 Agent 写操作同样走审批条 |
| 计划 / 只问 | `/plan` 先出计划再动手；`/ask` 只读不改文件 |
| 排队与插话 | 生成中 Enter 进官方队列；Ctrl+Enter 立刻插话（不排队） |
| 子 Agent | 父会话里看到脚手架行，可开子 Tab 跟进 |
| Goal / 待办 | 长程目标条、todo 清单钉在对话上方 |
| 记忆 | 全局 / 仓库笔记；`/memory`、flush、整理 |
| 技能 / 工具 / MCP / 插件 | 专用面板浏览、启停；MCP 支持 stdio 与 HTTP |
| Hooks | 工具前后脚本；仓库需先信任 |
| Rewind / Fork | 回滚到历史节点；派生新会话 |
| 会话搜索 | 官方 FTS，侧栏按项目 / 闲聊 / 工作台分组 |
| 右栏 | 文件树、源码、工作区 diff（相对 HEAD） |
| 终端 Dock | 本机 PTY，跟会话绑在一起 |
| 沙箱副本 | `/sandbox` 把改动写到 git worktree，不是进程级沙箱 |
| 定时任务 | 会话内调度，侧栏可打开面板 |
| 反馈 / 分享 | 走官方反馈通道与分享会话 |

### 工作台壳

| 能力 | 说明 |
|------|------|
| 流程画布 | 对话生成 / 迭代节点图（开始、Agent、工具、分支、并行、汇合、结束） |
| 发布 | 写成引擎能发现的 sidecar，编码对话里按名调用 |
| 试跑 | 在画布会话里跑，详情页看子 Agent 结果 |
| Agent 编制 | 岗位、权限规则、人设；发布后给流程节点用 |

两边共用同一套模型和密钥，只是主界面不同。工作台的流程落到当前仓库；编码对话可以调用已经发布的流程。

---

## 两套界面

侧栏左上角切换。会话列表和 Tab **按壳分开**：关掉工作台的 Tab，不会把你丢回编码。

| 壳 | 你在干什么 | 里面有什么 |
|----|------------|------------|
| **编码** | 对着某个 Git 仓库说话、改代码、跑命令 | 多会话 Tab、工作区 / 项目列表、权限与计划审批、记忆、MCP / 技能 / 插件、定时任务、改动面板 |
| **工作台** | 用对话生成和迭代流程，而不是手拖一张图交差 | 流程画布（节点编排、发布、试跑）、Agent 编制（岗位、权限、人设）、已发布的自动化任务 |

画布 / 编制用过的会话默认不进普通历史；只有保存过产物的才会出现在侧栏「工作台」。未绑定产物的画布只活在当前 Tab，这是设计，不是丢失。

---

## 启动

### 环境

| 依赖 | 要求 |
|------|------|
| 操作系统 | Windows / macOS / Linux（日常以 Windows 桌面为主） |
| Rust | 仓库锁定的工具链，见 [`rust-toolchain.toml`](rust-toolchain.toml)（当前 1.94，含 rustfmt / clippy） |
| Node | **20.12+**。`crates/vesprism-desktop` 的启动脚本会优先用 nvm 里的 Node 22，**不改**你给别的项目留着的全局 Node 18 |
| 系统 WebView | Tauri 2 依赖本机 WebView2（Windows）或等价实现 |

首次编译会拉一整棵官方 workspace，时间较长。日常开发只跑桌面包，不要在仓库根做全量 `cargo build`。

### 开发窗口

```sh
cd crates/vesprism-desktop
npm install
npm run desktop          # Vite :9527 + Tauri 窗口
```

请使用弹出的 **桌面窗口**。`http://127.0.0.1:9527` 只是给窗口加载 UI 的地址。

### 安装包与检查

```sh
npm run desktop:build    # 打当前平台安装包
npm run typecheck && npm test
```

密钥、模型、工作区写在本机 `~/.vesprism/config.toml` 和 `~/.vesprism/.env`。设置页里加模型和直接改配置文件等价；改完通常要**重启进程**才会被引擎读到。

**不要把 API key 提交进 Git。** 仓库根和桌面包的 `node_modules/` 也不要提交。

---

## 登录与配置

两条路可以同时存在，互不覆盖：

1. **官方账号。** 设置 → 通用，或斜杠 `/login`。走浏览器回环授权，凭证写在 `~/.vesprism`（`auth.json` 等），**不会**去读命令行已经登录的 `~/.grok`。登出只清桌面这份；环境变量里的密钥仍保留。
2. **API 密钥。** 设置 → 模型，把 key 写入 `~/.vesprism/.env`。可接官方接口，也可以加兼容 OpenAI Chat Completions 的第三方端点（`base_url` + 后端类型）。

其它常用项：

| 位置 | 作用 |
|------|------|
| 设置 → 模型 | 列表、默认模型、思考强度、上下文窗口、采样、自定义 Header |
| 设置 → 安全 | 执行策略、联网、文件范围；本会话「信任模式」与 `/always-approve` 相同 |
| 设置 → 引擎 / Hooks | 引擎偏好、仓库 Hooks 信任 |
| 电脑操作 | 默认关闭（`[desktop] computer_use = false`）。打开后经内置 MCP 截屏/点击/打字，**每次仍走工具审批** |

第三方模型仍可能读到引擎内置的系统提示模板（会自称由 xAI 发布），这是模板不是产品文案。

---

## 本机数据

| 位置 | 内容 |
|------|------|
| `~/.vesprism/` | 整个桌面的 `GROK_HOME`：配置、密钥、会话成绩单、记忆、侧栏 SQLite 索引 |
| `~/.vesprism/config.toml` | 模型列表、默认模型、hooks、sandbox、桌面开关 |
| `~/.vesprism/.env` | API keys（权限会收紧） |
| `~/.vesprism/sessions/` | 官方 session 目录 + `threads.sqlite` |
| `~/.vesprism/scratch/` | 未绑定仓库时的闲聊工作区 |
| 当前打开的仓库 | 编码改动；工作台发布的流程 sidecar（如 `.grok/workflows/`） |
| 本仓库 `crates/vesprism-desktop` | 桌面前端 + Tauri 后端源码 |

旧目录 `~/.jike-grok-desktop` 若还在，启动时会一次性迁到 `~/.vesprism`。

---

## 仓库结构

```
crates/vesprism-desktop/     桌面产品（React 19 + Vite 8 + Tauri 2）
crates/grok-session/         桌面胶水：进程内 ACP 客户端，包官方 agent
crates/codegen/xai-grok-*    官方引擎、工具、MCP、工作流、配置…
crates/common/               官方公共库
docs/                        Vesprism 手册与上游合并说明
```

运行时从窗口到引擎：

```
Vesprism 窗口 (React)
    → Tauri IPC（每 Tab 一个 Actor）
grok-session（自建 ACP 客户端）
    → 进程内内存管道
xai-grok-shell（官方 Agent 运行时，不是另起 grok 子进程）
```

前端状态：`tabStates: Map<tabId, TabState>` 是唯一事实源；`$messages` 等 atom 只是当前 Tab 的投影。改 UI 时写 `patchTab` / `patchActiveTab`，不要绕过 map 去 set 全局 atom。

---

## 和上游的关系

| 路径 | 归属 | 合并时 |
|------|------|--------|
| `crates/codegen/xai-grok-*`、`crates/common/*` | 官方引擎 | 上游优先，本地补丁要记账 |
| `crates/grok-session` | 桌面胶水 | 两边都留 |
| `crates/vesprism-desktop` | 桌面 UI | 以本仓为准 |

新功能默认顺序：**先查官方有没有现成 ACP / `x.ai/*` 扩展 → 能在桌面或 `grok-session` 接上就接 → 只有根因在引擎里才改 `xai-grok-*`。** 细则见 [`docs/官方代码修改原则.md`](docs/官方代码修改原则.md)。拉上游按 [`docs/官方合并与二次开发工作流.md`](docs/官方合并与二次开发工作流.md)。

官方终端 `grok` 的安装、TUI 截图和发行说明在 [上游 README](https://github.com/xai-org/grok-build)。本页不是那份文档。上游仓库本身不接受外部 PR；本 fork 用于 Vesprism 桌面二次开发。

---

## 文档

| 文档 | 内容 |
|------|------|
| [`docs/Vesprism-全功能与实现手册.md`](docs/Vesprism-全功能与实现手册.md) | 现码怎么接、该动哪一层（给接手的人 / Agent） |
| [`docs/官方合并与二次开发工作流.md`](docs/官方合并与二次开发工作流.md) | fetch / merge / 冲突口诀 |
| [`docs/官方代码修改原则.md`](docs/官方代码修改原则.md) | 什么时候允许改 `xai-grok-*` |
| [`docs/桌面端-组装层设计.md`](docs/桌面端-组装层设计.md) | 会话组装单（模型 / 工具 / 权限 / 流程挂载） |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 上游贡献政策（英文原文） |
| [`SECURITY.md`](SECURITY.md) | 安全问题怎么报 |
| [中文摘要](README.zh.md) | 本页的短版 |

`docs/官方同步-*.md` 是各次合并上游的记录，合并出冲突时对照着看。

---

## 许可证

上游与本仓二次开发均为 **Apache-2.0**。法律文本以英文 [`LICENSE`](LICENSE) 为准，中文参考 [`LICENSE.zh.md`](LICENSE.zh.md)。

---

**Vesprism** is a desktop workbench on the Grok Build agent runtime: a **coding** shell for your repo, and a **workbench** shell for conversational multi-agent flows. The model loop, tools, permissions, MCP, subagents, memory, and workflows run in-process via the official `xai-grok-shell`; this repo adds a Tauri 2 + React 19 shell around it.

This tree is a fork of [`xai-org/grok-build`](https://github.com/xai-org/grok-build), not the official CLI distribution. Day-to-day development is pushed to [`wang1021-learner/grokbuild`](https://github.com/wang1021-learner/grokbuild). Config lives in `~/.vesprism` (`GROK_HOME`), isolated from the CLI’s `~/.grok`.

```sh
cd crates/vesprism-desktop && npm install && npm run desktop
```

Use the native window that opens. Opening `http://127.0.0.1:9527` in a browser only shows the static shell. Full documentation (Chinese) is in this file and in [`docs/`](docs/). License: Apache-2.0.
