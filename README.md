<div align="center">

<img src="crates/vesprism-desktop/public/vesprism-logo.png" alt="Vesprism" width="96">

# Vesprism

**AI 原生桌面开发工作台。**  
编码改仓库，工作台编排流程。引擎用 [Grok Build](https://github.com/xai-org/grok-build) 官方运行时，桌面是自研壳。

[启动桌面](#启动桌面) ·
[两套界面](#两套界面) ·
[和上游的关系](#和上游的关系) ·
[文档](#文档) ·
[许可证](#许可证)

</div>

---

## 启动桌面

需要 **Node 20.12+**（本包脚本会优先用本机 nvm 的 22，不改全局 Node 18）和仓库锁定的 **Rust** 工具链。

```sh
cd crates/vesprism-desktop
npm install
npm run desktop
```

用弹出的桌面窗口，不要拿浏览器打开 `127.0.0.1:9527`。  
打包安装包：`npm run desktop:build`。  
检查：`npm run typecheck` 与 `npm test`。

密钥和模型写在本机 `~/.vesprism/`（`config.toml` / `.env`），和命令行 `grok` 的 `~/.grok` 分开。不要把 API key 提交进仓库。

## 两套界面

| 壳 | 做什么 |
|----|--------|
| **编码** | 对话写代码、权限审批、计划、记忆、MCP、技能 |
| **工作台** | 流程画布、Agent 编制、已发布自动化任务 |

侧栏左上角切换。会话、Tab 按壳分开。

## 和上游的关系

本仓 fork 自 [`xai-org/grok-build`](https://github.com/xai-org/grok-build)，定期 `merge upstream/main`。

| 路径 | 归属 |
|------|------|
| `crates/codegen/xai-grok-*` | 官方引擎 |
| `crates/grok-session` | 桌面胶水（进程内 ACP） |
| `crates/vesprism-desktop` | 桌面 UI |

官方 CLI/TUI 的安装与说明以 [上游 README](https://github.com/xai-org/grok-build) 为准，不要用本页当 `grok` 安装文档。

日常推送：`origin` = `wang1021-learner/grokbuild`。  
改官方 crate 的规则：[`docs/官方代码修改原则.md`](docs/官方代码修改原则.md)。

## 文档

- [`docs/Vesprism-全功能与实现手册.md`](docs/Vesprism-全功能与实现手册.md) — 现码怎么接、改哪一层
- [`docs/官方合并与二次开发工作流.md`](docs/官方合并与二次开发工作流.md) — 拉上游
- [中文 README](README.zh.md)

## 许可证

上游与本仓二次开发均为 **Apache-2.0**。法律文本以英文 [`LICENSE`](LICENSE) 为准；中文参考 [`LICENSE.zh.md`](LICENSE.zh.md)。

---

<div align="center">

**Vesprism** is a desktop workbench around the Grok Build agent runtime: coding chat and a flow canvas. It is a fork of [`xai-org/grok-build`](https://github.com/xai-org/grok-build), not the official CLI. Run `cd crates/vesprism-desktop && npm run desktop`.

</div>
