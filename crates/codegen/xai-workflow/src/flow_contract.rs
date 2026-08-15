//! 流程契约 sidecar（`<id>.flow.yaml`，与 `<id>.rhai` 同目录同名）。
//!
//! 给 agent 看的说明 / 入出参 Schema / 版本 / 依赖。不改 Rhai 方言。
//! 无 sidecar 的裸 rhai 仍可 `/workflow` 触发，但不可被 `flows:` 挂载。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::meta::is_valid_workflow_name;

// jike: 流程即工具的磁盘契约；官方 list/挂载只认这份，不从 rhai meta 猜 Schema

const MAX_FLOW_NAME_LEN: usize = 128;
const MAX_FLOW_DESCRIPTION_LEN: usize = 4_096;
const MAX_FLOW_VERSION_LEN: usize = 32;
const MAX_FLOW_DEPENDENCIES: usize = 32;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FlowContract {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FlowContractError {
    #[error("failed to read {path}: {error}")]
    Io { path: String, error: String },
    #[error("parse .flow.yaml failed: {0}")]
    Parse(String),
    #[error("{0} must be a non-empty string")]
    MissingField(&'static str),
    #[error("flow id '{0}' is not a valid workflow name (1-64 lowercase letters, digits, single hyphens)")]
    InvalidId(String),
    #[error("flow id '{id}' must match rhai/file name '{expected}'")]
    IdMismatch { id: String, expected: String },
    #[error("{field} must be at most {max} UTF-8 bytes (got {actual})")]
    StringTooLong {
        field: String,
        max: usize,
        actual: usize,
    },
    #[error("{0} must be a JSON Schema object")]
    InvalidSchema(&'static str),
    #[error("dependencies[{0}] is not a valid flow id")]
    InvalidDependency(usize),
    #[error("dependencies must contain at most {max} entries (got {actual})")]
    TooManyDependencies { max: usize, actual: usize },
}

/// `<name>.rhai` → `<name>.flow.yaml`（仅替换扩展名，不改目录）。
pub fn sidecar_path(rhai_path: &Path) -> PathBuf {
    rhai_path.with_extension("flow.yaml")
}

pub fn parse_flow_contract(yaml: &str) -> Result<FlowContract, FlowContractError> {
    let contract: FlowContract =
        serde_yaml::from_str(yaml).map_err(|e| FlowContractError::Parse(e.to_string()))?;
    validate_contract(&contract)?;
    Ok(contract)
}

/// 读 sidecar。文件不存在返回 `Ok(None)`；存在但非法返回 `Err`（调用方记到该条目，不中断扫目录）。
pub fn load_flow_contract(
    rhai_path: &Path,
    expected_id: &str,
) -> Result<Option<FlowContract>, FlowContractError> {
    let path = sidecar_path(rhai_path);
    match std::fs::read_to_string(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(FlowContractError::Io {
            path: path.display().to_string(),
            error: e.to_string(),
        }),
        Ok(text) => {
            let contract = parse_flow_contract(&text)?;
            if contract.id != expected_id {
                return Err(FlowContractError::IdMismatch {
                    id: contract.id,
                    expected: expected_id.to_string(),
                });
            }
            Ok(Some(contract))
        }
    }
}

fn validate_contract(c: &FlowContract) -> Result<(), FlowContractError> {
    if c.id.trim().is_empty() {
        return Err(FlowContractError::MissingField("id"));
    }
    if !is_valid_workflow_name(&c.id) {
        return Err(FlowContractError::InvalidId(c.id.clone()));
    }
    require_nonempty("name", &c.name, MAX_FLOW_NAME_LEN)?;
    require_nonempty("description", &c.description, MAX_FLOW_DESCRIPTION_LEN)?;
    require_nonempty("version", &c.version, MAX_FLOW_VERSION_LEN)?;
    require_schema_object("input_schema", &c.input_schema)?;
    require_schema_object("output_schema", &c.output_schema)?;
    if c.dependencies.len() > MAX_FLOW_DEPENDENCIES {
        return Err(FlowContractError::TooManyDependencies {
            max: MAX_FLOW_DEPENDENCIES,
            actual: c.dependencies.len(),
        });
    }
    for (i, dep) in c.dependencies.iter().enumerate() {
        if !is_valid_workflow_name(dep) {
            return Err(FlowContractError::InvalidDependency(i));
        }
    }
    Ok(())
}

fn require_nonempty(
    field: &'static str,
    value: &str,
    max: usize,
) -> Result<(), FlowContractError> {
    if value.trim().is_empty() {
        return Err(FlowContractError::MissingField(field));
    }
    if value.len() > max {
        return Err(FlowContractError::StringTooLong {
            field: field.to_string(),
            max,
            actual: value.len(),
        });
    }
    Ok(())
}

fn require_schema_object(
    field: &'static str,
    value: &serde_json::Value,
) -> Result<(), FlowContractError> {
    let Some(obj) = value.as_object() else {
        return Err(FlowContractError::InvalidSchema(field));
    };
    if let Some(ty) = obj.get("type") {
        let type_ok = match ty {
            serde_json::Value::String(s) => !s.trim().is_empty(),
            serde_json::Value::Array(arr) => {
                !arr.is_empty() && arr.iter().all(|v| v.as_str().is_some_and(|s| !s.is_empty()))
            }
            _ => false,
        };
        if !type_ok {
            return Err(FlowContractError::InvalidSchema(field));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_yaml() -> &'static str {
        r#"
id: refund
name: 退款
description: 按订单号办理退款
version: "1"
input_schema:
  type: object
  required: [order_id]
  properties:
    order_id:
      type: string
output_schema:
  type: object
dependencies:
  - notify-user
"#
    }

    #[test]
    fn parses_full_contract() {
        let c = parse_flow_contract(valid_yaml()).unwrap();
        assert_eq!(c.id, "refund");
        assert_eq!(c.name, "退款");
        assert_eq!(c.description, "按订单号办理退款");
        assert_eq!(c.version, "1");
        assert_eq!(c.dependencies, vec!["notify-user"]);
        assert_eq!(c.input_schema["type"], "object");
    }

    #[test]
    fn missing_description_fails() {
        let err = parse_flow_contract(
            r#"
id: refund
name: 退款
description: ""
version: "1"
input_schema: { type: object }
output_schema: { type: object }
"#,
        )
        .unwrap_err();
        assert!(matches!(err, FlowContractError::MissingField("description")));
    }

    #[test]
    fn invalid_schema_fails() {
        let err = parse_flow_contract(
            r#"
id: refund
name: 退款
description: 说明
version: "1"
input_schema: "not-an-object"
output_schema: { type: object }
"#,
        )
        .unwrap_err();
        assert!(matches!(err, FlowContractError::InvalidSchema("input_schema")));
    }

    #[test]
    fn unknown_field_fails_loud() {
        let err = parse_flow_contract(
            r#"
id: refund
name: 退款
description: 说明
version: "1"
input_schema: { type: object }
output_schema: { type: object }
nonesuch: true
"#,
        )
        .unwrap_err();
        assert!(matches!(err, FlowContractError::Parse(_)));
    }

    #[test]
    fn sidecar_path_replaces_extension_only() {
        let p = sidecar_path(Path::new("/tmp/.grok/workflows/refund.rhai"));
        assert_eq!(p.file_name().unwrap(), "refund.flow.yaml");
    }

    #[test]
    fn load_absent_sidecar_is_ok_none() {
        let dir = tempfile::tempdir().unwrap();
        let rhai = dir.path().join("refund.rhai");
        std::fs::write(&rhai, "let meta = #{ name: \"refund\", description: \"d\" };\n").unwrap();
        assert!(load_flow_contract(&rhai, "refund").unwrap().is_none());
    }

    #[test]
    fn load_rejects_id_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let rhai = dir.path().join("refund.rhai");
        std::fs::write(&rhai, "x").unwrap();
        std::fs::write(
            sidecar_path(&rhai),
            r#"
id: other
name: 退款
description: 说明
version: "1"
input_schema: { type: object }
output_schema: { type: object }
"#,
        )
        .unwrap();
        let err = load_flow_contract(&rhai, "refund").unwrap_err();
        assert!(matches!(err, FlowContractError::IdMismatch { .. }));
    }
}
