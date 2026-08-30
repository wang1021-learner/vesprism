//! 写台书的持久化：`~/.vesprism/books/<id>.json`（结构数据）+
//! `~/.vesprism/writing/<id>/`（每书一个会话工作目录，transcript 按书归档）。
//!
//! id 只允许 `[A-Za-z0-9_-]`，防止路径穿越；写入走原子写（temp + rename）。

use std::path::PathBuf;

use serde::Serialize;

fn books_root() -> PathBuf {
    crate::commands::desktop_home_dir().join("books")
}

pub(crate) fn writing_root() -> PathBuf {
    crate::commands::desktop_home_dir().join("writing")
}

/// 写台每书会话目录（~/.vesprism/writing/<id>）。沙箱 / 侧栏分组都靠它识别。
pub fn is_writing_cwd(origin: &str) -> bool {
    let raw = origin.trim();
    if raw.is_empty() {
        return false;
    }
    let origin_path = std::path::Path::new(raw);
    if let (Ok(root), Ok(child)) = (
        writing_root().canonicalize(),
        origin_path.canonicalize(),
    ) {
        let c = child.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
        let r = root.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
        return c == r || c.starts_with(&format!("{r}/"));
    }
    let n = raw.replace('\\', "/").to_ascii_lowercase();
    n.contains("/.vesprism/writing/")
}

/// 规范化书 id：只留字母数字与 `-`/`_`；空或含危险字符返回 None。
fn sanitize_id(id: &str) -> Option<String> {
    let s = id.trim();
    if s.is_empty() || s.len() > 128 {
        return None;
    }
    let clean: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if clean.is_empty() {
        return None;
    }
    Some(clean)
}

fn book_path(id: &str) -> Option<PathBuf> {
    sanitize_id(id).map(|clean| books_root().join(format!("{clean}.json")))
}

#[derive(Debug, Clone, Serialize)]
pub struct WritingBookMeta {
    pub id: String,
    pub title: String,
    pub updated_at: String,
}

fn meta_from_json(id: &str, json: &str) -> WritingBookMeta {
    let parsed = serde_json::from_str::<serde_json::Value>(json).ok();
    let title = parsed
        .as_ref()
        .and_then(|v| v.get("title"))
        .and_then(|t| t.as_str())
        .unwrap_or("未命名")
        .to_string();
    let updated_at = parsed
        .as_ref()
        .and_then(|v| v.get("updatedAt"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    WritingBookMeta {
        id: id.to_string(),
        title,
        updated_at,
    }
}

/// 书库列表：扫 books 目录下的 `<id>.json`，按文件修改时间倒序。
#[tauri::command]
pub fn writing_list_books() -> Result<Vec<WritingBookMeta>, String> {
    let root = books_root();
    std::fs::create_dir_all(&root).map_err(|e| format!("创建书库目录失败: {e}"))?;
    let mut metas: Vec<(WritingBookMeta, std::time::SystemTime)> = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|e| format!("读取书库失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取书库条目失败: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".json") else {
            continue;
        };
        if !entry.path().is_file() {
            continue;
        }
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::UNIX_EPOCH);
        let json = std::fs::read_to_string(entry.path()).unwrap_or_default();
        metas.push((meta_from_json(id, &json), mtime));
    }
    metas.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(metas.into_iter().map(|(m, _)| m).collect())
}

/// 读一本书的 JSON 文本。
#[tauri::command]
pub fn writing_load_book(id: String) -> Result<String, String> {
    let path = book_path(&id).ok_or_else(|| "书 id 不合法".to_string())?;
    if !path.is_file() {
        return Err("这本书不存在".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("读取书失败: {e}"))
}

/// 保存一本书（原子写）。`id` 以规范化后的为准。
#[tauri::command]
pub fn writing_save_book(id: String, json: String) -> Result<(), String> {
    let clean = sanitize_id(&id).ok_or_else(|| "书 id 不合法".to_string())?;
    let root = books_root();
    std::fs::create_dir_all(&root).map_err(|e| format!("创建书库目录失败: {e}"))?;
    let path = root.join(format!("{clean}.json"));
    crate::commands::atomic_write(&path, json.as_bytes())
        .map_err(|e| format!("保存书失败: {e}"))
}

/// 删除一本书（含其 JSON 与专属会话目录）。
#[tauri::command]
pub fn writing_delete_book(id: String) -> Result<(), String> {
    let clean = sanitize_id(&id).ok_or_else(|| "书 id 不合法".to_string())?;
    if let Some(path) = book_path(&clean) {
        if path.is_file() {
            std::fs::remove_file(&path).map_err(|e| format!("删除书失败: {e}"))?;
        }
    }
    let wdir = writing_root().join(&clean);
    if wdir.is_dir() {
        std::fs::remove_dir_all(&wdir).map_err(|e| format!("删除书目录失败: {e}"))?;
    }
    Ok(())
}

/// 每书一个会话工作目录（确保存在并返回绝对路径）。
/// 引擎 transcript 按书落盘，切书重启会话即换桶。
#[tauri::command]
pub fn writing_session_cwd(id: String) -> Result<String, String> {
    let clean = sanitize_id(&id).ok_or_else(|| "书 id 不合法".to_string())?;
    let wdir = writing_root().join(&clean);
    std::fs::create_dir_all(&wdir).map_err(|e| format!("创建书目录失败: {e}"))?;
    Ok(wdir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::sanitize_id;

    #[test]
    fn atomic_write_keeps_dest_when_overwriting() {
        let dir = std::env::temp_dir().join(format!(
            "vesprism-atomic-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("book.json");
        crate::commands::atomic_write(&path, b"{\"v\":1}").unwrap();
        crate::commands::atomic_write(&path, b"{\"v\":2}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"v\":2}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn writing_cwd_detects_slash_and_backslash() {
        assert!(super::is_writing_cwd(r"C:\Users\x\.vesprism\writing\book-1"));
        assert!(super::is_writing_cwd("/home/u/.vesprism/writing/book-1"));
        assert!(!super::is_writing_cwd("/home/u/code/app"));
        assert!(!super::is_writing_cwd(""));
    }

    #[test]
    fn sanitize_blocks_traversal() {
        assert_eq!(sanitize_id("book-123"), Some("book-123".to_string()));
        // 危险字符一律替换，结果不含路径分隔符或点
        let trav = sanitize_id("../../etc").unwrap();
        assert!(!trav.contains('/') && !trav.contains('.'));
        assert_eq!(sanitize_id("a/b"), Some("a_b".to_string()));
        assert_eq!(sanitize_id("  "), None);
        assert_eq!(sanitize_id(""), None);
        assert!(sanitize_id("x").is_some());
    }
}
