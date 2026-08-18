//! 权限规则引擎：组装单 `permissions.rules` 的评估器（桌面侧细粒度策略）。
//!
//! 官方 `[permission] rules` 仅全局/项目级；组装单需要**按会话**的细粒度规则，
//! 因此在 `request_permission` 转发前端审批条之前评估本引擎：
//!
//! - 规则命中且 policy 为 deny/allow_once/allow_always → 直接回官方 outcome；
//! - 规则命中且 policy 为 ask，或没有命中 → 转发前端审批条（`ForwardToUi`）。
//!
//! 规则语法：`match: "<kind>:<glob>"`，`kind` 采用官方 ToolFilter 词汇
//! （any/bash/edit/read/grep/mcp/web_fetch）或一个具体工具名；省略 `kind:`
//! 时 glob 直接匹配工具名。glob 支持 `*`（段内）、`**`（跨 `/`）、`?`。
//! `*` 不跨 `/`：匹配任意路径后缀用 `**/`。
//!
//! 动作词汇对齐官方 `RequestPermissionOutcome`：ask / deny / allow_once /
//! allow_always（官方还有 command/domain/mcp 级 always 选项，后续按需扩展）。

use std::collections::HashMap;

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// 词汇
// ---------------------------------------------------------------------------

/// 权限模式：映射官方 `_meta.yoloMode/autoMode`（按会话）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionMode {
    /// 询问（默认官方审批流）。
    #[default]
    Ask,
    /// 官方 yolo 模式（自动放行）。
    Yolo,
    /// 官方 auto 模式（LLM 分类器）。
    Auto,
}

/// 规则动作，对齐官方 `RequestPermissionOutcome` 词汇。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Policy {
    /// 转发前端审批条。
    Ask,
    /// 直接拒绝（reject-once）。
    Deny,
    /// 本次放行（allow-once）。
    AllowOnce,
    /// 会话内总是放行（allow-always）。
    AllowAlways,
}

/// 一条权限规则。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionRule {
    /// 匹配表达式：`"<kind>:<glob>"` 或 `"<glob>"`（见模块文档）。
    #[serde(rename = "match")]
    pub matcher: String,
    pub policy: Policy,
}

impl PermissionRule {
    /// 装配前校验：语法必须可解析。
    pub fn validate(&self) -> Result<()> {
        RuleMatcher::parse(&self.matcher).map(|_| ())
    }
}

// ---------------------------------------------------------------------------
// 工具分类（官方 ToolFilter 词汇映射）
// ---------------------------------------------------------------------------

/// 工具类别：官方 ToolFilter 词汇 + ACP ToolKind 类别词（+ 具体工具名同义词）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolKind {
    Any,
    Bash,
    Edit,
    Read,
    Grep,
    Mcp,
    WebFetch,
    Delete,
    Move,
    Tool(String),
}

impl ToolKind {
    fn parse(word: &str) -> Result<Self> {
        Ok(match word {
            "any" => ToolKind::Any,
            "bash" => ToolKind::Bash,
            "edit" => ToolKind::Edit,
            "read" => ToolKind::Read,
            "grep" => ToolKind::Grep,
            "mcp" => ToolKind::Mcp,
            "web_fetch" => ToolKind::WebFetch,
            "delete" => ToolKind::Delete,
            "move" => ToolKind::Move,
            other => {
                if other.is_empty() {
                    bail!("kind 不能为空");
                }
                if other.chars().any(char::is_whitespace) {
                    bail!("工具名不能含空白：{other:?}");
                }
                ToolKind::Tool(other.to_string())
            }
        })
    }
}

/// 把「工具名或 ACP 类别词」归入类别。
///
/// 权限请求的线格式只带 ACP `ToolKind` 类别（execute/read/edit/…），不带
/// 具体工具名；本函数同时接受两类词汇，让规则作者可以写 `edit:**/.env`
/// 或 `execute:git push*`。
pub fn classify_tool(tool_name: &str) -> ToolKind {
    match tool_name {
        // ACP 类别词 + 官方工具名同义词。
        "execute" | "bash" | "shell" | "run_terminal_command" | "run_terminal_cmd" => {
            ToolKind::Bash
        }
        "edit" | "write" | "search_replace" | "multi_edit" | "apply_patch" => ToolKind::Edit,
        "read" | "view" | "read_file" | "cursor_read" => ToolKind::Read,
        "search" | "grep" | "glob" | "search_content" | "search_file" => ToolKind::Grep,
        "fetch" | "web_fetch" | "web_search" | "search_web" => ToolKind::WebFetch,
        "delete" | "remove" => ToolKind::Delete,
        "move" | "rename" => ToolKind::Move,
        "mcp" => ToolKind::Mcp,
        _ if tool_name.starts_with("mcp__") => ToolKind::Mcp,
        _ => ToolKind::Tool(tool_name.to_string()),
    }
}

// ---------------------------------------------------------------------------
// glob 匹配
// ---------------------------------------------------------------------------

/// `*`（段内）/ `**`（跨 `/`）/ `?` 的路径 glob。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobPattern {
    raw: String,
}

impl GlobPattern {
    pub fn parse(raw: &str) -> Result<Self> {
        if raw.trim().is_empty() {
            bail!("glob 不能为空");
        }
        Ok(Self {
            raw: raw.to_string(),
        })
    }

    /// `*` 不跨 `/`；`**` 跨任意深度（含零段）。
    pub fn matches(&self, text: &str) -> bool {
        let p: Vec<char> = self.raw.chars().collect();
        let t: Vec<char> = text.chars().collect();
        let mut memo: HashMap<(usize, usize), bool> = HashMap::new();
        glob_match(&p, 0, &t, 0, &mut memo)
    }
}

fn glob_match(
    p: &[char],
    mut i: usize,
    t: &[char],
    mut j: usize,
    memo: &mut HashMap<(usize, usize), bool>,
) -> bool {
    if let Some(&hit) = memo.get(&(i, j)) {
        return hit;
    }
    while i < p.len() {
        match p[i] {
            '?' => {
                if j >= t.len() {
                    memo.insert((i, j), false);
                    return false;
                }
                i += 1;
                j += 1;
            }
            '*' => {
                // `**`：跨任意深度（含 `/`）。
                if i + 1 < p.len() && p[i + 1] == '*' {
                    // `**/` 支持零目录语义：跳过 `**/` 整体直接匹配剩余。
                    if i + 2 < p.len() && p[i + 2] == '/' && glob_match(p, i + 3, t, j, memo) {
                        memo.insert((i, j), true);
                        return true;
                    }
                    for k in j..=t.len() {
                        if glob_match(p, i + 2, t, k, memo) {
                            memo.insert((i, j), true);
                            return true;
                        }
                    }
                    memo.insert((i, j), false);
                    return false;
                }
                // `*`：段内任意字符，不跨 `/`。
                let mut k = j;
                loop {
                    if glob_match(p, i + 1, t, k, memo) {
                        memo.insert((i, j), true);
                        return true;
                    }
                    if k >= t.len() || t[k] == '/' {
                        break;
                    }
                    k += 1;
                }
                memo.insert((i, j), false);
                return false;
            }
            c => {
                if j >= t.len() || t[j] != c {
                    memo.insert((i, j), false);
                    return false;
                }
                i += 1;
                j += 1;
            }
        }
    }
    let hit = j == t.len();
    memo.insert((i, j), hit);
    hit
}

// ---------------------------------------------------------------------------
// 规则匹配
// ---------------------------------------------------------------------------

/// 一条已编译的匹配表达式：`<kind>:<glob>` 或 `<glob>`（省略 kind 时匹配工具名）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleMatcher {
    kind: ToolKind,
    pattern: GlobPattern,
}

impl RuleMatcher {
    pub fn parse(expr: &str) -> Result<Self> {
        let expr = expr.trim();
        if expr.is_empty() {
            bail!("匹配表达式不能为空");
        }
        let (kind, pattern) = match expr.split_once(':') {
            Some((left, right)) => (ToolKind::parse(left.trim())?, GlobPattern::parse(right)?),
            None => (ToolKind::Any, GlobPattern::parse(expr)?),
        };
        Ok(Self { kind, pattern })
    }

    /// 工具类别与 glob 都命中才算命中。省略 kind 的规则对工具名做 glob；
    /// 带 kind 的规则对 `detail`（命令/路径摘要）做 glob，detail 为空时
    /// 只有 `*` 这类全通配能命中。
    pub fn matches(&self, tool_name: &str, detail: &str) -> bool {
        let kind_hit = match &self.kind {
            ToolKind::Any => true,
            other => classify_tool(tool_name) == *other,
        };
        if !kind_hit {
            return false;
        }
        let target = if matches!(self.kind, ToolKind::Any) {
            tool_name
        } else {
            detail
        };
        self.pattern.matches(target)
    }
}

// ---------------------------------------------------------------------------
// 引擎
// ---------------------------------------------------------------------------

/// 评估结果：转发前端，或直接应答官方 outcome。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyDecision {
    /// 转发前端审批条（规则未命中或规则要求 ask）。
    ForwardToUi,
    /// 直接应答（deny / allow_once / allow_always）。
    Respond(Policy),
}

/// 权限策略引擎：规则按序评估，**首条命中生效**。
#[derive(Debug, Clone, Default)]
pub struct PolicyEngine {
    pub mode: PermissionMode,
    pub rules: Vec<PermissionRule>,
}

impl PolicyEngine {
    pub fn new(mode: PermissionMode, rules: Vec<PermissionRule>) -> Self {
        Self { mode, rules }
    }

    /// 评估一次权限请求。`detail` 为工具调用摘要（命令或路径）。
    pub fn evaluate(&self, tool_name: &str, detail: &str) -> PolicyDecision {
        self.evaluate_filtered(tool_name, detail, |_| true)
    }

    /// 是否有命中的 deny 规则（须排在只读/子会话自动放行之前）。
    pub fn has_deny(&self, tool_name: &str, detail: &str) -> bool {
        matches!(
            self.evaluate_filtered(tool_name, detail, |p| *p == Policy::Deny),
            PolicyDecision::Respond(Policy::Deny)
        )
    }

    /// 评估非 deny 规则（deny 已在短路之前处理）。
    pub fn evaluate_non_deny(&self, tool_name: &str, detail: &str) -> PolicyDecision {
        self.evaluate_filtered(tool_name, detail, |p| *p != Policy::Deny)
    }

    fn evaluate_filtered(
        &self,
        tool_name: &str,
        detail: &str,
        keep: impl Fn(&Policy) -> bool,
    ) -> PolicyDecision {
        for rule in &self.rules {
            if !keep(&rule.policy) {
                continue;
            }
            let Ok(matcher) = RuleMatcher::parse(&rule.matcher) else {
                continue;
            };
            if matcher.matches(tool_name, detail) {
                return match rule.policy {
                    Policy::Ask => PolicyDecision::ForwardToUi,
                    policy => PolicyDecision::Respond(policy),
                };
            }
        }
        PolicyDecision::ForwardToUi
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_tool_maps_official_filter_vocabulary() {
        assert_eq!(classify_tool("execute"), ToolKind::Bash);
        assert_eq!(classify_tool("run_terminal_command"), ToolKind::Bash);
        assert_eq!(classify_tool("search_replace"), ToolKind::Edit);
        assert_eq!(classify_tool("read_file"), ToolKind::Read);
        assert_eq!(classify_tool("grep"), ToolKind::Grep);
        assert_eq!(classify_tool("mcp__foo__bar"), ToolKind::Mcp);
        assert_eq!(classify_tool("web_search"), ToolKind::WebFetch);
        assert_eq!(
            classify_tool("todo_write"),
            ToolKind::Tool("todo_write".to_string())
        );
    }

    #[test]
    fn glob_star_stays_in_segment_and_dstar_crosses() {
        let g = GlobPattern::parse("*.env").unwrap();
        assert!(g.matches("a.env"));
        assert!(!g.matches("dir/a.env"));

        let g = GlobPattern::parse("**/.env").unwrap();
        assert!(g.matches(".env"));
        assert!(g.matches("a/.env"));
        assert!(g.matches("a/b/c/.env"));

        let g = GlobPattern::parse("src/?.rs").unwrap();
        assert!(g.matches("src/a.rs"));
        assert!(!g.matches("src/ab.rs"));
    }

    #[test]
    fn kind_colon_glob_matches_detail() {
        let m = RuleMatcher::parse("edit:**/.env").unwrap();
        assert!(m.matches("search_replace", "config/deep/.env"));
        assert!(!m.matches("search_replace", "src/main.rs"));
        // 类别不命中：bash 工具不走 edit 规则。
        assert!(!m.matches("run_terminal_command", "config/.env"));
    }

    #[test]
    fn no_kind_rule_matches_tool_name() {
        let m = RuleMatcher::parse("web_*").unwrap();
        assert!(m.matches("web_search", ""));
        assert!(m.matches("web_fetch", "https://x"));
        assert!(!m.matches("grep", ""));
    }

    #[test]
    fn parse_rejects_bad_exprs() {
        assert!(RuleMatcher::parse("").is_err());
        assert!(RuleMatcher::parse("  ").is_err());
        assert!(RuleMatcher::parse("bash:").is_err()); // 空 glob
        assert!(RuleMatcher::parse(":x").is_err()); // 空 kind
    }

    #[test]
    fn engine_first_match_wins() {
        let engine = PolicyEngine::new(
            PermissionMode::Ask,
            vec![
                PermissionRule {
                    matcher: "edit:**/.env".to_string(),
                    policy: Policy::Deny,
                },
                PermissionRule {
                    matcher: "edit:**".to_string(),
                    policy: Policy::AllowOnce,
                },
            ],
        );
        assert_eq!(
            engine.evaluate("search_replace", "a/.env"),
            PolicyDecision::Respond(Policy::Deny)
        );
        assert_eq!(
            engine.evaluate("search_replace", "a/main.rs"),
            PolicyDecision::Respond(Policy::AllowOnce)
        );
    }

    #[test]
    fn engine_ask_rule_and_no_match_forward_to_ui() {
        let engine = PolicyEngine::new(
            PermissionMode::Ask,
            vec![PermissionRule {
                matcher: "bash:git push*".to_string(),
                policy: Policy::Ask,
            }],
        );
        assert_eq!(
            engine.evaluate("run_terminal_command", "git push origin main"),
            PolicyDecision::ForwardToUi
        );
        assert_eq!(
            engine.evaluate("run_terminal_command", "cargo build"),
            PolicyDecision::ForwardToUi
        );
    }

    #[test]
    fn empty_detail_only_matches_catchall() {
        let m = RuleMatcher::parse("bash:*").unwrap();
        assert!(m.matches("run_terminal_command", ""));
        let m = RuleMatcher::parse("bash:git*").unwrap();
        assert!(!m.matches("run_terminal_command", ""));
    }

    #[test]
    fn acp_execute_hits_bash_rule() {
        let engine = PolicyEngine::new(
            PermissionMode::Ask,
            vec![PermissionRule {
                matcher: "bash:git push*".to_string(),
                policy: Policy::Deny,
            }],
        );
        assert!(engine.has_deny("execute", "git push origin main"));
        assert!(!engine.has_deny("execute", "cargo build"));
    }

    #[test]
    fn permission_mode_serde_round_trips() {
        assert_eq!(
            serde_yaml::from_str::<PermissionMode>("yolo").unwrap(),
            PermissionMode::Yolo
        );
        assert_eq!(
            serde_yaml::from_str::<PermissionMode>("auto").unwrap(),
            PermissionMode::Auto
        );
        assert_eq!(
            serde_yaml::from_str::<PermissionMode>("ask").unwrap(),
            PermissionMode::Ask
        );
    }
}
