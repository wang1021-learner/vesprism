//! project.sqlite：按版本号迁移，WAL，单写连接。
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

use crate::event::{JobErrorCode, JobStatus};
use crate::graph::Graph;
use crate::model::{EntityId, Link, Node};

pub const SCHEMA_VERSION: i64 = 1;

const MIGRATIONS: &[&str] = &[
    // v1：首个发布版的起始结构。以后改结构只追加新版本，不改这一条。
    r#"
    CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL DEFAULT '{}',
        hash TEXT, needs_update INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE canvas_layout (node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
        x REAL NOT NULL, y REAL NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE jobs (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
        spec TEXT NOT NULL, status TEXT NOT NULL, submit_attempted INTEGER NOT NULL DEFAULT 0,
        provider_task_id TEXT, progress REAL NOT NULL DEFAULT 0, cost_usd REAL, error TEXT,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()), error_code TEXT,
        poll_failures INTEGER NOT NULL DEFAULT 0, poll_failing_since INTEGER,
        attempt INTEGER NOT NULL DEFAULT 1, asset_id TEXT REFERENCES asset(id));
    CREATE TABLE project_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE links (from_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        to_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, port TEXT NOT NULL,
        source_item TEXT NOT NULL DEFAULT '', PRIMARY KEY (from_id, to_id, port, source_item));
    CREATE TABLE item_hashes (node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (node_id, item_id));
    CREATE TABLE export_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, export_node TEXT NOT NULL,
        stale_confirmed INTEGER NOT NULL, flagged TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE job_attempts (job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL, idempotency_key TEXT NOT NULL, provider_task_id TEXT,
        status TEXT NOT NULL, error_code TEXT, error TEXT, cost_usd REAL,
        archived_at INTEGER NOT NULL DEFAULT (unixepoch()), asset_id TEXT REFERENCES asset(id),
        PRIMARY KEY (job_id, attempt));
    CREATE TABLE asset (id TEXT PRIMARY KEY, hash TEXT NOT NULL, rel_path TEXT NOT NULL, mime TEXT NOT NULL,
        bytes INTEGER NOT NULL, width INTEGER, height INTEGER, duration_ms INTEGER,
        created_at INTEGER NOT NULL);
    CREATE INDEX asset_hash ON asset(hash);
    "#,
];

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("项目库版本 {found} 比本程序支持的 {supported} 新，请升级应用")]
    TooNew { found: i64, supported: i64 },
}

#[derive(Debug, Clone, PartialEq)]
pub struct JobRow {
    pub id: String,
    pub node_id: String,
    pub idempotency_key: String,
    pub spec: String,
    pub status: JobStatus,
    pub submit_attempted: bool,
    pub provider_task_id: Option<String>,
    pub progress: f32,
    pub cost_usd: Option<f64>,
    pub error_code: Option<JobErrorCode>,
    pub error: Option<String>,
    pub poll_failures: u32,
    /// 连续查进度失败的起点（unix 秒）
    pub poll_failing_since: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct JobAttempt {
    pub attempt: u32,
    pub idempotency_key: String,
    pub provider_task_id: Option<String>,
    pub status: JobStatus,
    pub error_code: Option<JobErrorCode>,
}

/// 唯一写连接。
pub struct Store {
    conn: Connection,
}

pub fn status_str(s: JobStatus) -> &'static str {
    match s {
        JobStatus::Queued => "queued",
        JobStatus::Running => "running",
        JobStatus::Done => "done",
        JobStatus::Failed => "failed",
        JobStatus::Cancelled => "cancelled",
        JobStatus::NeedsLogin => "needs_login",
    }
}

fn parse_status(s: &str) -> JobStatus {
    match s {
        "queued" => JobStatus::Queued,
        "running" => JobStatus::Running,
        "done" => JobStatus::Done,
        "cancelled" => JobStatus::Cancelled,
        "needs_login" => JobStatus::NeedsLogin,
        _ => JobStatus::Failed,
    }
}

fn code_str(c: JobErrorCode) -> &'static str {
    match c {
        JobErrorCode::UnconfirmedSubmit => "unconfirmed_submit",
        JobErrorCode::ProviderFailed => "provider_failed",
    }
}

fn parse_code(s: Option<String>) -> Option<JobErrorCode> {
    match s.as_deref() {
        Some("unconfirmed_submit") => Some(JobErrorCode::UnconfirmedSubmit),
        Some("provider_failed") => Some(JobErrorCode::ProviderFailed),
        _ => None,
    }
}

const JOB_COLS: &str =
    "id, node_id, idempotency_key, spec, status, submit_attempted, provider_task_id,
    progress, cost_usd, error_code, error, poll_failures, poll_failing_since";

impl Store {
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let mut conn = Connection::open(path)?;
        // 先看版本再动文件：比本程序新的库连日志模式都不改。
        let found: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if found > SCHEMA_VERSION {
            return Err(StoreError::TooNew { found, supported: SCHEMA_VERSION });
        }
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        migrate(&mut conn, path)?;
        Ok(Self { conn })
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO project_settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>, StoreError> {
        Ok(self
            .conn
            .query_row("SELECT value FROM project_settings WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    /// 只读看项目名：不迁移、不写库、不建文件。列表页用。
    pub fn peek_setting(path: &Path, key: &str) -> Result<Option<String>, StoreError> {
        let conn = Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        let found: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if found > SCHEMA_VERSION {
            return Err(StoreError::TooNew { found, supported: SCHEMA_VERSION });
        }
        Ok(conn
            .query_row("SELECT value FROM project_settings WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn insert_job(
        &self,
        id: &str,
        node_id: &str,
        key: &str,
        spec: &str,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO jobs (id, node_id, idempotency_key, spec, status) VALUES (?1, ?2, ?3, ?4, 'queued')",
            params![id, node_id, key, spec],
        )?;
        Ok(())
    }

    /// 发请求前落库：之后崩了也知道「可能已提交」。
    pub fn set_submit_attempted(&self, id: &str, attempted: bool) -> Result<(), StoreError> {
        self.conn.execute(
            "UPDATE jobs SET submit_attempted = ?2, updated_at = unixepoch() WHERE id = ?1",
            params![id, attempted as i64],
        )?;
        Ok(())
    }

    pub fn set_provider_task(&self, id: &str, task: &str) -> Result<(), StoreError> {
        self.conn.execute(
            "UPDATE jobs SET provider_task_id = ?2, status = 'running', error_code = NULL, error = NULL,
             updated_at = unixepoch() WHERE id = ?1",
            params![id, task],
        )?;
        Ok(())
    }

    pub fn update_job(
        &self,
        id: &str,
        status: JobStatus,
        progress: f32,
        cost_usd: Option<f64>,
        error_code: Option<JobErrorCode>,
        error: Option<&str>,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "UPDATE jobs SET status = ?2, progress = ?3, cost_usd = COALESCE(?4, cost_usd), error_code = ?5,
             error = ?6, updated_at = unixepoch() WHERE id = ?1",
            params![id, status_str(status), progress, cost_usd, error_code.map(code_str), error],
        )?;
        Ok(())
    }

    /// 记录查进度失败；`since` 为 None 表示恢复正常、清零。
    pub fn set_poll_failures(
        &self,
        id: &str,
        failures: u32,
        since: Option<i64>,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "UPDATE jobs SET poll_failures = ?2, poll_failing_since = ?3, updated_at = unixepoch() WHERE id = ?1",
            params![id, failures, since],
        )?;
        Ok(())
    }

    /// 用户确认「可能再扣一次费」后重来：清掉旧的提交痕迹，回到排队。
    /// 用户确认后重试：当前这次尝试先归档，再换新幂等键（`drama-<id>-a<n>`）、尝试次数 +1，回到排队。
    /// 新键保证供应商不会把它当成原来那笔去重。
    pub fn reset_for_retry(&self, id: &str) -> Result<(), StoreError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO job_attempts (job_id, attempt, idempotency_key, provider_task_id, status, error_code, error, cost_usd, asset_id)
             SELECT id, attempt, idempotency_key, provider_task_id, status, error_code, error, cost_usd, asset_id FROM jobs WHERE id = ?1",
            params![id],
        )?;
        tx.execute(
            "UPDATE jobs SET attempt = attempt + 1, idempotency_key = 'drama-' || id || '-a' || (attempt + 1),
             status = 'queued', submit_attempted = 0, provider_task_id = NULL, progress = 0, cost_usd = NULL,
             error_code = NULL, error = NULL, poll_failures = 0, poll_failing_since = NULL, asset_id = NULL,
             updated_at = unixepoch() WHERE id = ?1",
            params![id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// 当前是第几次尝试（从 1 开始）。
    pub fn job_attempt(&self, id: &str) -> Result<Option<u32>, StoreError> {
        Ok(self
            .conn
            .query_row("SELECT attempt FROM jobs WHERE id = ?1", [id], |r| r.get(0))
            .optional()?)
    }

    /// 已归档的旧尝试，按次数升序。对账用。
    pub fn job_attempts(&self, id: &str) -> Result<Vec<JobAttempt>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT attempt, idempotency_key, provider_task_id, status, error_code FROM job_attempts
             WHERE job_id = ?1 ORDER BY attempt",
        )?;
        let rows = stmt
            .query_map([id], |r| {
                Ok(JobAttempt {
                    attempt: r.get(0)?,
                    idempotency_key: r.get(1)?,
                    provider_task_id: r.get(2)?,
                    status: parse_status(&r.get::<_, String>(3)?),
                    error_code: parse_code(r.get(4)?),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn job(&self, id: &str) -> Result<Option<JobRow>, StoreError> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {JOB_COLS} FROM jobs WHERE id = ?1"),
                params![id],
                row_to_job,
            )
            .optional()?)
    }

    pub fn all_jobs(&self) -> Result<Vec<JobRow>, StoreError> {
        let mut stmt = self.conn.prepare(&format!("SELECT {JOB_COLS} FROM jobs ORDER BY rowid"))?;
        let rows = stmt.query_map([], row_to_job)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn unfinished_jobs(&self) -> Result<Vec<JobRow>, StoreError> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {JOB_COLS} FROM jobs WHERE status IN ('queued','running','needs_login') ORDER BY rowid"
        ))?;
        let rows = stmt
            .query_map([], row_to_job)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

fn row_to_job(r: &rusqlite::Row<'_>) -> rusqlite::Result<JobRow> {
    Ok(JobRow {
        id: r.get(0)?,
        node_id: r.get(1)?,
        idempotency_key: r.get(2)?,
        spec: r.get(3)?,
        status: parse_status(&r.get::<_, String>(4)?),
        submit_attempted: r.get::<_, i64>(5)? != 0,
        provider_task_id: r.get(6)?,
        progress: r.get::<_, f64>(7)? as f32,
        cost_usd: r.get(8)?,
        error_code: parse_code(r.get(9)?),
        error: r.get(10)?,
        poll_failures: r.get::<_, i64>(11)? as u32,
        poll_failing_since: r.get(12)?,
    })
}

/// 一次导出快照：是否确认过带过期素材导出，以及当时带角标的节点。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportSnapshot {
    pub id: i64,
    pub export_node: EntityId,
    pub stale_confirmed: bool,
    pub flagged: Vec<(EntityId, String)>,
}

impl Store {
    /// 整张图写进库（一个事务）。节点用 upsert，画布布局不受影响。
    pub fn save_graph(&mut self, g: &Graph) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        let keep: Vec<&EntityId> = g.nodes.keys().collect();
        let existing: Vec<String> = {
            let mut st = tx.prepare("SELECT id FROM nodes")?;
            st.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?
        };
        for id in existing.iter().filter(|id| !keep.contains(id)) {
            tx.execute("DELETE FROM nodes WHERE id = ?1", params![id])?;
        }
        for n in g.nodes.values() {
            tx.execute(
                "INSERT INTO nodes (id, kind, body, hash, needs_update, locked) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, body = excluded.body, hash = excluded.hash,
                 needs_update = excluded.needs_update, locked = excluded.locked",
                params![
                    n.id,
                    serde_json::to_string(&n.kind)?,
                    serde_json::to_string(n)?,
                    g.hashes.get(&n.id),
                    n.needs_update,
                    n.locked
                ],
            )?;
        }
        tx.execute("DELETE FROM links", [])?;
        for l in &g.links {
            tx.execute(
                "INSERT INTO links (from_id, to_id, port, source_item) VALUES (?1, ?2, ?3, ?4)",
                params![
                    l.from,
                    l.to,
                    serde_json::to_string(&l.port)?,
                    l.source_item.clone().unwrap_or_default()
                ],
            )?;
        }
        tx.execute("DELETE FROM item_hashes", [])?;
        for (node, items) in &g.item_hashes {
            for (item, h) in items {
                tx.execute(
                    "INSERT INTO item_hashes (node_id, item_id, hash) VALUES (?1, ?2, ?3)",
                    params![node, item, h],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn load_graph(&self) -> Result<Graph, StoreError> {
        let mut g = Graph::default();
        let mut st = self
            .conn
            .prepare("SELECT body, hash, needs_update, locked FROM nodes")?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, bool>(2)?,
                r.get::<_, bool>(3)?,
            ))
        })?;
        for row in rows {
            let (body, hash, needs_update, locked) = row?;
            let mut n: Node = serde_json::from_str(&body)?;
            // 端口只认端口表（按类型）。库里存的是建节点当时的端口，表改过以后旧节点会过期，
            // 读回时一律换成当前表，前端和连线校验才对得上。
            let (inputs, outputs) = n.kind.default_ports();
            n.inputs = inputs;
            n.outputs = outputs;
            n.needs_update = needs_update;
            n.locked = locked;
            if let Some(h) = hash {
                g.hashes.insert(n.id.clone(), h);
            }
            g.nodes.insert(n.id.clone(), n);
        }
        let mut st = self
            .conn
            .prepare("SELECT from_id, to_id, port, source_item FROM links")?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?;
        for row in rows {
            let (from, to, port, item) = row?;
            g.links.insert(Link {
                from,
                to,
                port: serde_json::from_str(&port)?,
                source_item: (!item.is_empty()).then_some(item),
            });
        }
        let mut st = self
            .conn
            .prepare("SELECT node_id, item_id, hash FROM item_hashes")?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            let (node, item, h) = row?;
            g.item_hashes.entry(node).or_default().insert(item, h);
        }
        Ok(g)
    }

    pub fn set_layout(
        &self,
        node: &str,
        x: f64,
        y: f64,
        collapsed: bool,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT INTO canvas_layout (node_id, x, y, collapsed) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(node_id) DO UPDATE SET x = excluded.x, y = excluded.y, collapsed = excluded.collapsed",
            params![node, x, y, collapsed],
        )?;
        Ok(())
    }

    pub fn layout(&self, node: &str) -> Result<Option<(f64, f64, bool)>, StoreError> {
        Ok(self
            .conn
            .query_row(
                "SELECT x, y, collapsed FROM canvas_layout WHERE node_id = ?1",
                params![node],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?)
    }

    /// 全部节点位置，`load_graph` 一次读回。
    pub fn layouts(&self) -> Result<std::collections::BTreeMap<EntityId, crate::model::NodeLayout>, StoreError> {
        let mut stmt = self.conn.prepare("SELECT node_id, x, y, collapsed FROM canvas_layout")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, crate::model::NodeLayout { x: r.get(1)?, y: r.get(2)?, collapsed: r.get(3)? }))
            })?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    }

    /// 导出时记一笔：带角标就必须是用户确认过的。
    pub fn record_export(
        &self,
        export_node: &str,
        stale_confirmed: bool,
        g: &Graph,
    ) -> Result<i64, StoreError> {
        let flagged = g.stale_flags();
        self.conn.execute(
            "INSERT INTO export_snapshots (export_node, stale_confirmed, flagged) VALUES (?1, ?2, ?3)",
            params![export_node, stale_confirmed, serde_json::to_string(&flagged)?],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn export_snapshot(&self, id: i64) -> Result<Option<ExportSnapshot>, StoreError> {
        let row = self
            .conn
            .query_row(
                "SELECT export_node, stale_confirmed, flagged FROM export_snapshots WHERE id = ?1",
                params![id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, bool>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        match row {
            None => Ok(None),
            Some((export_node, stale_confirmed, flagged)) => Ok(Some(ExportSnapshot {
                id,
                export_node,
                stale_confirmed,
                flagged: serde_json::from_str(&flagged)?,
            })),
        }
    }
}

fn migrate(conn: &mut Connection, path: &Path) -> Result<(), StoreError> {
    migrate_steps(conn, path, MIGRATIONS)
}

/// 所有待升级的版本放进同一个事务：任何一步失败，整体退回原来的版本。升级前的备份照留。
fn migrate_steps(conn: &mut Connection, path: &Path, steps: &[&str]) -> Result<(), StoreError> {
    let target = steps.len() as i64;
    let found: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if found > target {
        return Err(StoreError::TooNew {
            found,
            supported: target,
        });
    }
    if found == target {
        return Ok(());
    }
    if found > 0 && path != Path::new(":memory:") {
        // 升级前自动备份：project.sqlite.bak-v{旧版本}
        let mut bak = path.as_os_str().to_owned();
        bak.push(format!(".bak-v{found}"));
        let bak = std::path::PathBuf::from(bak);
        if bak.exists() {
            std::fs::remove_file(&bak)?;
        }
        conn.execute("VACUUM INTO ?1", params![bak.to_string_lossy()])?;
    }
    let tx = conn.transaction()?;
    for sql in &steps[found as usize..] {
        tx.execute_batch(sql)?;
    }
    tx.pragma_update(None, "user_version", target)?;
    tx.commit()?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_to_current_and_uses_wal() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::open(&dir.path().join("project.sqlite")).unwrap();
        let v: i64 = s
            .conn()
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        let mode: String = s
            .conn()
            .pragma_query_value(None, "journal_mode", |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[test]
    fn newer_db_is_refused_not_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("project.sqlite");
        {
            let c = Connection::open(&p).unwrap();
            c.pragma_update(None, "user_version", 99).unwrap();
        }
        assert!(matches!(
            Store::open(&p),
            Err(StoreError::TooNew { found: 99, .. })
        ));
        let c = Connection::open(&p).unwrap();
        let v: i64 = c
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, 99);
    }
    fn chain() -> Graph {
        use crate::model::{NodeKind, PortType::*};
        let n = |id: &str, kind, i: &[crate::model::PortType], o: &[crate::model::PortType]| Node {
            id: id.into(),
            kind,
            inputs: i.to_vec(),
            outputs: o.to_vec(),
            locked: false,
            needs_update: false,
            text: String::new(),
        };
        let mut g = Graph::default();
        g.add_node(n("script", NodeKind::Script, &[], &[Line]));
        g.add_node(n("voice", NodeKind::Voice, &[Line], &[Audio]));
        g.add_node(n("shot", NodeKind::Shot, &[Audio], &[Video]));
        g.add_node(n("export", NodeKind::Export, &[Video], &[FinalCut]));
        let _ = g.set_item_hashes("script", [("L1".to_string(), "h1".to_string())].into());
        g.link(Link {
            from: "script".into(),
            to: "voice".into(),
            port: Line,
            source_item: Some("L1".into()),
        })
        .unwrap();
        g.link(Link {
            from: "voice".into(),
            to: "shot".into(),
            port: Audio,
            source_item: None,
        })
        .unwrap();
        g.link(Link {
            from: "shot".into(),
            to: "export".into(),
            port: Video,
            source_item: None,
        })
        .unwrap();
        for id in ["script", "voice", "shot", "export"] {
            g.clear_needs_update(id);
        }
        g.set_hash("script", "s1".into());
        g.set_hash("script", "s2".into()); // voice 标需更新
        g
    }

    #[test]
    fn marks_survive_restart() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("project.sqlite");
        {
            let mut s = Store::open(&p).unwrap();
            s.save_graph(&chain()).unwrap();
            s.set_layout("shot", 10.0, 20.0, true).unwrap();
        }
        let s = Store::open(&p).unwrap();
        let g = s.load_graph().unwrap();
        assert!(g.node("voice").unwrap().needs_update);
        assert!(
            g.upstream_stale("export"),
            "upstreamStale 重启后照样现算出来"
        );
        assert_eq!(g.hash("script"), Some("s2"));
        assert!(
            g.links
                .iter()
                .any(|l| l.source_item.as_deref() == Some("L1"))
        );
        assert_eq!(g.item_hashes["script"]["L1"], "h1");
        assert_eq!(s.layout("shot").unwrap(), Some((10.0, 20.0, true)));
        // 再存一次，布局不被冲掉
        let mut s = s;
        s.save_graph(&g).unwrap();
        assert_eq!(s.layout("shot").unwrap(), Some((10.0, 20.0, true)));
    }

    #[test]
    fn export_snapshot_records_confirmation_and_flags() {
        let s = Store::open(Path::new(":memory:")).unwrap();
        let mut g = chain();
        let mut s = s;
        s.save_graph(&g).unwrap();
        let id = s.record_export("export", true, &g).unwrap();
        let snap = s.export_snapshot(id).unwrap().unwrap();
        assert!(snap.stale_confirmed);
        assert_eq!(
            snap.flagged,
            vec![
                ("export".to_string(), "upstream_stale".to_string()),
                ("shot".to_string(), "upstream_stale".to_string()),
                ("voice".to_string(), "needs_update".to_string()),
            ]
        );
        g.clear_needs_update("voice");
        let id2 = s.record_export("export", false, &g).unwrap();
        assert!(s.export_snapshot(id2).unwrap().unwrap().flagged.is_empty());
    }
    #[test]
    fn settings_roundtrip_and_peek_is_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.sqlite");
        let s = Store::open(&path).unwrap();
        assert_eq!(s.setting("name").unwrap(), None);
        s.set_setting("name", "第一集").unwrap();
        s.set_setting("name", "第二集").unwrap();
        assert_eq!(s.setting("name").unwrap().as_deref(), Some("第二集"));
        drop(s);
        assert_eq!(Store::peek_setting(&path, "name").unwrap().as_deref(), Some("第二集"));
        let junk = dir.path().join("junk.sqlite");
        std::fs::write(&junk, b"not a database at all, just bytes......").unwrap();
        assert!(Store::peek_setting(&junk, "name").is_err());
        assert!(Store::peek_setting(&dir.path().join("missing.sqlite"), "name").is_err());
        assert!(!dir.path().join("missing.sqlite").exists());
    }

    #[test]
    fn confirmed_retry_gets_new_key_counts_attempts_and_archives_old_task() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::open(&dir.path().join("project.sqlite")).unwrap();
        s.insert_job("j", "n", "drama-j", "{}").unwrap();
        s.set_provider_task("j", "task-1").unwrap();
        s.update_job("j", JobStatus::Failed, 0.3, None, Some(JobErrorCode::UnconfirmedSubmit), Some("x")).unwrap();
        assert_eq!(s.job_attempt("j").unwrap(), Some(1));
        s.reset_for_retry("j").unwrap();
        let j = s.job("j").unwrap().unwrap();
        assert_eq!(j.idempotency_key, "drama-j-a2");
        assert_eq!((j.status, j.provider_task_id.clone(), j.error_code), (JobStatus::Queued, None, None));
        s.set_provider_task("j", "task-2").unwrap();
        s.reset_for_retry("j").unwrap();
        assert_eq!(s.job_attempt("j").unwrap(), Some(3));
        assert_eq!(s.job("j").unwrap().unwrap().idempotency_key, "drama-j-a3");
        let a = s.job_attempts("j").unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!((a[0].attempt, a[0].idempotency_key.as_str(), a[0].provider_task_id.as_deref()), (1, "drama-j", Some("task-1")));
        assert_eq!(a[0].error_code, Some(JobErrorCode::UnconfirmedSubmit));
        assert_eq!((a[1].attempt, a[1].provider_task_id.as_deref()), (2, Some("task-2")));
    }

    /// 第三轮并进 v1 的素材结构（没发布过，不加版本）。合并检查 = 旧 v1→v4 + 这一段。
    const ROUND3_ASSET: &str = r#"
        CREATE TABLE asset (id TEXT PRIMARY KEY, hash TEXT NOT NULL, rel_path TEXT NOT NULL, mime TEXT NOT NULL,
            bytes INTEGER NOT NULL, width INTEGER, height INTEGER, duration_ms INTEGER,
            created_at INTEGER NOT NULL);
        CREATE INDEX asset_hash ON asset(hash);
        ALTER TABLE jobs ADD COLUMN asset_id TEXT REFERENCES asset(id);
        ALTER TABLE job_attempts ADD COLUMN asset_id TEXT REFERENCES asset(id);
    "#;

    /// 合并前 v1→v4 四步升级的原文，只用来证明合并后的结构完全一致。
    const LEGACY_V4: &[&str] = &[
        // v1
        r#"
        CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL DEFAULT '{}',
            hash TEXT, needs_update INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE links (from_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            to_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, port TEXT NOT NULL,
            PRIMARY KEY (from_id, to_id, port));
        CREATE TABLE canvas_layout (node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
            x REAL NOT NULL, y REAL NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE jobs (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
            spec TEXT NOT NULL, status TEXT NOT NULL, submit_attempted INTEGER NOT NULL DEFAULT 0,
            provider_task_id TEXT, progress REAL NOT NULL DEFAULT 0, cost_usd REAL, error TEXT,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
        CREATE TABLE project_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        "#,
        // v2：错误码 + 查进度失败的重试计数
        r#"
        ALTER TABLE jobs ADD COLUMN error_code TEXT;
        ALTER TABLE jobs ADD COLUMN poll_failures INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE jobs ADD COLUMN poll_failing_since INTEGER;
        "#,
        // v3：连线可挂某一句台词；台词 hash；导出快照。upstreamStale 是现算的，不建列
        r#"
        CREATE TABLE links_v3 (from_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            to_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, port TEXT NOT NULL,
            source_item TEXT NOT NULL DEFAULT '', PRIMARY KEY (from_id, to_id, port, source_item));
        INSERT INTO links_v3 (from_id, to_id, port) SELECT from_id, to_id, port FROM links;
        DROP TABLE links;
        ALTER TABLE links_v3 RENAME TO links;
        CREATE TABLE item_hashes (node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            item_id TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (node_id, item_id));
        CREATE TABLE export_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, export_node TEXT NOT NULL,
            stale_confirmed INTEGER NOT NULL, flagged TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()));
        "#,
        // v4：用户确认后的重试换新幂等键、记尝试次数；旧尝试（含供应商任务编号）留档对账
        r#"
        ALTER TABLE jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
        CREATE TABLE job_attempts (job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            attempt INTEGER NOT NULL, idempotency_key TEXT NOT NULL, provider_task_id TEXT,
            status TEXT NOT NULL, error_code TEXT, error TEXT, cost_usd REAL,
            archived_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (job_id, attempt));
        "#,
    ];

    fn schema(c: &Connection) -> Vec<String> {
        let mut out = Vec::new();
        let tables: Vec<String> = c
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        for t in tables {
            let mut q = c.prepare(&format!(
                "SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info('{t}') ORDER BY name"
            )).unwrap();
            for row in q.query_map([], |r| Ok(format!("{t}.{}:{}:{}:{:?}:{}", r.get::<_, String>(0)?, r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, i64>(4)?))).unwrap() {
                out.push(row.unwrap());
            }
            let mut q = c.prepare(&format!(
                "SELECT \"table\", \"from\", \"to\", on_delete FROM pragma_foreign_key_list('{t}') ORDER BY \"from\""
            )).unwrap();
            for row in q.query_map([], |r| Ok(format!("{t} fk {}.{}->{} {}", r.get::<_, String>(0)?, r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?.unwrap_or_default(), r.get::<_, String>(3)?))).unwrap() {
                out.push(row.unwrap());
            }
            let mut q = c.prepare(&format!(
                "SELECT il.\"unique\", group_concat(ii.name) FROM pragma_index_list('{t}') il, pragma_index_info(il.name) ii GROUP BY il.name ORDER BY 2"
            )).unwrap();
            for row in q.query_map([], |r| Ok(format!("{t} idx u{} {}", r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).unwrap() {
                out.push(row.unwrap());
            }
        }
        out.sort();
        out
    }

    #[test]
    fn squashed_v1_matches_old_v4_schema_exactly() {
        let fresh = Connection::open_in_memory().unwrap();
        fresh.execute_batch(MIGRATIONS[0]).unwrap();
        let old = Connection::open_in_memory().unwrap();
        for sql in LEGACY_V4 {
            old.execute_batch(sql).unwrap();
        }
        old.execute_batch(ROUND3_ASSET).unwrap();
        assert_eq!(schema(&fresh), schema(&old));
        assert!(schema(&fresh).iter().any(|c| c.starts_with("asset.rel_path:TEXT:1")));
        assert_eq!(MIGRATIONS.len(), 1);
        assert_eq!(SCHEMA_VERSION, 1);
    }

    #[test]
    fn failed_migration_rolls_back_and_leaves_no_tables() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("project.sqlite");
        let mut c = Connection::open(&p).unwrap();
        let broken = [MIGRATIONS[0], "THIS IS NOT SQL;"];
        assert!(migrate_steps(&mut c, &p, &broken).is_err());
        let v: i64 = c.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(v, 0);
        let n: i64 = c.query_row("SELECT count(*) FROM sqlite_master WHERE type='table'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "半截结构不留");
    }

    #[test]
    fn db_newer_than_v1_is_refused_with_clear_error_and_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("project.sqlite");
        {
            let c = Connection::open(&p).unwrap();
            c.execute_batch(MIGRATIONS[0]).unwrap();
            c.execute("INSERT INTO project_settings VALUES ('name','x')", []).unwrap();
            c.pragma_update(None, "user_version", 2).unwrap();
        }
        let before = std::fs::read(&p).unwrap();
        let e = Store::open(&p).err().expect("必须拒绝");
        assert!(matches!(e, StoreError::TooNew { found: 2, supported: 1 }));
        assert!(e.to_string().contains("请升级应用"));
        assert!(matches!(Store::peek_setting(&p, "name"), Err(StoreError::TooNew { .. })));
        assert_eq!(std::fs::read(&p).unwrap(), before, "不覆盖写入");
        assert!(!dir.path().join("project.sqlite.bak-v2").exists());
    }

    #[test]
    fn layouts_reads_back_all_positions() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(&dir.path().join("project.sqlite")).unwrap();
        s.save_graph(&chain()).unwrap();
        s.set_layout("voice", 1.5, -2.0, true).unwrap();
        s.set_layout("shot", 10.0, 20.0, false).unwrap();
        let l = s.layouts().unwrap();
        assert_eq!(l.len(), 2);
        assert_eq!(l["voice"], crate::model::NodeLayout { x: 1.5, y: -2.0, collapsed: true });
    }

    /// 角色 → 配音（character_look）。旧库里配音节点存的是老端口 [line]，读回后按端口表也能连。
    #[test]
    fn character_can_link_into_voice() {
        use crate::model::{NodeKind, PortType};
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(&dir.path().join("project.sqlite")).unwrap();
        let mut g = Graph::default();
        let (ci, co) = NodeKind::Character.default_ports();
        g.add_node(Node { id: "char".into(), kind: NodeKind::Character, inputs: ci, outputs: co, locked: false, needs_update: false, text: String::new() });
        // 第三轮前建的配音节点：输入只有台词
        g.add_node(Node { id: "voice".into(), kind: NodeKind::Voice, inputs: vec![PortType::Line], outputs: vec![PortType::Audio], locked: false, needs_update: false, text: String::new() });
        s.save_graph(&g).unwrap();
        let mut g = s.load_graph().unwrap();
        assert_eq!(g.node("voice").unwrap().inputs, NodeKind::Voice.default_ports().0, "读回按端口表");
        let link = Link { from: "char".into(), to: "voice".into(), port: PortType::CharacterLook, source_item: None };
        assert_eq!(g.link(link), Ok(()));
        s.save_graph(&g).unwrap();
        assert_eq!(s.load_graph().unwrap().links.len(), 1);
    }

    /// 旧库里留着不合法的线：打开不报错、不删线、库文件一个字节都不改。
    #[test]
    fn opening_old_db_with_illegal_link_reads_it_flags_it_and_writes_nothing() {
        use crate::model::{NodeKind, PortType};
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("project.sqlite");
        {
            let mut s = Store::open(&p).unwrap();
            let mut g = Graph::default();
            for (id, k, ins) in [
                ("script", NodeKind::Script, None),
                ("char", NodeKind::Character, None),
                ("sg", NodeKind::ShotGroup, None),
                ("shot", NodeKind::Shot, None),
                // 配音节点是第三轮前建的，只有台词输入
                ("voice", NodeKind::Voice, Some(vec![PortType::Line])),
            ] {
                let (i, o) = k.default_ports();
                g.add_node(Node { id: id.into(), kind: k, inputs: ins.unwrap_or(i), outputs: o, locked: false, needs_update: false, text: String::new() });
            }
            for (f, t, port) in [
                ("script", "shot", PortType::Line),
                ("char", "voice", PortType::CharacterLook), // 现在的表允许
                ("sg", "shot", PortType::Image),            // 旧表允许，现在不行
            ] {
                g.links.insert(Link { from: f.into(), to: t.into(), port, source_item: None });
            }
            s.save_graph(&g).unwrap();
        }
        assert!(!dir.path().join("project.sqlite-wal").exists(), "关库后日志已合并");
        let before = std::fs::read(&p).unwrap();
        {
            let s = Store::open(&p).unwrap();
            let g = s.load_graph().unwrap();
            let v = g.snapshot();
            assert_eq!(v.links.len(), 3, "三条线都读出来，没删");
            let flag = |f: &str| v.links.iter().find(|l| l.from == f).unwrap().invalid;
            assert!(flag("sg"));
            assert!(!flag("script") && !flag("char"));
            assert_eq!(g.invalid_links().len(), 1);
            let n: i64 = s.conn().query_row("SELECT count(*) FROM links", [], |r| r.get(0)).unwrap();
            assert_eq!(n, 3, "库里也还是三条");
        }
        assert_eq!(std::fs::read(&p).unwrap(), before, "只是打开，库文件零字节变化");
        // 删掉非法线后保存，重开还是删掉的状态
        {
            let mut s = Store::open(&p).unwrap();
            let mut g = s.load_graph().unwrap();
            let bad = g.invalid_links().remove(0);
            g.unlink(&bad).unwrap();
            s.save_graph(&g).unwrap();
        }
        let g = Store::open(&p).unwrap().load_graph().unwrap();
        assert!(g.invalid_links().is_empty() && g.snapshot().links.len() == 2);
    }
}
