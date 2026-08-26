<div align="center">

<img src="crates/vesprism-desktop/public/vesprism-logo.png" alt="Vesprism" width="96">

# Vesprism

**AI 原生桌面开发工作台。**  
在同一窗口里：**编码**改你的仓库，**工作台**用自然语言编排多 Agent 流程。  
模型循环、工具、权限、工作流跑在本机进程里的 [Grok Build](https://github.com/xai-org/grok-build) 官方运行时上；外面这一层是自研 Tauri 桌面壳，不是套终端、也不是官方 CLI 安装页。

[它是什么](#它是什么) ·
[两套界面](#两套界面) ·
[启动桌面](#启动桌面) ·
[本机数据](#本机数据) ·
[和上游的关系](#和上游的关系) ·
[文档](#文档) ·
[许可证](#许可证)

</div>

---

## 它是什么

Vesprism 面向「一个人 + 一个仓库 + 一台电脑」：把编码 Agent 做成真正的桌面应用。

- **对话即工作。** 你在输入框里说要改什么，Agent 读文件、搜索、跑命令、改代码；危险操作会弹权限，而不是默默全盘执行。
- **流程也能对话生成。** 工作台里用自然语言画出节点、编制岗位、发布成可调用的自动化任务；试跑进度和对话都在画布上。
- **引擎不另起炉灶。** 会话、斜杠命令、MCP、子 Agent、计划模式、记忆、排队、插话、Rewind / Fork 都走官方 `xai-grok-shell`。桌面负责窗口、多 Tab、侧栏和把官方事件画出来。
- **配置和官方 CLI 隔离。** 用户数据在 `~/.vesprism`，不会和本机已装的 `grok`（`~/.grok`）抢同一份密钥和会话。

本仓是 [`xai-org/grok-build`](https://github.com/xai-org/grok-build) 的 fork，定期合并上游。日常开发推到 `wang1021-learner/grokbuild`。

## 两套界面

侧栏左上角切换。会话列表和 Tab 按壳分开，关掉工作台的 Tab 不会把你丢回编码。

| 壳 | 你在干什么 | 里面有什么 |
|----|------------|------------|
| **编码** | 对着某个 Git 仓库说话、改代码、跑命令 | 多会话 Tab、工作区/项目列表、权限与计划审批、记忆、MCP / 技能 / 插件、定时任务、改动面板 |
| **工作台** | 用对话生成和迭代流程，而不是手拖一张图交差 | 流程画布（节点编排、发布、试跑）、Agent 编制（岗位、权限、人设）、已发布的自动化任务 |

工作台的流程会落到仓库里的 sidecar，编码对话也可以按名调用已发布的流程。两边共用同一套模型和密钥，只是主界面不同。

## 启动桌面

需要仓库锁定的 **Rust** 工具链（见 `rust-toolchain.toml`），以及 **Node 20.12+**。本包启动脚本会优先用 nvm 里的 Node 22，**不改**你给别的项目留着的全局 Node 18。

```sh
cd crates/vesprism-desktop
npm install
npm run desktop          # 开发：Vite + Tauri 窗口
```

请使用弹出的 **桌面窗口**。`127.0.0.1:9527` 只是给窗口加载 UI 的地址，用浏览器打开只能看到壳、调不了会话。

```sh
npm run desktop:build    # 打安装包
npm run typecheck && npm test
```

密钥、模型、工作区写在本机 `~/.vesprism/config.toml` 和 `~/.vesprism/.env`。设置页里加模型和改配置文件等价；改完通常要重启进程才会被引擎读到。 **不要把 API key 提交进 Git。**

## 本机数据

| 位置 | 内容 |
|------|------|
| `~/.vesprism/` | 配置、密钥、会话、记忆、桌面索引（`GROK_HOME`） |
| 当前打开的仓库 | 编码改动、工作台发布的流程 sidecar |
| 本仓库 `crates/vesprism-desktop` | 桌面前端 + Tauri 后端 |

旧目录 `~/.jike-grok-desktop` 若还在，启动时会一次性迁到 `~/.vesprism`。

## 和上游的关系

```
Vesprism 窗口 (React)
    → Tauri IPC
grok-session（自建 ACP 客户端）
    → 进程内内存管道
xai-grok-shell（官方 Agent 运行时）
```

| 路径 | 归属 | 合并时 |
|------|------|--------|
| `crates/codegen/xai-grok-*`、`crates/common/*` | 官方引擎 | 上游优先，本地补丁要记账 |
| `crates/grok-session` | 桌面胶水 | 两边都留 |
| `crates/vesprism-desktop` | 桌面 UI | 以本仓为准 |

官方终端 `grok` 的安装、TUI 截图和 [x.ai/cli](https://x.ai/cli) 说明在 [上游 README](https://github.com/xai-org/grok-build)。本页不是那份安装文档。

改官方代码前先读 [`docs/官方代码修改原则.md`](docs/官方代码修改原则.md)；拉上游按 [`docs/官方合并与二次开发工作流.md`](docs/官方合并与二次开发工作流.md)。

## 文档

- [`docs/Vesprism-全功能与实现手册.md`](docs/Vesprism-全功能与实现手册.md) — 现码怎么接、该动哪一层
- [`docs/官方合并与二次开发工作流.md`](docs/官方合并与二次开发工作流.md) — fetch / merge / 冲突口诀
- [`docs/官方代码修改原则.md`](docs/官方代码修改原则.md) — 什么时候允许改 `xai-grok-*`
- [中文 README](README.zh.md)

## 许可证

上游与本仓二次开发均为 **Apache-2.0**。法律文本以英文 [`LICENSE`](LICENSE) 为准，中文参考 [`LICENSE.zh.md`](LICENSE.zh.md)。

---

**Vesprism** is a desktop workbench on top of the Grok Build agent runtime: a coding shell for the repo, and a workbench shell for conversational flow design. This repository is a fork of [`xai-org/grok-build`](https://github.com/xai-org/grok-build), not the official CLI distribution. Run `cd crates/vesprism-desktop && npm run desktop`. Config lives in `~/.vesprism`, isolated from `~/.grok`.
