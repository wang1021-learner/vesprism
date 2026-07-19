# PTY 基准基线（中文翻译）

> **⚠️ 免责声明**：本文件是对英文原版 `README.md` 的中文翻译，仅供参考。以英文原版 [`README.md`](README.md) 为准。

---

基线是**按平台和场景**分别维护的（macOS arm64 的时序与 Linux arm64 CI 运行器截然不同）。
CI 会将当前运行与对应平台的文件进行比较，如果任何场景的 p99 帧时间增长超过 15%（默认；`--threshold` 可覆盖），则判定失败。

文件命名：`<platform>.json`，其中 `<platform>` 匹配 CI 工件架构名称 —
`linux-x86_64`、`linux-aarch64`、`macos-aarch64`。

## 生成基线

在安静机器上运行完整基准套件：

```bash
cargo run -p xai-grok-pager --release --bin pty-bench -- \
  --all \
  --write-baseline crates/codegen/xai-grok-pager-pty-harness/benches/pty_baselines/<platform>.json
```

## 有意的性能变更后覆盖

有意改变帧时间（任一方向）的 PR 必须更新受影响的基线。
在 PR 描述中包含一次干净运行的 `pty-bench` 输出，以便审查者验证新数值是否合理。

## 首次运行

平台文件在首次 CI 运行时种子化（参见 `pager-bench` 作业）。
在此之前，`--baseline <missing-file>` 将失败并显示清晰的错误。
