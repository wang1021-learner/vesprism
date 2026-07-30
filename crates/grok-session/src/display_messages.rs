//! Codex 风格：从磁盘 `updates.jsonl`（rollout 等价物）投影展示用消息。
//!
//! 不启 agent、不依赖 ACP 事件回放。侧栏点开历史应先调这里再 `load_session` 挂 runtime。

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
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
}

/// 从 session 目录的 updates.jsonl 投影消息；文件缺失则返回空列表。
pub fn load_display_messages_from_session_dir(dir: &Path) -> anyhow::Result<Vec<DisplayMessage>> {
    let path = dir.join("updates.jsonl");
    if !path.is_file() {
        // 兜底：极老会话只有 chat_history
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

/// 按 session_id 查找目录并投影（扫 sessions 树，与官方 find_session_dir_by_id 一致）。
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
                b.get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
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
    msgs.push(DisplayMessage {
        id: new_id(next),
        role: role.to_string(),
        text: chunk.to_string(),
        tool: None,
        tool_call_id: None,
        prompt_id: None,
    });
}

fn apply_update_line(msgs: &mut Vec<DisplayMessage>, next: &mut u64, v: &Value) {
    let update = v
        .pointer("/params/update")
        .or_else(|| v.get("update"))
        .cloned()
        .unwrap_or_else(|| v.clone());

    let kind = update
        .get("sessionUpdate")
        .or_else(|| update.get("session_update"))
        .and_then(|x| x.as_str())
        .unwrap_or("");

    match kind {
        "user_message_chunk" | "user_message" => {
            let text = update
                .get("content")
                .map(text_from_content)
                .unwrap_or_default();
            let pid = update
                .get("promptId")
                .or_else(|| update.get("prompt_id"))
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            if text.is_empty() {
                return;
            }
            // 同 prompt 合并
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
            msgs.push(DisplayMessage {
                id: new_id(next),
                role: "user".into(),
                text,
                tool: None,
                tool_call_id: None,
                prompt_id: pid,
            });
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
            let id = update
                .get("toolCallId")
                .or_else(|| update.get("tool_call_id"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let title = update
                .get("title")
                .and_then(|x| x.as_str())
                .unwrap_or("tool")
                .to_string();
            let detail = update
                .get("rawInput")
                .or_else(|| update.get("raw_input"))
                .map(|x| {
                    if x.is_string() {
                        x.as_str().unwrap_or("").to_string()
                    } else {
                        x.to_string()
                    }
                })
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| title.clone());
            upsert_tool(msgs, next, &id, &title, &detail);
        }
        "tool_call_update" => {
            let id = update
                .get("toolCallId")
                .or_else(|| update.get("tool_call_id"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let title = update
                .get("title")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            let content_text = update
                .get("content")
                .map(|c| {
                    if let Some(arr) = c.as_array() {
                        arr.iter()
                            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join("\n")
                    } else {
                        text_from_content(c)
                    }
                })
                .unwrap_or_default();
            let preview = update
                .get("rawOutput")
                .or_else(|| update.get("raw_output"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let text = if !content_text.is_empty() {
                content_text
            } else if !preview.is_empty() {
                preview
            } else {
                String::new()
            };
            let label = title.as_deref().unwrap_or("tool");
            if id.is_empty() && text.is_empty() {
                return;
            }
            if let Some(m) = msgs
                .iter_mut()
                .rev()
                .find(|m| m.role == "tool" && m.tool_call_id.as_deref() == Some(id.as_str()))
            {
                if !text.is_empty() {
                    m.text = text;
                }
                if let Some(t) = title {
                    m.tool = Some(t);
                }
            } else {
                upsert_tool(msgs, next, &id, label, if text.is_empty() { label } else { &text });
            }
        }
        _ => {}
    }
}

fn upsert_tool(
    msgs: &mut Vec<DisplayMessage>,
    next: &mut u64,
    id: &str,
    label: &str,
    text: &str,
) {
    let tid = if id.is_empty() {
        format!("tool_{}", *next)
    } else {
        id.to_string()
    };
    if let Some(m) = msgs
        .iter_mut()
        .rev()
        .find(|m| m.role == "tool" && m.tool_call_id.as_deref() == Some(tid.as_str()))
    {
        m.tool = Some(label.to_string());
        if !text.is_empty() {
            m.text = text.to_string();
        }
        return;
    }
    msgs.push(DisplayMessage {
        id: new_id(next),
        role: "tool".into(),
        text: text.to_string(),
        tool: Some(label.to_string()),
        tool_call_id: Some(tid),
        prompt_id: None,
    });
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
                // 跳过 system-reminder 等注入
                if text.contains("<system-reminder>") || text.contains("system-reminder") {
                    continue;
                }
                msgs.push(DisplayMessage {
                    id: new_id(&mut next),
                    role: "user".into(),
                    text,
                    tool: None,
                    tool_call_id: None,
                    prompt_id: None,
                });
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
    // 常见壳：<user_query>...</user_query>
    if let Some(start) = raw.find("<user_query>") {
        let rest = &raw[start + "<user_query>".len()..];
        if let Some(end) = rest.find("</user_query>") {
            return rest[..end].trim().to_string();
        }
    }
    raw.trim().to_string()
}
