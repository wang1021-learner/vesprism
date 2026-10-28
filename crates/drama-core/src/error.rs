use serde::Serialize;

/// link/unlink 的错误码，前端按 code 撤回连线。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum LinkError {
    #[error("端口类型不匹配")]
    TypeMismatch,
    #[error("连线会形成环")]
    Cycle,
    #[error("剧本已定稿")]
    ScriptLocked,
    #[error("节点不存在")]
    NotFound,
}
