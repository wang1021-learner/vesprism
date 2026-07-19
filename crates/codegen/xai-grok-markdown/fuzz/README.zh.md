# Fuzzing xai-grok-markdown（中文翻译）

> **⚠️ 免责声明**：本文件是对英文原版 `README.md` 的中文翻译，仅供参考。以英文原版 [`README.md`](README.md) 为准。

---

使用 [cargo-fuzz](https://rust-fuzz.github.io/book/cargo-fuzz.html)（libFuzzer）对 markdown 渲染器进行覆盖率引导的模糊测试。

## 前提条件

```bash
cargo install cargo-fuzz   # 如果尚未安装
rustup toolchain install nightly
```

## 目标

| 目标 | 测试范围 |
|---|---|
| `render_all` | 所有 8 种组合：对每个输入执行 `pretty × syntect × {full, streaming}` |

每次迭代运行：
- `render_markdown_ratatui_full()` — 4 种组合（pretty/非 pretty × syntect/无 syntect）
- `StreamingMarkdownRenderer` 逐字符 — 同样的 4 种组合

## 运行

在 `crates/codegen/xai-grok-markdown` 下：

```bash
# 无限期运行（Ctrl-C 停止）：
cargo +nightly fuzz run render_all fuzz/corpus/render_all fuzz/seeds/render_all -- -max_len=16384

# 运行 5 分钟：
cargo +nightly fuzz run render_all fuzz/corpus/render_all fuzz/seeds/render_all -- -max_len=16384 -max_total_time=300
```

- `corpus/` — 自动生成的输入（gitignored）
- `seeds/` — 手写种子输入（已提交）

## 重现崩溃

发现崩溃后，输入会保存到 `artifacts/render_all/crash-<hash>`。用以下方式重现：

```bash
cargo +nightly fuzz run render_all fuzz/artifacts/render_all/crash-<hash>
```

## 添加种子输入

将 `.txt` 或 `.md` 文件放入 `seeds/render_all/`。好的种子覆盖不同的 markdown 特性（表格、代码块、emoji、嵌套列表等），帮助模糊测试器更快到达新代码路径。
