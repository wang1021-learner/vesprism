//! 用于保障 TTY 安全的轻量级进程生成工具。
//!
//! 当 TUI/分屏器/原始模式终端占用了父进程的控制 TTY 时，
//! 每一个子进程都必须与之分离。否则，该子进程（或其子孙进程，如 npm, git, pinentry, ssh-agent 等）
//! 可能会直接打开 `/dev/tty`，并在当前屏幕上输出鼠标转义字符、能力探测回复或凭据输入提示，从而破坏终端显示。
//!
//! 本 crate 提供了确保子进程生成安全所需的最小功能接口。
//! 它的设计非常轻量，使得工作区中的**所有** crate 都可以依赖它，而无需引入庞大的第三方库。
//!
//! # 使用示例
//!
//! ```rust,no_run
//! use xai_tty_utils::{detach_command, pager_env};
//! use std::process::Stdio;
//!
//! let mut cmd = tokio::process::Command::new("git");
//! cmd.args(["status", "--porcelain"]);
//! detach_command(&mut cmd);
//! cmd.stdin(Stdio::null());
//! cmd.envs(pager_env());
//! ```
//!
//! 针对 `std::process::Command` 的使用示例：
//!
//! ```rust,no_run
//! use xai_tty_utils::{detach_std_command, pager_env};
//! use std::process::Stdio;
//!
//! let mut cmd = std::process::Command::new("git");
//! cmd.args(["log", "--oneline"]);
//! detach_std_command(&mut cmd);
//! cmd.stdin(Stdio::null());
//! cmd.envs(pager_env());
//! ```

use std::collections::HashMap;
use std::io;

mod process_resources;
pub use process_resources::{ProcessResources, sample_process_memory, sample_process_resources};

mod process_scope;
pub use process_scope::{ProcessScope, global_process_scope};

/// How long a shell gets to forward a hangup to its jobs before it is killed.
pub const HANGUP_GRACE: std::time::Duration = std::time::Duration::from_millis(200);

pub mod runtime;

// ---------------------------------------------------------------------------
// TTY 分离 — pre_exec 构建块
// ---------------------------------------------------------------------------

/// 通过启动新会话来脱离控制 TTY。
///
/// 这样可以防止生成的子进程打开 `/dev/tty` 并与 TUI 争夺终端输入。
/// 因为 `Stdio::null()` 只能重定向文件描述符 0；而像 `ssh`、`ssh-add` 以及交互式 shell（如 `zsh -i`）
/// 这类程序会直接绕过它去打开 `/dev/tty`。
///
/// 如果 `setsid()` 因 `EPERM`（当前进程已经是进程组组长）而失败，
/// 则会退而使用 `setpgid(0, 0)`。这虽然仍可以让控制终端被访问，但提供了进程组层面的隔离。
///
/// # 安全性
///
/// 必须且只能在 `pre_exec` 钩子中（即 `fork` 与 `exec` 之间）被调用。
/// `setsid()` 和 `setpgid()` 均是异步信号安全（POSIX）的。
#[cfg(unix)]
pub fn detach_from_tty() -> io::Result<()> {
    use nix::errno::Errno;
    use nix::unistd::{Pid, setpgid, setsid};

    match setsid() {
        Ok(_) => Ok(()),
        Err(Errno::EPERM) => {
            setpgid(Pid::from_raw(0), Pid::from_raw(0))
                .map_err(|e| io::Error::from_raw_os_error(e as i32))?;
            Ok(())
        }
        Err(e) => Err(io::Error::from_raw_os_error(e as i32)),
    }
}

/// 在非 Unix 平台上为无操作。
#[cfg(not(unix))]
pub fn detach_from_tty() -> io::Result<()> {
    Ok(())
}

/// Reset `oom_score_adj` to 0. The score is inherited across `fork`, so a
/// protected parent would otherwise shield everything it spawns, leaving a
/// runaway command unkillable.
///
/// Best-effort: failing the spawn is worse than keeping the inherited score.
///
/// # Safety
///
/// Safe between `fork` and `exec`: raw `open`/`write`/`close` only, which are
/// async-signal-safe and allocation-free.
#[cfg(target_os = "linux")]
pub fn reset_oom_score_adj() -> io::Result<()> {
    const PATH: &[u8] = b"/proc/self/oom_score_adj\0";
    // SAFETY: `PATH` is a NUL-terminated `'static` literal and `value` is passed
    // with its own length; both pointers stay valid for the calls.
    unsafe {
        let fd = libc::open(PATH.as_ptr().cast(), libc::O_WRONLY | libc::O_CLOEXEC);
        if fd < 0 {
            return Ok(());
        }
        let value = b"0\n";
        libc::write(fd, value.as_ptr().cast(), value.len());
        libc::close(fd);
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
pub fn reset_oom_score_adj() -> io::Result<()> {
    Ok(())
}

/// Set by the launcher of the cyber tool server, which itself runs under a
/// protective (negative) `oom_score_adj`, so the commands it spawns stay
/// ordinary OOM candidates instead of inheriting that protection.
#[cfg(unix)]
pub const RESET_CHILD_OOM_ENV: &str = "GROK_TOOLS_RESET_CHILD_OOM";

#[cfg(unix)]
pub fn detach_from_tty_reset_oom() -> io::Result<()> {
    reset_oom_score_adj()?;
    detach_from_tty()
}

/// Must be called pre-fork, not from inside the hook: reading the environment
/// is not async-signal-safe.
#[cfg(unix)]
pub fn detach_pre_exec_hook() -> fn() -> io::Result<()> {
    if std::env::var_os(RESET_CHILD_OOM_ENV).is_some() {
        detach_from_tty_reset_oom
    } else {
        detach_from_tty
    }
}

// ---------------------------------------------------------------------------
// tokio::process::Command 封装
// ---------------------------------------------------------------------------

/// 使 `tokio::process::Command` 脱离父进程的控制 TTY/控制台。
///
/// - Unix：使用 `pre_exec` 钩子调用 `setsid`（若遇 EPERM 则降级调用 `setpgid`）。
/// - Windows：使用 `CREATE_NO_WINDOW` 标志。注意不要添加 `DETACHED_PROCESS`，
///   因为这会破坏子孙进程（如 `cmd.exe` -> `node`）的标准输入输出管道继承。
pub fn detach_command(cmd: &mut tokio::process::Command) {
    #[cfg(unix)]
    {
        // 安全性：detach_from_tty 仅调用 setsid/setpgid，这两者均符合 POSIX 
        // 异步信号安全要求，满足 pre_exec 的安全契约。
        // SAFETY: every hook `detach_pre_exec_hook` can return is async-signal-safe,
        // and the env read that selects one happens here, before fork.
        unsafe {
            cmd.pre_exec(detach_pre_exec_hook());
        }
    }
    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::CREATE_NO_WINDOW;
        cmd.creation_flags(CREATE_NO_WINDOW.0);
    }
}

// ---------------------------------------------------------------------------
// std::process::Command 封装
// ---------------------------------------------------------------------------

/// 使 `std::process::Command` 脱离父进程的控制 TTY/控制台。
///
/// 这是 [`detach_command`] 的 `std` 版本（前者仅适用于 `tokio::process::Command`）。
/// 当需要通过 `std::process::Command` 生成进程时使用此函数（例如在同步代码或 `spawn_blocking` 中）。
///
/// - Unix：使用 `pre_exec` 钩子调用 `setsid`（若遇 EPERM 则降级调用 `setpgid`）。
/// - Windows：使用 `CREATE_NO_WINDOW` 标志。
pub fn detach_std_command(cmd: &mut std::process::Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // 安全性：detach_from_tty 仅调用 setsid/setpgid，这两者均符合 POSIX 
        // 异步信号 safe 要求，满足 pre_exec 的安全契约。
        // SAFETY: every hook `detach_pre_exec_hook` can return is async-signal-safe,
        // and the env read that selects one happens here, before fork.
        unsafe {
            cmd.pre_exec(detach_pre_exec_hook());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows::Win32::System::Threading::CREATE_NO_WINDOW;
        cmd.creation_flags(CREATE_NO_WINDOW.0);
    }
}

// ---------------------------------------------------------------------------
// Parent-death binding — Linux PR_SET_PDEATHSIG
// ---------------------------------------------------------------------------

/// The `pre_exec` body for [`kill_on_parent_death_std`]: arm `PR_SET_PDEATHSIG`
/// and close the classic pdeathsig race (parent died between `fork` and
/// `prctl`, so the signal will never fire) by comparing `getppid()` against
/// the pid captured at spawn time.
///
/// In debug builds this also enforces that the command was **armed on the
/// thread that spawns it**: pdeathsig binds to the death of the spawning
/// thread, so a cross-thread arm+spawn would silently bind the child to a
/// different thread's lifetime than the arming site reasoned about. The
/// guard returns `Err(EINVAL)` — surfaced by `spawn()` as an
/// `InvalidInput` error — rather than panicking, because this closure runs
/// post-fork where unwinding is not async-signal-safe;
/// `io::Error::from_raw_os_error` is allocation-free.
///
/// # Safety
///
/// Must only be called inside a `pre_exec` hook (between `fork` and `exec`):
/// it calls only async-signal-safe libc functions (`prctl`, `getppid`,
/// `_exit`) and its error paths build errors via `from_raw_os_error` /
/// `last_os_error` — never `io::Error::new`/`other`, which allocate. The
/// debug-only thread guard reads `std::thread::current().id()` from the
/// fork-copied TLS of the spawning thread; that handle is lazily created,
/// so in the (rare) case the spawning thread never materialized it this
/// can allocate — accepted for a debug-only misuse guard.
#[cfg(target_os = "linux")]
fn bind_to_parent_death(parent_pid: u32, armed_thread: std::thread::ThreadId) -> io::Result<()> {
    // Post-fork, TLS is a copy of the SPAWNING thread's, so this observes
    // which thread called `spawn()`.
    if cfg!(debug_assertions) && std::thread::current().id() != armed_thread {
        return Err(io::Error::from_raw_os_error(libc::EINVAL));
    }
    // SAFETY: prctl(PR_SET_PDEATHSIG, …) only sets the calling process's
    // parent-death signal; it reads/writes no caller memory.
    if unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM as libc::c_ulong) } == -1 {
        return Err(io::Error::last_os_error());
    }
    // Parent already gone (pdeathsig can no longer fire): exit instead of
    // orphaning. A reparented child sees a ppid different from the pid the
    // spawn site captured.
    // SAFETY: getppid/_exit are async-signal-safe and take no pointers.
    if unsafe { libc::getppid() } as u32 != parent_pid {
        unsafe { libc::_exit(0) };
    }
    Ok(())
}

/// Bind the child's lifetime to the spawning process: on Linux the kernel
/// delivers `SIGTERM` to the child when the parent dies
/// (`PR_SET_PDEATHSIG`), so helper processes cannot outlive a crashed or
/// killed grok and pile up on shared hosts. No-op on non-Linux platforms
/// (macOS and Windows have no pdeathsig equivalent).
///
/// **Caveat: pdeathsig binds to the death of the spawning *thread*, not
/// the process — arm and `spawn()` on a thread that lives as long as the
/// parent process.** Debug builds enforce arm-thread == spawn-thread: a
/// mismatch fails the `spawn()` with `InvalidInput` (`EINVAL`).
///
/// **Opt-in.** Only use this for helpers that are useless without their
/// parent (idle inhibitors, protocol children speaking over inherited
/// pipes). Never apply it to processes designed to outlive the client —
/// leader daemons, workspace servers, backgrounded user tasks.
///
/// Composable with [`detach_std_command`]: `pre_exec` hooks run in
/// registration order, and `setsid`/`setpgid` do not clear the parent-death
/// signal, so this can be applied before or after a `detach_*` helper.
///
/// Further Linux caveat: the kernel clears the setting across a
/// setuid/setcap `execve`.
pub fn kill_on_parent_death_std(cmd: &mut std::process::Command) {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        let parent_pid = std::process::id();
        let armed_thread = std::thread::current().id();
        // SAFETY: bind_to_parent_death calls only async-signal-safe libc
        // functions and builds errors without allocating (see its docs for
        // the debug-only TLS read). Satisfies the pre_exec contract.
        unsafe {
            cmd.pre_exec(move || bind_to_parent_death(parent_pid, armed_thread));
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = cmd;
    }
}

/// Bind the *current* process's lifetime to its parent: on Linux, arm
/// `PR_SET_PDEATHSIG(SIGTERM)` so this process is terminated when the
/// process that spawned it dies. No-op elsewhere.
///
/// This is the child-side variant of [`kill_on_parent_death_std`] for protocol
/// servers whose parents are not spawned from this workspace (IDE clients,
/// the agent SDKs, `grok-desktop` all spawn `grok agent … stdio`): the
/// child arms the binding itself at startup instead of relying on every
/// external spawner to.
///
/// Unlike the spawn-time helper there is no ppid race check: a direct
/// parent at pid 1 is legitimate here (containers where the client is PID
/// 1), so an already-dead parent is indistinguishable from that case. The
/// caller's stdin-EOF handling covers the parent-died-before-arm race —
/// dead parent means closed pipes.
///
/// The binding keys off the death of the **parent's thread that spawned
/// this process** — a property of the spawner that the child can neither
/// inspect nor enforce (unlike [`kill_on_parent_death_std`], whose debug guard
/// runs in the spawner). External spawners that fork protocol children
/// from short-lived worker threads will see the signal early; for the
/// stdio entrypoints this is equivalent to the parent closing the pipes.
///
/// # Errors
///
/// Returns the `prctl` errno on Linux when the arm fails; the process then
/// keeps its previous lifetime semantics (stdin-EOF only), so callers
/// should log the failure. This crate stays logging-free by design —
/// surfacing the result is the observable seam. Always `Ok(())` on
/// non-Linux platforms (no-op).
///
/// **Opt-in.** Only call from entrypoints that are useless without the
/// process that spawned them (e.g. stdio transports over inherited pipes).
/// Never from daemons designed to outlive their spawner.
pub fn kill_current_process_on_parent_death() -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: prctl(PR_SET_PDEATHSIG, …) only sets the calling process's
        // parent-death signal; it reads/writes no caller memory.
        if unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM as libc::c_ulong) } == -1 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 进程组生命周期
// ---------------------------------------------------------------------------

/// Bound on waiting for an already-killed child (or its pipe readers) before
/// abandoning it.
///
/// A kill normally makes `child.wait()` resolve in milliseconds, but a child
/// wedged in an uninterruptible kernel syscall (D-state — e.g. a read on a
/// hard NFS mount whose server stopped responding) only observes the signal
/// when that syscall returns, which can be effectively never. Callers that
/// must not block (tool futures, turn loops) wait at most this long, then
/// abandon the corpse to the runtime's orphan reaper.
pub const KILL_REAP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Reap an already-killed child, waiting at most `bound` (usually
/// [`KILL_REAP_TIMEOUT`]).
///
/// Returns the exit status when the child was reaped in time. `None` covers
/// both failure shapes — the bound expired (see [`KILL_REAP_TIMEOUT`]) and
/// `wait()` itself erred (e.g. the child was already reaped elsewhere) — the
/// caller's obligation is identical in either case: the kill signal is
/// already delivered, there is no status to report, and the corpse is left
/// to tokio's orphan reaper. Callers should log the `None` case.
pub async fn reap_killed_bounded(
    child: &mut tokio::process::Child,
    bound: std::time::Duration,
) -> Option<std::process::ExitStatus> {
    match tokio::time::timeout(bound, child.wait()).await {
        Ok(res) => res.ok(),
        Err(_elapsed) => None,
    }
}

/// Configure a command so the spawned child becomes the leader of a new
/// process group.
/// 配置命令行，使生成的子进程成为新进程组的组长。
pub fn new_process_group(cmd: &mut tokio::process::Command) {
    #[cfg(unix)]
    {
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP.0);
    }
}

/// 经过验证的 Unix 进程组 ID，可安全传递给 `killpg`。
///
/// 由于 `killpg(pgid)` 实际上等同于 `kill(-pgid)`，传入异常的 pgid 会将原本局部范围的
/// 进程组杀灭操作扩大为广播式杀灭：`0` 会向*调用者自身*所在的进程组发送信号，`1` 会向 init 进程
/// 发送信号，而调用者自身的 pgid 则会直接杀掉当前进程及其所有的子树。
/// [`ProcessGroupId::new`] 会拒绝这三种情况，因此持有该类型即代表着一种静态保证：
/// `killpg` 只能触及到真正属于外部的进程组。这种极高破坏性的原语在注册时仅验证一次，
/// 而不需要在每个调用点重复检查。
#[cfg(unix)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProcessGroupId(u32);

#[cfg(unix)]
impl ProcessGroupId {
    /// 验证进程组组长的 pid。若 pid 为 `0`（调用者自身进程组）、`1`（init 进程）
    /// 或调用者自身的进程组（对其发信号会杀掉当前进程本身），则返回错误。
    /// 生成到独立进程组中的子进程（通过 [`new_process_group`] 或 `detach_*` 助手调用 `setpgid`/`setsid`）
    /// 其组长 pid 必然 `> 1` 且与调用者的 pgid 不同。
    /// 因此正常生成的进程组不会触发该错误，此处的检查主要是为了拦截未被正确分组的子进程，
    /// 防止其引起杀灭广播。
    pub fn new(pid: u32) -> io::Result<Self> {
        if pid <= 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("拒绝退化的进程组 ID {pid}（0 = 自身进程组, 1 = init）"),
            ));
        }
        // killpg_unix 在转换时会执行 `pid as i32`；若值大于 i32::MAX 将会溢出为负数，
        // 而带有负数 pgid 的 killpg 在 Linux/macOS 上会返回 EINVAL。
        // 在这里进行拦截，以确保这一限制在构建时即为安全的，而不是依赖系统的奇异行为。
        if pid > i32::MAX as u32 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("进程组 ID {pid} 超过 i32::MAX，无法用于 killpg"),
            ));
        }
        if i64::from(pid) == i64::from(nix::unistd::getpgrp().as_raw()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("拒绝 killpg 调用者自身的进程组（{pid}）"),
            ));
        }
        Ok(Self(pid))
    }

    /// 获取经过验证的原始进程组 ID。
    pub fn get(self) -> u32 {
        self.0
    }
}

/// 进程树清理句柄。
///
/// - Unix：持有经过验证的组长 ID（[`ProcessGroupId`]）；并分发至 `killpg(pgid, signal)`。
/// - Windows：持有带有 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 限制的作业对象。
///
/// **Drop 语义因平台而异**：在 Windows 上，drop 会强行关闭并清理作业中的所有进程。
/// 在 Unix 上，drop 不会执行任何清理操作，必须显式调用 [`kill`](Self::kill) 或 [`terminate`](Self::terminate)。
pub struct ProcessGroup {
    /// 在通过 [`Self::attach_pid`] 注册子进程前为 `None`；注册后，`Some` 包含一个可安全用于 killpg 的 ID。
    /// 该 pid 在 attach 时被设置一次，且绝不会被自动清空。
    /// PID 复用安全性由*所有者*在回收进程后 drop 该 group（其 `Arc`）来保证，
    /// 此时已没有任何实体能够对其调用 `kill`。所以我们无需在进程退出时手动重置该字段。
    #[cfg(unix)]
    leader: Option<ProcessGroupId>,
    #[cfg(windows)]
    job: windows::Win32::Foundation::HANDLE,
    /// Set for a shell that owns a terminal, whose job-control children only
    /// die if the shell is asked to hang up first.
    hangup_first: bool,
}

#[cfg(windows)]
unsafe impl Send for ProcessGroup {}
#[cfg(windows)]
unsafe impl Sync for ProcessGroup {}

impl ProcessGroup {
    pub fn new() -> io::Result<Self> {
        #[cfg(unix)]
        {
            Ok(Self {
                leader: None,
                hangup_first: false,
            })
        }
        #[cfg(windows)]
        {
            use std::mem::{size_of, zeroed};
            use windows::Win32::Foundation::CloseHandle;
            use windows::Win32::System::JobObjects::{
                CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject,
            };
            use windows::core::PCWSTR;

            let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
                .map_err(|e| io::Error::other(format!("CreateJobObjectW 失败: {e}")))?;

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            let result = unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if let Err(e) = result {
                let _ = unsafe { CloseHandle(job) };
                return Err(io::Error::other(format!("SetInformationJobObject 失败: {e}")));
            }

            Ok(Self {
                job,
                hangup_first: false,
            })
        }
    }

    pub fn attach(&mut self, child: &tokio::process::Child) -> io::Result<()> {
        let pid = child
            .id()
            .ok_or_else(|| io::Error::other("ProcessGroup::attach: 子进程已退出"))?;
        self.attach_pid(pid)
    }

    /// 关联一个 `std::process::Child`（而非 tokio 的 Child）。
    /// PID 通过 `Child::id()` 读取，在通过 `wait()` 回收子进程前该 ID 一直有效。
    pub fn attach_std(&mut self, child: &std::process::Child) -> io::Result<()> {
        self.attach_pid(child.id())
    }

    /// 通过原始 PID 关联一个已经生成的子进程。
    /// 该子进程必须是其自身进程组/作业的组长（即通过 [`new_process_group`] (Unix `setpgid`) 
    /// 或 `detach_*` 助手 (Unix `setsid`) 生成的），否则 `kill` 可能会误向错误的进程组发信号。
    pub fn attach_pid(&mut self, pid: u32) -> io::Result<()> {
        #[cfg(unix)]
        {
            self.leader = Some(ProcessGroupId::new(pid)?);
            Ok(())
        }
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::CloseHandle;
            use windows::Win32::System::JobObjects::AssignProcessToJobObject;
            use windows::Win32::System::Threading::{
                OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
            };

            let process_handle =
                unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) }
                    .map_err(|e| io::Error::other(format!("OpenProcess({pid}) 失败: {e}")))?;

            let assign_result = unsafe { AssignProcessToJobObject(self.job, process_handle) };
            let _ = unsafe { CloseHandle(process_handle) };

            assign_result
                .map_err(|e| io::Error::other(format!("AssignProcessToJobObject({pid}) 失败: {e}")))
        }
    }

    pub fn terminate(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
            self.killpg_unix(nix::sys::signal::Signal::SIGTERM)
        }
        #[cfg(windows)]
        {
            self.terminate_job(1)
        }
    }

    pub fn kill(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
            self.killpg_unix(nix::sys::signal::Signal::SIGKILL)
        }
        #[cfg(windows)]
        {
            self.terminate_job(1)
        }
    }

    /// Whether any process still exists in this group. `None` where the
    /// platform cannot say (Windows, `EPERM`); treat it as alive.
    ///
    /// Over-reports, never under-reports: an unreaped zombie is still a
    /// process, so it counts as live. Filtering zombies out would let a
    /// reaped leader with a live descendant look empty.
    pub fn has_live_members(&self) -> Option<bool> {
        #[cfg(unix)]
        {
            let Some(leader) = self.leader else {
                return Some(false);
            };
            match nix::sys::signal::killpg(nix::unistd::Pid::from_raw(leader.get() as i32), None) {
                Ok(()) => Some(true),
                Err(nix::errno::Errno::ESRCH) => Some(false),
                Err(_) => None,
            }
        }
        #[cfg(windows)]
        {
            None
        }
    }

    /// Ask an interactive shell to hang up. Its job-control children each live
    /// in their own process group, which no `killpg` here reaches, but a shell
    /// forwards the hangup to them before it exits.
    pub fn hangup(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
            self.killpg_unix(nix::sys::signal::Signal::SIGHUP)?;
            // A stopped shell cannot forward the hangup until it resumes.
            self.killpg_unix(nix::sys::signal::Signal::SIGCONT)
        }
        #[cfg(windows)]
        {
            Ok(())
        }
    }

    /// Whether teardown should hang this group up before killing it. Never on
    /// Windows, where the hangup is a no-op and the Job Object takes the tree.
    pub fn wants_hangup(&self) -> bool {
        cfg!(unix) && self.hangup_first
    }

    /// Mark this group as a terminal-owning shell. See [`Self::hangup`].
    pub fn hang_up_before_kill(&mut self) {
        self.hangup_first = true;
    }

    #[cfg(unix)]
    fn killpg_unix(&self, signal: nix::sys::signal::Signal) -> io::Result<()> {
        // `leader` 在子进程注册前为 `None`，且 `ProcessGroupId` 在构建时已确保是 
        // killpg 安全的（绝非 0/1/自身进程组），因此这里只会向真正的外部进程组发送信号。
        let Some(leader) = self.leader else {
            return Ok(());
        };
        nix::sys::signal::killpg(nix::unistd::Pid::from_raw(leader.get() as i32), signal)
            .map_err(|e| io::Error::from_raw_os_error(e as i32))
    }

    #[cfg(windows)]
    fn terminate_job(&self, exit_code: u32) -> io::Result<()> {
        use windows::Win32::System::JobObjects::TerminateJobObject;
        unsafe { TerminateJobObject(self.job, exit_code) }
            .map_err(|e| io::Error::other(format!("TerminateJobObject 失败: {e}")))
    }
}

#[cfg(windows)]
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.job) };
    }
}

// ---------------------------------------------------------------------------
// 环境变量助手
// ---------------------------------------------------------------------------

/// 返回特定的环境变量，防止命令行工具启动任何会因等待用户输入而阻塞的交互式程序
/// （例如分屏器、编辑器、凭据提示等）。
pub fn pager_env() -> HashMap<String, String> {
    HashMap::from([
        ("PAGER".to_string(), passthrough_pager().to_string()),
        ("GIT_PAGER".to_string(), passthrough_pager().to_string()),
        ("GH_PAGER".to_string(), passthrough_pager().to_string()),
        ("MANPAGER".to_string(), passthrough_pager().to_string()),
        ("AWS_PAGER".to_string(), String::new()),
        ("SYSTEMD_PAGER".to_string(), passthrough_pager().to_string()),
        ("GIT_EDITOR".to_string(), noop_cmd().to_string()),
        ("GIT_SEQUENCE_EDITOR".to_string(), noop_cmd().to_string()),
        ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
        // 留空（对于 gpg 相当于未设置），防止 gpg-agent/pinentry 抢占 TUI 的 tty；
        // 配合 setsid 分离，签名失败时可以干净利落地报错，而不是破坏当前的终端屏幕。
        ("GPG_TTY".to_string(), String::new()),
    ])
}

/// 设置在每个 git 命令上的环境变量，用以抑制交互式输入提示。
pub const GIT_AUTH_SUPPRESSION_ENVS: [(&str, &str); 4] = [
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GIT_ASKPASS", ""),
    ("GIT_LFS_SKIP_SMUDGE", "1"),
    ("GIT_SSH_COMMAND", "ssh -o BatchMode=yes"),
];

/// 带有身份验证/LFS/SSH 提示抑制以及 `--no-optional-locks` 的 git 命令。
///
/// 在 Bazel 测试沙箱中会尊重 `GIT_BIN_PATH` 以运行密闭式 git。
/// Respects `GIT_BIN_PATH` for hermetic git in Bazel test sandboxes.
///
/// `--no-optional-locks` skips *optional* maintenance locks only (for example
/// `status` refreshing the index). Required locks for the requested operation
/// are still taken. Prefer this for readers (`status`, `cat-file`, `rev-parse`).
pub fn git_command() -> std::process::Command {
    let mut cmd = git_command_base();
    cmd.arg("--no-optional-locks");
    cmd
}

/// Like [`git_command`], but omits `--no-optional-locks`.
///
/// Writers such as `fetch` may take optional maintenance locks (packed-refs
/// refresh, etc.) in addition to required locks. Use this for mutating git
/// that should not skip those optional locks under concurrent restore.
pub fn git_command_locking() -> std::process::Command {
    git_command_base()
}

fn git_command_base() -> std::process::Command {
    let mut hermetic_exec_path: Option<std::path::PathBuf> = None;
    let git = match std::env::var("GIT_BIN_PATH") {
        Ok(p) => {
            let p = std::path::PathBuf::from(p);
            let p = if p.is_relative() {
                std::env::current_dir().unwrap_or_default().join(&p)
            } else {
                p
            };
            // git-minimal spawns subcommands (`git stash` → `git
            // update-index`) through its exec path, which is baked to a
            // build-machine prefix. Helpers live next to the binary, so point
            // the exec path there. Skip the host-fallback wrapper: host git
            // must keep its own exec path.
            if p.file_name().is_some_and(|name| name == "git") {
                hermetic_exec_path = p.parent().map(std::path::Path::to_path_buf);
            }
            p.to_string_lossy().into_owned()
        }
        Err(_) => "git".to_string(),
    };
    let mut cmd = std::process::Command::new(&git);
    detach_std_command(&mut cmd);
    cmd.stdin(std::process::Stdio::null());
    cmd.envs(pager_env());
    for &(key, val) in &GIT_AUTH_SUPPRESSION_ENVS {
        cmd.env(key, val);
    }
    if let Some(exec_path) = hermetic_exec_path {
        cmd.env("GIT_EXEC_PATH", exec_path);
    }
    cmd
}

fn passthrough_pager() -> &'static str {
    #[cfg(unix)]
    {
        "cat"
    }
    #[cfg(not(unix))]
    {
        ""
    }
}

fn noop_cmd() -> &'static str {
    #[cfg(unix)]
    {
        "true"
    }
    #[cfg(not(unix))]
    {
        r"C:\Windows\System32\cmd.exe /c exit 0"
    }
}

// ---------------------------------------------------------------------------
// 标准错误重定向 — 屏蔽第三方 C 库的噪声以保护 TUI 输出
// ---------------------------------------------------------------------------

/// 指向真实终端的复制出的 stderr 文件描述符。由 [`redirect_native_stderr`] 设置一次。
/// 使用 [`OwnedFd`](std::os::unix::io::OwnedFd) 存储以保证类型安全；
/// [`OnceLock`](std::sync::OnceLock) 确保其在整个进程生命周期中一直存活。
#[cfg(unix)]
static TUI_STDERR_FD: std::sync::OnceLock<std::os::unix::io::OwnedFd> = std::sync::OnceLock::new();

/// 将原生标准错误（fd 2）重定向到 `/dev/null`，使得 C 库直接写入 fd 2 的消息
/// 不会与 TUI 的转义序列交织重叠。
///
/// 在 macOS 上，当 fork 出的子进程无法关闭父进程的堆日志记录时，`libsystem_malloc` 会直接从 C代码向 fd 2 写入 
/// `MallocStackLogging` 诊断信息（绕过了 Rust 的 `stderr()` 锁）。
/// 该信息源自 Apple 开源的 `libmalloc` 中的 `turn_off_stack_logging()` 函数：
/// <https://opensource.apple.com/source/libmalloc/>
///
/// 调用此函数后，所有特意的终端输出都应当通过从 [`dup_tui_stderr`] 获取 of `File` 进行写入。
///
/// # 平台相关
///
/// 仅限 Unix 平台。在非 Unix 平台上本函数为无操作。
///
/// 必须在极早期且尚未派生任何线程之前被调用，以避免与其他向 fd 2 写入数据的代码产生竞态冲突。
/// TUI 的 `spawn_writer_thread` 应当在此调用之后启动。
pub fn redirect_native_stderr() {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::io::{AsRawFd, FromRawFd, OwnedFd};

        // 安全性：在进程启动时，对始终有效的 fd 2（stderr）调用 dup(2) 是安全的。
        let duped = unsafe { libc::dup(2) };
        if duped < 0 {
            return; // 尽力而为，不崩溃
        }

        // 在重定向之前，将复制出来的 fd 存入（作为 OwnedFd）。
        // 安全性：`duped` 是一个刚刚复制出来的、有效的物理文件描述符。
        let owned = unsafe { OwnedFd::from_raw_fd(duped) };
        let _ = TUI_STDERR_FD.set(owned);

        // 在将 fd 2 重定向到 /dev/null 之前，刷新所有缓存的 stderr 数据，以防止数据静默丢失。
        let _ = std::io::stderr().flush();

        // 打开 /dev/null 并将其 dup2 覆盖到 fd 2 上。
        let devnull = match std::fs::OpenOptions::new().write(true).open("/dev/null") {
            Ok(f) => f,
            Err(_) => return,
        };
        // 安全性：devnull.as_raw_fd() 是有效的；fd 2 是一个有效的覆盖目标。
        unsafe { libc::dup2(devnull.as_raw_fd(), 2) };
        // devnull 的 File 对象在此处析构，fd 2 现在正式指向 /dev/null。
    }
}

/// 创建一个写入到真实终端 stderr 的独立的 `File` 对象。
///
/// 这会向保存的 fd 调用 `dup(2)`，以创建一个独立持有的文件描述符。
/// 每一个调用者都会得到各自专属的 fd，可以将其包装进 `BufWriter` 或传递给子线程等。
/// Drop 掉返回的 `File` 仅仅会关闭调用者自己对应的那个复制本，底层的终端 fd 绝不会受到影响。
///
/// 如果此前未调用 [`redirect_native_stderr`]，则会复制常规的 fd 2。
pub fn dup_tui_stderr() -> io::Result<std::fs::File> {
    #[cfg(unix)]
    {
        use std::os::unix::io::{AsRawFd, FromRawFd};
        let source_fd = TUI_STDERR_FD.get().map(|fd| fd.as_raw_fd()).unwrap_or(2);
        // 安全性：source_fd 要么是之前复制出的 stderr（通过 OnceLock<OwnedFd> 在进程生命周期内保持有效），
        // 要么是常规的 fd 2（标准错误）。dup() 会返回一个新的独立拥有的 fd。
        let new_fd = unsafe { libc::dup(source_fd) };
        if new_fd < 0 {
            return Err(io::Error::last_os_error());
        }
        // 安全性：new_fd 是一个刚刚复制出来的、被当前进程拥有的文件描述符。
        Ok(unsafe { std::fs::File::from_raw_fd(new_fd) })
    }
    #[cfg(not(unix))]
    {
        // 在 Windows 上，`redirect_native_stderr` 为无操作，因此文件描述符 2 总是代表真正的 stderr。
        // 我们在临时创建的 File 上使用 `try_clone()`，通过内部的 `DuplicateHandle` 获得一个独立拥有的句柄，
        // 从而规避了 `from_raw_handle` 的陷阱 —— 后者会导致 `File` 接管进程 stderr 句柄的所有权，并在被 drop 时将其关闭。
        use std::os::windows::io::{AsRawHandle, FromRawHandle};
        let stderr_handle = unsafe {
            windows::Win32::System::Console::GetStdHandle(
                windows::Win32::System::Console::STD_ERROR_HANDLE,
            )
            .map_err(|e| io::Error::other(format!("GetStdHandle 失败: {e}")))?
        };
        // 从原始句柄创建一个临时的 File 并复制它（内部会调用 DuplicateHandle），
        // 接着使用 mem::forget 释放临时 File，防止其关闭进程的 stderr 句柄。
        let temp = unsafe { std::fs::File::from_raw_handle(stderr_handle.0 as _) };
        let cloned = temp.try_clone();
        // 防止 temp 析构时关闭进程的 stderr 句柄。
        std::mem::forget(temp);
        cloned
    }
}

/// 还原 fd 2，使其重新指向真实的终端 stderr。
///
/// 在进程退出前调用此函数，使得最后的打印信息（如 panic 崩溃输出、日志刷盘等）
/// 能够正常输出到用户的终端，而不是流向 `/dev/null`。
pub fn restore_native_stderr() {
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        if let Some(fd) = TUI_STDERR_FD.get() {
            // 安全性：fd 是已备份的真实 stderr（通过 OnceLock<OwnedFd> 保证在进程整个生命周期内有效）。
            // dup2 原子地用 fd 的副本替换 fd 2。
            unsafe { libc::dup2(fd.as_raw_fd(), 2) };
        }
    }
}

/// 当运行在 Windows Subsystem for Linux (WSL1/WSL2) 内部时返回 `true`。
/// 结果在进程生命周期内会被缓存。检测方式：读取 `WSL_DISTRO_NAME` / `WSL_INTEROP` 环境变量，
/// 若不存在则读取 `/proc/sys/kernel/osrelease` 是否包含 `microsoft`/`wsl` 子串（作为备用方案，
/// 这也可以拦截 WSL1 以及清空了环境变量的 shell）。
pub fn is_wsl() -> bool {
    static CACHE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CACHE.get_or_init(detect_is_wsl)
}

fn detect_is_wsl() -> bool {
    if !cfg!(target_os = "linux") {
        return false;
    }
    let env: HashMap<String, String> = std::env::vars().collect();
    let osrelease = std::fs::read_to_string("/proc/sys/kernel/osrelease").ok();
    is_wsl_from_inputs(&env, osrelease.as_deref())
}

/// 纯辅助函数，以便单元测试可以直接传入环境变量和 `/proc` 的内容。
fn is_wsl_from_inputs(env: &HashMap<String, String>, osrelease: Option<&str>) -> bool {
    if env.contains_key("WSL_DISTRO_NAME") || env.contains_key("WSL_INTEROP") {
        return true;
    }
    osrelease.is_some_and(|s| {
        let lower = s.to_ascii_lowercase();
        lower.contains("microsoft") || lower.contains("wsl")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detach_command_does_not_panic() {
        let mut cmd = tokio::process::Command::new("echo");
        detach_command(&mut cmd);
    }

    /// `None` when lowering our own score below 0 is not permitted (it needs
    /// `CAP_SYS_RESOURCE`).
    #[cfg(target_os = "linux")]
    fn child_oom_score_under(hook: fn() -> io::Result<()>) -> Option<String> {
        let own = std::fs::read_to_string("/proc/self/oom_score_adj").expect("read own score");
        let restore = own.trim().to_owned();
        if std::fs::write("/proc/self/oom_score_adj", b"-500\n").is_err() {
            return None;
        }
        let mut cmd = std::process::Command::new("cat");
        cmd.arg("/proc/self/oom_score_adj")
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped());
        // SAFETY: both hooks call only async-signal-safe primitives.
        unsafe {
            use std::os::unix::process::CommandExt;
            cmd.pre_exec(hook);
        }
        let out = cmd.output().expect("spawn child");
        let _ = std::fs::write("/proc/self/oom_score_adj", format!("{restore}\n"));
        Some(String::from_utf8_lossy(&out.stdout).trim().to_owned())
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn detach_from_tty_reset_oom_resets_the_child() {
        let Some(score) = child_oom_score_under(detach_from_tty_reset_oom) else {
            return;
        };
        assert_eq!(
            score, "0",
            "the reset variant must zero the child's oom_score_adj"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn plain_detach_from_tty_leaves_child_oom_score_inherited() {
        let Some(score) = child_oom_score_under(detach_from_tty) else {
            return;
        };
        assert_eq!(
            score, "-500",
            "plain detach_from_tty must not touch the child's inherited oom_score_adj (prod path)"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn detach_pre_exec_hook_defaults_to_no_reset() {
        let Some(score) = child_oom_score_under(detach_pre_exec_hook()) else {
            return;
        };
        assert_eq!(
            score, "-500",
            "without the opt-in env the hook must not reset children"
        );
    }

    #[test]
    fn detach_std_command_does_not_panic() {
        let mut cmd = std::process::Command::new("echo");
        detach_std_command(&mut cmd);
    }

    #[test]
    fn git_command_locking_matches_reader_except_optional_locks_flag() {
        use std::collections::HashMap;
        use std::ffi::{OsStr, OsString};

        let locking = git_command_locking();
        let reading = git_command();
        assert_eq!(locking.get_program(), reading.get_program());

        let lock_args: Vec<OsString> = locking.get_args().map(OsStr::to_os_string).collect();
        let read_args: Vec<OsString> = reading.get_args().map(OsStr::to_os_string).collect();
        assert_eq!(
            read_args.last().map(OsString::as_os_str),
            Some(OsStr::new("--no-optional-locks"))
        );
        assert_eq!(
            &read_args[..read_args.len().saturating_sub(1)],
            lock_args.as_slice()
        );

        let lock_envs: HashMap<_, _> = locking.get_envs().collect();
        let read_envs: HashMap<_, _> = reading.get_envs().collect();
        assert_eq!(lock_envs, read_envs);
    }

    #[test]
    fn new_process_group_does_not_panic() {
        let mut cmd = tokio::process::Command::new("echo");
        new_process_group(&mut cmd);
    }

    #[test]
    fn kill_on_parent_death_std_does_not_panic() {
        let mut cmd = std::process::Command::new("echo");
        kill_on_parent_death_std(&mut cmd);
    }

    #[cfg(unix)]
    #[test]
    fn has_live_members_tracks_the_group_emptying() {
        let mut group = ProcessGroup::new().expect("group");
        assert_eq!(group.has_live_members(), Some(false));

        let mut cmd = std::process::Command::new("sleep");
        cmd.arg("1000")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        detach_std_command(&mut cmd);
        #[allow(clippy::disallowed_methods)] // test: exercises ProcessGroup directly
        let mut child = cmd.spawn().expect("spawn sleeper");
        group.attach_std(&child).expect("attach");
        assert_eq!(group.has_live_members(), Some(true));

        group.kill().expect("kill group");
        // Required: an unreaped zombie still reports live.
        child.wait().expect("reap sleeper");
        assert_eq!(group.has_live_members(), Some(false));
    }

    /// Debug builds enforce the top-of-doc caveat that arming and spawning
    /// happen on the same (long-lived) thread — pdeathsig binds to the
    /// spawning thread's lifetime, so a cross-thread arm+spawn must fail
    /// the spawn with `InvalidInput` (`EINVAL` from the pre_exec guard)
    /// instead of silently binding to the wrong thread. The same-thread
    /// happy path is covered by `armed_child_survives_while_parent_lives`.
    #[cfg(all(target_os = "linux", debug_assertions))]
    #[test]
    fn cross_thread_arming_fails_spawn_in_debug_builds() {
        let mut cmd = std::thread::spawn(|| {
            let mut cmd = std::process::Command::new("true");
            kill_on_parent_death_std(&mut cmd);
            cmd
        })
        .join()
        .expect("arming thread");
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[allow(clippy::disallowed_methods)] // test fixture; the test kills it
        let error = cmd
            .spawn()
            .expect_err("cross-thread arm+spawn must fail in debug builds");
        assert_eq!(
            error.kind(),
            std::io::ErrorKind::InvalidInput,
            "expected the EINVAL thread guard, got: {error}"
        );
    }

    // ── parent-death binding integration tests (Linux) ──────────
    //
    // The scenario needs a real intermediate parent process, so the test
    // binary re-execs itself (the `stderr_redirect_roundtrip_subprocess`
    // pattern): the driver spawns `pdeathsig_intermediate_entry`, which
    // spawns a long-sleeping grandchild armed with the helper and exits;
    // the driver then asserts the grandchild dies with it.

    /// Env marker dispatching the re-exec'd test binary into the
    /// intermediate-parent logic.
    #[cfg(target_os = "linux")]
    const PDEATHSIG_INTERMEDIATE_ENV: &str = "__XAI_TTY_UTILS_PDEATHSIG_INTERMEDIATE";

    /// Intermediate parent: spawn the armed grandchild, report its pid on
    /// stdout, linger briefly so the driver can observe it alive, then exit
    /// (which must take the grandchild down via pdeathsig).
    #[cfg(target_os = "linux")]
    #[test]
    fn pdeathsig_intermediate_entry() {
        if std::env::var_os(PDEATHSIG_INTERMEDIATE_ENV).is_none() {
            return; // skip when not invoked as the re-exec'd intermediate
        }

        let mut cmd = std::process::Command::new("sleep");
        cmd.arg("300")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        // Composability under test: detach (setsid) plus parent-death
        // binding on the same command, in the documented order.
        detach_std_command(&mut cmd);
        kill_on_parent_death_std(&mut cmd);
        #[allow(clippy::disallowed_methods)] // test fixture; the test kills it
        let child = cmd.spawn().expect("spawn armed grandchild");
        println!("grandchild:{}", child.id());
        // Do not reap: the grandchild must outlive this handle and die only
        // via pdeathsig when this process exits.
        std::mem::forget(child);
        std::thread::sleep(std::time::Duration::from_millis(1000));
    }

    /// A child spawned with [`kill_on_parent_death_std`] must not outlive
    /// its parent: the kernel SIGTERMs it when the parent exits.
    #[cfg(target_os = "linux")]
    #[test]
    fn armed_child_dies_when_parent_exits() {
        let exe = std::env::current_exe().expect("current_exe");
        let mut cmd = std::process::Command::new(exe);
        cmd.arg("--exact")
            .arg("tests::pdeathsig_intermediate_entry")
            .arg("--nocapture")
            .arg("--test-threads=1")
            .env(PDEATHSIG_INTERMEDIATE_ENV, "1")
            // The intermediate is a fresh libtest run of exactly one filtered
            // test. Strip Bazel's per-shard env so a `shard_count` build can't
            // partition that single test into another shard (running zero
            // tests), and drop any inherited filter.
            .env_remove("TEST_SHARD_INDEX")
            .env_remove("TEST_TOTAL_SHARDS")
            .env_remove("TEST_SHARD_STATUS_FILE")
            .env_remove("TESTBRIDGE_TEST_ONLY")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        #[allow(clippy::disallowed_methods)] // test fixture; the test kills it
        let mut intermediate = cmd.spawn().expect("spawn intermediate test process");

        // Grandchild pid from the intermediate's stdout. Substring-match, not
        // line-prefix parsing: with `--nocapture` libtest prints the
        // `test tests::… ... ` header WITHOUT a trailing newline, so the
        // reported pid shares its line with harness chrome.
        let stdout = intermediate.stdout.take().expect("piped stdout");
        let mut reader = std::io::BufReader::new(stdout);
        let mut seen: Vec<String> = Vec::new();
        let grandchild_pid = loop {
            use std::io::BufRead as _;
            let mut line = String::new();
            let n = reader
                .read_line(&mut line)
                .expect("read intermediate stdout");
            assert_ne!(
                n, 0,
                "intermediate exited without reporting a grandchild; stdout seen: {seen:?}"
            );
            if let Some(idx) = line.find("grandchild:") {
                let digits: String = line[idx + "grandchild:".len()..]
                    .chars()
                    .take_while(char::is_ascii_digit)
                    .collect();
                break digits.parse::<i32>().unwrap_or_else(|e| {
                    panic!("parse grandchild pid from {line:?}: {e}");
                });
            }
            seen.push(line);
        };

        // `kill(pid, 0)` succeeds on zombies, and under a non-reaping
        // subreaper (e.g. a test process-wrapper) the orphaned grandchild can
        // linger as a zombie after the SIGTERM. Treat zombie as dead: the
        // signal did its job.
        let alive = |pid: i32| match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
            Err(_) => false,
            Ok(stat) => {
                // Field 3 (state) is the first token after the last ')' —
                // comm can itself contain ')'.
                let state = stat
                    .rsplit_once(')')
                    .and_then(|(_, rest)| rest.trim_start().chars().next());
                state != Some('Z')
            }
        };
        assert!(
            alive(grandchild_pid),
            "grandchild should be running while its parent is alive"
        );

        let status = intermediate.wait().expect("wait intermediate");
        assert!(status.success(), "intermediate test run failed: {status:?}");

        // Parent gone — the armed grandchild must be SIGTERMed by the kernel
        // (orphan → reparent → reap → ESRCH). Poll with a deadline.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while alive(grandchild_pid) && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(
            !alive(grandchild_pid),
            "grandchild pid {grandchild_pid} outlived its parent despite \
             kill_on_parent_death_std (PR_SET_PDEATHSIG not effective)"
        );
    }

    /// The binding must be one-directional: a live parent keeps its armed
    /// child alive (no false-positive from the ppid race check or from
    /// composing with `detach_std_command`).
    #[cfg(target_os = "linux")]
    #[test]
    fn armed_child_survives_while_parent_lives() {
        let mut cmd = std::process::Command::new("sleep");
        cmd.arg("60")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        detach_std_command(&mut cmd);
        kill_on_parent_death_std(&mut cmd);
        #[allow(clippy::disallowed_methods)] // test fixture; the test kills it
        let mut child = cmd.spawn().expect("spawn armed child");

        // The binding must not kill a child whose parent (this process) is
        // alive and whose ppid matches the captured pid.
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert!(
            child.try_wait().expect("try_wait").is_none(),
            "armed child died even though its parent is still alive"
        );
        child.kill().expect("kill child");
        child.wait().expect("reap child");
    }

    fn wsl_env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn is_wsl_detects_wsl_distro_name() {
        assert!(is_wsl_from_inputs(
            &wsl_env(&[("WSL_DISTRO_NAME", "Ubuntu")]),
            None
        ));
    }

    #[test]
    fn is_wsl_detects_wsl_interop() {
        assert!(is_wsl_from_inputs(
            &wsl_env(&[("WSL_INTEROP", "/run/WSL/8_interop")]),
            None,
        ));
    }

    // 当环境变量被清除时，通过 osrelease 仍然能匹配到 WSL 环境。
    #[test]
    fn is_wsl_detects_wsl2_osrelease() {
        assert!(is_wsl_from_inputs(
            &wsl_env(&[]),
            Some("5.15.167.4-microsoft-standard-WSL2\n"),
        ));
    }

    #[test]
    fn is_wsl_detects_wsl1_osrelease() {
        assert!(is_wsl_from_inputs(
            &wsl_env(&[]),
            Some("4.4.0-19041-Microsoft\n")
        ));
    }

    #[test]
    fn is_wsl_osrelease_match_is_case_insensitive() {
        assert!(is_wsl_from_inputs(
            &wsl_env(&[]),
            Some("WSLg-experimental\n")
        ));
        assert!(is_wsl_from_inputs(
            &wsl_env(&[]),
            Some("Foo-MICROSOFT-bar\n")
        ));
    }

    #[test]
    fn is_wsl_rejects_native_linux() {
        assert!(!is_wsl_from_inputs(
            &wsl_env(&[]),
            Some("6.5.0-21-generic\n")
        ));
    }

    #[test]
    fn is_wsl_rejects_when_osrelease_missing() {
        assert!(!is_wsl_from_inputs(&wsl_env(&[]), None));
    }

    #[test]
    fn is_wsl_env_var_match_is_exact_key_not_substring() {
        // 名字仅仅包含 "WSL" 的变量不应触发检测。
        assert!(!is_wsl_from_inputs(
            &wsl_env(&[("MY_WSLISH_VAR", "1"), ("OTHER", "wsl_in_value")]),
            Some("6.5.0-21-generic\n"),
        ));
    }

    #[test]
    fn pager_env_has_expected_keys() {
        let env = pager_env();
        assert!(env.contains_key("PAGER"));
        assert!(env.contains_key("GIT_PAGER"));
        assert!(env.contains_key("GH_PAGER"));
        assert!(env.contains_key("GIT_TERMINAL_PROMPT"));
        // 存在且为空，使 gpg/pinentry 无法抢占 TUI 终端。
        assert_eq!(env.get("GPG_TTY"), Some(&String::new()));
    }

    // ── stderr 重定向集成测试 ────────────────────────
    //
    // 重定向、dup 以及还原的操作会改变进程全局的状态（fd 2 和 `OnceLock`），
    // 因此完整的流程会在一个子进程中运行，以避免污染其他测试用例。

    /// 即使此前未调用重定向，`dup_tui_stderr` 也应返回一个可写入的 File。
    #[test]
    fn dup_tui_stderr_without_redirect_returns_writable_file() {
        use std::io::Write;
        let mut f = dup_tui_stderr().expect("dup_tui_stderr 应当成功");
        f.write_all(b"").expect("零长度写入应当成功");
    }

    /// 由 `dup_tui_stderr` 返回的 `File` 可以正常写入多字节 UTF-8，
    /// 且不会发生截断或字节级别的乱码。
    ///
    /// 在 Windows 上，包装了控制台句柄的 `File` 会使用 `WriteFile`
    /// （面向字节且与活动代码页相关），而非 `WriteConsoleW`（面向 UTF-16 且与代码页无关）。
    /// 本测试旨在验证其至少能够正常写入而不报错。
    /// Windows 上的完整 Unicode 支持还需要调用 `SetConsoleOutputCP(65001)` 
    /// 或直接使用 `std::io::stderr()`（它内部使用 `WriteConsoleW`）。
    #[test]
    fn dup_tui_stderr_accepts_multibyte_utf8() {
        use std::io::Write;
        let mut f = dup_tui_stderr().expect("dup_tui_stderr 应当成功");
        // 盲文（每个占 3 字节），Powerline 图标（占 3 字节），表情符号（占 4 字节）。
        let payload = "⣀⣾⠿⠛\u{e0a0}\u{1F600}";
        f.write_all(payload.as_bytes())
            .expect("多字节 UTF-8 写入应当成功");
        f.flush().expect("flush 应当成功");
    }

    /// 派生一个子进程以演练 重定向 -> dup -> 还原 的完整闭环。
    #[cfg(unix)]
    #[test]
    fn stderr_redirect_roundtrip_subprocess() {
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("tests::stderr_redirect_roundtrip_body")
            .env("__XAI_STDERR_REDIRECT_SUBPROCESS", "1")
            .status()
            .expect("派生子进程失败");
        assert!(status.success(), "子进程集成测试失败");
    }

    /// 实际的 重定向/dup/还原 的测试逻辑体（仅作为子进程执行）。
    #[cfg(unix)]
    #[test]
    fn stderr_redirect_roundtrip_body() {
        if std::env::var("__XAI_STDERR_REDIRECT_SUBPROCESS").is_err() {
            return; // 若非作为子进程调用，则直接跳过
        }

        use std::io::Write;
        use std::os::unix::io::AsRawFd;

        // 1. 重定向后，fd 2 正式指向 /dev/null。
        redirect_native_stderr();
        let fd2_flags = unsafe { libc::fcntl(2, libc::F_GETFD) };
        assert!(fd2_flags >= 0, "重定向后 fd 2 应当有效");

        // 验证 fd 2 已指向 /dev/null：检查写入是否成功，
        // 同时检查读取 inode 信息以确定它已经变成了别的文件。
        let mut stat_fd2: libc::stat = unsafe { std::mem::zeroed() };
        let r = unsafe { libc::fstat(2, &mut stat_fd2) };
        assert_eq!(r, 0, "fstat(2) 应当成功");

        // 2. `dup_tui_stderr` 应当返回一个可以写入真实终端的 fd。
        let mut tui = dup_tui_stderr().expect("dup_tui_stderr after redirect");
        assert!(tui.as_raw_fd() > 2, "复制出的 fd 应大于 2");
        tui.write_all(b"").expect("写入复制出的 fd 应当成功");

        // 3. 第二次调用应该返回一个彼此独立的 fd。
        let tui2 = dup_tui_stderr().expect("second dup_tui_stderr");
        assert_ne!(
            tui.as_raw_fd(),
            tui2.as_raw_fd(),
            "每次调用应返回不同的 fd"
        );
        drop(tui2);
        // 在第一个 fd 被 drop 之后，第一个 fd 依然能够正常工作。
        tui.write_all(b"").expect("第一个 fd 在第二个 fd 被 drop 后仍应可用");

        // 4. `restore_native_stderr` 应当能恢复原来的 fd 2。
        restore_native_stderr();
        let fd2_after = unsafe { libc::fcntl(2, libc::F_GETFD) };
        assert!(fd2_after >= 0, "还原后 fd 2 应当有效");

        // 验证 fd 2 不再指向 /dev/null（验证 inode 已发生改变）。
        let mut stat_after: libc::stat = unsafe { std::mem::zeroed() };
        let r = unsafe { libc::fstat(2, &mut stat_after) };
        assert_eq!(r, 0, "还原后 fstat(2) 应当成功");
        assert_ne!(
            stat_fd2.st_ino, stat_after.st_ino,
            "还原后 fd 2 的 inode 应发生改变（不再是 /dev/null）"
        );
    }

    #[tokio::test]
    async fn process_group_kill_terminates_attached_child() {
        let mut cmd = if cfg!(windows) {
            let mut c = tokio::process::Command::new("cmd");
            c.args(["/C", "ping", "-n", "60", "127.0.0.1"]);
            c
        } else {
            let mut c = tokio::process::Command::new("sleep");
            c.arg("60");
            c
        };
        new_process_group(&mut cmd);

        let mut group = ProcessGroup::new().expect("创建 ProcessGroup");
        #[allow(clippy::disallowed_methods)] // 测试：直接操作 ProcessGroup
        let mut child = cmd.spawn().expect("派生子进程");
        group.attach(&child).expect("将子进程关联到组");

        group.kill().expect("kill ProcessGroup");

        let status = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait())
            .await
            .expect("child should exit within 5s of group kill")
            .expect("wait returns ok");
        assert!(
            !status.success(),
            "被 kill 的子进程不应成功退出"
        );
    }

    /// `kill()` 必须能够清理掉整个进程组 —— 包括组长在新组中派生出的子孙（子树）进程，
    /// 而不是仅仅清理直属的组长进程。
    /// 这是 LSP / MCP / 终端清理逻辑所依赖的 `killpg` 树状杀灭属性。
    /// 在修正前的代码中，仅仅给直属的子进程发送了信号，从而导致子孙进程（例如语言服务器自身的子进程）沦为孤儿进程。
    #[cfg(unix)]
    #[tokio::test]
    async fn process_group_kill_reaps_grandchild_tree() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        // 组长进程 = sh；它在相同的进程组中后台启动了一个子孙进程（sh 并不会对
        // 其子进程调用 `setsid`），输出该子孙进程的 PID，然后等待。
        let mut cmd = tokio::process::Command::new("sh");
        cmd.args(["-c", "sleep 60 & echo $!; wait"]);
        cmd.stdout(std::process::Stdio::piped());
        new_process_group(&mut cmd);

        let mut group = ProcessGroup::new().expect("创建 ProcessGroup");
        #[allow(clippy::disallowed_methods)] // 测试：操作 ProcessGroup 及其子孙进程的清理
        let mut child = cmd.spawn().expect("spawn leader");
        group.attach(&child).expect("attach leader to group");

        // 从组长进程的标准输出中读取子孙进程的 PID。
        let stdout = child.stdout.take().expect("piped stdout");
        let mut line = String::new();
        BufReader::new(stdout)
            .read_line(&mut line)
            .await
            .expect("read grandchild pid");
        let gc_pid: i32 = line.trim().parse().expect("parse grandchild pid");

        let alive =
            |pid: i32| nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None).is_ok();
        assert!(
            alive(gc_pid),
            "子孙进程在 kill 之前应处于运行状态"
        );

        group.kill().expect("kill ProcessGroup");

        // 组长进程退出。
        tokio::time::timeout(std::time::Duration::from_secs(5), child.wait())
            .await
            .expect("leader should exit within 5s of group kill")
            .expect("wait ok");

        // 子孙进程（在同一个组内）也必须被 killpg 清理掉 —— 
        // 持续轮询直到其消失（孤儿进程 -> 托管给 init -> 被回收 -> 报错 ESRCH）。
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while alive(gc_pid) && std::time::Instant::now() < deadline {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        assert!(
            !alive(gc_pid),
            "killpg 必须回收整个组（包括子孙进程），而非仅组长；\
             组被 kill 后，子孙进程 {gc_pid} 仍在运行"
        );
    }

    /// [`ProcessGroupId`] 在构建时应当拒绝不合规的 pid（0, 1, 当前进程自身的组），
    /// 从而确保 `killpg` 绝不可能广播到子进程进程组以外的地方。
    #[cfg(unix)]
    #[test]
    fn process_group_id_rejects_degenerate_and_own_group() {
        assert!(
            ProcessGroupId::new(0).is_err(),
            "pid 0 = 调用者自身进程组 — 必须拒绝"
        );
        assert!(
            ProcessGroupId::new(1).is_err(),
            "pid 1 = init — 必须拒绝"
        );
        let own = nix::unistd::getpgrp().as_raw() as u32;
        assert!(
            ProcessGroupId::new(own).is_err(),
            "调用者自身的进程组（{own}）必须被拒绝"
        );
        // 大于 i32::MAX 的 pid 在转换时会发生溢出，因此必须予以拒绝。
        assert!(
            ProcessGroupId::new(u32::MAX).is_err(),
            "pid > i32::MAX 必须被拒绝（killpg 转换时会发生回绕）"
        );
        // 正常的外部 pid 则应当构建成功。
        let foreign = if own == 2 { 3 } else { 2 };
        let id = ProcessGroupId::new(foreign).expect("foreign pgid should be accepted");
        assert_eq!(id.get(), foreign);
    }
}
