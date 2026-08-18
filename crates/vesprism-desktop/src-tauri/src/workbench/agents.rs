//! 工作台 Agent 资产：`~/.vesprism/agents/<id>/agent.yaml` + `system-prompt.md`。
//! 人设段落 / 技能 / MCP / 插件由此承载；会话组装单（`compositions/<name>.yml`）收敛为
//! 模型 / 工具停用 / 权限 / 流程，`agent_type` 引用本目录的 Agent id（一个 id 两处用）。

use crate::commands::desktop_home_dir;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_ID_LEN: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCapability {
    ReadOnly,
    ReadWrite,
    Execute,
    All,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AgentPersona {
    pub label: Option<String>,
    pub sections: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub version: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub capability: Option<AgentCapability>,
    #[serde(default)]
    pub isolation: bool,
    #[serde(default)]
    pub disabled_tools: Vec<String>,
    #[serde(default)]
    pub permission_rules: Vec<String>,
    #[serde(default)]
    pub persona: AgentPersona,
    #[serde(default)]
    pub input_contract: String,
    #[serde(default)]
    pub output_contract: String,
    #[serde(default)]
    pub output_schema: Option<Value>,
    #[serde(default)]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub flows: Vec<String>,
}

impl Default for AgentRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            version: "1".into(),
            model: None,
            capability: None,
            isolation: false,
            disabled_tools: Vec::new(),
            permission_rules: Vec::new(),
            persona: AgentPersona::default(),
            input_contract: String::new(),
            output_contract: String::new(),
            output_schema: None,
            agent_type: None,
            skills: Vec::new(),
            flows: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentListItem {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub model: Option<String>,
    pub capability: Option<AgentCapability>,
    pub isolation: bool,
    pub disabled_tools: Vec<String>,
    pub permission_rules: Vec<String>,
    pub agent_type: Option<String>,
    pub output_schema: Option<Value>,
    pub skills: Vec<String>,
    pub system_prompt: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetail {
    pub agent: AgentRecord,
    pub system_prompt: String,
}

pub fn agents_root() -> PathBuf {
    desktop_home_dir().join("agents")
}

pub fn is_valid_agent_id(id: &str) -> bool {
    let s = id.trim();
    if s.is_empty() || s.len() > MAX_ID_LEN {
        return false;
    }
    let mut prev_hyphen = false;
    let mut started = false;
    for c in s.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            prev_hyphen = false;
            started = true;
        } else if c == '-' {
            if !started || prev_hyphen {
                return false;
            }
            prev_hyphen = true;
        } else {
            return false;
        }
    }
    started && !prev_hyphen
}

fn agent_dir(root: &Path, id: &str) -> PathBuf {
    root.join(id)
}

fn yaml_path(root: &Path, id: &str) -> PathBuf {
    agent_dir(root, id).join("agent.yaml")
}

fn prompt_path(root: &Path, id: &str) -> PathBuf {
    agent_dir(root, id).join("system-prompt.md")
}

pub fn parse_agent_yaml(yaml: &str, source: &str) -> Result<AgentRecord, String> {
    let rec: AgentRecord =
        serde_yaml::from_str(yaml).map_err(|e| format!("解析 Agent 失败（{source}）: {e}"))?;
    rec.validate()
        .map_err(|e| format!("Agent 校验失败（{source}）: {e}"))?;
    Ok(rec)
}

impl AgentRecord {
    pub fn validate(&self) -> Result<(), String> {
        if !is_valid_agent_id(&self.id) {
            return Err(format!(
                "Agent id 不合法：{:?}（1-64 位小写字母、数字、单连字符）",
                self.id
            ));
        }
        if self.name.trim().is_empty() {
            return Err("Agent 显示名不能为空".into());
        }
        if self.version.trim().is_empty() {
            return Err("Agent 必须有 version".into());
        }
        for name in &self.disabled_tools {
            if name.trim().is_empty() {
                return Err("disabled_tools 不能含空名".into());
            }
        }
        for matcher in &self.permission_rules {
            if matcher.trim().is_empty() {
                return Err("permission_rules 不能含空表达式".into());
            }
        }
        Ok(())
    }
}

pub fn list_agents_in(root: &Path) -> Result<Vec<AgentListItem>, String> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let rd = fs::read_dir(root).map_err(|e| format!("读取 Agent 目录失败: {e}"))?;
    let mut out = Vec::new();
    for ent in rd.flatten() {
        let path = ent.path();
        if !path.is_dir() {
            continue;
        }
        let stem = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .trim();
        if stem.is_empty() {
            continue;
        }
        let yaml = path.join("agent.yaml");
        if !yaml.is_file() {
            continue;
        }
        let text = match fs::read_to_string(&yaml) {
            Ok(t) => t,
            Err(e) => {
                out.push(AgentListItem {
                    id: stem.to_string(),
                    name: format!("⚠️ {stem} (读取失败)"),
                    description: None,
                    version: "1".into(),
                    model: None,
                    capability: None,
                    isolation: false,
                    disabled_tools: Vec::new(),
                    permission_rules: Vec::new(),
                    agent_type: None,
                    output_schema: None,
                    skills: Vec::new(),
                    system_prompt: None,
                    error: Some(format!("读取 agent.yaml 失败: {e}")),
                });
                continue;
            }
        };
        let rec = match parse_agent_yaml(&text, stem) {
            Ok(r) if r.id != stem => {
                out.push(AgentListItem {
                    id: stem.to_string(),
                    name: format!("⚠️ {stem} (id 不一致)"),
                    description: Some(format!("目录名 {stem}，yaml id 为 {}", r.id)),
                    version: r.version,
                    model: None,
                    capability: None,
                    isolation: false,
                    disabled_tools: Vec::new(),
                    permission_rules: Vec::new(),
                    agent_type: None,
                    output_schema: None,
                    skills: Vec::new(),
                    system_prompt: None,
                    error: Some(format!(
                        "目录名 {stem} 与 agent.yaml 的 id {} 不一致。请改 yaml 或改目录名后重开。",
                        r.id
                    )),
                });
                continue;
            }
            Ok(r) => r,
            Err(e) => {
                out.push(AgentListItem {
                    id: stem.to_string(),
                    name: format!("⚠️ {stem} (格式损坏)"),
                    description: None,
                    version: "1".into(),
                    model: None,
                    capability: None,
                    isolation: false,
                    disabled_tools: Vec::new(),
                    permission_rules: Vec::new(),
                    agent_type: None,
                    output_schema: None,
                    skills: Vec::new(),
                    system_prompt: None,
                    error: Some(e),
                });
                continue;
            }
        };
        let system_prompt = fs::read_to_string(path.join("system-prompt.md"))
            .ok()
            .filter(|s| !s.trim().is_empty());
        let desc = if rec.description.trim().is_empty() {
            None
        } else {
            Some(rec.description)
        };
        out.push(AgentListItem {
            id: rec.id,
            name: rec.name,
            description: desc,
            version: rec.version,
            model: rec.model.filter(|s| !s.trim().is_empty()),
            capability: rec.capability,
            isolation: rec.isolation,
            disabled_tools: rec.disabled_tools,
            permission_rules: rec.permission_rules,
            agent_type: rec.agent_type.filter(|s| !s.trim().is_empty()),
            output_schema: rec.output_schema,
            skills: rec.skills,
            system_prompt,
            error: None,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

pub fn get_agent_in(root: &Path, id: &str) -> Result<AgentDetail, String> {
    if !is_valid_agent_id(id) {
        return Err(format!("Agent id 不合法: {id}"));
    }
    let yaml = yaml_path(root, id);
    if !yaml.is_file() {
        return Err(format!("Agent 不存在: {id}"));
    }
    let text = fs::read_to_string(&yaml).map_err(|e| format!("读取 agent.yaml 失败: {e}"))?;
    let agent = parse_agent_yaml(&text, id)?;
    let system_prompt = fs::read_to_string(prompt_path(root, id)).unwrap_or_default();
    Ok(AgentDetail {
        agent,
        system_prompt,
    })
}

pub fn save_agent_in(
    root: &Path,
    mut agent: AgentRecord,
    system_prompt: Option<String>,
) -> Result<AgentRecord, String> {
    if agent.version.trim().is_empty() {
        agent.version = "1".into();
    }
    agent.id = agent.id.trim().to_string();
    agent.name = agent.name.trim().to_string();
    agent.validate()?;
    let dir = agent_dir(root, &agent.id);
    fs::create_dir_all(&dir).map_err(|e| format!("创建 Agent 目录失败: {e}"))?;
    let yaml = serde_yaml::to_string(&agent).map_err(|e| format!("序列化 agent.yaml 失败: {e}"))?;
    fs::write(yaml_path(root, &agent.id), yaml.as_bytes())
        .map_err(|e| format!("写入 agent.yaml 失败: {e}"))?;
    if let Some(prompt) = system_prompt {
        fs::write(prompt_path(root, &agent.id), prompt.as_bytes())
            .map_err(|e| format!("写入 system-prompt.md 失败: {e}"))?;
    }
    Ok(agent)
}

pub fn delete_agent_in(root: &Path, id: &str) -> Result<(), String> {
    if !is_valid_agent_id(id) {
        return Err(format!("Agent id 不合法: {id}"));
    }
    let dir = agent_dir(root, id);
    if !dir.is_dir() {
        return Err(format!("Agent 不存在: {id}"));
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("删除 Agent 失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_agents() -> Result<Vec<AgentListItem>, String> {
    list_agents_in(&agents_root())
}

#[tauri::command]
pub fn get_agent(id: String) -> Result<AgentDetail, String> {
    get_agent_in(&agents_root(), &id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAgentRequest {
    pub agent: AgentRecord,
    #[serde(default)]
    pub system_prompt: Option<String>,
}

#[tauri::command]
pub fn save_agent(payload: SaveAgentRequest) -> Result<AgentRecord, String> {
    save_agent_in(&agents_root(), payload.agent, payload.system_prompt)
}

#[tauri::command]
pub fn delete_agent(id: String) -> Result<(), String> {
    delete_agent_in(&agents_root(), &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("vesp-wb-agents-{}-{nanos}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample() -> AgentRecord {
        AgentRecord {
            id: "pr-reviewer".into(),
            name: "PR 审查员".into(),
            description: "只读审查".into(),
            version: "1".into(),
            capability: Some(AgentCapability::ReadOnly),
            isolation: false,
            disabled_tools: vec!["web_search".into()],
            permission_rules: vec!["edit:**/.env".into()],
            input_contract: "PR diff".into(),
            output_contract: "审查意见".into(),
            ..AgentRecord::default()
        }
    }

    #[test]
    fn id_rules() {
        assert!(is_valid_agent_id("pr-reviewer"));
        assert!(is_valid_agent_id("a1"));
        assert!(!is_valid_agent_id(""));
        assert!(!is_valid_agent_id("PR"));
        assert!(!is_valid_agent_id("-x"));
        assert!(!is_valid_agent_id("x-"));
        assert!(!is_valid_agent_id("a--b"));
    }

    #[test]
    fn round_trip_dir() {
        let root = tmp();
        save_agent_in(&root, sample(), Some("# prompt\n只读审查".into())).unwrap();
        let got = get_agent_in(&root, "pr-reviewer").unwrap();
        assert_eq!(got.agent.name, "PR 审查员");
        assert_eq!(got.agent.capability, Some(AgentCapability::ReadOnly));
        assert_eq!(got.agent.permission_rules, vec!["edit:**/.env".to_string()]);
        assert_eq!(got.system_prompt, "# prompt\n只读审查");
        let list = list_agents_in(&root).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "pr-reviewer");
        assert_eq!(list[0].version, "1");
        delete_agent_in(&root, "pr-reviewer").unwrap();
        assert!(list_agents_in(&root).unwrap().is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_version_rejected_on_parse() {
        let err = parse_agent_yaml("id: x\nname: X\n", "t").unwrap_err();
        assert!(
            err.contains("version") || err.contains("missing"),
            "err: {err}"
        );
    }

    #[test]
    fn unknown_field_rejected() {
        let err = parse_agent_yaml(
            "id: pr-reviewer\nname: X\nversion: \"1\"\npreset: nope\n",
            "t",
        )
        .unwrap_err();
        assert!(err.contains("preset") || err.contains("解析"), "err: {err}");
    }

    #[test]
    fn list_flags_dir_id_mismatch() {
        let root = tmp();
        let dir = root.join("folder-a");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("agent.yaml"),
            "id: other-id\nname: 错位\nversion: \"1\"\n",
        )
        .unwrap();
        let list = list_agents_in(&root).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "folder-a");
        assert!(list[0].error.as_deref().unwrap_or("").contains("不一致"));
        let _ = fs::remove_dir_all(&root);
    }
}
