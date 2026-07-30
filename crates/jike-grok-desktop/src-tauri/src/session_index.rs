//! Codex 风格会话索引：SQLite WAL + session_id。
//!
//! - 正文仍在磁盘 `updates.jsonl` / session 目录（rollout 等价）
//! - 本库只存侧栏列表元数据，对齐 `~/.codex/state_*.sqlite` 的 threads 表思路

use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static INDEX: Mutex<Option<Connection>> = Mutex::new(None);

fn db_path() -> PathBuf {
    let home = std::env::var("GROK_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".jike-grok-desktop")
        });
    home.join("sessions").join("threads.sqlite")
}

fn open_db() -> Result<Connection, String> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&path).map_err(|e| format!("打开 threads.sqlite 失败: {e}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS threads (
           id TEXT PRIMARY KEY,
           title TEXT NOT NULL DEFAULT '',
           preview TEXT NOT NULL DEFAULT '',
           cwd TEXT NOT NULL DEFAULT '',
           updated_at TEXT NOT NULL DEFAULT '',
           updated_at_ms INTEGER NOT NULL DEFAULT 0,
           num_messages INTEGER NOT NULL DEFAULT 0,
           transcript_path TEXT NOT NULL DEFAULT ''
         );
         CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at_ms DESC);
         CREATE INDEX IF NOT EXISTS idx_threads_cwd ON threads(cwd);",
    )
    .map_err(|e| format!("初始化 threads 表失败: {e}"))?;
    Ok(conn)
}

fn with_db<T>(f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let mut guard = INDEX.lock().map_err(|_| "session index 锁损坏".to_string())?;
    if guard.is_none() {
        *guard = Some(open_db()?);
    }
    f(guard.as_ref().unwrap())
}

#[derive(Debug, Clone)]
pub struct ThreadRow {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub cwd: String,
    pub updated_at: String,
    pub updated_at_ms: i64,
    pub num_messages: usize,
    pub transcript_path: String,
}

/// 用当前磁盘 summary 全量重建索引（启动 / 刷新列表时调用）。
pub fn rebuild_from_summaries(rows: &[ThreadRow]) -> Result<(), String> {
    with_db(|conn| {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM threads", [])
            .map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO threads
                     (id, title, preview, cwd, updated_at, updated_at_ms, num_messages, transcript_path)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                )
                .map_err(|e| e.to_string())?;
            for r in rows {
                stmt.execute(params![
                    r.id,
                    r.title,
                    r.preview,
                    r.cwd,
                    r.updated_at,
                    r.updated_at_ms,
                    r.num_messages as i64,
                    r.transcript_path,
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// 列出线程；`current_cwd` 非空时该 cwd 优先，其余按 recency。
pub fn list_threads(current_cwd: &str, limit: Option<u32>) -> Result<Vec<ThreadRow>, String> {
    with_db(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, preview, cwd, updated_at, updated_at_ms, num_messages, transcript_path
                 FROM threads
                 ORDER BY updated_at_ms DESC",
            )
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map([], |row| {
                Ok(ThreadRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    preview: row.get(2)?,
                    cwd: row.get(3)?,
                    updated_at: row.get(4)?,
                    updated_at_ms: row.get(5)?,
                    num_messages: row.get::<_, i64>(6)? as usize,
                    transcript_path: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut all: Vec<ThreadRow> = iter.filter_map(|r| r.ok()).collect();

        let current = current_cwd.trim().replace('\\', "/").to_ascii_lowercase();
        if !current.is_empty() {
            all.sort_by(|a, b| {
                let a_cur = a.cwd.replace('\\', "/").to_ascii_lowercase() == current;
                let b_cur = b.cwd.replace('\\', "/").to_ascii_lowercase() == current;
                match (a_cur, b_cur) {
                    (true, false) => std::cmp::Ordering::Less,
                    (false, true) => std::cmp::Ordering::Greater,
                    _ => b.updated_at_ms.cmp(&a.updated_at_ms),
                }
            });
        }

        if let Some(n) = limit.filter(|n| *n > 0) {
            all.truncate(n as usize);
        }
        Ok(all)
    })
}

pub fn delete_thread(session_id: &str) -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM threads WHERE id = ?1", params![session_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn rename_thread(session_id: &str, title: &str) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "UPDATE threads SET title = ?1 WHERE id = ?2",
            params![title, session_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// 解析会话目录下 updates.jsonl 绝对路径（若存在）。
pub fn transcript_path_for_dir(dir: &Path) -> String {
    let p = dir.join("updates.jsonl");
    if p.is_file() {
        p.to_string_lossy().into_owned()
    } else {
        dir.join("chat_history.jsonl")
            .to_string_lossy()
            .into_owned()
    }
}
