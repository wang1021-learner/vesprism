//! 项目列表与新建。编号只由后端生成（ULID），目录只在根目录下。
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::*;

const B32: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub const DEFAULT_NAME: &str = "未命名项目";
const NAME_KEY: &str = "name";

/// 48 位毫秒时间 + 80 位随机。随机取自标准库的随机哈希种子，不新加依赖。
pub fn new_ulid() -> String {
    use std::hash::{BuildHasher, Hasher};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
        & ((1u64 << 48) - 1);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let rnd = |salt: u64| {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(salt);
        h.write_u64(seq);
        h.finish()
    };
    let r = (((rnd(1) as u128) << 64) | rnd(2) as u128) & ((1u128 << 80) - 1);
    let v = ((ms as u128) << 80) | r;
    (0..26).rev().map(|i| B32[((v >> (i * 5)) & 31) as usize] as char).collect()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub project_id: String,
    pub name: String,
    /// unix 毫秒，取库文件（含 WAL）最后修改时间
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenProject {
    pub project_id: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectList {
    /// 按更新时间倒序
    pub projects: Vec<ProjectSummary>,
    /// 打不开的库，单独列出，不跳过
    pub broken: Vec<BrokenProject>,
}

fn mtime_ms(p: &Path) -> Option<i64> {
    let t = std::fs::metadata(p).ok()?.modified().ok()?;
    Some(t.duration_since(UNIX_EPOCH).ok()?.as_millis() as i64)
}

fn updated_at(db: &Path) -> i64 {
    let wal = db.with_file_name("project.sqlite-wal");
    mtime_ms(db).max(mtime_ms(&wal)).unwrap_or(0)
}

pub fn create_project(st: &DramaState, name: Option<String>) -> Result<ProjectSummary> {
    let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    let name = name.unwrap_or_else(|| DEFAULT_NAME.to_string());
    let id = new_ulid();
    let dir = st.root().join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| CommandError::new(Code::Io, e.to_string()))?;
    let db = dir.join("project.sqlite");
    let store = Store::open(&db)?;
    store.set_setting(NAME_KEY, &name)?;
    let graph = store.load_graph()?;
    st.insert(&id, Project { dir, store, graph });
    Ok(ProjectSummary { project_id: id, name, updated_at: updated_at(&db) })
}

/// 只扫根目录下 ULID 命名的子目录；其他目录不是我们的，不管。
pub fn list_projects(st: &DramaState) -> Result<ProjectList> {
    let mut out = ProjectList { projects: Vec::new(), broken: Vec::new() };
    let rd = match std::fs::read_dir(st.root()) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(CommandError::new(Code::Io, e.to_string())),
    };
    for ent in rd.flatten() {
        let Ok(id) = ent.file_name().into_string() else { continue };
        if !ent.path().is_dir() || !is_ulid(&id) {
            continue;
        }
        let db = ent.path().join("project.sqlite");
        if !db.is_file() {
            out.broken.push(BrokenProject { project_id: id, message: "缺少 project.sqlite".into() });
            continue;
        }
        match Store::peek_setting(&db, NAME_KEY) {
            Ok(name) => out.projects.push(ProjectSummary {
                project_id: id,
                name: name.unwrap_or_else(|| DEFAULT_NAME.to_string()),
                updated_at: updated_at(&db),
            }),
            Err(e) => out.broken.push(BrokenProject { project_id: id, message: e.to_string() }),
        }
    }
    out.projects
        .sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| b.project_id.cmp(&a.project_id)));
    out.broken.sort_by(|a, b| a.project_id.cmp(&b.project_id));
    Ok(out)
}
