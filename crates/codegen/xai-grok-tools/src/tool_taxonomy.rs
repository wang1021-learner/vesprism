//! 工具分类法（Tool Taxonomy）—— 独立于 Agent 宿主（Harness）的标准化工具词汇、身份标识与规范 `_meta` 信封。
//!
//! 本模块仅依赖 `ToolKind`/`ToolNamespace` 以及 `serde`/`serde_json`（不依赖 `ToolInput`、proto 或运行时）。
//! 未来的 `xai-tool-taxonomy` 独立 crate 可将这两个无依赖的 enum 迁移至此。
//! 与 `ToolInput` 绑定的标准化映射逻辑位于 [`crate::normalization`]。

use crate::types::tool::{ToolKind, ToolNamespace};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

/// 规范化输入字段名称 —— 所有 Agent 宿主统一遵循的标准参数词汇表。
/// 通过这些常量输出标准 key，以确保 Wire 协议规范的唯一性。
pub mod field {
    pub const PATH: &str = "path";
    pub const OFFSET: &str = "offset";
    pub const LIMIT: &str = "limit";
    pub const COMMAND: &str = "command";
    pub const DESCRIPTION: &str = "description";
    pub const CWD: &str = "cwd";
    pub const DIRECTORY: &str = "directory";
    pub const PATTERN: &str = "pattern";
}

/// 挂载标准工具身份信息的 `_meta` 键名（对齐 `x.ai/mcp_tool` 嵌套结构）。
/// 消费端可反序列化为 [`CanonicalToolMeta`]。
pub const TOOL_META_KEY: &str = "x.ai/tool";

/// 标准工具 `_meta` 协议的版本号。若 key 结构或类型发生破坏性变更，必须递增此版本。
pub const TOOL_META_VERSION: u32 = 1;

impl ToolKind {
    /// 语义分类统一的展示名称（独立于 Agent 宿主）。
    /// 作为 Kind 的纯函数，使得不同工具集中的同类工具共享相同展示名
    /// （如 `read_file` 和 `Read` → `"Read"`；`run_terminal_cmd` 和 `Shell` → `"Run Command"`）。
    /// 仅用于 UI 展示；模型感知到的真正工具名称由 `x.ai/tool` 中的 `name` 指定。
    /// 属于穷举映射，新增 `ToolKind` 时必须补充对应 label 方可编译。
    pub fn presentation_name(self) -> &'static str {
        match self {
            ToolKind::Read => "Read",
            ToolKind::Edit => "Edit",
            ToolKind::Delete => "Delete",
            ToolKind::Write => "Write",
            ToolKind::Move => "Move",
            ToolKind::ListDir => "List Files",
            ToolKind::List => "List Files",
            ToolKind::Search => "Search",
            ToolKind::Lsp => "Code Intelligence",
            ToolKind::Execute => "Run Command",
            ToolKind::Plan => "Plan",
            ToolKind::WebSearch => "Web Search",
            ToolKind::WebFetch => "Web Fetch",
            ToolKind::BackgroundTaskAction => "Background Task",
            ToolKind::WaitTasksAction => "Wait for Tasks",
            ToolKind::KillTaskAction => "Kill Task",
            ToolKind::Skill => "Skill",
            ToolKind::MemorySearch => "Memory Search",
            ToolKind::MemoryGet => "Memory Read",
            ToolKind::Task => "Subagent",
            ToolKind::EnterPlan => "Enter Plan Mode",
            ToolKind::ExitPlan => "Exit Plan Mode",
            ToolKind::AskUser => "Ask User",
            ToolKind::ImageGen => "Generate Image",
            ToolKind::VideoGen => "Generate Video",
            ToolKind::ImageToVideo => "Generate Video",
            ToolKind::ReferenceToVideo => "Generate Video",
            ToolKind::DeployApp => "Deploy App",
            ToolKind::SearchTool => "Search Tools",
            ToolKind::UseTool => "Use Tool",
            ToolKind::Monitor => "Monitor",
            ToolKind::GoalUpdate => "Update Goal",
            ToolKind::Workflow => "Workflow",
            ToolKind::Other => "Tool",
        }
    }

    /// 标识该工具分类默认是否为纯只读（无工作区或外部副作用）。
    /// 作为 `ToolMetadata::is_read_only` 的分类层默认实现，具体工具实现可单独重写覆盖。
    /// 属于穷举映射（无 `_` 通配符），强制新增分类时明确标注只读属性而非误判为写操作。
    pub fn is_read_only(self) -> bool {
        match self {
            ToolKind::Read
            | ToolKind::Search
            | ToolKind::Lsp
            | ToolKind::ListDir
            | ToolKind::List
            | ToolKind::MemorySearch
            | ToolKind::MemoryGet
            | ToolKind::WebSearch
            | ToolKind::WebFetch
            | ToolKind::EnterPlan
            | ToolKind::ExitPlan
            | ToolKind::AskUser => true,
            ToolKind::Edit
            | ToolKind::Delete
            | ToolKind::Write
            | ToolKind::Move
            | ToolKind::Execute
            | ToolKind::Plan
            | ToolKind::BackgroundTaskAction
            | ToolKind::WaitTasksAction
            | ToolKind::KillTaskAction
            | ToolKind::Skill
            | ToolKind::Task
            | ToolKind::ImageGen
            | ToolKind::VideoGen
            | ToolKind::ImageToVideo
            | ToolKind::ReferenceToVideo
            | ToolKind::DeployApp
            | ToolKind::SearchTool
            | ToolKind::UseTool
            | ToolKind::Monitor
            | ToolKind::GoalUpdate
            | ToolKind::Workflow
            | ToolKind::Other => false,
        }
    }
}

impl schemars::JsonSchema for ToolKind {
    fn schema_name() -> Cow<'static, str> {
        "ToolKind".into()
    }

    fn json_schema(_generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        use strum::IntoEnumIterator;
        let known = Self::iter()
            .filter_map(|k| serde_json::to_value(k).ok())
            .filter_map(|v| v.as_str().map(|s| format!("`{s}`")))
            .collect::<Vec<_>>()
            .join(", ");
        schemars::json_schema!({
            "type": "string",
            "description": format!(
                "Categorizes what a tool does at a high level. Open set — consumers must \
                 tolerate unknown values (Rust deserializes them to `other` via \
                 `#[serde(other)]`). Known values: {known}."
            ),
        })
    }
}

/// 工具调用的标准身份元数据，由工具已注册的元数据通过客户端 Wire 名称解析得出。
///
/// 独立于 Agent 宿主。`tool_kind` 即为权威的 `metadata.kind()`。
#[derive(Debug, Clone, Copy)]
pub struct ToolIdentity {
    pub tool_kind: ToolKind,
    pub namespace: ToolNamespace,
    pub presentation_name: &'static str,
    pub read_only: bool,
}

/// 标准工具身份信封，作为嵌套对象挂载在工具调用事件 `_meta` 的 [`TOOL_META_KEY`] 之下。
///
/// ```json
/// "x.ai/tool": {
///   "version": 1,
///   "name": "read_file",
///   "kind": "read",
///   "namespace": "grok_build",
///   "label": "Read",
///   "read_only": true,
///   "input": { "path": "..." }
/// }
/// ```
///
/// 消费端契约规范：
/// - **`label`**: 跨宿主的通用分组/展示键，功能等价的工具共享此键（如 grok `read_file` → `"Read"`）。
/// - **`kind`**: 更精细的分类标示（`metadata.kind()`），在不同宿主间可能不完全相同（如列目录在一套工具集中为 `list`，在另一套中为 `list_dir`）；建议优先按 `label` 归并，并容忍未知的 kind。
/// - **`name`**: 模型感知的宿主特定工具名称，用于诊断分析。对于宿主主动发起的事件（如 `bash_mode` 标记），`raw_input` 不保证与 `name` 的 schema 完全匹配。
/// - **`input`**: 标准化参数映射（非完整镜像）：仅包含跨宿主通用键，故意过滤了宿主特定参数（如 grep 标志、`replace_all`）以及大体积载荷（如编辑操作的 `old_string`/`new_string` 或文件写入的完整内容）——如需完整载荷请读取 `raw_input`。在无固定格式时（如 MCP / 动态工具 / 范围外工具）该字段会被直接省略。当缺失部分字段或整个字典时，可降级从同一 `tool_call_id` 的当前或历史更新中的 `raw_input` 提取。
/// - **生命周期**: 同一次调用的多次更新共享 `tool_call_id` —— 采用合并覆盖策略（最后写入优先）；`input` 可能会在后续更新中延迟到达。
/// - **版本兼容**: 增量变更（新增字段、新增 `kind` / `label` 值）不会递增 `version`。未知的 `kind` 自动降级为 `"other"`；`namespace` 为封闭枚举（无 `other` 兜底），以显式触发严格类型的反序列化更新。非 Rust 消费端建议将 `namespace` 作为普通字符串处理，当 `x.ai/tool` 解析失败时降级回 `raw_input` 及 ACP `kind`。`version` 仅在字段移除或语义变更时递增。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct CanonicalToolMeta {
    pub version: u32,
    pub name: String,
    pub kind: ToolKind,
    pub namespace: ToolNamespace,
    pub label: Cow<'static, str>,
    pub read_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
}

impl CanonicalToolMeta {
    /// 根据解析后的身份信息与已投影的 `input` 构造标准元数据。
    /// 不依赖 `ToolInput`，保持本类型为叶子节点（参数映射投影在 `normalization` 模块中实现）。
    pub fn new(
        name: impl Into<String>,
        identity: &ToolIdentity,
        input: Option<serde_json::Value>,
    ) -> Self {
        Self {
            version: TOOL_META_VERSION,
            name: name.into(),
            kind: identity.tool_kind,
            namespace: identity.namespace,
            label: Cow::Borrowed(identity.presentation_name),
            read_only: identity.read_only,
            input,
        }
    }

    /// 挂载至 [`TOOL_META_KEY`] 下，同时保留已存在的 `_meta` 属性（如 `bash_mode`、`backend`、`x.ai/mcp_tool` 等）。
    pub fn merge_into(&self, existing: Option<serde_json::Value>) -> serde_json::Value {
        debug_assert!(
            matches!(existing, None | Some(serde_json::Value::Object(_))),
            "_meta is always absent or an object"
        );
        let mut map = match existing {
            Some(serde_json::Value::Object(m)) => m,
            Some(other) => return other,
            None => serde_json::Map::new(),
        };
        let value = serde_json::to_value(self).expect("CanonicalToolMeta serializes");
        map.insert(TOOL_META_KEY.to_string(), value);
        serde_json::Value::Object(map)
    }
}

/// 已发布的 [`CanonicalToolMeta`] Wire 信封 JSON Schema (draft-07)（来自 `schema/tool_meta.schema.json`）。
/// 非 Rust 消费端据此生成代码；通过测试 `tool_meta_schema_is_up_to_date` 保持与 Rust 类型定义同步。
pub fn tool_meta_json_schema_str() -> &'static str {
    include_str!("../schema/tool_meta.schema.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(kind: ToolKind) -> ToolIdentity {
        ToolIdentity {
            tool_kind: kind,
            namespace: ToolNamespace::GrokBuild,
            presentation_name: kind.presentation_name(),
            read_only: kind.is_read_only(),
        }
    }

    #[test]
    fn is_read_only_classifies_kinds() {
        assert!(ToolKind::Read.is_read_only());
        assert!(ToolKind::Search.is_read_only());
        assert!(ToolKind::List.is_read_only());
        assert!(!ToolKind::Edit.is_read_only());
        assert!(!ToolKind::Execute.is_read_only());
        assert!(!ToolKind::Delete.is_read_only());
    }

    #[test]
    fn namespace_round_trips_snake_case_with_pascal_aliases() {
        use strum::IntoEnumIterator;

        fn wire_and_pascal(ns: ToolNamespace) -> (&'static str, &'static str) {
            match ns {
                ToolNamespace::GrokBuild => ("grok_build", "GrokBuild"),
                ToolNamespace::GrokBuildConcise => ("grok_build_concise", "GrokBuildConcise"),
                ToolNamespace::GrokBuildHashline => ("grok_build_hashline", "GrokBuildHashline"),
                ToolNamespace::Codex => ("codex", "Codex"),
                ToolNamespace::OpenCode => ("opencode", "OpenCode"),
                ToolNamespace::MCP => ("mcp", "MCP"),
            }
        }

        for ns in ToolNamespace::iter() {
            let (snake, pascal) = wire_and_pascal(ns);
            assert_eq!(serde_json::to_value(ns).unwrap(), serde_json::json!(snake));
            assert_eq!(
                serde_json::from_value::<ToolNamespace>(serde_json::json!(snake)).unwrap(),
                ns
            );
            assert_eq!(
                serde_json::from_value::<ToolNamespace>(serde_json::json!(pascal)).unwrap(),
                ns
            );
        }
    }

    #[test]
    fn unknown_kind_degrades_to_other() {
        let k: ToolKind = serde_json::from_value(serde_json::json!("teleport")).unwrap();
        assert_eq!(k, ToolKind::Other);
    }

    /// 已发布的 `kind` schema 必须保持为开放字符串（否则基于代码生成的消费端在遇到新 kind 时会直接硬报错，破坏 `#[serde(other)]` 契约）。
    /// `namespace` 则故意保持为封闭枚举 —— 参见 [`CanonicalToolMeta`] 的版本兼容契约。
    #[test]
    fn kind_schema_is_open_string_namespace_stays_closed() {
        let kind = serde_json::to_value(schemars::schema_for!(ToolKind)).unwrap();
        assert_eq!(kind["type"], "string");
        assert!(kind.get("enum").is_none(), "kind must not be a closed enum");
        assert!(
            kind["description"].as_str().unwrap().contains("`read`"),
            "known values must be listed in the description"
        );
        let ns = serde_json::to_value(schemars::schema_for!(ToolNamespace)).unwrap();
        assert!(ns.get("enum").is_some(), "namespace is a closed enum");
    }

    #[test]
    fn canonical_meta_wire_shape_round_trips() {
        let meta = CanonicalToolMeta::new(
            "read_file",
            &identity(ToolKind::Read),
            Some(serde_json::json!({ "path": "/a" })),
        );
        let t = serde_json::to_value(&meta).unwrap();
        assert_eq!(t["version"], serde_json::json!(TOOL_META_VERSION));
        assert_eq!(t["name"], "read_file");
        assert_eq!(t["kind"], "read");
        assert_eq!(t["namespace"], "grok_build");
        assert_eq!(t["label"], "Read");
        assert_eq!(t["read_only"], true);
        assert_eq!(t["input"]["path"], "/a");
        assert_eq!(
            serde_json::from_value::<CanonicalToolMeta>(t).unwrap(),
            meta
        );
    }

    /// 已提交的 schema（非 Rust 消费端代码生成的产物）必须与 Rust 类型保持一致。
    /// 可通过 `UPDATE_TOOL_META_SCHEMA=1` 重新生成。
    #[test]
    fn tool_meta_schema_is_up_to_date() {
        let generator = schemars::generate::SchemaSettings::draft07().into_generator();
        let schema = serde_json::to_value(generator.into_root_schema_for::<CanonicalToolMeta>())
            .expect("schema serializes");
        let generated = format!("{}\n", serde_json::to_string_pretty(&schema).unwrap());
        if std::env::var("UPDATE_TOOL_META_SCHEMA").is_ok() {
            std::fs::write(
                concat!(env!("CARGO_MANIFEST_DIR"), "/schema/tool_meta.schema.json"),
                &generated,
            )
            .unwrap();
            return;
        }
        let mut expected: serde_json::Value =
            serde_json::from_str(tool_meta_json_schema_str()).expect("checked-in schema parses");
        if let Some(values) = expected["definitions"]["ToolNamespace"]["enum"].as_array_mut() {
            use std::collections::HashSet;
            use strum::IntoEnumIterator;
            let compiled: HashSet<String> = ToolNamespace::iter()
                .filter_map(|ns| {
                    serde_json::to_value(ns)
                        .ok()
                        .and_then(|v| v.as_str().map(str::to_owned))
                })
                .collect();
            values.retain(|v| matches!(v.as_str(), Some(s) if compiled.contains(s)));
        }
        let expected = format!("{}\n", serde_json::to_string_pretty(&expected).unwrap());
        assert_eq!(
            generated, expected,
            "tool_meta.schema.json is stale; regenerate with UPDATE_TOOL_META_SCHEMA=1"
        );
    }

    #[test]
    fn merge_into_nests_under_one_key_and_preserves_existing() {
        let meta = CanonicalToolMeta::new("run_terminal_cmd", &identity(ToolKind::Execute), None);
        let merged = meta.merge_into(Some(serde_json::json!({"bash_mode": true})));
        let o = merged.as_object().unwrap();
        assert_eq!(o["bash_mode"], true, "existing meta must be preserved");
        let t = &o[TOOL_META_KEY];
        assert_eq!(t["kind"], "execute");
        assert!(t.get("input").is_none(), "absent input omitted");
    }
}
