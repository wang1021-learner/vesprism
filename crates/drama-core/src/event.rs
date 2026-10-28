use serde::{Deserialize, Serialize};

use crate::model::EntityId;

pub const JOB_EVENT: &str = "drama://job";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
    NeedsLogin,
}

/// 失败原因的机器可读码。前端按它判断，不解析 `error` 文案。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobErrorCode {
    /// 请求可能已被供应商受理（可能已扣费），结果不明；重试前必须让用户确认。
    UnconfirmedSubmit,
    /// 供应商明确返回失败。
    ProviderFailed,
}

/// `drama://job` 事件负载。不含任何凭证。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    pub job_id: EntityId,
    pub node_id: EntityId,
    pub status: JobStatus,
    /// 0.0..=1.0
    pub progress: f32,
    pub cost_usd: Option<f64>,
    pub error_code: Option<JobErrorCode>,
    pub error: Option<String>,
}
