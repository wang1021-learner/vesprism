//! 任务队列：提交与续查。规则：
//! 1. 发请求前先写 submit_attempted；拿到供应商任务 id 立刻写库，再去查进度。
//! 2. 提交超时 = 结果不明：认幂等键的用同一个键重提；不认的标 `unconfirmed_submit`，等用户确认。
//! 3. 有任务 id 后，查进度超时/网络错只计次数、保持「生成中」、退避续查（最长 60 秒一次）；
//!    连续失败满 30 分钟才转 `unconfirmed_submit`。只有供应商明确判失败才标 `provider_failed`。
//! 4. 凭证问题标 needs_login，不算失败、不计费；重新登录后按原 id 续查。
//! 5. 凭证只在调用时取、只传给供应商；供应商回显的内容入库/发事件前脱敏。
use std::time::Duration;

use crate::event::{JobErrorCode, JobEvent, JobStatus};
use crate::provider::{MediaProvider, PollState, ProviderError};
use crate::store::{JobRow, Store, StoreError};

pub const UNCONFIRMED_SUBMIT: &str = "提交结果未知，请确认后手动重试";
pub const POLL_GIVE_UP: &str = "连续 30 分钟查不到进度，结果未知，请确认后手动重试";
pub const POLL_GIVE_UP_SECS: i64 = 30 * 60;
pub const POLL_MAX_DELAY_SECS: u64 = 60;
const POLL_NORMAL_DELAY_SECS: u64 = 2;

pub type Credentials<'a> = &'a dyn Fn() -> Result<String, ProviderError>;

pub struct Queue<'a, P: MediaProvider> {
    store: &'a Store,
    provider: &'a P,
    creds: Credentials<'a>,
    clock: Box<dyn Fn() -> i64 + 'a>,
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn redact(msg: &str, bearer: &str) -> String {
    if bearer.is_empty() {
        msg.to_string()
    } else {
        msg.replace(bearer, "***")
    }
}

/// 下一次查进度的间隔：正常 2 秒；失败后指数退避，封顶 60 秒。
pub fn poll_delay(failures: u32) -> Duration {
    if failures == 0 {
        return Duration::from_secs(POLL_NORMAL_DELAY_SECS);
    }
    Duration::from_secs(
        2u64.saturating_pow(failures.min(16))
            .min(POLL_MAX_DELAY_SECS),
    )
}

impl<'a, P: MediaProvider> Queue<'a, P> {
    pub fn new(store: &'a Store, provider: &'a P, creds: Credentials<'a>) -> Self {
        Self {
            store,
            provider,
            creds,
            clock: Box::new(now_unix),
        }
    }

    /// 注入时钟（unix 秒），测试用假时钟。
    pub fn with_clock(mut self, clock: impl Fn() -> i64 + 'a) -> Self {
        self.clock = Box::new(clock);
        self
    }

    pub fn enqueue(&self, job_id: &str, node_id: &str, spec: &str) -> Result<(), StoreError> {
        // 幂等键本地生成并先落库；用 job id 派生，重启后不变
        let key = format!("drama-{job_id}");
        self.store.insert_job(job_id, node_id, &key, spec)
    }

    /// 提交一次。`crash_after_submit` 只给测试用：模拟「请求已发、id 未写库」时崩溃。
    pub fn submit(
        &self,
        job_id: &str,
        crash_after_submit: bool,
    ) -> Result<Option<JobEvent>, StoreError> {
        let Some(job) = self.store.job(job_id)? else {
            return Ok(None);
        };
        let bearer = match (self.creds)() {
            Ok(b) => b,
            Err(_) => return self.set(&job, JobStatus::NeedsLogin, None, None),
        };
        self.store.set_submit_attempted(job_id, true)?;
        match self
            .provider
            .submit(&bearer, &job.idempotency_key, &job.spec)
        {
            Ok(task) => {
                if crash_after_submit {
                    return Ok(None);
                }
                self.store.set_provider_task(job_id, &task)?;
                self.emit(job_id)
            }
            Err(ProviderError::Auth) => {
                // 凭证被拒 = 请求没被受理；之前没提交过就撤回标记
                if !job.submit_attempted {
                    self.store.set_submit_attempted(job_id, false)?;
                }
                self.set(&job, JobStatus::NeedsLogin, None, None)
            }
            Err(ProviderError::Timeout) if self.provider.supports_idempotency() => {
                // 结果不明，但同一个键重提不会多扣：留在排队，resume 用原键重提
                self.set(&job, JobStatus::Queued, None, None)
            }
            Err(ProviderError::Timeout) => self.set(
                &job,
                JobStatus::Failed,
                Some(JobErrorCode::UnconfirmedSubmit),
                Some(UNCONFIRMED_SUBMIT.into()),
            ),
            Err(ProviderError::Failed(msg)) => {
                if !job.submit_attempted {
                    self.store.set_submit_attempted(job_id, false)?;
                }
                self.set(
                    &job,
                    JobStatus::Failed,
                    Some(JobErrorCode::ProviderFailed),
                    Some(redact(&msg, &bearer)),
                )
            }
        }
    }

    /// 查一次进度。调用方按 `poll_delay(job.poll_failures)` 安排下一次。
    pub fn poll(&self, job_id: &str) -> Result<Option<JobEvent>, StoreError> {
        let Some(job) = self.store.job(job_id)? else {
            return Ok(None);
        };
        let Some(task) = job.provider_task_id.clone() else {
            return self.emit(job_id);
        };
        if matches!(
            job.status,
            JobStatus::Done | JobStatus::Failed | JobStatus::Cancelled
        ) {
            return self.emit(job_id); // 已结束的任务不再查
        }
        let bearer = match (self.creds)() {
            Ok(b) => b,
            Err(_) => return self.set(&job, JobStatus::NeedsLogin, None, None),
        };
        match self.provider.poll(&bearer, &task) {
            Ok(PollState::Running { progress }) => {
                self.store.set_poll_failures(job_id, 0, None)?;
                self.store
                    .update_job(job_id, JobStatus::Running, progress, None, None, None)?;
                self.emit(job_id)
            }
            Ok(PollState::Done { cost_usd }) => {
                self.store.set_poll_failures(job_id, 0, None)?;
                self.store
                    .update_job(job_id, JobStatus::Done, 1.0, Some(cost_usd), None, None)?;
                self.emit(job_id)
            }
            Ok(PollState::Failed(msg)) => self.set(
                &job,
                JobStatus::Failed,
                Some(JobErrorCode::ProviderFailed),
                Some(redact(&msg, &bearer)),
            ),
            Err(ProviderError::Auth) => self.set(&job, JobStatus::NeedsLogin, None, None),
            Err(ProviderError::Timeout) | Err(ProviderError::Failed(_)) => {
                let now = (self.clock)();
                let since = job.poll_failing_since.unwrap_or(now);
                self.store
                    .set_poll_failures(job_id, job.poll_failures + 1, Some(since))?;
                if now - since >= POLL_GIVE_UP_SECS {
                    self.set(
                        &job,
                        JobStatus::Failed,
                        Some(JobErrorCode::UnconfirmedSubmit),
                        Some(POLL_GIVE_UP.into()),
                    )
                } else {
                    // 任务还在供应商那边跑：保持生成中，不提示
                    self.set(&job, JobStatus::Running, None, None)
                }
            }
        }
    }

    /// 应用启动 / 重新登录后调用：只续查，不重复扣费。
    pub fn resume(&self) -> Result<Vec<JobEvent>, StoreError> {
        let mut out = Vec::new();
        for job in self.store.unfinished_jobs()? {
            let ev = match (&job.provider_task_id, job.submit_attempted) {
                (Some(_), _) => {
                    if job.status == JobStatus::NeedsLogin {
                        self.store.update_job(
                            &job.id,
                            JobStatus::Running,
                            job.progress,
                            None,
                            None,
                            None,
                        )?;
                    }
                    self.poll(&job.id)?
                }
                (None, false) => self.submit(&job.id, false)?,
                (None, true) if self.provider.supports_idempotency() => {
                    self.submit(&job.id, false)?
                }
                (None, true) => self.set(
                    &job,
                    JobStatus::Failed,
                    Some(JobErrorCode::UnconfirmedSubmit),
                    Some(UNCONFIRMED_SUBMIT.into()),
                )?,
            };
            out.extend(ev);
        }
        Ok(out)
    }

    /// 用户在确认框里认了「可能再扣一次费」之后才调用。
    pub fn retry_confirmed(&self, job_id: &str) -> Result<Option<JobEvent>, StoreError> {
        self.store.reset_for_retry(job_id)?;
        self.submit(job_id, false)
    }

    fn set(
        &self,
        job: &JobRow,
        status: JobStatus,
        code: Option<JobErrorCode>,
        error: Option<String>,
    ) -> Result<Option<JobEvent>, StoreError> {
        self.store
            .update_job(&job.id, status, job.progress, None, code, error.as_deref())?;
        self.emit(&job.id)
    }

    fn emit(&self, job_id: &str) -> Result<Option<JobEvent>, StoreError> {
        Ok(self.store.job(job_id)?.map(|j: JobRow| JobEvent {
            job_id: j.id,
            node_id: j.node_id,
            status: j.status,
            progress: j.progress,
            cost_usd: j.cost_usd,
            error_code: j.error_code,
            error: j.error,
        }))
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;
    use crate::provider::{FakeProvider, Fault};

    const SECRET: &str = "TEST-SECRET-123";

    fn creds() -> Result<String, ProviderError> {
        Ok(SECRET.to_string())
    }

    fn store(dir: &tempfile::TempDir) -> Store {
        Store::open(&dir.path().join("project.sqlite")).unwrap()
    }

    #[test]
    fn happy_path_records_actual_cost() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let p = FakeProvider::new();
        let q = Queue::new(&s, &p, &creds);
        q.enqueue("j1", "shot1", "{}").unwrap();
        assert_eq!(
            q.submit("j1", false).unwrap().unwrap().status,
            JobStatus::Running
        );
        assert_eq!(q.poll("j1").unwrap().unwrap().status, JobStatus::Running);
        let done = q.poll("j1").unwrap().unwrap();
        assert_eq!(done.status, JobStatus::Done);
        assert_eq!(done.cost_usd, Some(0.05));
        assert_eq!(p.billed_tasks(), 1);
    }

    #[test]
    fn restart_with_task_id_only_polls_no_second_charge() {
        let dir = tempfile::tempdir().unwrap();
        let p = FakeProvider::new();
        {
            let s = store(&dir);
            let q = Queue::new(&s, &p, &creds);
            q.enqueue("j1", "shot1", "{}").unwrap();
            q.submit("j1", false).unwrap();
        } // 应用被强关
        let s = store(&dir);
        let q = Queue::new(&s, &p, &creds);
        q.resume().unwrap();
        q.resume().unwrap();
        assert_eq!(p.submit_calls(), 1);
        assert_eq!(p.billed_tasks(), 1);
        assert_eq!(s.job("j1").unwrap().unwrap().status, JobStatus::Done);
    }

    #[test]
    fn crash_before_id_written_with_idempotent_provider_no_second_charge() {
        let dir = tempfile::tempdir().unwrap();
        let p = FakeProvider::new();
        {
            let s = store(&dir);
            let q = Queue::new(&s, &p, &creds);
            q.enqueue("j1", "shot1", "{}").unwrap();
            q.submit("j1", true).unwrap();
        }
        let s = store(&dir);
        let q = Queue::new(&s, &p, &creds);
        q.resume().unwrap();
        assert_eq!(p.billed_tasks(), 1);
        assert!(s.job("j1").unwrap().unwrap().provider_task_id.is_some());
    }

    #[test]
    fn crash_before_id_written_without_idempotency_fails_and_waits_for_user() {
        let dir = tempfile::tempdir().unwrap();
        let mut p = FakeProvider::new();
        p.idempotent = false;
        {
            let s = store(&dir);
            let q = Queue::new(&s, &p, &creds);
            q.enqueue("j1", "shot1", "{}").unwrap();
            q.submit("j1", true).unwrap();
        }
        let s = store(&dir);
        let q = Queue::new(&s, &p, &creds);
        let ev = q.resume().unwrap();
        assert_eq!(ev[0].status, JobStatus::Failed);
        assert_eq!(ev[0].error_code, Some(JobErrorCode::UnconfirmedSubmit));
        assert_eq!(p.submit_calls(), 1);
        assert_eq!(p.billed_tasks(), 1);
    }

    #[test]
    fn auth_loss_mid_job_marks_needs_login_then_resumes_same_task() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let mut p = FakeProvider::new();
        p.poll_faults.insert(1, Fault::Auth);
        let q = Queue::new(&s, &p, &creds);
        q.enqueue("j1", "shot1", "{}").unwrap();
        q.submit("j1", false).unwrap();
        let ev = q.poll("j1").unwrap().unwrap();
        assert_eq!(ev.status, JobStatus::NeedsLogin);
        assert_eq!(ev.cost_usd, None);
        q.resume().unwrap(); // 重新登录后
        q.resume().unwrap();
        assert_eq!(s.job("j1").unwrap().unwrap().status, JobStatus::Done);
        assert_eq!(p.submit_calls(), 1);
        assert_eq!(p.billed_tasks(), 1);
    }

    #[test]
    fn submit_timeout_after_create_idempotent_retries_same_key_one_charge() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let mut p = FakeProvider::new();
        p.submit_faults.insert(1, Fault::TimeoutAfterCreate);
        let q = Queue::new(&s, &p, &creds);
        q.enqueue("j1", "shot1", "{}").unwrap();
        let ev = q.submit("j1", false).unwrap().unwrap();
        assert_eq!(ev.status, JobStatus::Queued);
        assert_eq!(ev.error_code, None);
        assert_eq!(p.billed_tasks(), 1); // 供应商那边已经扣了
        for _ in 0..3 {
            q.resume().unwrap();
        }
        assert_eq!(s.job("j1").unwrap().unwrap().status, JobStatus::Done);
        assert_eq!(p.submit_calls(), 2);
        assert_eq!(p.billed_tasks(), 1);
    }

    #[test]
    fn submit_timeout_after_create_without_idempotency_waits_for_confirmation() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let mut p = FakeProvider::new();
        p.idempotent = false;
        p.submit_faults.insert(1, Fault::TimeoutAfterCreate);
        let q = Queue::new(&s, &p, &creds);
        q.enqueue("j1", "shot1", "{}").unwrap();
        let ev = q.submit("j1", false).unwrap().unwrap();
        assert_eq!(ev.status, JobStatus::Failed);
        assert_eq!(ev.error_code, Some(JobErrorCode::UnconfirmedSubmit));
        q.resume().unwrap(); // 重启不会自动重提
        assert_eq!(p.submit_calls(), 1);
        assert_eq!(p.billed_tasks(), 1);
        // 用户确认后才再提，这一笔是用户认过的
        assert_eq!(
            q.retry_confirmed("j1").unwrap().unwrap().status,
            JobStatus::Running
        );
        assert_eq!(p.billed_tasks(), 2);
    }

    #[test]
    fn submit_explicit_rejection_is_provider_failed() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let mut p = FakeProvider::new();
        p.submit_faults.insert(1, Fault::Fail);
        let q = Queue::new(&s, &p, &creds);
        q.enqueue("j1", "a", "{}").unwrap();
        let ev = q.submit("j1", false).unwrap().unwrap();
        assert_eq!(ev.status, JobStatus::Failed);
        assert_eq!(ev.error_code, Some(JobErrorCode::ProviderFailed));
        assert!(!s.job("j1").unwrap().unwrap().submit_attempted);
        assert_eq!(p.billed_tasks(), 0);
    }

    #[test]
    fn poll_timeout_keeps_running_and_finishes_with_one_charge() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let mut p = FakeProvider::new();
        p.poll_faults.insert(1, Fault::Timeout);
        p.poll_faults.insert(2, Fault::Fail);
        let q = Queue::new(&s, &p, &creds);
        q.enqueue("j1", "shot1", "{}").unwrap();
        q.submit("j1", false).unwrap();
        for _ in 0..2 {
            let ev = q.poll("j1").unwrap().unwrap();
            assert_eq!(ev.status, JobStatus::Running);
            assert_eq!(ev.error_code, None);
        }
        assert_eq!(s.job("j1").unwrap().unwrap().poll_failures, 2);
        q.poll("j1").unwrap();
        let done = q.poll("j1").unwrap().unwrap();
        assert_eq!(done.status, JobStatus::Done);
        assert_eq!(s.job("j1").unwrap().unwrap().poll_failures, 0);
        assert_eq!(p.submit_calls(), 1);
        assert_eq!(p.billed_tasks(), 1);
    }

    #[test]
    fn poll_failing_for_30_minutes_becomes_unconfirmed() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let mut p = FakeProvider::new();
        for n in 1..=100 {
            p.poll_faults.insert(n, Fault::Timeout);
        }
        let now = Cell::new(1_000_000i64);
        let q = Queue::new(&s, &p, &creds).with_clock(|| now.get());
        q.enqueue("j1", "shot1", "{}").unwrap();
        q.submit("j1", false).unwrap();
        assert_eq!(q.poll("j1").unwrap().unwrap().status, JobStatus::Running);
        now.set(now.get() + POLL_GIVE_UP_SECS - 1);
        assert_eq!(q.poll("j1").unwrap().unwrap().status, JobStatus::Running);
        now.set(now.get() + 1);
        let ev = q.poll("j1").unwrap().unwrap();
        assert_eq!(ev.status, JobStatus::Failed);
        assert_eq!(ev.error_code, Some(JobErrorCode::UnconfirmedSubmit));
        assert!(q.resume().unwrap().is_empty()); // 已转失败，重启不再续查
        assert_eq!(p.submit_calls(), 1);
        assert_eq!(p.billed_tasks(), 1);
    }

    #[test]
    fn poll_delay_backs_off_and_caps_at_60s() {
        assert_eq!(poll_delay(0), Duration::from_secs(2));
        assert_eq!(poll_delay(1), Duration::from_secs(2));
        assert_eq!(poll_delay(3), Duration::from_secs(8));
        assert_eq!(poll_delay(6), Duration::from_secs(60));
        assert_eq!(poll_delay(1000), Duration::from_secs(60));
    }

    #[test]
    fn missing_credentials_is_needs_login_not_attempted() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let p = FakeProvider::new();
        let no_creds = || Err(ProviderError::Auth);
        let q = Queue::new(&s, &p, &no_creds);
        q.enqueue("j1", "a", "{}").unwrap();
        assert_eq!(
            q.submit("j1", false).unwrap().unwrap().status,
            JobStatus::NeedsLogin
        );
        assert!(!s.job("j1").unwrap().unwrap().submit_attempted);
        assert_eq!(p.submit_calls(), 0);
    }

    #[test]
    fn secret_never_reaches_events_db_or_wal() {
        let dir = tempfile::tempdir().unwrap();
        let mut p = FakeProvider::new();
        p.submit_faults.insert(2, Fault::Fail); // j2：供应商回显凭证
        p.poll_faults.insert(1, Fault::Auth); // j1：needs_login
        p.poll_faults.insert(3, Fault::TaskFailed); // j3：失败信息回显凭证
        p.poll_faults.insert(4, Fault::Fail); // 重启续查时网络错回显凭证
        let scan = |when: &str| {
            for suffix in ["", "-wal", "-shm"] {
                let f = dir.path().join(format!("project.sqlite{suffix}"));
                if let Ok(raw) = std::fs::read(&f) {
                    assert!(
                        !String::from_utf8_lossy(&raw).contains(SECRET),
                        "{when}: {suffix} 里有凭证"
                    );
                }
            }
        };
        let mut events = Vec::new();
        {
            let s = store(&dir);
            let q = Queue::new(&s, &p, &creds);
            for j in ["j1", "j2", "j3"] {
                q.enqueue(j, "n", "{\"prompt\":\"x\"}").unwrap();
                events.extend(q.submit(j, false).unwrap());
            }
            events.extend(q.poll("j1").unwrap());
            events.extend(q.poll("j3").unwrap());
            events.extend(q.poll("j3").unwrap());
            scan("库开着");
        }
        {
            let s = store(&dir); // 重启续查
            let q = Queue::new(&s, &p, &creds);
            events.extend(q.resume().unwrap());
            events.extend(q.resume().unwrap());
            scan("重启后");
        }
        scan("关库后");
        assert!(!p.bearers_seen().is_empty());
        assert!(
            p.bearers_seen().iter().all(|b| b == SECRET),
            "凭证确实传给了供应商"
        );
        assert!(events.iter().any(|e| e.status == JobStatus::NeedsLogin));
        assert!(
            events
                .iter()
                .any(|e| e.error_code == Some(JobErrorCode::ProviderFailed))
        );
        let json = serde_json::to_string(&events).unwrap();
        assert!(!json.contains(SECRET));
        assert!(json.contains("***"), "回显内容已脱敏");
    }

    #[test]
    fn confirmed_retry_is_not_deduped_by_idempotent_provider() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("project.sqlite")).unwrap();
        let mut p = crate::provider::FakeProvider::new();
        p.poll_faults.insert(1, crate::provider::Fault::TaskFailed);
        let creds = || Ok::<_, ProviderError>("b".to_string());
        let q = Queue::new(&store, &p, &creds);
        q.enqueue("j", "n", "{}").unwrap();
        q.submit("j", false).unwrap();
        assert_eq!(q.poll("j").unwrap().unwrap().status, JobStatus::Failed);
        q.retry_confirmed("j").unwrap();
        assert_eq!(p.billed_tasks(), 2, "新幂等键：供应商当成新请求");
        let old = store.job_attempts("j").unwrap();
        assert_eq!(old[0].provider_task_id.as_deref(), Some("task-1"));
        assert_eq!(store.job("j").unwrap().unwrap().provider_task_id.as_deref(), Some("task-2"));
    }
}
