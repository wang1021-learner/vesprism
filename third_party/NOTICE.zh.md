# 第三方声明 — 供应商嵌入 crate（中文翻译）

> **⚠️ 免责声明**：本文件是对英文原版 NOTICE 文件的中文翻译，仅供参考。法律效力以英文原版 [`NOTICE`](NOTICE) 为准。

---

## 概述

本仓库包含以下上游项目的源代码嵌入（vendored in-source）。每个 crate 旁附有完整的许可证文本。各 crate 标头中的 Cargo.toml 记录了所作（或所未作）的本地修改。

---

## 供应商嵌入式 crate 列表

### mermaid-to-svg

| 项目 | 详情 |
|------|------|
| 路径 | `third_party/mermaid-to-svg/` |
| 许可证 | MIT |
| 许可证文件 | `third_party/mermaid-to-svg/LICENSE` |
| 上游仓库 | https://github.com/warpdotdev/mermaid-to-svg |
| 版权 | Copyright (c) 2025-2026 Denver Technologies, Inc. |

该项目的祖先来源（mermaid.js、dagre.js 及相关组件）列表参见：
`third_party/mermaid-to-svg/THIRD_PARTY_NOTICES`

---

### dagre_rust

| 项目 | 详情 |
|------|------|
| 路径 | `third_party/dagre_rust/` |
| 许可证 | Apache License 2.0 |
| 许可证文件 | `third_party/dagre_rust/LICENCE` |
| 上游仓库 | https://github.com/r3alst/dagre-rust<br>（同样通过 warpdotdev/mermaid-to-svg crates/dagre_rust 重新发布） |
| 版本 | 0.0.5 |
| crates.io | https://crates.io/crates/dagre_rust/0.0.5 |

---

### graphlib_rust

| 项目 | 详情 |
|------|------|
| 路径 | `third_party/graphlib_rust/` |
| 许可证 | Apache License 2.0 |
| 许可证文件 | `third_party/graphlib_rust/LICENCE` |
| 上游仓库 | https://github.com/r3alst/graphlib-rust |
| 版本 | 0.0.2 |
| crates.io | https://crates.io/crates/graphlib_rust/0.0.2 |

---

### ordered_hashmap

| 项目 | 详情 |
|------|------|
| 路径 | `third_party/ordered_hashmap/` |
| 许可证 | Apache License 2.0 |
| 许可证文件 | `third_party/ordered_hashmap/LICENCE` |
| 上游仓库 | https://github.com/r3alst/ordered-hashmap |
| 版本 | 0.0.3 |
| crates.io | https://crates.io/crates/ordered_hashmap/0.0.3 |

---

## 产品级声明

所有随 Grok CLI 发布的第三方 crate.io/Git 依赖项的声明（包括 MPL 包、Apache NOTICE 文件、libgit2 COPYING 以及双许可证选择等），均位于根目录：

**`THIRD-PARTY-NOTICES`**

---

*第三方供应商 crate 声明 完。*

*完整产品级声明请参见 [`THIRD-PARTY-NOTICES.zh.md`](../THIRD-PARTY-NOTICES.zh.md)*
