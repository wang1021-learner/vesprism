# 第三方声明（中文翻译摘要）

> **⚠️ 免责声明**：本文件是对英文原版第三方声明的中文翻译摘要，仅供参考。法律效力以英文原版 [`THIRD-PARTY-NOTICES`](THIRD-PARTY-NOTICES) 为准。

---

## 说明

本文件是 Grok Build CLI 的所有第三方依赖项的版权声明与许可证文本的翻译摘要。

原版文件结构包括：
- **PART I** — 逐包条目（约 300+ 个依赖项，含 MIT、Apache-2.0、BSD、ISC、Zlib、MPL-2.0、Unicode 等多许可证）
- **PART II** — 许可证全文（各许可证标准文本）
- **PART III** — 双许可证声明
- **PART IV** — 来源代码库链接

由于原文件约 18,800 行，中文版仅保留以下核心内容的翻译：

---

## 包含的第三方软件类型

| 许可证类型 | 示例项目 |
|-----------|---------|
| Apache License 2.0 | tokio, axum, tonic, prost, serde, reqwest, gix |
| MIT | rand, regex, clap, tracing, pulldown-cmark, crossterm |
| BSD-2/3-Clause | 多项加密与压缩库 |
| ISC | 多项开源工具 |
| MPL-2.0 | cssparser, unicode-bidi |
| Zlib | 多个压缩库 |
| Unicode 许可证 | unicode-segmentation, unicode-width |
| BSL-1.0 | 多个 Boost 派生库 |
| 其他（CDLA, GPL+linking-exception 等） | libgit2 等 |

---

## 主要供应商说明

### 嵌入式第三方源码包（vendored crates，位于 `third_party/` 目录）

| 路径 | 许可证 | 上游仓库 |
|------|--------|----------|
| `third_party/mermaid-to-svg/` | MIT | https://github.com/warpdotdev/mermaid-to-svg |
| `third_party/dagre_rust/` | Apache-2.0 | https://github.com/r3alst/dagre-rust |
| `third_party/graphlib_rust/` | Apache-2.0 | https://github.com/r3alst/graphlib-rust |
| `third_party/ordered_hashmap/` | Apache-2.0 | https://github.com/r3alst/ordered-hashmap |

每个供应商的许可证文本见对应的 LICENSE/LICENCE 文件。

---

## 主要贡献者/版权持有人（部分）

本软件包含以下组织的贡献：
- **The Rust 项目 及 Rust 社区** — 多项基础库
- **SpaceXAI / xAI** — 第一方代码（Apache-2.0）
- **Denver Technologies, Inc.** — mermaid-to-svg（MIT）
- **The RustCrypto Project Developers** — 加密库系列
- **tokio-rs 团队** — 异步运行时
- **serde 团队** — 序列化框架
- **以及其他数以百计的开源贡献者**

---

## 许可责任矩阵

涵盖的许可证家族包括：
- MIT
- Apache-2.0
- BSD-2-Clause, BSD-3-Clause
- ISC
- Zlib
- Unicode-DFS-2016, Unicode-TOU
- BSL-1.0 (Boost)
- MPL-2.0
- CDLA-Permissive-2.0
- libgit2 GPL + 链接例外包

已从发布中移除的包（CDDL inferno, EPL colored_json, WTFPL termini 等）未包含在此声明中。

---

## 完整原版

完整的逐包声明列表请参见原始英文文件 `THIRD-PARTY-NOTICES`。
该文件包含约 380 个软件包的完整版权声明、许可证文本双语言副本和使用保证。

---

## 第三方许可汇总（常见库）

以下是仓库中主要使用的第三方库及其许可证概要：

### 核心框架

| 库名 | 许可证 | 用途 |
|------|--------|------|
| tokio | MIT 或 Apache-2.0 | 异步运行时 |
| serde | MIT 或 Apache-2.0 | 序列化框架 |
| clap | MIT 或 Apache-2.0 | 命令行解析 |
| tracing | MIT | 应用级追踪 |
| reqwest | MIT 或 Apache-2.0 | HTTP 客户端 |
| axum | MIT | Web 框架 |
| tonic | MIT | gRPC 框架 |

### 加密与安全

| 库名 | 许可证 | 用途 |
|------|--------|------|
| ring | ISC + ring 自建 | 加密原语 |
| rustls | Apache-2.0 / MIT / ISC | TLS 库 |
| sha2 | MIT 或 Apache-2.0 | SHA 哈希 |
| aes-gcm | MIT 或 Apache-2.0 | AES-GCM 加密 |

### UI 与终端

| 库名 | 许可证 | 用途 |
|------|--------|------|
| ratatui | MIT | TUI 框架 |
| crossterm | MIT | 终端控制 |
| alacritty_terminal | Apache-2.0 | 终端模拟 |

> **完整列表**请参见原英文文件 `THIRD-PARTY-NOTICES` 的第一部分。
