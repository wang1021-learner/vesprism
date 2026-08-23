//! 会话级流程挂载：`_meta["x.ai/flows"]` → `flow__<id>` 工具名。
//!
//! 只负责解析、命名、契约校验。真正跑 Rhai 走现有 workflow manager。

use std::path::Path;

use serde_json::Value;

use super::workflow::registry::{MountContractError, WorkflowRegistry};

// jike: 流程即工具。加法键，旧客户端忽略。工具名前缀防和 MCP 撞名。

pub(crate) const FLOWS_META_KEY: &str = "x.ai/flows";
pub(crate) const FLOW_TOOL_PREFIX: &str = "flow__";
pub(crate) const FLOW_DEFAULT_AGENT_BUDGET: u64 = 8;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub(crate) enum FlowMountError {
    #[error("{0}")]
    InvalidMeta(String),
    #[error("unknown flow id '{0}'")]
    Unknown(String),
    #[error("flow '{0}' is not mountable (need a valid .flow.yaml contract)")]
    NotMountable(String),
    #[error("flow '{id}' contract is invalid: {detail}")]
    InvalidContract { id: String, detail: String },
    #[error("flow '{id}' is missing dependencies: {missing}")]
    MissingDependencies { id: String, missing: String },
    #[error("flow tool name '{0}' collides with an existing tool")]
    NameCollision(String),
}

/// 解析 `_meta["x.ai/flows"]`。
/// `Ok(None)` = 键不存在（热更新时保持原值）；`Ok(Some(ids))` = 覆盖（空数组=卸掉全部）。
pub(crate) fn parse_flows_meta(
    meta: Option<&Value>,
) -> Result<Option<Vec<String>>, FlowMountError> {
    let Some(meta) = meta.and_then(|v| v.as_object()) else {
        return Ok(None);
    };
    let Some(raw) = meta.get(FLOWS_META_KEY) else {
        return Ok(None);
    };
    if raw.is_null() {
        return Ok(Some(Vec::new()));
    }
    let Some(arr) = raw.as_array() else {
        return Err(FlowMountError::InvalidMeta(
            "`x.ai/flows` must be an array of flow ids".into(),
        ));
    };
    let mut ids = Vec::with_capacity(arr.len());
    for (i, item) in arr.iter().enumerate() {
        let Some(s) = item.as_str().map(str::trim).filter(|s| !s.is_empty()) else {
            return Err(FlowMountError::InvalidMeta(format!(
                "`x.ai/flows[{i}]` must be a non-empty string"
            )));
        };
        if !xai_workflow::is_valid_workflow_name(s) {
            return Err(FlowMountError::InvalidMeta(format!(
                "`x.ai/flows[{i}]` is not a valid flow id: {s}"
            )));
        }
        if !ids.iter().any(|e| e == s) {
            ids.push(s.to_string());
        }
    }
    Ok(Some(ids))
}

pub(crate) fn flow_tool_name(id: &str) -> String {
    format!("{FLOW_TOOL_PREFIX}{id}")
}

pub(crate) fn flow_id_from_tool_name(name: &str) -> Option<&str> {
    name.strip_prefix(FLOW_TOOL_PREFIX)
        .filter(|id| !id.is_empty() && xai_workflow::is_valid_workflow_name(id))
}

pub(crate) fn assert_no_tool_collision(
    id: &str,
    existing: &[String],
) -> Result<(), FlowMountError> {
    let name = flow_tool_name(id);
    if existing.iter().any(|n| n == &name || n == id) {
        return Err(FlowMountError::NameCollision(name));
    }
    Ok(())
}

/// 校验每个 id 都有可挂载契约。失败信息按条列出。
pub(crate) fn resolve_mountable_ids(
    cwd: &Path,
    ids: &[String],
) -> Result<Vec<xai_workflow::FlowContract>, FlowMountError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let registry = WorkflowRegistry::scan(Some(cwd));
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        match registry.mountable_contract(id) {
            Ok(c) => out.push(c.clone()),
            Err(MountContractError::Resolve(_)) => return Err(FlowMountError::Unknown(id.clone())),
            Err(MountContractError::NotMountable { .. }) => {
                return Err(FlowMountError::NotMountable(id.clone()));
            }
            Err(MountContractError::InvalidContract(detail)) => {
                return Err(FlowMountError::InvalidContract {
                    id: id.clone(),
                    detail,
                });
            }
            Err(MountContractError::MissingDependencies { missing, .. }) => {
                return Err(FlowMountError::MissingDependencies {
                    id: id.clone(),
                    missing: missing.join(", "),
                });
            }
        }
    }
    Ok(out)
}

pub(crate) async fn run_flow_tool(
    cwd: &str,
    manager: std::sync::Arc<tokio::sync::Mutex<crate::session::workflow::manager::WorkflowManager>>,
    mounted: &[String],
    inflight: std::sync::Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    id: &str,
    args: Value,
) -> Result<xai_grok_tools::types::output::ToolRunResult, xai_tool_runtime::ToolError> {
    if let Err(e) = preflight_flow_tool(mounted, &inflight, id) {
        return Err(e);
    }
    let finish = || {
        inflight
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
    };
    let cwd_path = Path::new(cwd);
    let registry = WorkflowRegistry::scan(Some(cwd_path));
    let contract = match registry.mountable_contract(id) {
        Ok(c) => c.clone(),
        Err(e) => {
            finish();
            return Err(xai_tool_runtime::ToolError::custom(
                "flow_not_mountable",
                e.to_string(),
            ));
        }
    };
    let resolved = match registry.resolve_by_name(id) {
        Ok(r) => r,
        Err(e) => {
            finish();
            return Err(xai_tool_runtime::ToolError::custom(
                "flow_unresolved",
                e.to_string(),
            ));
        }
    };
    let spec = crate::session::workflow::manager::LaunchSpec {
        objective: contract.description.clone(),
        args,
        agent_budget: Some(FLOW_DEFAULT_AGENT_BUDGET),
        effort: None,
        resume_run_id: None,
    };
    let launched = manager.lock().await.launch(resolved, spec);
    let outcome = match launched {
        Ok((_run_id, rx)) => rx.await.unwrap_or(xai_workflow::WorkflowOutcome::Failed {
            error: "workflow outcome channel closed".into(),
        }),
        Err(e) => {
            finish();
            return Err(xai_tool_runtime::ToolError::custom(
                "flow_launch_failed",
                e.to_string(),
            ));
        }
    };
    finish();
    match outcome {
        xai_workflow::WorkflowOutcome::Completed { result } => {
            if let Err(e) = validate_flow_result(&contract, &result) {
                return Err(xai_tool_runtime::ToolError::custom(
                    "flow_output_schema",
                    format!("{}: {e}", flow_tool_name(id)),
                ));
            }
            let prompt_text = serde_json::to_string_pretty(&result).unwrap_or_default();
            Ok(xai_grok_tools::types::output::ToolRunResult {
                output: xai_grok_tools::types::output::ToolOutput::Dynamic(result.into()),
                prompt_text,
                effective_tool_name: None,
            })
        }
        xai_workflow::WorkflowOutcome::Paused { kind, message } => {
            Err(xai_tool_runtime::ToolError::custom(
                "flow_paused",
                format!("v1 mounted flows cannot pause ({kind:?}): {message}"),
            ))
        }
        xai_workflow::WorkflowOutcome::BudgetExceeded { message } => {
            Err(xai_tool_runtime::ToolError::custom("flow_budget", message))
        }
        xai_workflow::WorkflowOutcome::Cancelled => Err(xai_tool_runtime::ToolError::custom(
            "flow_cancelled",
            format!("flow '{id}' was cancelled"),
        )),
        xai_workflow::WorkflowOutcome::Failed { error } => {
            Err(xai_tool_runtime::ToolError::custom("flow_failed", error))
        }
    }
}

pub(crate) fn preflight_flow_tool(
    mounted: &[String],
    inflight: &std::sync::Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    id: &str,
) -> Result<(), xai_tool_runtime::ToolError> {
    if !mounted.iter().any(|x| x == id) {
        return Err(xai_tool_runtime::ToolError::custom(
            "flow_not_mounted",
            format!("flow '{id}' is not mounted on this session"),
        ));
    }
    let mut guard = inflight.lock().unwrap_or_else(|e| e.into_inner());
    if !guard.insert(id.to_string()) {
        return Err(xai_tool_runtime::ToolError::custom(
            "flow_reentrant",
            format!("flow '{id}' is already running on this session"),
        ));
    }
    Ok(())
}

pub(crate) fn validate_flow_result(
    contract: &xai_workflow::FlowContract,
    result: &Value,
) -> Result<(), String> {
    crate::session::workflow::schema_contract::compile_contract_schema(&contract.output_schema)
        .and_then(|v| {
            v.validate(result)
                .map_err(|err| format!("output does not match output_schema: {err}"))
        })
}

pub(crate) fn flow_tool_definition(
    contract: &xai_workflow::FlowContract,
) -> xai_grok_tools::types::definition::ToolDefinition {
    xai_grok_tools::types::definition::ToolDefinition::function(
        flow_tool_name(&contract.id),
        Some(contract.description.clone()),
        contract.input_schema.clone(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_absent_is_none() {
        assert_eq!(parse_flows_meta(None).unwrap(), None);
        assert_eq!(parse_flows_meta(Some(&json!({"other": 1}))).unwrap(), None);
    }

    #[test]
    fn parse_array_and_null() {
        assert_eq!(
            parse_flows_meta(Some(&json!({"x.ai/flows": ["refund", "notify-user"]}))).unwrap(),
            Some(vec!["refund".into(), "notify-user".into()])
        );
        assert_eq!(
            parse_flows_meta(Some(&json!({"x.ai/flows": []}))).unwrap(),
            Some(vec![])
        );
        assert_eq!(
            parse_flows_meta(Some(&json!({"x.ai/flows": null}))).unwrap(),
            Some(vec![])
        );
    }

    #[test]
    fn parse_rejects_bad_shape_and_id() {
        assert!(parse_flows_meta(Some(&json!({"x.ai/flows": "refund"}))).is_err());
        assert!(parse_flows_meta(Some(&json!({"x.ai/flows": ["Refund"]}))).is_err());
        assert!(parse_flows_meta(Some(&json!({"x.ai/flows": [""]}))).is_err());
    }

    #[test]
    fn tool_name_roundtrip_and_collision() {
        assert_eq!(flow_tool_name("refund"), "flow__refund");
        assert_eq!(flow_id_from_tool_name("flow__refund"), Some("refund"));
        assert_eq!(flow_id_from_tool_name("workflow"), None);
        assert!(assert_no_tool_collision("refund", &["workflow".into()]).is_ok());
        assert!(assert_no_tool_collision("refund", &["flow__refund".into()]).is_err());
    }

    fn write_mountable(dir: &std::path::Path, id: &str, extra_yaml: &str) {
        let wf = dir.join(".grok").join("workflows");
        std::fs::create_dir_all(&wf).unwrap();
        std::fs::write(
            wf.join(format!("{id}.rhai")),
            format!(
                "let meta = #{{ name: \"{id}\", description: \"d\" }};\ncomplete(#{{ ok: true }});\n"
            ),
        )
        .unwrap();
        std::fs::write(
            wf.join(format!("{id}.flow.yaml")),
            format!(
                "id: {id}\nname: {id}\ndescription: 给 agent 的说明\nversion: \"1\"\ninput_schema:\n  type: object\n  required: [order_id]\n  properties:\n    order_id:\n      type: string\noutput_schema:\n  type: object\n  required: [ok]\n  properties:\n    ok:\n      type: boolean\n{extra_yaml}"
            ),
        )
        .unwrap();
    }

    #[test]
    fn resolve_mountable_and_unknown_and_bare() {
        let tmp = tempfile::tempdir().unwrap();
        write_mountable(tmp.path(), "refund", "");
        let found = resolve_mountable_ids(tmp.path(), &["refund".into()]).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "refund");

        let err = resolve_mountable_ids(tmp.path(), &["missing".into()]).unwrap_err();
        assert!(matches!(err, FlowMountError::Unknown(_)));

        std::fs::write(
            tmp.path()
                .join(".grok")
                .join("workflows")
                .join("bare-only.rhai"),
            "let meta = #{ name: \"bare-only\", description: \"d\" };\n",
        )
        .unwrap();
        let err = resolve_mountable_ids(tmp.path(), &["bare-only".into()]).unwrap_err();
        assert!(matches!(err, FlowMountError::NotMountable(_)));
    }

    #[test]
    fn tool_definition_exposes_input_schema() {
        let contract = xai_workflow::FlowContract {
            id: "refund".into(),
            name: "退款".into(),
            description: "按订单号办理退款".into(),
            version: "1".into(),
            input_schema: json!({
                "type": "object",
                "required": ["order_id"],
                "properties": { "order_id": { "type": "string" } }
            }),
            output_schema: json!({ "type": "object" }),
            dependencies: vec![],
        };
        let def = flow_tool_definition(&contract);
        assert_eq!(def.function.name, "flow__refund");
        assert_eq!(
            def.function.description.as_deref(),
            Some("按订单号办理退款")
        );
        assert_eq!(def.function.parameters["required"], json!(["order_id"]));
    }

    #[test]
    fn output_schema_accepts_and_rejects() {
        let contract = xai_workflow::FlowContract {
            id: "refund".into(),
            name: "退款".into(),
            description: "说明".into(),
            version: "1".into(),
            input_schema: json!({ "type": "object" }),
            output_schema: json!({
                "type": "object",
                "required": ["ok"],
                "properties": { "ok": { "type": "boolean" } }
            }),
            dependencies: vec![],
        };
        assert!(validate_flow_result(&contract, &json!({ "ok": true })).is_ok());
        assert!(validate_flow_result(&contract, &json!({ "ok": "no" })).is_err());
        assert!(validate_flow_result(&contract, &json!({ "other": 1 })).is_err());
    }

    #[test]
    fn preflight_rejects_unmounted_and_reentrant() {
        let inflight = std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashSet::new()));
        let err = preflight_flow_tool(&[], &inflight, "refund").unwrap_err();
        assert!(err.to_string().contains("not mounted"));

        preflight_flow_tool(&["refund".into()], &inflight, "refund").unwrap();
        let err = preflight_flow_tool(&["refund".into()], &inflight, "refund").unwrap_err();
        assert!(err.to_string().contains("already running"));
    }
}
