//! 每 Tab 一个交互式 PTY。关 Tab 杀进程；关应用靠 Job Object / drop 全回收。
//! AI 命令输出不走这里。

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct PtyOutputPayload {
    pub tab_id: String,
    pub data: String,
}

struct PtySlot {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
    attached: AtomicBool,
    cwd: String,
    /// 最近输出。切 Tab / StrictMode 重挂时回放，避免空屏。
    tail: Mutex<Vec<u8>>,
}

const TAIL_MAX: usize = 64 * 1024;

pub struct PtyManager {
    slots: Mutex<HashMap<String, Arc<PtySlot>>>,
    job: JobGuard,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            slots: Mutex::new(HashMap::new()),
            job: JobGuard::create(),
        }
    }

    pub fn start(
        &self,
        tab_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        app: AppHandle,
    ) -> Result<(), String> {
        if self.try_reattach(tab_id, cwd, cols, rows, &app)? {
            return Ok(());
        }
        // cwd 变了或进程已死：杀掉再建。
        self.stop(tab_id);

        let mut slots = self.slots.lock().map_err(|_| "pty 锁损坏")?;
        if let Some(slot) = slots.get(tab_id).cloned() {
            slot.attached.store(true, Ordering::SeqCst);
            drop(slots);
            flush_tail(&slot, &app, tab_id);
            let _ = self.resize(tab_id, cols, rows);
            return Ok(());
        }

        let (program, args) = default_shell();
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: rows.max(8),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("打开 PTY 失败: {e}"))?;

        let mut cmd = CommandBuilder::new(&program);
        if !args.is_empty() {
            cmd.args(&args);
        }
        if !cwd.trim().is_empty() {
            cmd.cwd(cwd);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("启动 shell 失败: {e}"))?;

        self.job.assign_child(child.as_ref());

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("PTY reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("PTY writer: {e}"))?;

        let slot = Arc::new(PtySlot {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            attached: AtomicBool::new(true),
            cwd: cwd.to_string(),
            tail: Mutex::new(Vec::new()),
        });
        slots.insert(tab_id.to_string(), slot.clone());
        drop(slots);

        let tab = tab_id.to_string();
        std::thread::Builder::new()
            .name(format!("pty-{tab}"))
            .spawn(move || read_loop(app, tab, reader, slot))
            .map_err(|e| format!("启动 PTY 读线程失败: {e}"))?;
        Ok(())
    }

    fn try_reattach(
        &self,
        tab_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        app: &AppHandle,
    ) -> Result<bool, String> {
        let slots = self.slots.lock().map_err(|_| "pty 锁损坏")?;
        let Some(slot) = slots.get(tab_id).cloned() else {
            return Ok(false);
        };
        let same_cwd = slot.cwd == cwd;
        let alive = slot
            .child
            .lock()
            .ok()
            .and_then(|mut c| c.try_wait().ok())
            .map(|st| st.is_none())
            .unwrap_or(false);
        if !(same_cwd && alive) {
            return Ok(false);
        }
        slot.attached.store(true, Ordering::SeqCst);
        drop(slots);
        flush_tail(&slot, app, tab_id);
        let _ = self.resize(tab_id, cols, rows);
        Ok(true)
    }

    pub fn detach(&self, tab_id: &str) {
        if let Ok(slots) = self.slots.lock() {
            if let Some(slot) = slots.get(tab_id) {
                slot.attached.store(false, Ordering::SeqCst);
            }
        }
    }

    pub fn write(&self, tab_id: &str, data: &str) -> Result<(), String> {
        let slots = self.slots.lock().map_err(|_| "pty 锁损坏")?;
        let slot = slots
            .get(tab_id)
            .ok_or_else(|| "该 Tab 没有终端".to_string())?;
        let mut w = slot.writer.lock().map_err(|_| "pty writer 锁损坏")?;
        w.write_all(data.as_bytes())
            .map_err(|e| format!("写入终端失败: {e}"))?;
        let _ = w.flush();
        Ok(())
    }

    pub fn resize(&self, tab_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let slots = self.slots.lock().map_err(|_| "pty 锁损坏")?;
        let slot = slots
            .get(tab_id)
            .ok_or_else(|| "该 Tab 没有终端".to_string())?;
        let master = slot.master.lock().map_err(|_| "pty master 锁损坏")?;
        master
            .resize(PtySize {
                rows: rows.max(8),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("调整终端尺寸失败: {e}"))
    }

    pub fn stop(&self, tab_id: &str) {
        let slot = {
            let Ok(mut slots) = self.slots.lock() else {
                return;
            };
            slots.remove(tab_id)
        };
        if let Some(slot) = slot {
            slot.attached.store(false, Ordering::SeqCst);
            if let Ok(mut child) = slot.child.lock() {
                let _ = child.kill();
            }
        }
    }
}

fn read_loop(app: AppHandle, tab_id: String, mut reader: Box<dyn Read + Send>, slot: Arc<PtySlot>) {
    let mut buf = [0u8; 4096];
    let mut leftover = Vec::new();
    loop {
        match reader.read(&mut buf) {
            Ok(0) => {
                if !leftover.is_empty() && slot.attached.load(Ordering::SeqCst) {
                    let data = String::from_utf8_lossy(&leftover).into_owned();
                    let _ = app.emit(
                        "pty-output",
                        PtyOutputPayload {
                            tab_id: tab_id.clone(),
                            data,
                        },
                    );
                }
                break;
            }
            Ok(n) => {
                keep_tail(&slot.tail, &buf[..n]);
                leftover.extend_from_slice(&buf[..n]);
                if let Some(data) = take_utf8_chunk(&mut leftover) {
                    if slot.attached.load(Ordering::SeqCst) {
                        let _ = app.emit(
                            "pty-output",
                            PtyOutputPayload {
                                tab_id: tab_id.clone(),
                                data,
                            },
                        );
                    }
                }
            }
            Err(_) => break,
        }
    }
}

/// 读循环可能把多字节 UTF-8 拆在两次 read 中间；不完整后缀留到下次。
fn take_utf8_chunk(buf: &mut Vec<u8>) -> Option<String> {
    if buf.is_empty() {
        return None;
    }
    match std::str::from_utf8(buf) {
        Ok(s) => {
            let out = s.to_string();
            buf.clear();
            Some(out)
        }
        Err(e) => {
            let valid = e.valid_up_to();
            if e.error_len().is_none() {
                if valid == 0 {
                    return None;
                }
                let out = String::from_utf8(buf.drain(..valid).collect()).unwrap_or_default();
                Some(out)
            } else {
                let err_len = e
                    .error_len()
                    .unwrap_or(1)
                    .min(buf.len().saturating_sub(valid));
                let mut out = if valid > 0 {
                    String::from_utf8(buf.drain(..valid).collect()).unwrap_or_default()
                } else {
                    String::new()
                };
                out.push('\u{FFFD}');
                let skip = err_len.min(buf.len());
                buf.drain(..skip);
                Some(out)
            }
        }
    }
}

fn keep_tail(tail: &Mutex<Vec<u8>>, chunk: &[u8]) {
    let Ok(mut buf) = tail.lock() else { return };
    buf.extend_from_slice(chunk);
    if buf.len() > TAIL_MAX {
        let excess = buf.len() - TAIL_MAX;
        buf.drain(..excess);
    }
}

fn flush_tail(slot: &PtySlot, app: &AppHandle, tab_id: &str) {
    let data = {
        let Ok(buf) = slot.tail.lock() else { return };
        if buf.is_empty() {
            return;
        }
        String::from_utf8_lossy(&buf).into_owned()
    };
    let _ = app.emit(
        "pty-output",
        PtyOutputPayload {
            tab_id: tab_id.to_string(),
            data,
        },
    );
}

fn default_shell() -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        if which_exists("pwsh.exe") {
            return ("pwsh.exe".into(), vec!["-NoLogo".into()]);
        }
        if which_exists("powershell.exe") {
            return ("powershell.exe".into(), vec!["-NoLogo".into()]);
        }
        (
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()),
            vec![],
        )
    }
    #[cfg(not(windows))]
    {
        (
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into()),
            vec![],
        )
    }
}

#[cfg(windows)]
fn which_exists(name: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| {
            std::env::split_paths(&p).any(|dir| {
                let p = dir.join(name);
                p.is_file()
            })
        })
        .unwrap_or(false)
}

struct JobGuard {
    #[cfg(windows)]
    handle: Option<windows::Win32::Foundation::HANDLE>,
}

#[cfg(windows)]
unsafe impl Send for JobGuard {}
#[cfg(windows)]
unsafe impl Sync for JobGuard {}

impl JobGuard {
    fn create() -> Self {
        #[cfg(windows)]
        {
            Self {
                handle: unsafe { create_kill_on_close_job() },
            }
        }
        #[cfg(not(windows))]
        {
            Self {}
        }
    }

    fn assign_child(&self, child: &dyn portable_pty::Child) {
        #[cfg(windows)]
        {
            if let Some(job) = self.handle {
                if let Some(raw) = child.as_raw_handle() {
                    unsafe {
                        assign_handle_to_job(job, raw);
                    }
                } else if let Some(pid) = child.process_id() {
                    unsafe {
                        assign_pid_to_job(job, pid);
                    }
                }
            }
        }
        #[cfg(not(windows))]
        {
            let _ = child;
        }
    }
}

#[cfg(windows)]
impl Drop for JobGuard {
    fn drop(&mut self) {
        if let Some(h) = self.handle.take() {
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(h);
            }
        }
    }
}

#[cfg(windows)]
unsafe fn create_kill_on_close_job() -> Option<windows::Win32::Foundation::HANDLE> {
    use windows::Win32::System::JobObjects::{
        CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JobObjectExtendedLimitInformation, SetInformationJobObject,
    };

    let job = unsafe { CreateJobObjectW(None, windows::core::PCWSTR::null()) }.ok()?;
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let ok = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    }
    .is_ok();
    if !ok {
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(job) };
        return None;
    }
    Some(job)
}

#[cfg(windows)]
unsafe fn assign_handle_to_job(
    job: windows::Win32::Foundation::HANDLE,
    raw: std::os::windows::io::RawHandle,
) {
    use windows::Win32::System::JobObjects::AssignProcessToJobObject;
    let proc = windows::Win32::Foundation::HANDLE(raw);
    let _ = unsafe { AssignProcessToJobObject(job, proc) };
}

#[cfg(windows)]
unsafe fn assign_pid_to_job(job: windows::Win32::Foundation::HANDLE, pid: u32) {
    use windows::Win32::System::JobObjects::AssignProcessToJobObject;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    let proc = match unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) } {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = unsafe { AssignProcessToJobObject(job, proc) };
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(proc) };
}
