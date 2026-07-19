# xai-crash-handler（中文翻译）

> **⚠️ 免责声明**：本文件是对英文原版 `README.md` 的中文翻译，仅供参考。以英文原版 [`README.md`](README.md) 为准。

---

针对 SIGBUS/SIGSEGV 的崩溃处理程序，带尽力而为的回溯捕获功能。

## 工作原理

`install()` 注册了一个 `sigaction` 处理程序。崩溃时，它会将二进制 blob（`GRCX` 格式）写入 `crash_dir/last-crash.bin`，
并通过预先计算的转义序列恢复终端态。处理程序仅使用异步信号安全的操作进行文件 I/O、终端恢复和重新抛出。

下次启动时，`check_previous_crash()` 读取该 blob，通过 `backtrace` 将 IP 解析为符号，
写入 `last-crash-report.txt`，并将其归档（保留最后 5 份报告）。

非 Unix 平台上为无操作（no-op）。在基于 musl 的 Linux（发布版）上，
处理程序仍会记录信号/地址/版本，但跳过了帧捕获，因为 musl 不提供 `backtrace()`。

## 限制

### 帧捕获是尽力而为的

帧捕获使用两种完全异步信号安全的技术：
1. 崩溃指令指针直接从内核传递的 `ucontext_t` 中提取。
2. 通过遍历帧指针链（x86_64 上的 RBP，aarch64 上的 x29）使用原始指针读取来捕获附加帧。

在没有 `-C force-frame-pointers` 的发布版构建中，帧指针链可能不完整或为空（编译器默认会省略帧指针以进行优化）。崩溃 PC 始终被捕获。在 debug/dev 构建中，帧指针默认保留，产生更完整的调用栈。

### sigaltstack 是每线程的

备用信号栈仅安装在调用 `install()` 的线程上。Tokio 工作线程不继承它。
工作线程上的栈溢出仍会触发处理程序（sigaction 是进程范围的），但在没有 altstack 保护的情况下，处理程序本身可能会在溢出的栈上发生错误。

## 用法

```rust
use std::path::PathBuf;

let crash_dir = PathBuf::from("/home/user/.myapp/crash");

// check_previous_crash 必须在 install() 之前调用，
// 因为 install() 使用 O_TRUNC 打开 last-crash.bin
if let Some(r) = xai_crash_handler::check_previous_crash(&crash_dir) {
    eprintln!("Crashed last session: {}", r.signal_name);
    eprintln!("Report: {}", r.report_path.display());
}

// 在任何线程或异步运行时之前安装 — sigaltstack 是每线程的。
// 如果 crash_dir 不存在则创建
xai_crash_handler::install(xai_crash_handler::CrashHandlerConfig {
    app_version: env!("CARGO_PKG_VERSION").to_string(),
    crash_dir,
});
```
