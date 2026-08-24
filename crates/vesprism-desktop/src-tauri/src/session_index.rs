//! 会话索引：SQLite WAL + session_id。
//!
//! - 正文仍在磁盘 `updates.jsonl` / session 目录
//! - 本库只存侧栏列表元数据 threads 表

use rusqlite::{Connection, params};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 把 Windows 长路径、斜杠、大小写折成同一把钥匙，
/// 使 `D:\foo`、`d:/foo`、`\\?\D:\foo` 归为同一项目。
pub fn normalize_workspace_path(path: &str) -> String {
    let mut s = path.trim().replace('\\', "/");
    if let Some(rest) = s.strip_prefix("//?/UNC/") {
        s = format!("//{rest}");
    } else if let Some(rest) = s.strip_prefix("//?/") {
        s = rest.to_string();
    }
    if s.len() > 1 {
        while s.ends_with('/') {
            let keep_drive_root = s.len() == 3 && s.as_bytes().get(1) == Some(&b':');
            if keep_drive_root {
                break;
            }
            s.pop();
            if s.is_empty() {
                break;
            }
        }
    }
    s.to_ascii_lowercase()
}

static INDEX: Mutex<Option<Connection>> = Mutex::new(None);

fn db_path() -> PathBuf {
    let home = std::env::var("GROK_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".vesprism")
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
         -- 组装单会话覆盖：独立于 threads 表，rebuild_from_summaries 不会清掉。
         CREATE TABLE IF NOT EXISTS thread_compositions (
           id TEXT PRIMARY KEY,
           composition TEXT NOT NULL DEFAULT ''
         );
         -- 工作台产物绑定：左侧历史会话 -> 本地 Flow / Agent 资产。
         -- 独立于 threads 表，rebuild_from_summaries 不会清掉。
         CREATE TABLE IF NOT EXISTS thread_workbench_bindings (
           id TEXT PRIMARY KEY,
           active_workbench_view TEXT NOT NULL DEFAULT '',
           updated_at_ms INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS thread_workbench_artifacts (
           session_id TEXT NOT NULL,
           kind TEXT NOT NULL,
           artifact_id TEXT NOT NULL,
           updated_at_ms INTEGER NOT NULL DEFAULT 0,
           PRIMARY KEY (session_id, kind, artifact_id)
         );
         CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at_ms DESC);
         CREATE INDEX IF NOT EXISTS idx_threads_cwd ON threads(cwd);
         CREATE INDEX IF NOT EXISTS idx_thread_workbench_artifacts_session
           ON thread_workbench_artifacts(session_id, updated_at_ms DESC);
         -- 工具会话（flow-canvas / agents / mcp / skills / tools / workflows）标记：
         -- 不进主聊天历史。画布/编制开口或已绑定产物的走 list_workbench_threads，进侧栏「工作台」。
         CREATE TABLE IF NOT EXISTS thread_tool_sessions (
           id TEXT PRIMARY KEY
         );
         -- 用户钉住的仓库根。只给侧栏多仓库切换用，不参与审批/信任。
         CREATE TABLE IF NOT EXISTS projects (
           root TEXT PRIMARY KEY,
           display_name TEXT NOT NULL DEFAULT '',
           updated_at_ms INTEGER NOT NULL DEFAULT 0
         );",
    )
    .map_err(|e| format!("初始化 threads 表失败: {e}"))?;
    Ok(conn)
}

fn with_db<T>(f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let mut guard = INDEX
        .lock()
        .map_err(|_| "session index 锁损坏".to_string())?;
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
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
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
                    normalize_workspace_path(&r.cwd),
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

/// 增量插入或更新单条会话索引记录，不触碰其余行（相比 rebuild_from_summaries 的全表重建）。
pub fn upsert_thread(row: &ThreadRow) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO threads
             (id, title, preview, cwd, updated_at, updated_at_ms, num_messages, transcript_path)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               preview = excluded.preview,
               cwd = excluded.cwd,
               updated_at = excluded.updated_at,
               updated_at_ms = excluded.updated_at_ms,
               num_messages = excluded.num_messages,
               transcript_path = excluded.transcript_path",
            params![
                row.id,
                row.title,
                row.preview,
                normalize_workspace_path(&row.cwd),
                row.updated_at,
                row.updated_at_ms,
                row.num_messages as i64,
                row.transcript_path,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// 标记会话为工具会话（flow-canvas / agents 等面板），默认不进侧栏历史。
pub fn mark_tool_session(id: &str) -> Result<(), String> {
    if id.trim().is_empty() {
        return Ok(());
    }
    with_db(|conn| {
        conn.execute(
            "INSERT OR IGNORE INTO thread_tool_sessions (id) VALUES (?1)",
            params![id.trim()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// 取消工具会话标记（一般不需要：有产物的会话由 list_workbench_threads 单独列出）。
pub fn unmark_tool_session(id: &str) -> Result<(), String> {
    if id.trim().is_empty() {
        return Ok(());
    }
    with_db(|conn| {
        conn.execute(
            "DELETE FROM thread_tool_sessions WHERE id = ?1",
            params![id.trim()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// 把历史里有工作台产物绑定或像画布生成器的会话补标成工具会话（一次性隔离旧脏数据）。
pub fn mark_legacy_canvas_sessions() -> Result<(), String> {
    with_db(|conn| {
        // 1. 已有工作台绑定的产物/会话直接打标
        conn.execute(
            "INSERT OR IGNORE INTO thread_tool_sessions (id)
             SELECT DISTINCT session_id FROM thread_workbench_artifacts
             UNION
             SELECT id FROM thread_workbench_bindings
             WHERE active_workbench_view != ''",
            [],
        )
        .map_err(|e| e.to_string())?;

        // 2. 匹配历史残余特征（title / preview）
        conn.execute(
            "INSERT OR IGNORE INTO thread_tool_sessions (id)
             SELECT id FROM threads
             WHERE title LIKE '生成流程图：%'
                OR title LIKE '你是 Vesprism 流程画布%'
                OR title LIKE '你是这个流程画布%'
                OR title LIKE 'You are the Vesprism flow-canvas%'
                OR title LIKE 'Generate a flow graph:%'
                OR title LIKE 'interface FlowGraph%'
                OR preview LIKE '%flow-canvas%'
                OR preview LIKE '%FlowGraph%'
                OR preview LIKE '%生成流程图%'",
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn is_tool_session(id: &str) -> Result<bool, String> {
    let id = id.trim();
    if id.is_empty() {
        return Ok(false);
    }
    with_db(|conn| {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM thread_tool_sessions WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    })
}

pub fn has_workbench_artifact(id: &str) -> Result<bool, String> {
    let id = id.trim();
    if id.is_empty() {
        return Ok(false);
    }
    with_db(|conn| {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM thread_workbench_artifacts WHERE session_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    })
}

fn map_thread_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ThreadRow> {
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
}

/// 列出主聊天历史；`current_cwd` 非空时该 cwd 优先，其余按 recency。
/// 排序与 `LIMIT` 均在 SQL 完成，避免全表进内存再 `sort_by`/`truncate`。
/// 工具会话一律不进本列表；已绑定产物的工作台记录见 `list_workbench_threads`。
pub fn list_threads(current_cwd: &str, limit: Option<u32>) -> Result<Vec<ThreadRow>, String> {
    let _ = mark_legacy_canvas_sessions();
    with_db(|conn| {
        let current = normalize_workspace_path(current_cwd);
        let lim = limit.filter(|n| *n > 0).map(|n| n as i64);

        // cwd 规范化后与当前工作区比：当前优先，组内 recency
        let sql = if lim.is_some() {
            "SELECT id, title, preview, cwd, updated_at, updated_at_ms, num_messages, transcript_path
             FROM threads
             WHERE id NOT IN (SELECT id FROM thread_tool_sessions)
             ORDER BY CASE WHEN cwd = ?1 THEN 0 ELSE 1 END,
                      updated_at_ms DESC
             LIMIT ?2"
        } else {
            "SELECT id, title, preview, cwd, updated_at, updated_at_ms, num_messages, transcript_path
             FROM threads
             WHERE id NOT IN (SELECT id FROM thread_tool_sessions)
             ORDER BY CASE WHEN cwd = ?1 THEN 0 ELSE 1 END,
                      updated_at_ms DESC"
        };

        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = if let Some(n) = lim {
            stmt.query_map(params![current, n], map_thread_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map(params![current], map_thread_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        };
        Ok(rows)
    })
}

/// 侧栏「工作台」分组：画布/编制干活会话。
/// 第一次开口就会挂 binding；保存 Flow / Agent 后另有产物行。不和主聊天混排。
const WORKBENCH_THREAD_WHERE: &str = "id IN (SELECT DISTINCT session_id FROM thread_workbench_artifacts)
             OR id IN (
               SELECT id FROM thread_workbench_bindings
               WHERE active_workbench_view IN ('flow-canvas', 'agents')
             )";

pub fn list_workbench_threads(limit: Option<u32>) -> Result<Vec<ThreadRow>, String> {
    let _ = mark_legacy_canvas_sessions();
    with_db(|conn| {
        let lim = limit.filter(|n| *n > 0).map(|n| n as i64);
        let sql = if lim.is_some() {
            format!(
                "SELECT id, title, preview, cwd, updated_at, updated_at_ms, num_messages, transcript_path
             FROM threads
             WHERE {WORKBENCH_THREAD_WHERE}
             ORDER BY updated_at_ms DESC
             LIMIT ?1"
            )
        } else {
            format!(
                "SELECT id, title, preview, cwd, updated_at, updated_at_ms, num_messages, transcript_path
             FROM threads
             WHERE {WORKBENCH_THREAD_WHERE}
             ORDER BY updated_at_ms DESC"
            )
        };

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = if let Some(n) = lim {
            stmt.query_map(params![n], map_thread_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map([], map_thread_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        };
        Ok(rows)
    })
}

/// 工作台第一次开口：不依赖已保存 Flow/Agent，侧栏「干活会话」也能看见。
pub fn touch_workbench_session(
    session_id: &str,
    view: &str,
    title: &str,
    cwd: &str,
) -> Result<(), String> {
    let sid = session_id.trim();
    let view = view.trim();
    if sid.is_empty() {
        return Ok(());
    }
    if view != "flow-canvas" && view != "agents" {
        return Err(format!("未知工作台视图: {view}"));
    }
    mark_tool_session(sid)?;
    let title = title.trim();
    let cwd_n = normalize_workspace_path(cwd);
    let now = now_ms();
    let updated_at = chrono::DateTime::from_timestamp(now / 1000, 0)
        .map(|t| t.to_rfc3339())
        .unwrap_or_default();
    with_db(|conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO thread_workbench_bindings (id, active_workbench_view, updated_at_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
               active_workbench_view = CASE
                 WHEN excluded.active_workbench_view = '' THEN thread_workbench_bindings.active_workbench_view
                 ELSE excluded.active_workbench_view
               END,
               updated_at_ms = excluded.updated_at_ms",
            params![sid, view, now],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO threads
             (id, title, preview, cwd, updated_at, updated_at_ms, num_messages, transcript_path)
             VALUES (?1, ?2, '', ?3, ?4, ?5, 1, '')
             ON CONFLICT(id) DO UPDATE SET
               updated_at = excluded.updated_at,
               updated_at_ms = excluded.updated_at_ms,
               cwd = CASE WHEN excluded.cwd = '' THEN threads.cwd ELSE excluded.cwd END,
               title = CASE
                 WHEN excluded.title = '' THEN threads.title
                 WHEN threads.title = '' THEN excluded.title
                 ELSE threads.title
               END,
               num_messages = CASE WHEN threads.num_messages < 1 THEN 1 ELSE threads.num_messages END",
            params![sid, title, cwd_n, updated_at, now],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn delete_thread(session_id: &str) -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM threads WHERE id = ?1", params![session_id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM thread_workbench_bindings WHERE id = ?1",
            params![session_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM thread_workbench_artifacts WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM thread_tool_sessions WHERE id = ?1",
            params![session_id],
        )
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

/// 读取会话的组装单覆盖（JSON 文本；无记录返回 `Ok(None)`）。
pub fn get_thread_composition(session_id: &str) -> Result<Option<String>, String> {
    with_db(|conn| {
        let mut stmt = conn
            .prepare("SELECT composition FROM thread_compositions WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![session_id]).map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(row) => row.get::<_, String>(0).map(Some).map_err(|e| e.to_string()),
            None => Ok(None),
        }
    })
}

/// 写入会话的组装单覆盖（UPSERT）。
pub fn set_thread_composition(session_id: &str, composition: &str) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO thread_compositions (id, composition) VALUES (?1, ?2)
             ON CONFLICT(id) DO UPDATE SET composition = excluded.composition",
            params![session_id, composition],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkbenchArtifactRow {
    pub kind: String,
    pub id: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ThreadWorkbenchBinding {
    pub session_id: String,
    pub active_workbench_view: Option<String>,
    pub artifacts: Vec<WorkbenchArtifactRow>,
    pub updated_at_ms: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn get_thread_workbench_binding(
    session_id: &str,
) -> Result<Option<ThreadWorkbenchBinding>, String> {
    let sid = session_id.trim();
    if sid.is_empty() {
        return Ok(None);
    }
    with_db(|conn| {
        let mut meta_stmt = conn
            .prepare(
                "SELECT active_workbench_view, updated_at_ms
                 FROM thread_workbench_bindings WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let mut meta_rows = meta_stmt.query(params![sid]).map_err(|e| e.to_string())?;
        let meta = match meta_rows.next().map_err(|e| e.to_string())? {
            Some(row) => Some((
                row.get::<_, String>(0).map_err(|e| e.to_string())?,
                row.get::<_, i64>(1).map_err(|e| e.to_string())?,
            )),
            None => None,
        };

        let mut stmt = conn
            .prepare(
                "SELECT kind, artifact_id, updated_at_ms
                 FROM thread_workbench_artifacts
                 WHERE session_id = ?1
                 ORDER BY updated_at_ms ASC",
            )
            .map_err(|e| e.to_string())?;
        let artifacts = stmt
            .query_map(params![sid], |row| {
                Ok(WorkbenchArtifactRow {
                    kind: row.get(0)?,
                    id: row.get(1)?,
                    updated_at_ms: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();

        if meta.is_none() && artifacts.is_empty() {
            return Ok(None);
        }
        let (active, updated_at_ms) = meta.unwrap_or_else(|| ("".to_string(), 0));
        Ok(Some(ThreadWorkbenchBinding {
            session_id: sid.to_string(),
            active_workbench_view: if active.trim().is_empty() {
                None
            } else {
                Some(active)
            },
            artifacts,
            updated_at_ms,
        }))
    })
}

pub fn add_thread_workbench_artifact(
    session_id: &str,
    kind: &str,
    artifact_id: &str,
    active_workbench_view: Option<&str>,
) -> Result<(), String> {
    let sid = session_id.trim();
    let kind = kind.trim();
    let artifact_id = artifact_id.trim();
    if sid.is_empty() || artifact_id.is_empty() {
        return Ok(());
    }
    if kind != "flow" && kind != "agent" {
        return Err(format!("未知工作台产物类型: {kind}"));
    }
    let view = active_workbench_view.unwrap_or("").trim();
    let now = now_ms();
    with_db(|conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO thread_workbench_bindings (id, active_workbench_view, updated_at_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
               active_workbench_view = CASE
                 WHEN excluded.active_workbench_view = '' THEN thread_workbench_bindings.active_workbench_view
                 ELSE excluded.active_workbench_view
               END,
               updated_at_ms = excluded.updated_at_ms",
            params![sid, view, now],
        )
        .map_err(|e| e.to_string())?;
        // 一个会话只绑定一个产物：先清旧绑定再挂新的（画布单 tab 场景下避免一对多）。
        tx.execute(
            "DELETE FROM thread_workbench_artifacts WHERE session_id = ?1",
            params![sid],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO thread_workbench_artifacts
             (session_id, kind, artifact_id, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(session_id, kind, artifact_id) DO UPDATE SET
               updated_at_ms = excluded.updated_at_ms",
            params![sid, kind, artifact_id, now],
        )
        .map_err(|e| e.to_string())?;
        // 首次绑定可能还没有 TurnEnded，threads 里没有行；补一条以免「工作台」列表空窗。
        tx.execute(
            "INSERT INTO threads
             (id, title, preview, cwd, updated_at, updated_at_ms, num_messages, transcript_path)
             VALUES (?1, ?2, '', '', '', ?3, 0, '')
             ON CONFLICT(id) DO UPDATE SET
               updated_at_ms = excluded.updated_at_ms,
               title = CASE WHEN threads.title = '' THEN excluded.title ELSE threads.title END",
            params![sid, format!("工作台 · {artifact_id}"), now],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectRow {
    pub root: String,
    pub display_name: String,
    pub updated_at_ms: i64,
}

fn display_name_from_root(root: &str) -> String {
    Path::new(root)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| root.to_string())
}

/// 把仓库根记进侧栏项目表；已有则刷新显示名和时间。
pub fn upsert_project(root: &str) -> Result<ProjectRow, String> {
    let root = normalize_workspace_path(root);
    if root.is_empty() {
        return Err("项目路径为空".into());
    }
    let display_name = display_name_from_root(&root);
    let now = now_ms();
    with_db(|conn| {
        conn.execute(
            "INSERT INTO projects (root, display_name, updated_at_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(root) DO UPDATE SET
               display_name = excluded.display_name,
               updated_at_ms = excluded.updated_at_ms",
            params![root, display_name, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    Ok(ProjectRow {
        root,
        display_name,
        updated_at_ms: now,
    })
}

pub fn remove_project(root: &str) -> Result<(), String> {
    let root = normalize_workspace_path(root);
    with_db(|conn| {
        conn.execute("DELETE FROM projects WHERE root = ?1", params![root])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn list_projects() -> Result<Vec<ProjectRow>, String> {
    with_db(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT root, display_name, updated_at_ms
                 FROM projects ORDER BY updated_at_ms DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ProjectRow {
                    root: row.get(0)?,
                    display_name: row.get(1)?,
                    updated_at_ms: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    })
}

/// 列出 cwd 与项目根精确相等（已规范化）的主聊天会话。
pub fn list_threads_for_project(root: &str, limit: Option<u32>) -> Result<Vec<ThreadRow>, String> {
    let root = normalize_workspace_path(root);
    with_db(|conn| {
        let lim = limit.filter(|n| *n > 0).map(|n| n as i64);
        let sql = if lim.is_some() {
            "SELECT id, title, preview, cwd, updated_at, updated_at_ms, num_messages, transcript_path
             FROM threads
             WHERE cwd = ?1 AND id NOT IN (SELECT id FROM thread_tool_sessions)
             ORDER BY updated_at_ms DESC
             LIMIT ?2"
        } else {
            "SELECT id, title, preview, cwd, updated_at, updated_at_ms, num_messages, transcript_path
             FROM threads
             WHERE cwd = ?1 AND id NOT IN (SELECT id FROM thread_tool_sessions)
             ORDER BY updated_at_ms DESC"
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = if let Some(n) = lim {
            stmt.query_map(params![root, n], map_thread_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map(params![root], map_thread_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        };
        Ok(rows)
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

#[cfg(test)]
mod tests {
    use super::normalize_workspace_path;

    #[test]
    fn normalize_folds_windows_path_variants() {
        // D:\foo、d:/foo、\\?\D:\foo 必须是同一把钥匙。
        assert_eq!(
            normalize_workspace_path(r"D:\foo\bar"),
            normalize_workspace_path(r"d:/foo/bar")
        );
        assert_eq!(
            normalize_workspace_path(r"\\?\D:\foo\bar"),
            normalize_workspace_path(r"D:\foo\bar")
        );
        assert_eq!(normalize_workspace_path(r"D:\foo\bar\"), "d:/foo/bar");
        assert_eq!(normalize_workspace_path("D:/"), "d:/");
    }
}
