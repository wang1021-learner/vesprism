//! 生成结果文件：`<项目目录>/assets/<blake3>.<扩展名>`，先写临时文件再改名。库里只存相对路径。
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::model::EntityId;
use crate::store::{Store, StoreError};

pub const ASSETS_DIR: &str = "assets";

/// 素材元数据（尺寸/时长按类型可空）。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AssetMeta {
    pub mime: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetRow {
    pub id: String,
    pub hash: String,
    pub rel_path: String,
    pub mime: String,
    pub bytes: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
    pub created_at: i64,
}

/// 发给前端的素材：校验过、规范化的绝对路径。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRef {
    pub path: String,
    pub mime: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

/// 节点上放哪一格：镜头分图片和视频，其他节点只有一格。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Slot {
    Image,
    Video,
    Single,
}

pub fn ext_for(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "audio/wav" | "audio/x-wav" => "wav",
        "video/mp4" => "mp4",
        _ => "bin",
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 原子写：临时文件 → fsync → rename。任何一步失败都删掉临时文件，不留半截。
/// `write` 可注入故障（测试用）。目标已存在（同 hash）就不再写。
pub fn write_atomic(
    dir: &Path,
    name: &str,
    data: &[u8],
    mut write: impl FnMut(&mut std::fs::File, &[u8]) -> std::io::Result<()>,
) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let dst = dir.join(name);
    if dst.is_file() && std::fs::metadata(&dst)?.len() == data.len() as u64 {
        return Ok(dst);
    }
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = dir.join(format!(".tmp-{}-{n}-{name}", std::process::id()));
    let res = (|| {
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        write(&mut f, data)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, &dst)
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(dst)
}

fn plain_write(f: &mut std::fs::File, d: &[u8]) -> std::io::Result<()> {
    f.write_all(d)
}

/// 去掉 Windows 规范化路径的 `\\?\` 前缀（UNC 网络路径保留），前端 convertFileSrc 才认。
fn display_path(p: &Path) -> String {
    let s = p.to_string_lossy().into_owned();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => rest.to_string(),
        _ => s,
    }
}

/// 相对路径 → 校验过的绝对路径。只认 `assets/` 下的普通文件名；`..`、绝对路径、
/// 盘符、跑出 `assets/` 的（含符号链接）一律 None（命令层是 not_found）。
pub fn resolve(project_dir: &Path, rel_path: &str) -> Option<PathBuf> {
    let rel = Path::new(rel_path);
    if rel_path.is_empty() || rel.is_absolute() || rel_path.split(['/', '\\']).any(|c| c == "..") {
        return None;
    }
    let mut comps = rel.components();
    if comps.next() != Some(Component::Normal(ASSETS_DIR.as_ref())) {
        return None;
    }
    let rest: Vec<_> = comps.collect();
    if rest.is_empty() || !rest.iter().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    let root = std::fs::canonicalize(project_dir.join(ASSETS_DIR)).ok()?;
    let full = std::fs::canonicalize(project_dir.join(rel)).ok()?;
    (full.starts_with(&root) && full.is_file()).then_some(full)
}

pub fn to_ref(project_dir: &Path, a: &AssetRow) -> Option<AssetRef> {
    let p = resolve(project_dir, &a.rel_path)?;
    Some(AssetRef {
        path: display_path(&p),
        mime: a.mime.clone(),
        width: a.width,
        height: a.height,
        duration_ms: a.duration_ms,
    })
}

pub fn slot_for(kind: crate::model::NodeKind, mime: &str) -> Slot {
    match kind {
        crate::model::NodeKind::Shot if mime.starts_with("video/") => Slot::Video,
        crate::model::NodeKind::Shot => Slot::Image,
        _ => Slot::Single,
    }
}

const ASSET_COLS: &str = "id, hash, rel_path, mime, bytes, width, height, duration_ms, created_at";

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<AssetRow> {
    Ok(AssetRow {
        id: r.get(0)?,
        hash: r.get(1)?,
        rel_path: r.get(2)?,
        mime: r.get(3)?,
        bytes: r.get::<_, i64>(4)? as u64,
        width: r.get(5)?,
        height: r.get(6)?,
        duration_ms: r.get::<_, Option<i64>>(7)?.map(|v| v as u64),
        created_at: r.get(8)?,
    })
}

impl Store {
    /// 存一份素材：文件按内容去重（同内容只落一份），记录每次都新建一条。
    pub fn put_asset(&self, project_dir: &Path, id: &str, data: &[u8], meta: &AssetMeta) -> Result<AssetRow, StoreError> {
        self.put_asset_with(project_dir, id, data, meta, plain_write)
    }

    pub fn put_asset_with(
        &self,
        project_dir: &Path,
        id: &str,
        data: &[u8],
        meta: &AssetMeta,
        write: impl FnMut(&mut std::fs::File, &[u8]) -> std::io::Result<()>,
    ) -> Result<AssetRow, StoreError> {
        let hash = blake3::hash(data).to_hex().to_string();
        let name = format!("{hash}.{}", ext_for(&meta.mime));
        write_atomic(&project_dir.join(ASSETS_DIR), &name, data, write)?;
        let a = AssetRow {
            id: id.to_string(),
            hash,
            rel_path: format!("{ASSETS_DIR}/{name}"),
            mime: meta.mime.clone(),
            bytes: data.len() as u64,
            width: meta.width,
            height: meta.height,
            duration_ms: meta.duration_ms,
            created_at: now_ms(),
        };
        self.conn().execute(
            &format!("INSERT INTO asset ({ASSET_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"),
            params![a.id, a.hash, a.rel_path, a.mime, a.bytes as i64, a.width, a.height, a.duration_ms.map(|v| v as i64), a.created_at],
        )?;
        Ok(a)
    }

    pub fn asset(&self, id: &str) -> Result<Option<AssetRow>, StoreError> {
        Ok(self
            .conn()
            .query_row(&format!("SELECT {ASSET_COLS} FROM asset WHERE id = ?1"), [id], row)
            .optional()?)
    }

    /// 生成成功：任务记下结果素材。
    pub fn set_job_asset(&self, job_id: &str, asset_id: &str) -> Result<(), StoreError> {
        self.conn().execute("UPDATE jobs SET asset_id = ?2 WHERE id = ?1", params![job_id, asset_id])?;
        Ok(())
    }

    /// 每个节点最近一次成功的结果（含已归档的旧尝试）。最近一次失败不会清掉之前的成功。
    /// 返回 (节点 id, 素材)，按素材写入先后排序，后面的覆盖前面的。
    pub fn successful_assets(&self) -> Result<Vec<(EntityId, AssetRow)>, StoreError> {
        let cols = ASSET_COLS.split(", ").map(|c| format!("a.{c}")).collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT r.node_id, {cols} FROM (
                SELECT node_id, asset_id FROM jobs WHERE status = 'done' AND asset_id IS NOT NULL
                UNION ALL
                SELECT j.node_id, ja.asset_id FROM job_attempts ja JOIN jobs j ON j.id = ja.job_id
                    WHERE ja.status = 'done' AND ja.asset_id IS NOT NULL
             ) r JOIN asset a ON a.id = r.asset_id ORDER BY a.created_at, a.rowid"
        );
        let mut st = self.conn().prepare(&sql)?;
        let rows = st
            .query_map([], |r| {
                let node: String = r.get(0)?;
                let a = AssetRow {
                    id: r.get(1)?,
                    hash: r.get(2)?,
                    rel_path: r.get(3)?,
                    mime: r.get(4)?,
                    bytes: r.get::<_, i64>(5)? as u64,
                    width: r.get(6)?,
                    height: r.get(7)?,
                    duration_ms: r.get::<_, Option<i64>>(8)?.map(|v| v as u64),
                    created_at: r.get(9)?,
                };
                Ok((node, a))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// 节点 → 格子 → 校验过的素材。路径校验不过的当没有（不暴露项目外的文件）。
    pub fn latest_refs(
        &self,
        project_dir: &Path,
        g: &crate::graph::Graph,
    ) -> Result<std::collections::HashMap<(EntityId, Slot), AssetRef>, StoreError> {
        let mut out = std::collections::HashMap::new();
        for (node, a) in self.successful_assets()? {
            let Some(n) = g.node(&node) else { continue };
            if let Some(r) = to_ref(project_dir, &a) {
                out.insert((node, slot_for(n.kind, &a.mime)), r);
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_meta() -> AssetMeta {
        AssetMeta { mime: "image/png".into(), width: Some(2), height: Some(2), duration_ms: None }
    }

    fn files(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect())
            .unwrap_or_default();
        v.sort();
        v
    }

    #[test]
    fn same_content_stored_once_two_records_one_hash() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::open(&dir.path().join("project.sqlite")).unwrap();
        let a = s.put_asset(dir.path(), "a1", b"same bytes", &png_meta()).unwrap();
        let b = s.put_asset(dir.path(), "a2", b"same bytes", &png_meta()).unwrap();
        assert_eq!(a.hash, b.hash);
        assert_eq!(a.rel_path, b.rel_path);
        assert_ne!(a.id, b.id);
        assert_eq!(files(&dir.path().join(ASSETS_DIR)), [format!("{}.png", a.hash)]);
        let n: i64 = s.conn().query_row("SELECT count(*) FROM asset WHERE hash = ?1", [&a.hash], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        assert_eq!(a.hash, blake3::hash(b"same bytes").to_hex().to_string());
        assert_eq!(s.asset("a2").unwrap().unwrap().bytes, 10);
    }

    #[test]
    fn failure_mid_write_leaves_no_temp_or_partial_file_and_no_record() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::open(&dir.path().join("project.sqlite")).unwrap();
        let data = vec![7u8; 4096];
        let e = s.put_asset_with(dir.path(), "x", &data, &png_meta(), |f, d| {
            f.write_all(&d[..1000])?;
            Err(std::io::Error::other("disk full"))
        });
        assert!(e.is_err());
        assert_eq!(files(&dir.path().join(ASSETS_DIR)), Vec::<String>::new(), "不留临时文件和半截文件");
        assert!(s.asset("x").unwrap().is_none());
        // 之后正常写能成功
        s.put_asset(dir.path(), "y", &data, &png_meta()).unwrap();
        assert_eq!(files(&dir.path().join(ASSETS_DIR)).len(), 1);
    }

    #[test]
    fn dotdot_absolute_and_outside_assets_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::open(&dir.path().join("project.sqlite")).unwrap();
        let a = s.put_asset(dir.path(), "a", b"x", &png_meta()).unwrap();
        assert!(resolve(dir.path(), &a.rel_path).is_some());
        let abs = dir.path().join(&a.rel_path).to_string_lossy().into_owned();
        for bad in [
            "../project.sqlite",
            "assets/../project.sqlite",
            "assets/../../etc/passwd",
            "project.sqlite",
            "assets",
            "assets/",
            "",
            "/etc/passwd",
            "C:\\Windows\\win.ini",
            "assets\\..\\project.sqlite",
            abs.as_str(),
        ] {
            assert!(resolve(dir.path(), bad).is_none(), "{bad}");
        }
        assert!(resolve(dir.path(), "assets/missing.png").is_none());
    }

    #[test]
    fn moving_whole_project_dir_still_resolves() {
        let base = tempfile::tempdir().unwrap();
        let p1 = base.path().join("p1");
        std::fs::create_dir_all(&p1).unwrap();
        let rel = {
            let s = Store::open(&p1.join("project.sqlite")).unwrap();
            s.put_asset(&p1, "a", b"img", &png_meta()).unwrap().rel_path
        };
        let p2 = base.path().join("moved").join("p2");
        std::fs::create_dir_all(p2.parent().unwrap()).unwrap();
        std::fs::rename(&p1, &p2).unwrap();
        let s = Store::open(&p2.join("project.sqlite")).unwrap();
        let a = s.asset("a").unwrap().unwrap();
        assert_eq!(a.rel_path, rel, "库里存的是相对路径");
        let r = to_ref(&p2, &a).unwrap();
        let canon = std::fs::canonicalize(&p2).unwrap();
        assert!(Path::new(&r.path).is_absolute());
        assert!(std::fs::canonicalize(&r.path).unwrap().starts_with(&canon));
        assert_eq!(std::fs::read(&r.path).unwrap(), b"img");
    }

    #[test]
    fn asset_ref_serializes_to_promised_shape() {
        let r = AssetRef { path: "/p/a.wav".into(), mime: "audio/wav".into(), width: None, height: None, duration_ms: Some(1200) };
        assert_eq!(serde_json::to_string(&r).unwrap(), r#"{"path":"/p/a.wav","mime":"audio/wav","durationMs":1200}"#);
    }
}
