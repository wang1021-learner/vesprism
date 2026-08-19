//! 官方 config.toml 能力的桌面开关：会话搜索、web search 域名、媒体限流、
//! worktree GC、hooks。只读写官方键，不另实现引擎逻辑。

use crate::commands::{desktop_home_dir, load_config_root, write_config_root};
use serde::{Deserialize, Serialize};
use toml::map::Map;
use toml::Value;

const DEFAULT_IMAGE_GEN: i64 = 8;
const DEFAULT_VIDEO_GEN: i64 = 4;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnginePrefsDto {
    /// 缺省开启（官方 `features.session_search` default_enabled）。
    pub session_search: bool,
    pub web_search_allowed: Vec<String>,
    pub web_search_excluded: Vec<String>,
    pub max_parallel_image_gen_calls: i64,
    pub max_parallel_video_gen_calls: i64,
}

fn table_mut<'a>(root: &'a mut Map<String, Value>, key: &str) -> Result<&'a mut Map<String, Value>, String> {
    let entry = root
        .entry(key.to_string())
        .or_insert_with(|| Value::Table(Map::new()));
    entry
        .as_table_mut()
        .ok_or_else(|| format!("[{key}] 必须是 table"))
}

fn string_array(v: Option<&Value>) -> Vec<String> {
    v.and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|i| i.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn to_string_array(items: &[String]) -> Value {
    Value::Array(
        items
            .iter()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| Value::String(s.to_string()))
            .collect(),
    )
}

fn normalize_domains(raw: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for s in raw {
        let d = s.trim().to_ascii_lowercase();
        if d.is_empty() || out.iter().any(|x: &String| x == &d) {
            continue;
        }
        out.push(d);
    }
    out
}

#[tauri::command]
pub fn get_engine_prefs() -> Result<EnginePrefsDto, String> {
    let root = load_config_root()?;
    let features = root.get("features").and_then(|v| v.as_table());
    let session_search = features
        .and_then(|t| t.get("session_search"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let web = root
        .get("toolset")
        .and_then(|v| v.as_table())
        .and_then(|t| t.get("web_search"))
        .and_then(|v| v.as_table());
    let media = root
        .get("tools")
        .and_then(|v| v.as_table())
        .and_then(|t| t.get("media_gen"))
        .and_then(|v| v.as_table());
    Ok(EnginePrefsDto {
        session_search,
        web_search_allowed: string_array(web.and_then(|t| t.get("allowed_domains"))),
        web_search_excluded: string_array(web.and_then(|t| t.get("excluded_domains"))),
        max_parallel_image_gen_calls: media
            .and_then(|t| t.get("max_parallel_image_gen_calls"))
            .and_then(|v| v.as_integer())
            .unwrap_or(DEFAULT_IMAGE_GEN)
            .clamp(1, 32),
        max_parallel_video_gen_calls: media
            .and_then(|t| t.get("max_parallel_video_gen_calls"))
            .and_then(|v| v.as_integer())
            .unwrap_or(DEFAULT_VIDEO_GEN)
            .clamp(1, 16),
    })
}

#[tauri::command]
pub fn set_engine_prefs(prefs: EnginePrefsDto) -> Result<EnginePrefsDto, String> {
    let mut root = load_config_root()?;
    let root_tbl = root
        .as_table_mut()
        .ok_or_else(|| "config.toml 根节点必须是 table".to_string())?;

    {
        let features = table_mut(root_tbl, "features")?;
        features.insert("session_search".into(), Value::Boolean(prefs.session_search));
    }

    let allowed = normalize_domains(&prefs.web_search_allowed);
    let excluded = normalize_domains(&prefs.web_search_excluded);
    let drop_toolset = {
        let toolset = table_mut(root_tbl, "toolset")?;
        {
            let web = table_mut(toolset, "web_search")?;
            if allowed.is_empty() {
                web.remove("allowed_domains");
            } else {
                web.insert("allowed_domains".into(), to_string_array(&allowed));
                web.remove("excluded_domains");
            }
            if allowed.is_empty() {
                if excluded.is_empty() {
                    web.remove("excluded_domains");
                } else {
                    web.insert("excluded_domains".into(), to_string_array(&excluded));
                }
            }
            if web.is_empty() {
                toolset.remove("web_search");
            }
        }
        toolset.is_empty()
    };
    if drop_toolset {
        root_tbl.remove("toolset");
    }

    {
        let tools = table_mut(root_tbl, "tools")?;
        let media = table_mut(tools, "media_gen")?;
        media.insert(
            "max_parallel_image_gen_calls".into(),
            Value::Integer(prefs.max_parallel_image_gen_calls.clamp(1, 32)),
        );
        media.insert(
            "max_parallel_video_gen_calls".into(),
            Value::Integer(prefs.max_parallel_video_gen_calls.clamp(1, 16)),
        );
    }

    write_config_root(&root)?;
    get_engine_prefs()
}

#[derive(Debug, Clone, Serialize)]
pub struct WorktreeStatusDto {
    pub home: String,
    pub total: u64,
    pub alive: u64,
    pub dead: u64,
    pub db_bytes: u64,
    pub available: bool,
    pub note: String,
}

#[tauri::command]
pub fn get_worktree_status() -> Result<WorktreeStatusDto, String> {
    let home = desktop_home_dir();
    match xai_fast_worktree::WorktreeDb::open_read_only(&home) {
        xai_fast_worktree::RegistryOpen::Opened { db, .. } => {
            let stats = db.stats().map_err(|e| format!("读取 worktree 索引失败: {e}"))?;
            Ok(WorktreeStatusDto {
                home: home.display().to_string(),
                total: stats.total_records,
                alive: stats.alive_count,
                dead: stats.dead_count,
                db_bytes: stats.db_file_bytes,
                available: true,
                note: "引擎会自动回收闲置 worktree，且不会删掉用户最后一份拷贝。".into(),
            })
        }
        xai_fast_worktree::RegistryOpen::Absent { .. } => Ok(WorktreeStatusDto {
            home: home.display().to_string(),
            total: 0,
            alive: 0,
            dead: 0,
            db_bytes: 0,
            available: false,
            note: "还没有 worktree 索引（尚未创建过隔离拷贝）。".into(),
        }),
        xai_fast_worktree::RegistryOpen::Busy { error, .. }
        | xai_fast_worktree::RegistryOpen::Failed { error, .. } => Ok(WorktreeStatusDto {
            home: home.display().to_string(),
            total: 0,
            alive: 0,
            dead: 0,
            db_bytes: 0,
            available: false,
            note: format!("无法读取 worktree 索引：{error}"),
        }),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct WorktreeGcDto {
    pub removed: u64,
    pub skipped_alive: u64,
    pub dry_run: bool,
    pub message: String,
}

#[tauri::command]
pub fn gc_desktop_worktrees(dry_run: bool) -> Result<WorktreeGcDto, String> {
    let home = desktop_home_dir();
    let db = xai_fast_worktree::WorktreeDb::open(&home)
        .map_err(|e| format!("打开 worktree 索引失败: {e}"))?;
    let report = xai_fast_worktree::gc_worktrees(
        &db,
        &xai_fast_worktree::GcOptions {
            dry_run,
            force: false,
            ..Default::default()
        },
    )
    .map_err(|e| format!("worktree 回收失败: {e}"))?;
    let removed = report.dead_removed + report.expired_removed + report.no_repo_paths;
    let message = if dry_run {
        format!(
            "预检：可回收 {removed}，仍在使用 {}。",
            report.skipped_alive
        )
    } else {
        format!(
            "已回收 {removed}，跳过仍在使用的 {}。",
            report.skipped_alive
        )
    };
    Ok(WorktreeGcDto {
        removed,
        skipped_alive: report.skipped_alive,
        dry_run,
        message,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookHandlerDto {
    pub handler_type: String,
    pub command: String,
    pub url: String,
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookGroupDto {
    pub event: String,
    pub matcher: String,
    pub hooks: Vec<HookHandlerDto>,
}

fn parse_handler(v: &Value) -> Option<HookHandlerDto> {
    let t = v.as_table()?;
    Some(HookHandlerDto {
        handler_type: t
            .get("type")
            .and_then(|x| x.as_str())
            .unwrap_or("command")
            .to_string(),
        command: t
            .get("command")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        url: t.get("url").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        timeout: t.get("timeout").and_then(|x| x.as_integer()).and_then(|i| {
            if i > 0 {
                Some(i as u64)
            } else {
                None
            }
        }),
    })
}

#[tauri::command]
pub fn list_config_hooks() -> Result<Vec<HookGroupDto>, String> {
    let root = load_config_root()?;
    let Some(hooks) = root.get("hooks").and_then(|v| v.as_table()) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for (event, val) in hooks {
        let groups: Vec<Value> = match val {
            Value::Array(arr) => arr.clone(),
            Value::Table(t) => vec![Value::Table(t.clone())],
            _ => continue,
        };
        for g in groups {
            let Some(tbl) = g.as_table() else { continue };
            let handlers = tbl
                .get("hooks")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(parse_handler).collect())
                .unwrap_or_default();
            out.push(HookGroupDto {
                event: event.clone(),
                matcher: tbl
                    .get("matcher")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                hooks: handlers,
            });
        }
    }
    out.sort_by(|a, b| a.event.cmp(&b.event).then(a.matcher.cmp(&b.matcher)));
    Ok(out)
}

fn handler_to_toml(h: &HookHandlerDto) -> Value {
    let mut t = Map::new();
    let kind = if h.handler_type.trim() == "http" {
        "http"
    } else {
        "command"
    };
    t.insert("type".into(), Value::String(kind.into()));
    if kind == "http" {
        if !h.url.trim().is_empty() {
            t.insert("url".into(), Value::String(h.url.trim().to_string()));
        }
    } else if !h.command.trim().is_empty() {
        t.insert(
            "command".into(),
            Value::String(h.command.trim().to_string()),
        );
    }
    if let Some(sec) = h.timeout.filter(|s| *s > 0) {
        t.insert("timeout".into(), Value::Integer(sec as i64));
    }
    Value::Table(t)
}

#[tauri::command]
pub fn set_config_hooks(groups: Vec<HookGroupDto>) -> Result<Vec<HookGroupDto>, String> {
    let mut root = load_config_root()?;
    let root_tbl = root
        .as_table_mut()
        .ok_or_else(|| "config.toml 根节点必须是 table".to_string())?;

    let mut by_event: Map<String, Value> = Map::new();
    for g in groups {
        let event = g.event.trim();
        if event.is_empty() {
            continue;
        }
        let handlers: Vec<Value> = g
            .hooks
            .iter()
            .filter(|h| !h.command.trim().is_empty() || !h.url.trim().is_empty())
            .map(handler_to_toml)
            .collect();
        if handlers.is_empty() {
            continue;
        }
        let mut tbl = Map::new();
        if !g.matcher.trim().is_empty() {
            tbl.insert("matcher".into(), Value::String(g.matcher.trim().to_string()));
        }
        tbl.insert("hooks".into(), Value::Array(handlers));
        let arr = by_event
            .entry(event.to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(list) = arr.as_array_mut() {
            list.push(Value::Table(tbl));
        }
    }

    if by_event.is_empty() {
        root_tbl.remove("hooks");
    } else {
        root_tbl.insert("hooks".into(), Value::Table(by_event));
    }
    write_config_root(&root)?;
    list_config_hooks()
}
