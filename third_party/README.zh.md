# 第三方供应商 crate（中文翻译）

> **⚠️ 免责声明**：本文件是对英文原版 `README.md` 的中文翻译，仅供参考。以英文原版 [`README.md`](README.md) 为准。

---

本目录存放**供应商内联到仓库中的上游源码**。这些**不**是第一方应用代码。

## 为什么使用供应商内联

这些 crate 位于渲染**不可信模型输出**（图表源码 → SVG）的路径上。
采用供应商内联方式可以提供一个完整的审计面、固定具体源码，并避免 crates.io 撤回风险。
就地修改和升级检查清单记录在每个 crate 的 `Cargo.toml` 头部注释中 —
重新供应商化时以这些注释为准。

## Mermaid 图表布局栈

| Crate | 版本 | 许可证 | 上游 | 许可证全文 |
|-------|------|--------|------|------------|
| [`mermaid-to-svg`](./mermaid-to-svg/) | (path) | MIT | [warpdotdev/mermaid-to-svg](https://github.com/warpdotdev/mermaid-to-svg) | [`LICENSE`](./mermaid-to-svg/LICENSE) |
| [`dagre_rust`](./dagre_rust/) | 0.0.5 | Apache-2.0 | [r3alst/dagre-rust](https://github.com/r3alst/dagre-rust) / Warp 重新分发 | [`LICENCE`](./dagre_rust/LICENCE) |
| [`graphlib_rust`](./graphlib_rust/) | 0.0.2 | Apache-2.0 | [r3alst/graphlib-rust](https://github.com/r3alst/graphlib-rust) | [`LICENCE`](./graphlib_rust/LICENCE) |
| [`ordered_hashmap`](./ordered_hashmap/) | 0.0.3 | Apache-2.0 | [r3alst/ordered-hashmap](https://github.com/r3alst/ordered-hashmap) | [`LICENCE`](./ordered_hashmap/LICENCE) |

依赖关系：

```text
xai-grok-mermaid
  └── mermaid-to-svg          (MIT)
        ├── dagre_rust        (Apache-2.0)
        │     ├── graphlib_rust
        │     └── ordered_hashmap
        └── graphlib_rust     (Apache-2.0)
              └── ordered_hashmap
```

## 通知与来源

- **[`NOTICE`](./NOTICE)** — 上述 crate 的简短索引（名称、许可证、上游链接、全文路径）。作为单页概览时优先选择该文件。
- **[`mermaid-to-svg/THIRD_PARTY_NOTICES`](./mermaid-to-svg/THIRD_PARTY_NOTICES)** — SVG 引擎的额外来源信息（例如 mermaid.js、dagre.js 的 MIT 通知）。

Apache 包中的英式拼写 **`LICENCE`** 是有意为之（按上游供应商原样）；仅搜索 `LICENSE` 会漏掉它们。

## crates.io 依赖

常规 Cargo 依赖（tokio、serde …）**不在** `third_party/` 下。它们通过 `Cargo.lock` / crates.io 解析。Grok CLI 依赖闭包的完整归属和许可证文本维护在：

[`THIRD-PARTY-NOTICES`](../THIRD-PARTY-NOTICES)

本目录仅用于**树内供应商内联**的源码。

## 升级

1. 阅读该 crate 的 `Cargo.toml` 顶部 `VENDORING NOTES` 代码块。
2. 重新应用列出的就地补丁（fmt、闭合环境、unsafe 修复、已删除的 bins/tests）。
3. 确认许可证文件仍与声明的 `license =` 字段匹配。
4. 如果版本或上游 URL 变更，刷新 [`NOTICE`](./NOTICE)。
