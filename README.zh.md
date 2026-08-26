# Vesprism

GitHub 仓库首页默认渲染根目录 [`README.md`](README.md)。下面是同一份说明的中文摘要。

**Vesprism** 是 AI 原生桌面开发工作台：同一个窗口里，**编码**对着仓库写代码，**工作台**用自然语言生成和迭代多 Agent 流程。模型循环、工具、权限、MCP、子 Agent、计划、记忆、工作流都跑在本机进程里的官方 Grok Build 运行时上；`crates/vesprism-desktop` 只做桌面壳（Tauri + React），不是套一层终端。

侧栏左上角在两套界面之间切换，会话和 Tab 按壳分开。配置和会话在 `~/.vesprism`，和命令行 `grok` 的 `~/.grok` 隔离。

```sh
cd crates/vesprism-desktop
npm install
npm run desktop
```

请用弹出的桌面窗口。浏览器打开开发地址只能看到静态壳，没有会话。

本仓 fork 自 [xai-org/grok-build](https://github.com/xai-org/grok-build)，定期合并上游。官方终端版安装以 [上游 README](https://github.com/xai-org/grok-build) 为准。

现码手册：[`docs/Vesprism-全功能与实现手册.md`](docs/Vesprism-全功能与实现手册.md)。  
许可证 Apache-2.0，以 [`LICENSE`](LICENSE) 为准。
