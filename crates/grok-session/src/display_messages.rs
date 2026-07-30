//! 从磁盘 `updates.jsonl`（rollout 等价物）投影展示用消息。
//!
//! 不启 agent、不依赖 ACP 事件回放。侧栏点开历史应先调这里再 `load_session` 挂 runtime。
//! 工具字段对齐实时 `ToolCallInfo`：kind / status / title / detail / preview。

use serde::Serialize;
use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// 前端 ChatMessage 对齐的展示消息（snake_case 序列化）。
#[derive(Debug, Clone, Serialize)]
pub struct DisplayMessage {
    pub id: String,
    /// user | assistant | thought | tool
    pub role: String,
    /// 正文；tool 角色下等同 preview（兼容旧前端）
    pub text: String,
    /// tool 标题（title）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    /// read / edit / execute / search / fetch / delete / move / think / other
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// pending / in_progress / completed / failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// 路径、命令等摘要
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// 输出预览
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

impl DisplayMessage {
    fn plain(id: String, role: &str, text: String, prompt_id: Option<String>) -> Self {
        Self {
            id,
            role: role.to_string(),
            text,
            tool: None,
            tool_call_id: None,
            prompt_id,
            kind: None,
            status: None,
            detail: None,
            preview: None,
        }
    }
}

/// 从 session 目录的 updates.jsonl 投影消息；文件缺失则返回空列表。
pub fn load_display_messages_from_session_dir(dir: &Path) -> anyhow::Result<Vec<DisplayMessage>> {
    let path = dir.join("updates.jsonl");
    if !path.is_file() {
        return load_display_messages_from_chat_history(&dir.join("chat_history.jsonl"));
    }
    let file = File::open(&path)
        .map_err(|e| anyhow::anyhow!("打开 updates.jsonl 失败 ({}): {e}", path.display()))?;
    let reader = BufReader::new(file);
    let mut msgs: Vec<DisplayMessage> = Vec::new();
    let mut next_id: u64 = 0;

    for line in reader.lines() {
        let line = line.map_err(|e| anyhow::anyhow!("读 updates.jsonl 失败: {e}"))?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        apply_update_line(&mut msgs, &mut next_id, &v);
    }
    Ok(msgs)
}

/// 按 session_id 查找目录并投影。
pub fn load_display_messages(session_id: &str) -> anyhow::Result<Vec<DisplayMessage>> {
    let dir = xai_grok_shell::session::persistence::find_session_dir_by_id(session_id)
        .ok_or_else(|| anyhow::anyhow!("找不到会话目录: {session_id}"))?;
    load_display_messages_from_session_dir(&dir)
}

fn new_id(next: &mut u64) -> String {
    let id = format!("msg_{next}");
    *next += 1;
    id
}

fn text_from_content(content: &Value) -> String {
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    if let Some(t) = content.get("text").and_then(|x| x.as_str()) {
        return t.to_string();
    }
    if let Some(arr) = content.as_array() {
        return arr
            .iter()
            .filter_map(|b| {
                // content 块：{ type, content: { text } } 或 { text }
                if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                    return Some(t.to_string());
                }
                b.get("content")
                    .map(text_from_content)
                    .filter(|s| !s.is_empty())
            })
            .collect::<Vec<_>>()
            .join("");
    }
    String::new()
}

fn append_role(msgs: &mut Vec<DisplayMessage>, next: &mut u64, role: &str, chunk: &str) {
    if chunk.is_empty() {
        return;
    }
    if let Some(last) = msgs.last_mut() {
        if last.role == role {
            last.text.push_str(chunk);
            return;
        }
    }
    msgs.push(DisplayMessage::plain(
        new_id(next),
        role,
        chunk.to_string(),
        None,
    ));
}

fn apply_update_line(msgs: &mut Vec<DisplayMessage>, next: &mut u64, v: &Value) {
    let update = v
        .pointer("/params/update")
        .or_else(|| v.get("update"))
        .cloned()
        .unwrap_or_else(|| v.clone());

    let session_kind = update
        .get("sessionUpdate")
        .or_else(|| update.get("session_update"))
        .and_then(|x| x.as_str())
        .unwrap_or("");

    match session_kind {
        "user_message_chunk" | "user_message" => {
            let text = update
                .get("content")
                .map(text_from_content)
                .unwrap_or_default();
            let pid = update
                .get("promptId")
                .or_else(|| update.get("prompt_id"))
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    v.pointer("/params/_meta/promptId")
                        .or_else(|| v.pointer("/_meta/promptId"))
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string())
                });
            if text.is_empty() {
                return;
            }
            if let Some(last) = msgs.last_mut() {
                if last.role == "user" {
                    if pid.is_some() && last.prompt_id == pid {
                        last.text.push_str(&text);
                        return;
                    }
                    if pid.is_none() && last.prompt_id.is_none() {
                        last.text.push_str(&text);
                        return;
                    }
                }
            }
            msgs.push(DisplayMessage::plain(
                new_id(next),
                "user",
                text,
                pid,
            ));
        }
        "agent_message_chunk" | "agent_message" | "message_chunk" => {
            let text = update
                .get("content")
                .map(text_from_content)
                .unwrap_or_default();
            append_role(msgs, next, "assistant", &text);
        }
        "agent_thought_chunk" | "agent_thought" | "thought_chunk" => {
            let text = update
                .get("content")
                .map(text_from_content)
                .unwrap_or_default();
            append_role(msgs, next, "thought", &text);
        }
        "tool_call" => {
            apply_tool_call(msgs, next, &update, v);
        }
        "tool_call_update" => {
            apply_tool_call_update(msgs, next, &update, v);
        }
        _ => {}
    }
}

fn apply_tool_call(msgs: &mut Vec<DisplayMessage>, next: &mut u64, update: &Value, root: &Value) {
    let id = tool_call_id(update);
    let title = str_field(update, &["title"]).unwrap_or_else(|| "tool".into());
    let kind = resolve_tool_kind(update, root);
    let status = resolve_tool_status(update, root).unwrap_or_else(|| "pending".into());
    let detail = extract_detail(update).unwrap_or_else(|| title.clone());
    let preview = extract_preview(update);
    let text = if !preview.is_empty() {
        preview.clone()
    } else {
        detail.clone()
    };
    upsert_tool(
        msgs,
        next,
        ToolFields {
            id: &id,
            title: &title,
            kind: Some(&kind),
            status: Some(&status),
            detail: Some(&detail),
            preview: if preview.is_empty() {
                None
            } else {
                Some(preview.as_str())
            },
            text: &text,
        },
    );
}

fn apply_tool_call_update(
    msgs: &mut Vec<DisplayMessage>,
    next: &mut u64,
    update: &Value,
    root: &Value,
) {
    let id = tool_call_id(update);
    let title = str_field(update, &["title"]);
    let kind = resolve_tool_kind(update, root);
    let status = resolve_tool_status(update, root);
    let detail = extract_detail(update);
    let preview = extract_preview(update);

    if id.is_empty() && title.is_none() && preview.is_empty() && detail.is_none() {
        return;
    }

    let label = title.as_deref().unwrap_or("tool");
    let text = if !preview.is_empty() {
        preview.as_str()
    } else if let Some(d) = detail.as_deref() {
        d
    } else {
        label
    };

    upsert_tool(
        msgs,
        next,
        ToolFields {
            id: &id,
            title: label,
            kind: Some(kind.as_str()),
            status: status.as_deref(),
            detail: detail.as_deref(),
            preview: if preview.is_empty() {
                None
            } else {
                Some(preview.as_str())
            },
            text,
        },
    );
}

struct ToolFields<'a> {
    id: &'a str,
    title: &'a str,
    kind: Option<&'a str>,
    status: Option<&'a str>,
    detail: Option<&'a str>,
    preview: Option<&'a str>,
    text: &'a str,
}

fn upsert_tool(msgs: &mut Vec<DisplayMessage>, next: &mut u64, f: ToolFields<'_>) {
    let tid = if f.id.is_empty() {
        format!("tool_{}", *next)
    } else {
        f.id.to_string()
    };

    if let Some(m) = msgs
        .iter_mut()
        .rev()
        .find(|m| m.role == "tool" && m.tool_call_id.as_deref() == Some(tid.as_str()))
    {
        if !f.title.is_empty() && f.title != "tool" {
            m.tool = Some(f.title.to_string());
        }
        if let Some(k) = f.kind {
            if !k.is_empty() {
                m.kind = Some(normalize_kind(k));
            }
        }
        if let Some(s) = f.status {
            if !s.is_empty() {
                m.status = Some(normalize_status(s));
            }
        }
        if let Some(d) = f.detail {
            if !d.is_empty() {
                m.detail = Some(d.to_string());
            }
        }
        if let Some(p) = f.preview {
            if !p.is_empty() {
                m.preview = Some(truncate_preview(p));
                m.text = truncate_preview(p);
            }
        } else if !f.text.is_empty() && m.preview.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
            // 无 preview 时不覆盖已有输出
            if m.text.is_empty() {
                m.text = f.text.to_string();
            }
        }
        return;
    }

    let preview = f.preview.map(truncate_preview);
    let text = if let Some(ref p) = preview {
        p.clone()
    } else if !f.text.is_empty() {
        f.text.to_string()
    } else {
        f.title.to_string()
    };

    msgs.push(DisplayMessage {
        id: new_id(next),
        role: "tool".into(),
        text,
        tool: Some(f.title.to_string()),
        tool_call_id: Some(tid),
        prompt_id: None,
        kind: f.kind.map(normalize_kind),
        status: Some(normalize_status(f.status.unwrap_or("pending"))),
        detail: f
            .detail
            .filter(|d| !d.is_empty())
            .map(|d| d.to_string())
            .or_else(|| Some(f.title.to_string())),
        preview,
    });
}

fn tool_call_id(update: &Value) -> String {
    str_field(update, &["toolCallId", "tool_call_id"]).unwrap_or_default()
}

fn str_field(v: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

/// 解析 kind：update.kind → updateParams.kind → x.ai/tool.kind → other
fn resolve_tool_kind(update: &Value, root: &Value) -> String {
    if let Some(k) = str_field(update, &["kind"]) {
        return normalize_kind(&k);
    }
    // params._meta.updateParams.kind
    if let Some(k) = root
        .pointer("/params/_meta/updateParams/kind")
        .or_else(|| root.pointer("/_meta/updateParams/kind"))
        .and_then(|x| x.as_str())
    {
        return normalize_kind(k);
    }
    // update._meta["x.ai/tool"].kind — 官方扩展 kind（list/read/…）
    if let Some(k) = update
        .pointer("/_meta/x.ai/tool/kind")
        .or_else(|| update.pointer("/_meta/x.ai\\/tool/kind"))
        .and_then(|x| x.as_str())
    {
        return map_xai_tool_kind(k);
    }
    // JSON key 可能是 "x.ai/tool"
    if let Some(meta) = update.get("_meta").and_then(|m| m.as_object()) {
        for (key, val) in meta {
            if key.contains("tool") || key.contains("x.ai") {
                if let Some(k) = val.get("kind").and_then(|x| x.as_str()) {
                    return map_xai_tool_kind(k);
                }
            }
        }
    }
    "other".into()
}

fn resolve_tool_status(update: &Value, root: &Value) -> Option<String> {
    if let Some(s) = str_field(update, &["status"]) {
        return Some(normalize_status(&s));
    }
    root.pointer("/params/_meta/updateParams/status")
        .or_else(|| root.pointer("/_meta/updateParams/status"))
        .and_then(|x| x.as_str())
        .map(normalize_status)
}

fn map_xai_tool_kind(k: &str) -> String {
    match k.to_ascii_lowercase().as_str() {
        "list" | "search" | "grep" | "glob" => "search".into(),
        "read" | "read_file" | "cat" => "read".into(),
        "edit" | "write" | "patch" | "search_replace" => "edit".into(),
        "execute" | "shell" | "bash" | "terminal" | "run" => "execute".into(),
        "fetch" | "http" | "web" => "fetch".into(),
        "delete" | "remove" => "delete".into(),
        "move" | "rename" => "move".into(),
        "think" | "thought" => "think".into(),
        other => normalize_kind(other),
    }
}

fn normalize_kind(k: &str) -> String {
    match k.to_ascii_lowercase().as_str() {
        "read" => "read".into(),
        "edit" | "write" => "edit".into(),
        "execute" | "terminal" | "bash" | "shell" => "execute".into(),
        "search" | "list" => "search".into(),
        "fetch" => "fetch".into(),
        "delete" => "delete".into(),
        "move" => "move".into(),
        "think" => "think".into(),
        "switchmode" | "switch_mode" => "other".into(),
        "other" => "other".into(),
        _ => "other".into(),
    }
}

fn normalize_status(s: &str) -> String {
    match s.to_ascii_lowercase().as_str() {
        "pending" => "pending".into(),
        "inprogress" | "in_progress" | "running" => "in_progress".into(),
        "completed" | "complete" | "done" | "success" => "completed".into(),
        "failed" | "error" | "cancelled" | "canceled" => "failed".into(),
        _ => s.to_ascii_lowercase(),
    }
}

fn extract_detail(update: &Value) -> Option<String> {
    let raw = update
        .get("rawInput")
        .or_else(|| update.get("raw_input"))?;
    // 字符串命令
    if let Some(s) = raw.as_str() {
        let t = s.trim();
        return if t.is_empty() { None } else { Some(t.to_string()) };
    }
    let obj = raw.as_object()?;
    const KEYS: &[&str] = &[
        "command",
        "cmd",
        "target_directory",
        "target_file",
        "file_path",
        "filePath",
        "path",
        "old_path",
        "new_path",
        "pattern",
        "query",
        "glob",
        "url",
        "uri",
        "href",
        "directory",
    ];
    for k in KEYS {
        if let Some(v) = obj.get(*k) {
            if let Some(s) = v.as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
    }
    // nested input
    if let Some(input) = obj.get("input").and_then(|x| x.as_object()) {
        for k in KEYS {
            if let Some(s) = input.get(*k).and_then(|x| x.as_str()) {
                let t = s.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
    }
    None
}

fn extract_preview(update: &Value) -> String {
    // content 数组 / 块
    if let Some(c) = update.get("content") {
        let t = text_from_content(c);
        if !t.trim().is_empty() {
            return t;
        }
        // Diff 片段
        if let Some(arr) = c.as_array() {
            let mut parts = Vec::new();
            for item in arr {
                let ty = item.get("type").and_then(|x| x.as_str()).unwrap_or("");
                if ty.eq_ignore_ascii_case("diff") {
                    let path = item
                        .get("path")
                        .and_then(|x| x.as_str())
                        .unwrap_or("diff");
                    let new_t = item
                        .get("newText")
                        .or_else(|| item.get("new_text"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    parts.push(format!("diff {path}\n{new_t}"));
                }
            }
            if !parts.is_empty() {
                return parts.join("\n");
            }
        }
    }
    // rawOutput：字符串或嵌套 { type: ListDir, Content: { content: "..." } }
    if let Some(raw) = update.get("rawOutput").or_else(|| update.get("raw_output")) {
        if let Some(s) = raw.as_str() {
            return s.to_string();
        }
        for path in [
            "/Content/content",
            "/content/content",
            "/Content/Content",
            "/output",
        ] {
            if let Some(s) = raw.pointer(path).and_then(|x| x.as_str()) {
                if !s.trim().is_empty() {
                    return s.to_string();
                }
            }
        }
        if let Some(s) = raw.get("content").and_then(|x| x.as_str()) {
            return s.to_string();
        }
        if let Some(s) = raw.get("output").and_then(|x| x.as_str()) {
            return s.to_string();
        }
    }
    String::new()
}

fn truncate_preview(s: &str) -> String {
    const MAX: usize = 8000;
    let t = s.trim();
    if t.len() <= MAX {
        return t.to_string();
    }
    let mut end = MAX;
    while end > 0 && !t.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &t[..end])
}

/// chat_history 兜底：只抽 user / assistant 文本（无 tool 卡）。
fn load_display_messages_from_chat_history(path: &Path) -> anyhow::Result<Vec<DisplayMessage>> {
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut msgs = Vec::new();
    let mut next = 0u64;
    for line in reader.lines() {
        let line = line?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        match ty {
            "user" => {
                let text = extract_user_visible_text(&v);
                if text.is_empty() {
                    continue;
                }
                if text.contains("<system-reminder>") || text.contains("system-reminder") {
                    continue;
                }
                msgs.push(DisplayMessage::plain(
                    new_id(&mut next),
                    "user",
                    text,
                    None,
                ));
            }
            "assistant" => {
                let text = v
                    .get("content")
                    .map(text_from_content)
                    .unwrap_or_default();
                if text.is_empty() {
                    continue;
                }
                append_role(&mut msgs, &mut next, "assistant", &text);
            }
            "reasoning" => {
                let text = v
                    .get("summary")
                    .or_else(|| v.get("content"))
                    .map(text_from_content)
                    .unwrap_or_default();
                if !text.is_empty() {
                    append_role(&mut msgs, &mut next, "thought", &text);
                }
            }
            _ => {}
        }
    }
    Ok(msgs)
}

fn extract_user_visible_text(v: &Value) -> String {
    let raw = v.get("content").map(text_from_content).unwrap_or_default();
    if let Some(start) = raw.find("<user_query>") {
        let rest = &raw[start + "<user_query>".len()..];
        if let Some(end) = rest.find("</user_query>") {
            return rest[..end].trim().to_string();
        }
    }
    raw.trim().to_string()
}
