//! 生成供应商接口与可注入故障的假实现。
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProviderError {
    /// 取不到凭证或凭证失效
    #[error("需要重新登录")]
    Auth,
    /// 超时：不代表供应商没收到请求
    #[error("请求超时")]
    Timeout,
    /// 网络或接口错误（含供应商原始信息，入库前要脱敏）
    #[error("供应商错误: {0}")]
    Failed(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum PollState {
    Running {
        progress: f32,
    },
    Done {
        cost_usd: f64,
    },
    /// 供应商明确判定任务失败
    Failed(String),
}

pub trait MediaProvider {
    /// 供应商是否认幂等键（同一个键重复提交只算一笔）
    fn supports_idempotency(&self) -> bool;
    /// 返回供应商任务 id。`bearer` 只在调用时传入，不得保存。
    fn submit(
        &self,
        bearer: &str,
        idempotency_key: &str,
        spec: &str,
    ) -> Result<String, ProviderError>;
    fn poll(&self, bearer: &str, provider_task_id: &str) -> Result<PollState, ProviderError>;
}

/// 故障注入：按调用序号（从 1 开始）指定行为。
#[derive(Debug, Clone, PartialEq)]
pub enum Fault {
    /// 接口报错，错误信息里回显 bearer（考脱敏）
    Fail,
    /// 请求没到供应商就超时
    Timeout,
    /// 供应商已建任务（已扣费），但响应超时
    TimeoutAfterCreate,
    Auth,
    /// poll 时供应商明确判定失败
    TaskFailed,
}

#[derive(Default)]
pub struct FakeProvider {
    pub idempotent: bool,
    pub submit_faults: HashMap<u32, Fault>,
    pub poll_faults: HashMap<u32, Fault>,
    /// poll 多少次后完成
    pub polls_to_done: u32,
    pub cost_usd: f64,
    state: Mutex<FakeState>,
}

#[derive(Default)]
struct FakeState {
    submit_calls: u32,
    poll_calls: u32,
    by_key: HashMap<String, String>,
    /// 扣费笔数 = tasks.len()
    tasks: Vec<String>,
    polled: HashMap<String, u32>,
    bearers_seen: Vec<String>,
}

impl FakeProvider {
    pub fn new() -> Self {
        Self {
            idempotent: true,
            polls_to_done: 2,
            cost_usd: 0.05,
            ..Default::default()
        }
    }

    pub fn billed_tasks(&self) -> usize {
        self.state.lock().unwrap().tasks.len()
    }

    pub fn submit_calls(&self) -> u32 {
        self.state.lock().unwrap().submit_calls
    }

    pub fn bearers_seen(&self) -> Vec<String> {
        self.state.lock().unwrap().bearers_seen.clone()
    }

    fn create(&self, s: &mut FakeState, key: &str) -> String {
        if self.idempotent {
            if let Some(id) = s.by_key.get(key) {
                return id.clone();
            }
        }
        let id = format!("task-{}", s.tasks.len() + 1);
        s.tasks.push(id.clone());
        s.by_key.insert(key.to_string(), id.clone());
        id
    }
}

impl MediaProvider for FakeProvider {
    fn supports_idempotency(&self) -> bool {
        self.idempotent
    }

    fn submit(&self, bearer: &str, key: &str, _spec: &str) -> Result<String, ProviderError> {
        let mut s = self.state.lock().unwrap();
        s.submit_calls += 1;
        s.bearers_seen.push(bearer.to_string());
        match self.submit_faults.get(&s.submit_calls) {
            Some(Fault::Fail) | Some(Fault::TaskFailed) => Err(ProviderError::Failed(format!(
                "400 rejected, auth={bearer}"
            ))),
            Some(Fault::Timeout) => Err(ProviderError::Timeout),
            Some(Fault::Auth) => Err(ProviderError::Auth),
            Some(Fault::TimeoutAfterCreate) => {
                self.create(&mut s, key);
                Err(ProviderError::Timeout)
            }
            None => Ok(self.create(&mut s, key)),
        }
    }

    fn poll(&self, bearer: &str, task: &str) -> Result<PollState, ProviderError> {
        let mut s = self.state.lock().unwrap();
        s.poll_calls += 1;
        s.bearers_seen.push(bearer.to_string());
        match self.poll_faults.get(&s.poll_calls) {
            Some(Fault::Fail) => {
                return Err(ProviderError::Failed(format!(
                    "502 upstream, auth={bearer}"
                )));
            }
            Some(Fault::Timeout) | Some(Fault::TimeoutAfterCreate) => {
                return Err(ProviderError::Timeout);
            }
            Some(Fault::Auth) => return Err(ProviderError::Auth),
            Some(Fault::TaskFailed) => {
                return Ok(PollState::Failed(format!("content blocked, auth={bearer}")));
            }
            None => {}
        }
        if !s.tasks.iter().any(|t| t == task) {
            return Ok(PollState::Failed("unknown task".into()));
        }
        let n = s.polled.entry(task.to_string()).or_default();
        *n += 1;
        if *n >= self.polls_to_done {
            Ok(PollState::Done {
                cost_usd: self.cost_usd,
            })
        } else {
            Ok(PollState::Running {
                progress: *n as f32 / self.polls_to_done as f32,
            })
        }
    }
}
