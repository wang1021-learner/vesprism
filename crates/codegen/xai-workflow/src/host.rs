use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentOpts {
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default)]
    pub max_output_tokens: Option<u64>,
    #[serde(default)]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub capability_mode: Option<String>,
    #[serde(default)]
    pub isolation_worktree: bool,
    #[serde(default)]
    pub fork_context: bool,
    #[serde(default)]
    pub resume_from: Option<String>,
    #[serde(default)]
    pub output_schema: Option<serde_json::Value>,
    #[serde(default)]
    pub phase: Option<String>,
    /// 整个 agent() 调用（含官方 schema 重试）的墙钟超时（毫秒）。
    /// 由 workflow host 在 spawn 时强制：超时取消子 agent 并返回失败。
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    /// // jike: 工作台 Agent 细粒度工具停用；透传到子 agent 工具集过滤。
    #[serde(default)]
    pub disabled_tools: Vec<String>,
    /// // jike: 工作台 Agent 的 per-agent deny 规则（`kind:glob` 或 `glob`，policy 隐含 deny）。
    /// // 随子 agent 上报，由 grok-session 在子会话权限自动放行之前拦截。
    #[serde(default)]
    pub permission_rules: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResult {
    pub agent_id: String,
    pub success: bool,
    pub output: serde_json::Value,
    pub cancelled: bool,
    pub tokens_used: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BudgetState {
    pub total: Option<u64>,
    pub spent: u64,
    pub reserved: u64,
    pub remaining: Option<u64>,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum HostError {
    #[error("workflow agent-call quota exceeded: requested {requested}, maximum {maximum}")]
    AgentCallQuotaExceeded { requested: u64, maximum: u64 },
    #[error("workflow token budget exceeded")]
    BudgetExceeded,
    #[error("workflow cancelled")]
    Cancelled,
    #[error("unsupported in this context: {0}")]
    Unsupported(String),
    #[error("host failure: {0}")]
    Failed(String),
}

#[derive(Debug)]
pub enum WorkflowHostRequest {
    ReserveAgentCalls {
        count: u64,
        reply: oneshot::Sender<Result<(), HostError>>,
    },
    ReleaseAgentCalls {
        count: u64,
        reply: oneshot::Sender<Result<(), HostError>>,
    },
    SpawnAgent {
        opts: AgentOpts,
        reply: oneshot::Sender<Result<AgentResult, HostError>>,
    },
    Phase {
        title: String,
        replayed: bool,
    },
    Log {
        message: String,
        replayed: bool,
    },
    Telemetry {
        name: String,
        fields: serde_json::Value,
        replayed: bool,
    },
    BudgetQuery {
        reply: oneshot::Sender<Result<BudgetState, HostError>>,
    },
    RenderTemplate {
        name: String,
        vars: serde_json::Value,
        reply: oneshot::Sender<Result<String, HostError>>,
    },
    WriteScratchFile {
        name: String,
        content: String,
        reply: oneshot::Sender<Result<String, HostError>>,
    },
    ReadScratchFile {
        name: String,
        reply: oneshot::Sender<Result<String, HostError>>,
    },
    GitDiffSince {
        commit: String,
        reply: oneshot::Sender<Result<String, HostError>>,
    },
}

impl WorkflowHostRequest {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::ReserveAgentCalls { .. } => "reserve_agent_calls",
            Self::ReleaseAgentCalls { .. } => "release_agent_calls",
            Self::SpawnAgent { .. } => "spawn_agent",
            Self::Phase { .. } => "phase",
            Self::Log { .. } => "log",
            Self::Telemetry { .. } => "telemetry",
            Self::BudgetQuery { .. } => "budget",
            Self::RenderTemplate { .. } => "render_template",
            Self::WriteScratchFile { .. } => "write_scratch_file",
            Self::ReadScratchFile { .. } => "read_scratch_file",
            Self::GitDiffSince { .. } => "git_diff_since",
        }
    }
}
