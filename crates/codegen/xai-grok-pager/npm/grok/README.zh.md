# Grok（中文翻译）

> **⚠️ 免责声明**：本文件是对英文原版 `README.md` 的中文翻译，仅供参考。以英文原版 [`README.md`](README.md) 为准。

---

将 Grok 带入您的终端。快速、无闪烁的 CLI，专为计划、子代理和并行工作而构建。

**[主页](https://x.ai/cli)** | **[文档](https://docs.x.ai/build/overview)**

## 安装

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
```

或通过 npm 安装：

```bash
npm i -g @xai-official/grok
```

## 快速入门

```bash
# 启动交互式 TUI
grok

# 运行单个任务
grok -p "Explain this codebase"
```

首次启动时，Grok 会打开浏览器进行身份验证。对于 CI 或无头环境，请使用来自 [console.x.ai](https://console.x.ai) 的 API 密钥：

```bash
export XAI_API_KEY="xai-..."
```

## 更新

```bash
grok update
```

如果通过 npm 安装：

```bash
npm i -g @xai-official/grok@latest
```

## 支持的平台

| 平台 | 架构 |
|---|---|
| macOS | Apple Silicon (arm64) |
| Linux | x86_64, arm64 |
| Windows | x86_64 |

## 文档

完整文档（包括配置、MCP 服务器、自定义模型、无头模式、代理模式等）请访问 [docs.x.ai/build/overview](https://docs.x.ai/build/overview)。

## 反馈

在 Grok 内运行 `/feedback` 直接报告Issue或发送反馈。
