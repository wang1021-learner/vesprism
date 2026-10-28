//! 生成任务。角色和镜头在正式运行时走 Grok Imagine；配音和其他节点仍走假产物。
//! 测试构建不打网络，镜头和配音继续用假 PNG / WAV。
use std::time::Duration;

use drama_core::event::{JobEvent, JobStatus};
use drama_core::provider::{FakeProvider, ProviderError};
use drama_core::queue::Queue;

use super::projects::new_ulid;
use super::*;

/// 假 Provider 多少次查询后完成：让前端能看到排队、生成中、完成几步。
pub const FAKE_POLLS_TO_DONE: u32 = 5;
const MAX_STEPS: u32 = 10_000;

pub fn fake_provider() -> FakeProvider {
    // 故障开关只在 debug 构建编译进来；正式构建里没有读这个环境变量的代码。
    #[cfg(debug_assertions)]
    let fault = std::env::var("DRAMA_FAKE_FAULT").ok();
    #[cfg(not(debug_assertions))]
    let fault: Option<String> = None;
    fake_provider_with(fault.as_deref())
}

/// `submit_timeout`：第一次提交超时、结果不明（卡片显示失败，可重试）；`task_failed`：第一次查询判失败。
pub fn fake_provider_with(fault: Option<&str>) -> FakeProvider {
    use drama_core::provider::Fault;
    let mut f = FakeProvider::new();
    f.polls_to_done = FAKE_POLLS_TO_DONE;
    match fault {
        Some("submit_timeout") => {
            f.idempotent = false;
            f.submit_faults.insert(1, Fault::Timeout);
        }
        Some("task_failed") => {
            f.poll_faults.insert(1, Fault::TaskFailed);
        }
        _ => {}
    }
    f
}

fn fake_creds() -> std::result::Result<String, ProviderError> {
    Ok("fake-local".into())
}

/// 建任务并落库，返回第一条「排队」事件。不发请求。
pub fn start_job(st: &DramaState, id: &str, node: &str) -> Result<JobEvent> {
    with_project(st, id, |p| {
        if p.graph.node(node).is_none() {
            return Err(CommandError::new(Code::NotFound, "节点不存在"));
        }
        let job_id = new_ulid();
        let q = Queue::new(&p.store, &st.fake, &fake_creds);
        q.enqueue(&job_id, node, "{}")?;
        Ok(job_event(&p.store, &job_id)?)
    })
}

fn job_event(store: &Store, job_id: &str) -> Result<JobEvent> {
    let j = store.job(job_id)?.ok_or_else(|| CommandError::new(Code::NotFound, "任务不存在"))?;
    Ok(JobEvent {
        job_id: j.id,
        node_id: j.node_id,
        status: j.status,
        progress: j.progress,
        cost_usd: j.cost_usd,
        error_code: j.error_code,
        error: j.error,
    })
}

/// 推进一步：没提交就提交，提交了就查一次。完成时清掉该节点的「需更新」。
/// 返回事件和下次查询前该等多久（任务结束返回 None）。
pub fn step(st: &DramaState, id: &str, job_id: &str) -> Result<(JobEvent, Option<Duration>)> {
    // 测试继续走假图，避免出图请求打到网络。正式运行时角色和镜头走 Grok。
    if !cfg!(test) {
        if let Some(pair) = grok_image_step(st, id, job_id)? {
            return Ok(pair);
        }
    }
    with_project(st, id, |p| {
        let job = p.store.job(job_id)?.ok_or_else(|| CommandError::new(Code::NotFound, "任务不存在"))?;
        let ev = {
            let q = Queue::new(&p.store, &st.fake, &fake_creds);
            if job.provider_task_id.is_none() { q.submit(job_id, false)? } else { q.poll(job_id)? }
        };
        let ev = match ev {
            Some(ev) => ev,
            None => job_event(&p.store, job_id)?,
        };
        if ev.status == JobStatus::Done {
            fake_output(p, job_id, &ev.node_id)?;
            p.graph.clear_needs_update(&ev.node_id);
            p.store.save_graph(&p.graph)?;
        }
        let next = match ev.status {
            JobStatus::Queued | JobStatus::Running => {
                let failures = p.store.job(job_id)?.map(|j| j.poll_failures).unwrap_or(0);
                Some(drama_core::queue::poll_delay(failures))
            }
            _ => None,
        };
        Ok((ev, next))
    })
}

/// 角色和镜头：先标成生成中，下一步在不占项目锁的情况下请求 Grok，把图片写入 assets/。
fn grok_image_step(st: &DramaState, id: &str, job_id: &str) -> Result<Option<(JobEvent, Option<Duration>)>> {
    use drama_core::event::JobErrorCode;
    use drama_core::model::NodeKind;
    use drama_core::provider::ProviderError;

    let snap = with_project(st, id, |p| {
        let job = p.store.job(job_id)?.ok_or_else(|| CommandError::new(Code::NotFound, "任务不存在"))?;
        let kind = p.graph.node(&job.node_id).map(|n| n.kind);
        Ok(match kind {
            Some(kind @ (NodeKind::Shot | NodeKind::Character)) => {
                Some((job.status, job.node_id, kind))
            }
            _ => None,
        })
    })?;
    let Some((status, node_id, kind)) = snap else {
        return Ok(None);
    };
    if matches!(
        status,
        JobStatus::Done | JobStatus::Failed | JobStatus::Cancelled | JobStatus::NeedsLogin
    ) {
        let ev = with_project(st, id, |p| job_event(&p.store, job_id))?;
        return Ok(Some((ev, None)));
    }
    let prompt = with_project(st, id, |p| Ok(p.graph.prompt_text(&node_id)))?;
    if prompt.trim().is_empty() {
        let ev = with_project(st, id, |p| {
            p.store.update_job(
                job_id,
                JobStatus::Failed,
                0.0,
                None,
                Some(JobErrorCode::ProviderFailed),
                Some("先在节点里写内容，或连上写了字的剧本和角色"),
            )?;
            job_event(&p.store, job_id)
        })?;
        return Ok(Some((ev, None)));
    }
    if status == JobStatus::Queued {
        let ev = with_project(st, id, |p| {
            p.store.update_job(job_id, JobStatus::Running, 0.05, None, None, None)?;
            job_event(&p.store, job_id)
        })?;
        return Ok(Some((ev, Some(Duration::ZERO))));
    }
    let aspect = if kind == NodeKind::Character { "2:3" } else { "16:9" };
    let ref_paths = if kind == NodeKind::Shot {
        with_project(st, id, |p| Ok(reference_images(p, &node_id)))?
    } else {
        Vec::new()
    };
    let refs: Vec<super::grok_image::RefImage> = ref_paths
        .into_iter()
        .filter_map(|(path, mime)| {
            let bytes = std::fs::read(&path).ok()?;
            Some(super::grok_image::RefImage { mime, bytes })
        })
        .collect();
    let bytes = match super::grok_image::imagine(&prompt, aspect, &refs) {
        Ok(bytes) => bytes,
        Err(err) => {
            let ev = with_project(st, id, |p| {
                match err {
                    ProviderError::Auth => p.store.update_job(
                        job_id,
                        JobStatus::NeedsLogin,
                        0.0,
                        None,
                        None,
                        Some("需要登录后才能出图"),
                    )?,
                    ProviderError::Timeout => p.store.update_job(
                        job_id,
                        JobStatus::Failed,
                        0.0,
                        None,
                        Some(JobErrorCode::UnconfirmedSubmit),
                        Some("出图超时，结果不明。重试可能再扣一次费"),
                    )?,
                    ProviderError::Failed(ref msg) => p.store.update_job(
                        job_id,
                        JobStatus::Failed,
                        0.0,
                        None,
                        Some(JobErrorCode::ProviderFailed),
                        Some(msg),
                    )?,
                }
                job_event(&p.store, job_id)
            })?;
            return Ok(Some((ev, None)));
        }
    };
    let ev = with_project(st, id, |p| {
        let meta = super::grok_image::image_meta(&bytes);
        let asset = p.store.put_asset(&p.dir, &super::projects::new_ulid(), &bytes, &meta)?;
        p.store.set_job_asset(job_id, &asset.id)?;
        p.store.update_job(job_id, JobStatus::Done, 1.0, Some(0.0), None, None)?;
        p.graph.clear_needs_update(&node_id);
        p.store.save_graph(&p.graph)?;
        job_event(&p.store, job_id)
    })?;
    Ok(Some((ev, None)))
}

/// 镜头上游里已经出过的图：角色定妆和别的镜头画面，近的优先，最多四张。
fn reference_images(p: &Project, node_id: &str) -> Vec<(String, String)> {
    use drama_core::asset::Slot;
    use drama_core::model::NodeKind;
    use std::collections::{HashSet, VecDeque};

    let Ok(refs) = p.store.latest_refs(&p.dir, &p.graph) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut queue = VecDeque::new();
    seen.insert(node_id.to_string());
    queue.push_back(node_id.to_string());
    while let Some(cur) = queue.pop_front() {
        let mut parents: Vec<String> = p
            .graph
            .links()
            .filter(|l| l.to == cur)
            .map(|l| l.from.clone())
            .collect();
        parents.sort();
        parents.dedup();
        for parent in parents {
            if !seen.insert(parent.clone()) {
                continue;
            }
            queue.push_back(parent.clone());
            if out.len() >= 4 {
                continue;
            }
            let slot = match p.graph.node(&parent).map(|n| n.kind) {
                Some(NodeKind::Shot) => Slot::Image,
                Some(NodeKind::Character) => Slot::Single,
                _ => continue,
            };
            let Some(asset) = refs.get(&(parent, slot)) else { continue };
            if asset.mime.starts_with("image/") {
                out.push((asset.path.clone(), asset.mime.clone()));
            }
        }
    }
    out
}

/// 估时长用的台词：任务参数里的 `text`，没有就用占位句。
pub const PLACEHOLDER_LINE: &str = "这是一句占位台词，用来估算配音时长。";

fn spec_text(spec: &str) -> String {
    serde_json::from_str::<serde_json::Value>(spec)
        .ok()
        .and_then(|v| v.get("text").and_then(|t| t.as_str()).map(str::to_string))
        .unwrap_or_else(|| PLACEHOLDER_LINE.to_string())
}

/// 假供应商完成后的产物：镜头出纯色 PNG（画镜号），配音出 WAV。走正式的素材存储，任务记下 asset_id。
/// 分镜组只是容器、导出由导出命令做，其他节点不出文件。
fn fake_output(p: &mut Project, job_id: &str, node_id: &str) -> Result<()> {
    use drama_core::asset::AssetMeta;
    use drama_core::fake_media as fm;
    use drama_core::model::NodeKind;
    let already: Option<String> =
        p.store.conn().query_row("SELECT asset_id FROM jobs WHERE id = ?1", [job_id], |r| r.get(0)).map_err(StoreError::from)?;
    if already.is_some() {
        return Ok(());
    }
    let Some(kind) = p.graph.node(node_id).map(|n| n.kind) else { return Ok(()) };
    let (data, meta) = match kind {
        NodeKind::Shot => {
            let mut shots: Vec<String> = p.graph.snapshot().nodes.into_iter().filter(|n| n.node.kind == NodeKind::Shot).map(|n| n.node.id).collect();
            shots.sort();
            let number = shots.iter().position(|s| s == node_id).map(|i| i as u32 + 1).unwrap_or(1);
            let png = fm::shot_png(number, fm::colour_for(node_id));
            (png, AssetMeta { mime: "image/png".into(), width: Some(fm::PNG_W), height: Some(fm::PNG_H), duration_ms: None })
        }
        NodeKind::Voice => {
            let spec = p.store.job(job_id)?.map(|j| j.spec).unwrap_or_default();
            let ms = fm::estimate_speech_ms(&spec_text(&spec));
            (fm::wav(ms), AssetMeta { mime: "audio/wav".into(), width: None, height: None, duration_ms: Some(ms) })
        }
        _ => return Ok(()),
    };
    let a = p.store.put_asset(&p.dir, &new_ulid(), &data, &meta)?;
    p.store.set_job_asset(job_id, &a.id)?;
    Ok(())
}

/// 一直推进到结束，每一步都推事件。锁只在单步里拿，等待时不占库。
pub fn run(
    st: &DramaState,
    id: &str,
    job_id: &str,
    wait: impl Fn(Duration),
    emit: impl Fn(&JobEvent),
) -> Result<JobEvent> {
    for _ in 0..MAX_STEPS {
        let (ev, next) = step(st, id, job_id)?;
        emit(&ev);
        match next {
            Some(d) => wait(d),
            None => return Ok(ev),
        }
    }
    Err(CommandError::new(Code::Io, "任务推进次数超限"))
}

/// 列出项目里全部任务的当前状态。前端进画布时拉一次，之后靠推送更新。
pub fn list_jobs(st: &DramaState, id: &str) -> Result<Vec<JobEvent>> {
    with_project(st, id, |p| Ok(p.store.all_jobs()?.into_iter().map(row_event).collect()))
}

fn row_event(j: drama_core::store::JobRow) -> JobEvent {
    JobEvent {
        job_id: j.id,
        node_id: j.node_id,
        status: j.status,
        progress: j.progress,
        cost_usd: j.cost_usd,
        error_code: j.error_code,
        error: j.error,
    }
}
