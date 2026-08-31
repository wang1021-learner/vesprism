# Vesprism

GitHub 仓库首页渲染根目录 [`README.md`](README.md)（完整中文说明：产品定位、三套界面、能力表、启动、登录、数据目录、和上游的关系）。下面是同一份内容的短摘要。

**Vesprism** 是 AI 原生桌面开发工作台：同一个窗口里三套产品，**编码**对着仓库写代码，**工作台**用自然语言生成和迭代多 Agent 流程，**写完**按章循环写长篇。模型循环、工具、权限、MCP、子 Agent、计划、记忆、工作流都跑在本机进程里的官方 Grok Build 运行时上；`crates/vesprism-desktop` 只做桌面壳（Tauri 2 + React 19），不是套一层终端。

侧栏左上角在三套界面之间切换，会话和 Tab 按壳分开。写完侧栏是书，不是引擎会话。配置和会话在 `~/.vesprism`，和命令行 `grok` 的 `~/.grok` 隔离。官方账号登录的凭证也只写在 Vesprism 目录，不会沿用命令行已经登录的账号。

```sh
cd crates/vesprism-desktop
npm install
npm run desktop
```

请用弹出的桌面窗口。浏览器打开 `http://127.0.0.1:9527` 只能看到静态壳，没有会话。

需要仓库锁定的 Rust 工具链（见 `rust-toolchain.toml`）和 Node 20.12+。启动脚本会优先用 nvm 里的 Node 22，不改你的全局 Node。

本仓 fork 自 [xai-org/grok-build](https://github.com/xai-org/grok-build)，日常推送到 [wang1021-learner/grokbuild](https://github.com/wang1021-learner/grokbuild)，定期合并上游。官方终端版安装以 [上游 README](https://github.com/xai-org/grok-build) 为准。

现码手册：[`docs/Vesprism-全功能与实现手册.md`](docs/Vesprism-全功能与实现手册.md)。  
许可证 Apache-2.0，以 [`LICENSE`](LICENSE) 为准。
