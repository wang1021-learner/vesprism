//! 写台书的持久化：`~/.vesprism/books/<id>/meta.json` + `book.json` + `chapters/NNNN.json`。
//! 旧档 `~/.vesprism/books/<id>.json` 在列表/读取时迁到目录。
//! `~/.vesprism/writing/<id>/` 每书一个会话工作目录。
//!
//! id 只允许 `[A-Za-z0-9_-]`，防止路径穿越；写入走原子写（temp + rename）。
//! 书库列表只读 meta，不读章正文。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

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
    let origin_path = Path::new(raw);
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

fn book_dir(root: &Path, id: &str) -> PathBuf {
    root.join(id)
}

fn legacy_path(root: &Path, id: &str) -> PathBuf {
    root.join(format!("{id}.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WritingBookMeta {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    #[serde(default)]
    pub accepted: u32,
    #[serde(default)]
    pub has_candidate: bool,
    #[serde(default)]
    pub land_line: String,
    #[serde(default)]
    pub accepted_chars: u32,
    #[serde(default)]
    pub target_chars: u32,
    #[serde(default)]
    pub remain_chars: u32,
    #[serde(default)]
    pub volume_line: String,
    #[serde(default)]
    pub aim: u32,
}

fn parse_value(json: &str) -> Result<Value, String> {
    serde_json::from_str(json).map_err(|e| format!("书稿不是合法 JSON: {e}"))
}

fn to_json_bytes(v: &Value) -> Result<Vec<u8>, String> {
    serde_json::to_vec(v).map_err(|e| format!("序列化失败: {e}"))
}

fn write_json_file(path: &Path, v: &Value) -> Result<(), String> {
    crate::commands::atomic_write(path, &to_json_bytes(v)?).map_err(|e| format!("保存失败: {e}"))
}

fn chapter_no_of(ch: &Value) -> Option<u32> {
    ch.get("no").and_then(|n| {
        n.as_u64()
            .map(|x| x as u32)
            .or_else(|| n.as_i64().and_then(|x| u32::try_from(x).ok()))
    })
}

fn chapter_id_of(ch: &Value) -> Option<&str> {
    ch.get("id").and_then(|x| x.as_str())
}

fn is_true(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|a| a.as_bool()) == Some(true)
}

fn count_hanzi(s: &str) -> u32 {
    s.chars()
        .filter(|c| {
            let u = *c as u32;
            (0x4E00..=0x9FFF).contains(&u)
                || (0x3400..=0x4DBF).contains(&u)
                || (0x20000..=0x2A6DF).contains(&u)
        })
        .count() as u32
}

fn draft_hanzi(draft: &Value) -> u32 {
    draft
        .get("beats")
        .and_then(|b| b.as_array())
        .map(|beats| {
            beats
                .iter()
                .filter_map(|b| b.get("body").and_then(|x| x.as_str()))
                .map(count_hanzi)
                .sum()
        })
        .unwrap_or(0)
}

fn parse_aim_from_words(s: &str) -> u32 {
    let nums: Vec<u32> = s
        .chars()
        .collect::<String>()
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|p| p.parse::<u32>().ok())
        .filter(|n| *n >= 100)
        .collect();
    if nums.len() >= 2 {
        (nums[0] + nums[1]) / 2
    } else if nums.len() == 1 {
        nums[0]
    } else {
        2200
    }
}

fn find_chapter<'a>(chapters: Option<&'a [Value]>, chapter_id: &str) -> Option<&'a Value> {
    chapters
        .and_then(|chs| chs.iter().find(|c| chapter_id_of(c) == Some(chapter_id)))
}

fn land_line_from(
    chapters: Option<&[Value]>,
    drafts: Option<&[Value]>,
    reviews: Option<&[Value]>,
) -> String {
    if let Some(ds) = drafts {
        if let Some(d) = ds.iter().find(|d| !is_true(d, "accepted")) {
            if let Some(cid) = d.get("chapterId").and_then(|x| x.as_str()) {
                if let Some(no) = find_chapter(chapters, cid).and_then(chapter_no_of) {
                    return format!("第{no}章试笔");
                }
                return "试笔".into();
            }
        }
    }
    if let Some(rs) = reviews {
        if let Some(r) = rs.iter().find(|r| !is_true(r, "adopted")) {
            if let Some(cid) = r.get("chapterId").and_then(|x| x.as_str()) {
                if let Some(no) = find_chapter(chapters, cid).and_then(chapter_no_of) {
                    return format!("第{no}章检查");
                }
                return "检查".into();
            }
        }
    }
    if let Some(chs) = chapters {
        let last_open = chs
            .iter()
            .rev()
            .find(|c| c.get("locked").and_then(|l| l.as_bool()) != Some(true));
        if let Some(no) = last_open.or_else(|| chs.last()).and_then(chapter_no_of) {
            return format!("第{no}章");
        }
    }
    "开卷".into()
}

fn meta_from_value(id: &str, assembled: &Value) -> WritingBookMeta {
    let title = assembled
        .get("title")
        .and_then(|t| t.as_str())
        .unwrap_or("未命名")
        .to_string();
    let updated_at = assembled
        .get("updatedAt")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let drafts = assembled.get("drafts").and_then(|d| d.as_array());
    let reviews = assembled.get("reviews").and_then(|d| d.as_array());
    let chapters = assembled.get("chapters").and_then(|d| d.as_array());
    let accepted = drafts
        .map(|ds| ds.iter().filter(|d| is_true(d, "accepted")).count() as u32)
        .unwrap_or(0);
    let has_candidate = drafts
        .map(|ds| ds.iter().any(|d| !is_true(d, "accepted")))
        .unwrap_or(false)
        || reviews
            .map(|rs| rs.iter().any(|r| !is_true(r, "adopted")))
            .unwrap_or(false);
    let accepted_chars = drafts
        .map(|ds| {
            ds.iter()
                .filter(|d| is_true(d, "accepted"))
                .map(draft_hanzi)
                .sum()
        })
        .unwrap_or(0);
    let target_chars = 1_000_000u32;
    let chapter_words = assembled
        .get("canon")
        .and_then(|c| c.get("chapterWords"))
        .and_then(|t| t.as_str())
        .unwrap_or("");
    let aim_chars = parse_aim_from_words(chapter_words).max(1);
    let aim = (target_chars + aim_chars - 1) / aim_chars;
    WritingBookMeta {
        id: id.to_string(),
        title,
        updated_at,
        accepted,
        has_candidate,
        land_line: land_line_from(
            chapters.map(|c| c.as_slice()),
            drafts.map(|d| d.as_slice()),
            reviews.map(|r| r.as_slice()),
        ),
        accepted_chars,
        target_chars,
        remain_chars: target_chars.saturating_sub(accepted_chars),
        volume_line: volume_line_from(assembled),
        aim,
    }
}

fn volume_line_from(assembled: &Value) -> String {
    let chapters = assembled.get("chapters").and_then(|c| c.as_array());
    let units = assembled.get("units").and_then(|c| c.as_array());
    let volumes = assembled.get("volumes").and_then(|c| c.as_array());
    let drafts = assembled.get("drafts").and_then(|d| d.as_array());
    let Some(ds) = drafts else {
        return String::new();
    };
    let accepted_ids: Vec<&str> = ds
        .iter()
        .filter(|d| is_true(d, "accepted"))
        .filter_map(|d| d.get("chapterId").and_then(|x| x.as_str()))
        .collect();
    let Some(chs) = chapters else {
        return String::new();
    };
    let mut last: Option<&Value> = None;
    let mut last_no = 0u32;
    for ch in chs {
        let Some(id) = chapter_id_of(ch) else {
            continue;
        };
        if !accepted_ids.contains(&id) {
            continue;
        }
        let no = chapter_no_of(ch).unwrap_or(0);
        if last.is_none() || no >= last_no {
            last = Some(ch);
            last_no = no;
        }
    }
    let Some(ch) = last else {
        return String::new();
    };
    let heading = format!("第{last_no}章");
    let unit_id = ch.get("unitId").and_then(|x| x.as_str()).unwrap_or("");
    let vol_id = units
        .and_then(|us| {
            us.iter()
                .find(|u| u.get("id").and_then(|x| x.as_str()) == Some(unit_id))
                .and_then(|u| u.get("volumeId").and_then(|x| x.as_str()))
        })
        .unwrap_or("");
    let vol_title = volumes.and_then(|vs| {
        vs.iter()
            .find(|v| v.get("id").and_then(|x| x.as_str()) == Some(vol_id))
            .and_then(|v| v.get("title").and_then(|t| t.as_str()))
    });
    match vol_title {
        Some(t) if !t.is_empty() => format!("{t} · {heading}"),
        _ => heading,
    }
}

fn split_parts(mut assembled: Value) -> Result<(Value, Vec<(u32, Value)>), String> {
    let obj = assembled
        .as_object_mut()
        .ok_or_else(|| "书稿必须是对象".to_string())?;
    let beats = obj.remove("beatsByChapter").unwrap_or_else(|| json!({}));
    let drafts = obj.remove("drafts").unwrap_or_else(|| json!([]));
    let reviews = obj.remove("reviews").unwrap_or_else(|| json!([]));
    let beats_map = beats.as_object().cloned().unwrap_or_default();
    let drafts_arr = drafts.as_array().cloned().unwrap_or_default();
    let reviews_arr = reviews.as_array().cloned().unwrap_or_default();
    let chapters = obj
        .get("chapters")
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();
    let mut files = Vec::new();
    for ch in &chapters {
        let Some(id) = chapter_id_of(ch) else {
            continue;
        };
        let no = chapter_no_of(ch).unwrap_or(0);
        let beats_for = beats_map.get(id).cloned().unwrap_or_else(|| json!([]));
        let draft = drafts_arr
            .iter()
            .find(|d| d.get("chapterId").and_then(|x| x.as_str()) == Some(id))
            .cloned();
        let review = reviews_arr
            .iter()
            .find(|d| d.get("chapterId").and_then(|x| x.as_str()) == Some(id))
            .cloned();
        let mut file = json!({
            "id": id,
            "no": no,
            "beats": beats_for,
        });
        if let Some(d) = draft {
            file["draft"] = d;
        }
        if let Some(r) = review {
            file["review"] = r;
        }
        files.push((no, file));
    }
    Ok((assembled, files))
}

fn assemble_from_parts(mut book: Value, chapter_files: Vec<Value>) -> Value {
    let mut beats = Map::new();
    let mut drafts = Vec::new();
    let mut reviews = Vec::new();
    for cf in chapter_files {
        let id = cf
            .get("id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        if let Some(b) = cf.get("beats") {
            beats.insert(id.clone(), b.clone());
        }
        if let Some(d) = cf.get("draft") {
            if !d.is_null() {
                drafts.push(d.clone());
            }
        }
        if let Some(r) = cf.get("review") {
            if !r.is_null() {
                reviews.push(r.clone());
            }
        }
    }
    if let Some(obj) = book.as_object_mut() {
        obj.insert("beatsByChapter".into(), Value::Object(beats));
        obj.insert("drafts".into(), Value::Array(drafts));
        obj.insert("reviews".into(), Value::Array(reviews));
    }
    book
}

fn drop_legacy_file(root: &Path, id: &str) {
    let legacy = legacy_path(root, id);
    if legacy.is_file() {
        let bak = root.join(format!("{id}.json.bak"));
        let _ = fs::copy(&legacy, &bak);
        let _ = fs::remove_file(&legacy);
    }
}

pub(crate) fn save_book_at(root: &Path, id: &str, json: &str) -> Result<(), String> {
    let clean = sanitize_id(id).ok_or_else(|| "书 id 不合法".to_string())?;
    if json.len() > crate::security::MAX_BOOK_JSON_BYTES {
        return Err("书稿超过 16MB，拒绝写入".into());
    }
    fs::create_dir_all(root).map_err(|e| format!("创建书库目录失败: {e}"))?;
    let assembled = parse_value(json)?;
    let meta = meta_from_value(&clean, &assembled);
    let (book, chapters) = split_parts(assembled)?;
    let dir = book_dir(root, &clean);
    let chap_dir = dir.join("chapters");
    fs::create_dir_all(&chap_dir).map_err(|e| format!("创建书目录失败: {e}"))?;
    let meta_val = serde_json::to_value(&meta).map_err(|e| format!("序列化书目失败: {e}"))?;
    write_json_file(&dir.join("meta.json"), &meta_val)?;
    write_json_file(&dir.join("book.json"), &book)?;
    let mut keep: HashSet<String> = HashSet::new();
    for (no, file) in chapters {
        let name = format!("{no:04}.json");
        keep.insert(name.clone());
        let bytes = to_json_bytes(&file)?;
        if bytes.len() > crate::security::MAX_BOOK_JSON_BYTES {
            return Err("章节超过 16MB，拒绝写入".into());
        }
        crate::commands::atomic_write(&chap_dir.join(&name), &bytes)
            .map_err(|e| format!("保存章节失败: {e}"))?;
    }
    if let Ok(entries) = fs::read_dir(&chap_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_s = name.to_string_lossy();
            if name_s.ends_with(".json") && !keep.contains(name_s.as_ref()) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    drop_legacy_file(root, &clean);
    Ok(())
}

pub(crate) fn load_book_at(root: &Path, id: &str) -> Result<String, String> {
    let clean = sanitize_id(id).ok_or_else(|| "书 id 不合法".to_string())?;
    migrate_one(root, &clean)?;
    let dir = book_dir(root, &clean);
    let book_path = dir.join("book.json");
    if !book_path.is_file() {
        return Err("这本书不存在".into());
    }
    let book_json = fs::read_to_string(&book_path).map_err(|e| format!("读取书失败: {e}"))?;
    let book = parse_value(&book_json)?;
    let mut files = Vec::new();
    let chap_dir = dir.join("chapters");
    if chap_dir.is_dir() {
        let mut entries: Vec<_> = fs::read_dir(&chap_dir)
            .map_err(|e| format!("读取章节目录失败: {e}"))?
            .flatten()
            .collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let name = entry.file_name();
            let name_s = name.to_string_lossy();
            if !name_s.ends_with(".json") {
                continue;
            }
            let text = fs::read_to_string(entry.path()).map_err(|e| format!("读取章节失败: {e}"))?;
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                files.push(v);
            }
        }
    }
    let assembled = assemble_from_parts(book, files);
    serde_json::to_string(&assembled).map_err(|e| format!("组装书失败: {e}"))
}

fn read_meta_file(dir: &Path, id: &str) -> Option<WritingBookMeta> {
    let text = fs::read_to_string(dir.join("meta.json")).ok()?;
    let mut meta: WritingBookMeta = serde_json::from_str(&text).ok()?;
    if meta.id.is_empty() {
        meta.id = id.to_string();
    }
    Some(meta)
}

fn migrate_one(root: &Path, id: &str) -> Result<(), String> {
    let dir = book_dir(root, id);
    if dir.join("book.json").is_file() {
        drop_legacy_file(root, id);
        return Ok(());
    }
    let legacy = legacy_path(root, id);
    if legacy.is_file() {
        let json = fs::read_to_string(&legacy).map_err(|e| format!("读取旧书失败: {e}"))?;
        save_book_at(root, id, &json)?;
    }
    Ok(())
}

fn migrate_all(root: &Path) -> Result<(), String> {
    if !root.is_dir() {
        return Ok(());
    }
    let entries: Vec<_> = fs::read_dir(root)
        .map_err(|e| format!("读取书库失败: {e}"))?
        .flatten()
        .collect();
    for entry in entries {
        let name = entry.file_name();
        let name_s = name.to_string_lossy();
        if name_s.ends_with(".bak") || !entry.path().is_file() {
            continue;
        }
        let Some(id) = name_s.strip_suffix(".json") else {
            continue;
        };
        if let Some(clean) = sanitize_id(id) {
            migrate_one(root, &clean)?;
        }
    }
    Ok(())
}

pub(crate) fn list_books_at(root: &Path) -> Result<Vec<WritingBookMeta>, String> {
    fs::create_dir_all(root).map_err(|e| format!("创建书库目录失败: {e}"))?;
    migrate_all(root)?;
    let mut metas: Vec<(WritingBookMeta, std::time::SystemTime)> = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| format!("读取书库失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取书库条目失败: {e}"))?;
        if !entry.path().is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(clean) = sanitize_id(&name) else {
            continue;
        };
        if clean != name {
            continue;
        }
        let Some(meta) = read_meta_file(&entry.path(), &clean) else {
            continue;
        };
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::UNIX_EPOCH);
        metas.push((meta, mtime));
    }
    metas.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(metas.into_iter().map(|(m, _)| m).collect())
}

pub(crate) fn delete_book_at(root: &Path, id: &str) -> Result<(), String> {
    let clean = sanitize_id(id).ok_or_else(|| "书 id 不合法".to_string())?;
    let dir = book_dir(root, &clean);
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| format!("删除书失败: {e}"))?;
    }
    let legacy = legacy_path(root, &clean);
    if legacy.is_file() {
        fs::remove_file(&legacy).map_err(|e| format!("删除旧书失败: {e}"))?;
    }
    let bak = root.join(format!("{clean}.json.bak"));
    if bak.is_file() {
        let _ = fs::remove_file(&bak);
    }
    Ok(())
}

fn draft_body(draft: &Value) -> String {
    let Some(beats) = draft.get("beats").and_then(|b| b.as_array()) else {
        return String::new();
    };
    beats
        .iter()
        .filter_map(|b| b.get("body").and_then(|x| x.as_str()))
        .collect::<Vec<_>>()
        .join("\n")
}

fn chapter_heading(ch: &Value, no: u32) -> String {
    let title = ch.get("title").and_then(|t| t.as_str()).unwrap_or("");
    if title.is_empty() {
        format!("第{no}章")
    } else {
        format!("第{no}章 {title}")
    }
}

pub(crate) fn export_plain_at(
    root: &Path,
    id: &str,
    want_no: Option<u32>,
    volume_id: Option<&str>,
) -> Result<String, String> {
    let json = load_book_at(root, id)?;
    let v = parse_value(&json)?;
    let title = v.get("title").and_then(|t| t.as_str()).unwrap_or("未命名");
    let mut chapters = v
        .get("chapters")
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();
    chapters.sort_by_key(|c| chapter_no_of(c).unwrap_or(0));
    if let Some(vid) = volume_id.filter(|s| !s.is_empty()) {
        let unit_ids: std::collections::HashSet<String> = v
            .get("units")
            .and_then(|u| u.as_array())
            .map(|us| {
                us.iter()
                    .filter(|u| u.get("volumeId").and_then(|x| x.as_str()) == Some(vid))
                    .filter_map(|u| u.get("id").and_then(|x| x.as_str()).map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        chapters.retain(|c| {
            c.get("unitId")
                .and_then(|x| x.as_str())
                .map(|id| unit_ids.contains(id))
                .unwrap_or(false)
        });
    }
    let drafts = v
        .get("drafts")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();
    let body_of = |ch: &Value| -> String {
        let cid = chapter_id_of(ch).unwrap_or("");
        drafts
            .iter()
            .find(|d| {
                d.get("chapterId").and_then(|x| x.as_str()) == Some(cid) && is_true(d, "accepted")
            })
            .map(draft_body)
            .unwrap_or_default()
    };
    if let Some(want) = want_no {
        let ch = chapters
            .iter()
            .find(|c| chapter_no_of(c) == Some(want))
            .ok_or_else(|| "这一章不存在".to_string())?;
        let body = body_of(ch);
        if body.trim().is_empty() {
            return Err("这一章还没有进正史的正文".into());
        }
        return Ok(format!("{}\n\n{body}\n", chapter_heading(ch, want)));
    }
    let mut parts = vec![title.to_string()];
    for ch in &chapters {
        let Some(no) = chapter_no_of(ch) else {
            continue;
        };
        let body = body_of(ch);
        if body.trim().is_empty() {
            continue;
        }
        parts.push(format!("{}\n\n{body}", chapter_heading(ch, no)));
    }
    if parts.len() < 2 {
        return Err("还没有正史正文可导出".into());
    }
    Ok(parts.join("\n\n") + "\n")
}

fn pick_export_txt(
    app: &AppHandle,
    title: &str,
    chapter_no: Option<u32>,
    volume_id: Option<&str>,
) -> Result<PathBuf, String> {
    let safe: String = title
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let name = if let Some(n) = chapter_no {
        format!("{safe}-第{n}章.txt")
    } else if let Some(vid) = volume_id.filter(|s| !s.is_empty()) {
        format!("{safe}-{vid}.txt")
    } else {
        format!("{safe}.txt")
    };
    let picked = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("正文", &["txt"])
        .blocking_save_file()
        .ok_or_else(|| "已取消导出".to_string())?;
    picked
        .into_path()
        .map_err(|e| format!("导出路径无效: {e}"))
}

/// 书库列表：只读各书 `meta.json`，按目录修改时间倒序。
#[tauri::command]
pub fn writing_list_books() -> Result<Vec<WritingBookMeta>, String> {
    list_books_at(&books_root())
}

/// 读一本书：组装 book.json + chapters/*.json。
#[tauri::command]
pub fn writing_load_book(id: String) -> Result<String, String> {
    load_book_at(&books_root(), &id)
}

/// 保存一本书：拆成 meta / 结构 / 按章文件。
#[tauri::command]
pub fn writing_save_book(id: String, json: String) -> Result<(), String> {
    save_book_at(&books_root(), &id, &json)
}

/// 删除一本书（含其目录、旧 JSON 与专属会话目录）。
#[tauri::command]
pub fn writing_delete_book(id: String) -> Result<(), String> {
    let clean = sanitize_id(&id).ok_or_else(|| "书 id 不合法".to_string())?;
    delete_book_at(&books_root(), &clean)?;
    let wdir = writing_root().join(&clean);
    if wdir.is_dir() {
        fs::remove_dir_all(&wdir).map_err(|e| format!("删除书目录失败: {e}"))?;
    }
    Ok(())
}

/// 导出正文 txt（一章或全书）。弹保存对话框。
#[tauri::command]
pub fn writing_export_book(
    id: String,
    chapter_no: Option<u32>,
    volume_id: Option<String>,
    app: AppHandle,
) -> Result<String, String> {
    let root = books_root();
    let vid = volume_id.as_deref();
    let text = export_plain_at(&root, &id, chapter_no, vid)?;
    let assembled = load_book_at(&root, &id)?;
    let v = parse_value(&assembled).unwrap_or_else(|_| json!({}));
    let title = v.get("title").and_then(|t| t.as_str()).unwrap_or("未命名");
    let dest = pick_export_txt(&app, title, chapter_no, vid)?;
    crate::commands::atomic_write(&dest, text.as_bytes()).map_err(|e| format!("导出失败: {e}"))?;
    Ok(dest.display().to_string())
}

/// 每书一个会话工作目录（确保存在并返回绝对路径）。
/// 引擎 transcript 按书落盘，切书重启会话即换桶。
#[tauri::command]
pub fn writing_session_cwd(id: String) -> Result<String, String> {
    let clean = sanitize_id(&id).ok_or_else(|| "书 id 不合法".to_string())?;
    let wdir = writing_root().join(&clean);
    fs::create_dir_all(&wdir).map_err(|e| format!("创建书目录失败: {e}"))?;
    Ok(wdir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::sanitize_id;
    use std::path::PathBuf;

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
    fn save_rejects_huge_json() {
        let huge = "x".repeat(crate::security::MAX_BOOK_JSON_BYTES + 1);
        let err = super::writing_save_book("book-size".into(), huge).unwrap_err();
        assert!(err.contains("16MB"));
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

    fn tmp_books() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "vesprism-books-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_book_json() -> String {
        serde_json::json!({
            "id": "b1",
            "title": "试",
            "updatedAt": "2026-01-01T00:00:00.000Z",
            "pitch": {
                "titles": ["试"],
                "platform": "番茄",
                "logline": "一句",
                "cheat": "",
                "cost": "",
                "comps": "",
                "emotion": "",
                "hooks": ["", "", ""],
                "firstThree": { "ch1": "", "ch2": "", "ch3": "" },
                "forbiddenBook": ""
            },
            "canon": {
                "platform": "",
                "pov": "",
                "chapterWords": "",
                "schedule": "",
                "samples": ["", "", ""],
                "powerCap": "",
                "timeRule": "",
                "infoRule": "",
                "povRule": "",
                "narrativeBan": "",
                "settingBan": "",
                "sentenceBan": "",
                "doneWhen": ""
            },
            "people": [],
            "rules": [],
            "places": [],
            "outline": {
                "want": "",
                "need": "",
                "antagonistWant": "",
                "leverage": "",
                "causality": "",
                "act1": "",
                "act2": "",
                "act3": "",
                "foreshadows": [],
                "volumeUpgrade": []
            },
            "volumes": [],
            "units": [],
            "chapters": [{
                "id": "ch-1",
                "no": 1,
                "title": "开场",
                "unitId": "",
                "job": "推进",
                "openHook": "门响",
                "goal": "",
                "resistance": "",
                "turn": "",
                "pleasure": "",
                "infoGive": "",
                "infoForbid": "",
                "cast": [],
                "plant": "",
                "press": "",
                "close": "",
                "endHookKind": "悬念",
                "endHook": "谁",
                "words": "",
                "mood": "",
                "platform": "tomato"
            }, {
                "id": "ch-2",
                "no": 2,
                "title": "试笔章",
                "unitId": "",
                "job": "推进",
                "openHook": "",
                "goal": "",
                "resistance": "",
                "turn": "",
                "pleasure": "",
                "infoGive": "",
                "infoForbid": "",
                "cast": [],
                "plant": "",
                "press": "",
                "close": "",
                "endHookKind": "",
                "endHook": "",
                "words": "",
                "mood": "",
                "platform": "tomato"
            }],
            "beatsByChapter": {
                "ch-1": [{
                    "id": "b1",
                    "title": "切块1",
                    "scene": "",
                    "job": "",
                    "dialogue": "",
                    "info": "",
                    "mood": "",
                    "land": ""
                }]
            },
            "drafts": [{
                "chapterId": "ch-1",
                "accepted": true,
                "beats": [{ "beatId": "b1", "body": "他推开门。" }]
            }, {
                "chapterId": "ch-2",
                "accepted": false,
                "beats": [{ "beatId": "b2", "body": "不该出现的试笔。" }]
            }],
            "reviews": [{
                "chapterId": "ch-1",
                "openHookOk": "",
                "goalOk": "",
                "endHookOk": "",
                "voiceLeak": "",
                "forbiddenKnow": "",
                "cheatAbuse": "",
                "dueSeen": "",
                "unnumbered": "",
                "states": [],
                "foreshadow": [],
                "summary80": "他推开门。",
                "adopted": true
            }]
        })
        .to_string()
    }

    #[test]
    fn save_splits_into_meta_book_and_chapter_files() {
        let root = tmp_books();
        super::save_book_at(&root, "b1", &sample_book_json()).unwrap();
        let dir = root.join("b1");
        assert!(dir.join("meta.json").is_file());
        assert!(dir.join("book.json").is_file());
        assert!(dir.join("chapters").join("0001.json").is_file());
        assert!(!root.join("b1.json").is_file());

        let book: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("book.json")).unwrap()).unwrap();
        assert!(book.get("beatsByChapter").is_none());
        assert!(book.get("drafts").is_none());
        assert!(book.get("reviews").is_none());
        assert_eq!(book["title"], "试");

        let assembled: serde_json::Value =
            serde_json::from_str(&super::load_book_at(&root, "b1").unwrap()).unwrap();
        assert_eq!(assembled["title"], "试");
        assert_eq!(assembled["drafts"][0]["beats"][0]["body"], "他推开门。");
        assert_eq!(assembled["beatsByChapter"]["ch-1"][0]["title"], "切块1");
        assert_eq!(assembled["reviews"][0]["summary80"], "他推开门。");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn list_reads_meta_even_if_chapter_file_is_garbage() {
        let root = tmp_books();
        super::save_book_at(&root, "b1", &sample_book_json()).unwrap();
        std::fs::write(root.join("b1").join("chapters").join("0001.json"), "NOT JSON").unwrap();
        let metas = super::list_books_at(&root).unwrap();
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].id, "b1");
        assert_eq!(metas[0].title, "试");
        assert_eq!(metas[0].accepted, 1);
        assert!(metas[0].land_line.contains("试笔") || metas[0].land_line.contains("第"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migrates_legacy_single_json_on_list() {
        let root = tmp_books();
        std::fs::write(root.join("b1.json"), sample_book_json()).unwrap();
        let metas = super::list_books_at(&root).unwrap();
        assert_eq!(metas[0].title, "试");
        assert!(root.join("b1").join("book.json").is_file());
        assert!(root.join("b1").join("chapters").join("0001.json").is_file());
        assert!(!root.join("b1.json").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn export_plain_uses_chapter_bodies() {
        let root = tmp_books();
        super::save_book_at(&root, "b1", &sample_book_json()).unwrap();
        let ch = super::export_plain_at(&root, "b1", Some(1), None).unwrap();
        assert!(ch.contains("第1章"));
        assert!(ch.contains("他推开门。"));
        let all = super::export_plain_at(&root, "b1", None, None).unwrap();
        assert!(all.contains("试"));
        assert!(all.contains("他推开门。"));
        assert!(!all.contains("不该出现的试笔"));
        let trial = super::export_plain_at(&root, "b1", Some(2), None).unwrap_err();
        assert!(trial.contains("正史"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_removes_book_dir() {
        let root = tmp_books();
        super::save_book_at(&root, "b1", &sample_book_json()).unwrap();
        super::delete_book_at(&root, "b1").unwrap();
        assert!(!root.join("b1").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
