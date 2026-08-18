//! 会话级组装单（半插件化配置面）：解析、继承合并、验证与逐层加载。
//!
//! 组装单决定一个会话的人设、模型、工具、技能、权限策略、工作流与 MCP 配置。
//! 四级叠加（后层覆盖前层）：
//!
//! 1. 内置 `default`（`Composition::default()`，空基准）；
//! 2. 用户级 `~/.vesprism/compositions/<name>.yml`（可 `extends` 另一个用户级组装单）；
//! 3. 工作区级 `<cwd>/.grok/agent.yml`；
//! 4. 会话覆盖（threads.sqlite 元数据，由调用方以 `Composition` 形式传入）。
//!
//! 本模块只负责配置面；把配置翻译成官方引擎通道的**执行器**（apply 编排）
//! 在装配层实现，见设计文档《桌面端-组装层设计.md》。
//!
//! 合并语义：`Option` 字段后层 `Some` 覆盖前层；列表/映射字段**整体替换**；
//! `mcp.disabled_tools` 按 server 键合并（后层覆盖同名 server 的工具列表）。
//!
//! 错误策略：`deny_unknown_fields` 让拼写错误在加载即失败；`validate` 在装配前
//! 检查规则语法与引用完整性。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::policy::{PermissionMode, PermissionRule};

/// 递归继承的深度上限（防环与恶意嵌套）。
const MAX_EXTENDS_DEPTH: usize = 8;

// ---------------------------------------------------------------------------
// 词汇
// ---------------------------------------------------------------------------

/// 人设配置：官方 `system_prompt_label` 桥。
/// `sections` 在官方 extraSystemSections 落地前不注入（也不写 AGENTS.md）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PersonaConfig {
    /// 官方「人设随模型走」标签（桌面第 7 天桥接的 `set_system_prompt_label`）。
    pub label: Option<String>,
    /// 追加的系统提示段落（按序拼接）。
    pub sections: Vec<String>,
}

/// 模型配置：映射官方 `session/set_model` + 推理强度。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ModelConfig {
    /// 模型名（官方 model id）。
    pub name: Option<String>,
    /// 推理强度（none/minimal/low/medium/high/xhigh）。
    pub reasoning_effort: Option<String>,
}

/// 工具配置。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ToolsConfig {
    /// 要停用的工具名。映射官方 `toolOverrides.disabled`（P3-1 扩展）：
    /// 会话级 seed + 每轮可 patch，模型级生效（模型拿不到被停工具）。
    pub disable: Vec<String>,
    /// 映射官方 `_meta["toolOverrides"]` 的其余自由参数（x_search 日期窗、
    /// web_search 域名白/黑名单等；键名以官方 ToolOverrides 字段为准）。
    pub overrides: Option<serde_json::Value>,
}

/// 技能配置：映射官方 `x.ai/skills/*`（发现范围按 cwd）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SkillsConfig {
    /// 可见作用域（local/repo/user/server/bundled；官方发现范围词汇）。
    pub scopes: Vec<String>,
    /// 通配排除（`*`/`**`，作用于技能名）。
    pub exclude: Vec<String>,
}

/// 权限配置：官方按会话模式 + 桌面侧细粒度规则。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PermissionsConfig {
    /// 官方按会话权限模式（`_meta.yoloMode/autoMode`）。
    pub mode: PermissionMode,
    /// 桌面侧规则（官方 `[permission] rules` 仅全局/项目级，细粒度规则在此）。
    pub rules: Vec<PermissionRule>,
}

/// 官方内置工具函数名（`disabled` 精确匹配这些）。
const OFFICIAL_TOOL_NAMES: &[&str] = &[
    "run_terminal_command",
    "web_search",
    "web_fetch",
    "search_replace",
    "read_file",
    "write",
    "grep",
    "glob",
    "apply_patch",
    "todo_write",
    "ask_user_question",
    "enter_plan_mode",
    "exit_plan_mode",
    "update_goal",
    "workflow",
];

/// 只认官方函数名。别名（bash/search/…）会让模型工具表对不上，直接拒。
pub fn canonicalize_tool_name(raw: &str) -> Result<String> {
    let name = raw.trim();
    if name.is_empty() {
        anyhow::bail!("停用工具名不能为空");
    }
    if OFFICIAL_TOOL_NAMES.contains(&name) {
        return Ok(name.to_string());
    }
    anyhow::bail!("未知工具名 {name:?}。请用官方函数名（如 run_terminal_command / web_search）")
}

/// 一个 MCP 服务器引用（stdio 或 HTTP 定义，映射官方 NewSessionRequest.mcp_servers）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct McpServerRef {
    /// 服务器名（官方 serverId；装配前校验非空）。
    pub name: String,
    /// HTTP 端点（与 `command` 二选一）。
    pub url: Option<String>,
    /// stdio 启动命令（与 `url` 二选一）。
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<BTreeMap<String, String>>,
}

/// MCP 配置：映射官方 `x.ai/session/update_mcp_servers` + `toggle_tool`。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct McpConfig {
    /// 会话要绑定/定义的服务器。
    pub servers: Vec<McpServerRef>,
    /// 按 server 停用的工具（映射官方 toggle_tool；持久化在项目 config，
    /// 会话级复原由装配层记录）。
    pub disabled_tools: BTreeMap<String, Vec<String>>,
}

/// 插件配置：映射官方 `_meta.pluginDirs`（按会话挂插件根）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PluginsConfig {
    /// 官方插件目录列表（路径可为相对工作区的路径）。
    pub dirs: Vec<PathBuf>,
}

/// 组装单本体。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Composition {
    /// 用户级组装单标识（供继承与面板展示）。
    pub id: Option<String>,
    /// 继承的用户级组装单名（仅用户级文件内有效；内置基准名为 `default`）。
    pub extends: Option<String>,
    pub persona: PersonaConfig,
    pub model: ModelConfig,
    pub tools: ToolsConfig,
    pub skills: SkillsConfig,
    pub permissions: PermissionsConfig,
    pub mcp: McpConfig,
    pub plugins: PluginsConfig,
    /// 挂到该会话的已发布流程 id。装配层经 `_meta["x.ai/flows"]` seed
    /// 或 `x.ai/session/update_flows` 挂载为 `flow__<id>`。
    pub flows: Vec<String>,
    /// 流程节点引用该组装单时写入官方 `AgentOpts.agent_type`。
    pub agent_type: Option<String>,
}

// ---------------------------------------------------------------------------
// 加载与继承合并
// ---------------------------------------------------------------------------

/// 从 YAML 文本解析一个组装单（严格模式：未知字段报错）。
pub fn parse_composition(yaml: &str, source: &str) -> Result<Composition> {
    serde_yaml::from_str(yaml).with_context(|| format!("解析组装单失败（{source}）"))
}

/// 加载用户级组装单文件 `<root>/compositions/<name>.yml`。
/// 解析结果若带 `extends`，递归合并其继承链（深度上限 [`MAX_EXTENDS_DEPTH`]）。
pub fn load_user_composition(root: &Path, name: &str) -> Result<Composition> {
    load_user_composition_inner(root, name, 0)
}

fn load_user_composition_inner(root: &Path, name: &str, depth: usize) -> Result<Composition> {
    if depth > MAX_EXTENDS_DEPTH {
        anyhow::bail!("组装单继承过深（> {MAX_EXTENDS_DEPTH} 层），可能存在环：{name}");
    }
    if name == "default" {
        return Ok(Composition::default());
    }
    let path = root.join("compositions").join(format!("{name}.yml"));
    let yaml = std::fs::read_to_string(&path)
        .with_context(|| format!("读取用户级组装单失败：{}", path.display()))?;
    let parsed = parse_composition(&yaml, &path.display().to_string())?;
    parsed
        .validate()
        .with_context(|| format!("组装单校验失败：{}", path.display()))?;
    let base = match parsed.extends.as_deref() {
        Some(parent) => load_user_composition_inner(root, parent, depth + 1)?,
        None => Composition::default(),
    };
    Ok(merge_composition(&base, &parsed))
}

/// 加载工作区级组装单 `<cwd>/.grok/agent.yml`；文件不存在返回 `Ok(None)`。
pub fn load_workspace_composition(cwd: &Path) -> Result<Option<Composition>> {
    let path = cwd.join(".grok").join("agent.yml");
    if !path.is_file() {
        return Ok(None);
    }
    let yaml = std::fs::read_to_string(&path)
        .with_context(|| format!("读取工作区组装单失败：{}", path.display()))?;
    let parsed = parse_composition(&yaml, &path.display().to_string())?;
    parsed
        .validate()
        .with_context(|| format!("组装单校验失败：{}", path.display()))?;
    Ok(Some(parsed))
}

/// 解析一个会话的最终组装单：内置 default → 用户级（含 extends 链）→
/// 工作区级 → 会话覆盖。后层覆盖前层。
pub fn resolve_composition(
    user_name: Option<&str>,
    cwd: &Path,
    session_overlay: Option<&Composition>,
    user_root: &Path,
) -> Result<Composition> {
    let mut resolved = match user_name {
        Some(name) => load_user_composition(user_root, name)?,
        None => Composition::default(),
    };
    if let Some(workspace) = load_workspace_composition(cwd)? {
        resolved = merge_composition(&resolved, &workspace);
    }
    if let Some(overlay) = session_overlay {
        resolved = merge_composition(&resolved, overlay);
    }
    Ok(resolved)
}

/// 后层覆盖前层：`Option` 取后层 `Some`；列表/映射整体替换；
/// `mcp.disabled_tools` 按 server 键合并。
pub fn merge_composition(base: &Composition, overlay: &Composition) -> Composition {
    let mut merged = base.clone();
    if let Some(v) = &overlay.id {
        merged.id = Some(v.clone());
    }
    // `extends` 只参与加载期解析，不进入合并结果。
    if overlay.persona.label.is_some() {
        merged.persona.label = overlay.persona.label.clone();
    }
    if !overlay.persona.sections.is_empty() {
        merged.persona.sections = overlay.persona.sections.clone();
    }
    if overlay.model.name.is_some() {
        merged.model.name = overlay.model.name.clone();
    }
    if overlay.model.reasoning_effort.is_some() {
        merged.model.reasoning_effort = overlay.model.reasoning_effort.clone();
    }
    if !overlay.tools.disable.is_empty() {
        merged.tools.disable = overlay.tools.disable.clone();
    }
    if overlay.tools.overrides.is_some() {
        merged.tools.overrides = overlay.tools.overrides.clone();
    }
    if !overlay.skills.scopes.is_empty() {
        merged.skills.scopes = overlay.skills.scopes.clone();
    }
    if !overlay.skills.exclude.is_empty() {
        merged.skills.exclude = overlay.skills.exclude.clone();
    }
    if overlay.permissions.mode != PermissionMode::default() {
        merged.permissions.mode = overlay.permissions.mode;
    }
    if !overlay.permissions.rules.is_empty() {
        merged.permissions.rules = overlay.permissions.rules.clone();
    }
    if !overlay.mcp.servers.is_empty() {
        merged.mcp.servers = overlay.mcp.servers.clone();
    }
    for (server, tools) in &overlay.mcp.disabled_tools {
        merged
            .mcp
            .disabled_tools
            .insert(server.clone(), tools.clone());
    }
    if !overlay.plugins.dirs.is_empty() {
        merged.plugins.dirs = overlay.plugins.dirs.clone();
    }
    if !overlay.flows.is_empty() {
        merged.flows = overlay.flows.clone();
    }
    if overlay.agent_type.is_some() {
        merged.agent_type = overlay.agent_type.clone();
    }
    merged
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

fn is_valid_flow_id(id: &str) -> bool {
    let s = id.trim();
    if s.is_empty() || s.len() > 64 {
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

impl Composition {
    /// 装配前校验：规则语法、引用完整性。失败即报错（fail loud）。
    pub fn validate(&self) -> Result<()> {
        if let Some(id) = &self.id {
            if id.trim().is_empty() {
                anyhow::bail!("组装单 id 不能为空字符串");
            }
        }
        for name in &self.tools.disable {
            canonicalize_tool_name(name).with_context(|| format!("tools.disable 无效：{name}"))?;
        }
        for rule in &self.permissions.rules {
            rule.validate()
                .with_context(|| format!("权限规则无效：{}", rule.matcher))?;
        }
        for scope in &self.skills.scopes {
            if scope.trim().is_empty() {
                anyhow::bail!("技能作用域不能为空字符串");
            }
        }
        for id in &self.flows {
            if !is_valid_flow_id(id) {
                anyhow::bail!("flows 项不是合法流程 id：{id:?}（1-64 位小写字母、数字、单连字符）");
            }
        }
        for server in &self.mcp.servers {
            if server.name.trim().is_empty() {
                anyhow::bail!("MCP 服务器名不能为空");
            }
            match (server.url.as_deref(), server.command.as_deref()) {
                (Some(_), Some(_)) => {
                    anyhow::bail!("MCP 服务器 {} 的 url 与 command 只能二选一", server.name)
                }
                (None, None) => {
                    anyhow::bail!("MCP 服务器 {} 需要 url 或 command", server.name)
                }
                _ => {}
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_full_composition_round_trips() {
        let yaml = r#"
id: coding
extends: base
persona:
  label: senior-engineer
  sections:
    - "回复使用中文"
model:
  name: deepseek-chat
  reasoning_effort: medium
tools:
  disable: [web_search]
  overrides:
    web_search:
      allowed_domains: ["docs.rs"]
skills:
  scopes: [local, repo]
  exclude: ["deploy-*"]
permissions:
  mode: ask
  rules:
    - match: "bash:*"
      policy: ask
    - match: "edit:**/.env"
      policy: deny
mcp:
  servers:
    - name: context7
      url: "https://context7.com/mcp"
  disabled_tools:
    context7: [tool_a]
plugins:
  dirs: ["~/.vesprism/plugins"]
flows:
  - demo-linear
"#;
        let parsed = parse_composition(yaml, "test").unwrap();
        assert_eq!(parsed.id.as_deref(), Some("coding"));
        assert_eq!(parsed.extends.as_deref(), Some("base"));
        assert_eq!(parsed.persona.label.as_deref(), Some("senior-engineer"));
        assert_eq!(parsed.persona.sections, vec!["回复使用中文"]);
        assert_eq!(parsed.model.name.as_deref(), Some("deepseek-chat"));
        assert_eq!(parsed.model.reasoning_effort.as_deref(), Some("medium"));
        assert_eq!(parsed.tools.disable, vec!["web_search"]);
        assert!(parsed.tools.overrides.is_some());
        assert_eq!(parsed.skills.scopes, vec!["local", "repo"]);
        assert_eq!(parsed.permissions.mode, PermissionMode::Ask);
        assert_eq!(parsed.permissions.rules.len(), 2);
        assert_eq!(parsed.mcp.servers.len(), 1);
        assert_eq!(
            parsed.mcp.disabled_tools.get("context7").unwrap(),
            &vec!["tool_a".to_string()]
        );
        assert_eq!(
            parsed.plugins.dirs,
            vec![PathBuf::from("~/.vesprism/plugins")]
        );
        assert_eq!(parsed.flows, vec!["demo-linear".to_string()]);
        parsed.validate().unwrap();
    }

    #[test]
    fn invalid_flow_id_fails_loud() {
        let parsed = parse_composition("flows: [Refund]\n", "test").unwrap();
        let err = parsed.validate().unwrap_err().to_string();
        assert!(err.contains("合法流程 id"), "err: {err}");
    }

    #[test]
    fn unknown_field_fails_loud() {
        let err = parse_composition("id: x\nnonesuch: true\n", "test").unwrap_err();
        let joined = err
            .chain()
            .map(|c| c.to_string())
            .collect::<Vec<_>>()
            .join(" | ");
        assert!(joined.contains("nonesuch"), "err: {joined}");
    }

    #[test]
    fn invalid_rule_matcher_fails_validation() {
        let parsed = parse_composition(
            "permissions:\n  rules:\n    - match: \"bad kind ::: x\"\n      policy: ask\n",
            "test",
        )
        .unwrap();
        let err = parsed.validate().unwrap_err();
        assert!(err.to_string().contains("权限规则无效"), "err: {err}");
    }

    #[test]
    fn merge_overlay_wins_for_present_fields_only() {
        let base = parse_composition(
            "id: base\npersona:\n  label: a\n  sections: [s1]\nmodel:\n  name: m1\n",
            "test",
        )
        .unwrap();
        let overlay = parse_composition("model:\n  reasoning_effort: low\n", "test").unwrap();
        let merged = merge_composition(&base, &overlay);
        // overlay 只写了 reasoning_effort：name 保留，label/sections 保留。
        assert_eq!(merged.model.name.as_deref(), Some("m1"));
        assert_eq!(merged.model.reasoning_effort.as_deref(), Some("low"));
        assert_eq!(merged.persona.label.as_deref(), Some("a"));
        assert_eq!(merged.persona.sections, vec!["s1"]);
    }

    #[test]
    fn merge_lists_replace_entirely() {
        let base = parse_composition("skills:\n  scopes: [local, repo]\n", "test").unwrap();
        let overlay = parse_composition("skills:\n  scopes: [user]\n", "test").unwrap();
        let merged = merge_composition(&base, &overlay);
        assert_eq!(merged.skills.scopes, vec!["user"]);
    }

    #[test]
    fn merge_mcp_disabled_tools_by_server_key() {
        let base = parse_composition(
            "mcp:\n  disabled_tools:\n    a: [t1]\n    b: [t2]\n",
            "test",
        )
        .unwrap();
        let overlay = parse_composition("mcp:\n  disabled_tools:\n    a: [t3]\n", "test").unwrap();
        let merged = merge_composition(&base, &overlay);
        assert_eq!(
            merged.mcp.disabled_tools.get("a").unwrap(),
            &vec!["t3".to_string()]
        );
        assert_eq!(
            merged.mcp.disabled_tools.get("b").unwrap(),
            &vec!["t2".to_string()]
        );
    }

    #[test]
    fn extends_cycle_is_rejected() {
        let tmp = std::env::temp_dir().join("grok-session-composition-cycle-test");
        let comps = tmp.join("compositions");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&comps).unwrap();
        std::fs::write(comps.join("a.yml"), "extends: b\n").unwrap();
        std::fs::write(comps.join("b.yml"), "extends: a\n").unwrap();
        let err = load_user_composition(&tmp, "a").unwrap_err();
        assert!(err.to_string().contains("继承过深"), "err: {err}");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn extends_merges_parent_then_child() {
        let tmp = std::env::temp_dir().join("grok-session-composition-extends-test");
        let comps = tmp.join("compositions");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&comps).unwrap();
        std::fs::write(
            comps.join("base.yml"),
            "persona:\n  label: base-label\n  sections: [s1]\n",
        )
        .unwrap();
        std::fs::write(
            comps.join("child.yml"),
            "extends: base\npersona:\n  sections: [s2]\nmodel:\n  name: m2\n",
        )
        .unwrap();
        let resolved = load_user_composition(&tmp, "child").unwrap();
        assert_eq!(resolved.persona.label.as_deref(), Some("base-label"));
        assert_eq!(resolved.persona.sections, vec!["s2"]);
        assert_eq!(resolved.model.name.as_deref(), Some("m2"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn resolve_workspace_and_session_layers() {
        let tmp = std::env::temp_dir().join("grok-session-composition-layers-test");
        let _ = std::fs::remove_dir_all(&tmp);
        let grok = tmp.join(".grok");
        std::fs::create_dir_all(&grok).unwrap();
        std::fs::write(grok.join("agent.yml"), "persona:\n  label: ws-label\n").unwrap();
        let session = parse_composition("model:\n  name: session-model\n", "test").unwrap();
        let resolved = resolve_composition(
            None,
            &tmp,
            Some(&session),
            Path::new("/nonexistent-user-root"),
        )
        .unwrap();
        assert_eq!(resolved.persona.label.as_deref(), Some("ws-label"));
        assert_eq!(resolved.model.name.as_deref(), Some("session-model"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn disable_official_names_only() {
        assert_eq!(
            canonicalize_tool_name("run_terminal_command").unwrap(),
            "run_terminal_command"
        );
        assert_eq!(canonicalize_tool_name("web_search").unwrap(), "web_search");
        assert!(canonicalize_tool_name("bash").is_err());
        assert!(canonicalize_tool_name("search").is_err());
        assert!(canonicalize_tool_name("nonesuch").is_err());
        let parsed = parse_composition("tools:\n  disable: [bash]\n", "t").unwrap();
        let err = format!("{:#}", parsed.validate().unwrap_err());
        assert!(
            err.contains("未知工具名") || err.contains("bash"),
            "err: {err}"
        );
    }
}
