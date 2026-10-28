//! 漫剧命令。整块在 `drama` 开关后面；项目目录只在 `~/.vesprism/drama/<ULID>/`。
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use drama_core::error::LinkError;
use drama_core::graph::Graph;
use drama_core::model::{EntityId, GraphView, Link};
use drama_core::store::{Store, StoreError};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    TypeMismatch,
    Cycle,
    ScriptLocked,
    NotFound,
    StaleNotConfirmed,
    /// 项目里有违反端口表的旧连线，导出前要先删掉
    InvalidLink,
    Io,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommandError {
    pub code: Code,
    pub message: String,
    /// `invalid_link` 时带上全部非法连线（可直接交给 drama_unlink）；其他错误不出现这个字段
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<Link>,
}

impl CommandError {
    fn new(code: Code, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), links: Vec::new() }
    }
}

impl From<LinkError> for CommandError {
    fn from(e: LinkError) -> Self {
        let code = match e {
            LinkError::TypeMismatch => Code::TypeMismatch,
            LinkError::Cycle => Code::Cycle,
            LinkError::ScriptLocked => Code::ScriptLocked,
            LinkError::NotFound => Code::NotFound,
        };
        Self::new(code, e.to_string())
    }
}

impl From<StoreError> for CommandError {
    fn from(e: StoreError) -> Self {
        Self::new(Code::Io, e.to_string())
    }
}

type Result<T> = std::result::Result<T, CommandError>;

mod grok_image;
mod jobs;
mod projects;
pub use projects::{create_project, list_projects};

/// 一个项目：唯一的写连接 + 内存里的图。
pub struct Project {
    /// 项目目录（库和 assets/ 都在这里）
    dir: PathBuf,
    store: Store,
    graph: Graph,
}

/// 放进 Tauri State：每个项目只开一个写连接，命令共用。
pub struct DramaState {
    root: PathBuf,
    projects: Mutex<HashMap<String, Arc<Mutex<Project>>>>,
    /// 现在只有假 Provider；真供应商接入时换掉这里。
    fake: drama_core::provider::FakeProvider,
}

impl DramaState {
    pub fn new(root: PathBuf) -> Self {
        Self { root, projects: Mutex::new(HashMap::new()), fake: jobs::fake_provider() }
    }

    pub fn default_root() -> PathBuf {
        dirs::home_dir().unwrap_or_default().join(".vesprism").join("drama")
    }

    /// 只认 ULID；目录由后端拼；项目库不存在就 not_found，不建空库。
    fn project(&self, project_id: &str) -> Result<Arc<Mutex<Project>>> {
        if !is_ulid(project_id) {
            return Err(CommandError::new(Code::NotFound, "项目不存在"));
        }
        let mut map = self.projects.lock().expect("drama state poisoned");
        if let Some(p) = map.get(project_id) {
            return Ok(p.clone());
        }
        let dir = self.root.join(project_id);
        let db = dir.join("project.sqlite");
        if !db.is_file() {
            return Err(CommandError::new(Code::NotFound, "项目不存在"));
        }
        let store = Store::open(&db)?;
        let graph = store.load_graph()?;
        let p = Arc::new(Mutex::new(Project { dir, store, graph }));
        map.insert(project_id.to_string(), p.clone());
        Ok(p)
    }

    fn insert(&self, id: &str, p: Project) {
        self.projects.lock().expect("drama state poisoned").insert(id.to_string(), Arc::new(Mutex::new(p)));
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

fn is_ulid(s: &str) -> bool {
    s.len() == 26
        && s.bytes().all(|b| b"0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(&b.to_ascii_uppercase()))
        && s.as_bytes()[0] <= b'7'
}

fn with_project<T>(st: &DramaState, id: &str, f: impl FnOnce(&mut Project) -> Result<T>) -> Result<T> {
    let p = st.project(id)?;
    let mut p = p.lock().expect("project poisoned");
    f(&mut p)
}

/// 整张图 + 已存的位置 + 每个节点最近一次成功的素材（路径已校验、是绝对路径）。
fn view(p: &mut Project) -> Result<GraphView> {
    use drama_core::asset::Slot;
    let mut v = p.graph.snapshot();
    v.layout = p.store.layouts()?;
    let refs = p.store.latest_refs(&p.dir, &p.graph)?;
    for n in &mut v.nodes {
        let get = |s: Slot| refs.get(&(n.node.id.clone(), s)).cloned();
        if n.image.is_some() {
            n.image = Some(get(Slot::Image));
            n.video = Some(get(Slot::Video));
        } else {
            n.asset = Some(get(Slot::Single));
        }
    }
    Ok(v)
}

/// 按库里的相对路径取素材绝对路径；`..`、绝对路径、跑出 assets/ 的都是 not_found。
#[allow(dead_code)] // 给后续按相对路径取素材的命令用；现在只有测试调用
pub fn asset_path(st: &DramaState, id: &str, rel_path: &str) -> Result<PathBuf> {
    with_project(st, id, |p| {
        drama_core::asset::resolve(&p.dir, rel_path).ok_or_else(|| CommandError::new(Code::NotFound, "素材不存在"))
    })
}

// ---- 纯逻辑（可测，不碰 Tauri）----

pub fn load_graph(st: &DramaState, id: &str) -> Result<GraphView> {
    with_project(st, id, view)
}

pub fn link(st: &DramaState, id: &str, l: Link) -> Result<GraphView> {
    with_project(st, id, |p| {
        p.graph.link(l)?;
        p.store.save_graph(&p.graph)?;
        view(p)
    })
}

pub fn unlink(st: &DramaState, id: &str, l: Link) -> Result<GraphView> {
    with_project(st, id, |p| {
        p.graph.unlink(&l)?;
        p.store.save_graph(&p.graph)?;
        view(p)
    })
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddNodeResult {
    pub graph: GraphView,
    pub node_id: EntityId,
}

/// 新建节点：id 后端生成，端口按类型默认，位置一起存。返回整张图和新节点 id。
pub fn add_node(st: &DramaState, id: &str, kind: drama_core::model::NodeKind, pos: Position) -> Result<AddNodeResult> {
    with_project(st, id, |p| {
        let (inputs, outputs) = kind.default_ports();
        let nid = projects::new_ulid();
        p.graph.add_node(drama_core::model::Node { id: nid.clone(), kind, inputs, outputs, locked: false, needs_update: false, text: String::new() });
        p.store.save_graph(&p.graph)?;
        p.store.set_layout(&nid, pos.x, pos.y, false)?;
        Ok(AddNodeResult { graph: view(p)?, node_id: nid })
    })
}

/// 删节点，连线和位置一起删。定稿的返回 script_locked。
pub fn remove_node(st: &DramaState, id: &str, node: &str) -> Result<GraphView> {
    with_project(st, id, |p| {
        p.graph.remove_node(node)?;
        p.store.save_graph(&p.graph)?;
        view(p)
    })
}

pub fn set_text(st: &DramaState, id: &str, node: &str, text: String) -> Result<GraphView> {
    with_project(st, id, |p| {
        p.graph.set_text(node, text)?;
        p.store.save_graph(&p.graph)?;
        view(p)
    })
}

pub fn set_layout(st: &DramaState, id: &str, node: &str, x: f64, y: f64, collapsed: bool) -> Result<()> {
    with_project(st, id, |p| {
        if p.graph.node(node).is_none() {
            return Err(CommandError::new(Code::NotFound, "节点不存在"));
        }
        Ok(p.store.set_layout(node, x, y, collapsed)?)
    })
}

/// 用户在「结果不明」卡片上确认后：清回排队，等队列重新提交。
pub fn retry_confirmed(st: &DramaState, id: &str, job_id: &str) -> Result<()> {
    with_project(st, id, |p| {
        if p.store.job(job_id)?.is_none() {
            return Err(CommandError::new(Code::NotFound, "任务不存在"));
        }
        Ok(p.store.reset_for_retry(job_id)?)
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub snapshot_id: i64,
    pub flagged: Vec<(EntityId, String)>,
    /// 导出用到的直接上游素材（最近一次成功的结果）
    pub inputs: Vec<drama_core::asset::AssetRef>,
}

/// 有角标却没确认，就拒绝，不导出也不记快照。
pub fn export(st: &DramaState, id: &str, export_node: &str, stale_confirmed: bool) -> Result<ExportResult> {
    with_project(st, id, |p| {
        if p.graph.node(export_node).is_none() {
            return Err(CommandError::new(Code::NotFound, "导出节点不存在"));
        }
        // 先查非法连线：带了 staleConfirmed 也不放行，不导出、不记快照。
        let bad = p.graph.invalid_links();
        if !bad.is_empty() {
            let mut e = CommandError::new(Code::InvalidLink, "有不合法的连线，请先删除后再导出");
            e.links = bad;
            return Err(e);
        }
        let flags = p.graph.stale_flags();
        if !flags.is_empty() && !stale_confirmed {
            return Err(CommandError::new(Code::StaleNotConfirmed, "部分素材不是最新"));
        }
        let sid = p.store.record_export(export_node, stale_confirmed, &p.graph)?;
        let snap = p.store.export_snapshot(sid)?.expect("just inserted");
        let refs = p.store.latest_refs(&p.dir, &p.graph)?;
        let mut ups: Vec<&Link> = p.graph.links().filter(|l| l.to == export_node).collect();
        ups.sort_by_key(|l| (l.from.clone(), format!("{:?}", l.port)));
        let mut inputs = Vec::new();
        for l in ups {
            let slot = match (p.graph.node(&l.from).map(|n| n.kind), l.port) {
                (Some(drama_core::model::NodeKind::Shot), drama_core::model::PortType::Video) => drama_core::asset::Slot::Video,
                (Some(drama_core::model::NodeKind::Shot), _) => drama_core::asset::Slot::Image,
                _ => drama_core::asset::Slot::Single,
            };
            // 镜头还没有视频（假供应商只出图）时用图顶上，导出能走通
            let r = refs.get(&(l.from.clone(), slot)).or_else(|| {
                (slot == drama_core::asset::Slot::Video).then(|| refs.get(&(l.from.clone(), drama_core::asset::Slot::Image))).flatten()
            });
            if let Some(r) = r {
                if !inputs.contains(r) {
                    inputs.push(r.clone());
                }
            }
        }
        Ok(ExportResult { snapshot_id: sid, flagged: snap.flagged, inputs })
    })
}

// ---- Tauri 命令：读写库都在 spawn_blocking 里 ----

async fn blocking<T: Send + 'static>(
    app: tauri::AppHandle,
    f: impl FnOnce(&DramaState) -> Result<T> + Send + 'static,
) -> Result<T> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<DramaState>()))
        .await
        .map_err(|e| CommandError::new(Code::Io, e.to_string()))?
}

#[tauri::command]
pub async fn drama_load_graph(app: tauri::AppHandle, project_id: String) -> Result<GraphView> {
    blocking(app, move |s| load_graph(s, &project_id)).await
}

#[tauri::command]
pub async fn drama_link(app: tauri::AppHandle, project_id: String, link: Link) -> Result<GraphView> {
    blocking(app, move |s| self::link(s, &project_id, link)).await
}

#[tauri::command]
pub async fn drama_unlink(app: tauri::AppHandle, project_id: String, link: Link) -> Result<GraphView> {
    blocking(app, move |s| self::unlink(s, &project_id, link)).await
}

#[tauri::command]
pub async fn drama_add_node(
    app: tauri::AppHandle,
    project_id: String,
    kind: drama_core::model::NodeKind,
    position: Position,
) -> Result<AddNodeResult> {
    blocking(app, move |s| add_node(s, &project_id, kind, position)).await
}

#[tauri::command]
pub async fn drama_remove_node(app: tauri::AppHandle, project_id: String, node_id: String) -> Result<GraphView> {
    blocking(app, move |s| remove_node(s, &project_id, &node_id)).await
}

#[tauri::command]
pub async fn drama_set_text(
    app: tauri::AppHandle,
    project_id: String,
    node_id: String,
    text: String,
) -> Result<GraphView> {
    blocking(app, move |s| set_text(s, &project_id, &node_id, text)).await
}

#[tauri::command]
pub async fn drama_set_layout(
    app: tauri::AppHandle,
    project_id: String,
    node_id: String,
    x: f64,
    y: f64,
    collapsed: bool,
) -> Result<()> {
    blocking(app, move |s| set_layout(s, &project_id, &node_id, x, y, collapsed)).await
}

#[tauri::command]
pub async fn drama_retry_confirmed(app: tauri::AppHandle, project_id: String, job_id: String) -> Result<()> {
    let (pid, jid) = (project_id.clone(), job_id.clone());
    blocking(app.clone(), move |s| retry_confirmed(s, &pid, &jid)).await?;
    spawn_runner(app, project_id, job_id);
    Ok(())
}

#[tauri::command]
pub async fn drama_export(
    app: tauri::AppHandle,
    project_id: String,
    export_node_id: String,
    stale_confirmed: Option<bool>,
) -> Result<ExportResult> {
    blocking(app, move |s| export(s, &project_id, &export_node_id, stale_confirmed.unwrap_or(false))).await
}

/// 任务事件推给前端：`drama://job`。
pub const JOB_EVENT: &str = "drama://job";

pub fn emit_job(app: &tauri::AppHandle, ev: &drama_core::event::JobEvent) {
    use tauri::Emitter;
    if let Err(e) = app.emit(JOB_EVENT, ev) {
        log::warn!("[drama] emit job event failed: {e}");
    }
}

#[tauri::command]
pub async fn drama_create_project(app: tauri::AppHandle, name: Option<String>) -> Result<projects::ProjectSummary> {
    blocking(app, move |s| create_project(s, name)).await
}

#[tauri::command]
pub async fn drama_list_projects(app: tauri::AppHandle) -> Result<projects::ProjectList> {
    blocking(app, list_projects).await
}

/// 建任务后立刻返回「排队」事件（前端拿 jobId 建卡），后台推进，每一步推 `drama://job`。
#[tauri::command]
pub async fn drama_start_job(
    app: tauri::AppHandle,
    project_id: String,
    node_id: String,
) -> Result<drama_core::event::JobEvent> {
    let pid = project_id.clone();
    let ev = blocking(app.clone(), move |s| jobs::start_job(s, &pid, &node_id)).await?;
    emit_job(&app, &ev);
    spawn_runner(app, project_id, ev.job_id.clone());
    Ok(ev)
}

fn spawn_runner(app: tauri::AppHandle, project_id: String, job_id: String) {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let st = app.state::<DramaState>();
        if let Err(e) = jobs::run(&st, &project_id, &job_id, std::thread::sleep, |ev| emit_job(&app, ev)) {
            log::warn!("[drama] job {job_id} stopped: {}", e.message);
        }
    });
}

#[tauri::command]
pub async fn drama_list_jobs(app: tauri::AppHandle, project_id: String) -> Result<Vec<drama_core::event::JobEvent>> {
    blocking(app, move |s| jobs::list_jobs(s, &project_id)).await
}

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        drama_load_graph,
        drama_link,
        drama_unlink,
        drama_set_layout,
        drama_set_text,
        drama_retry_confirmed,
        drama_export,
        drama_create_project,
        drama_list_projects,
        drama_start_job,
        drama_list_jobs,
        drama_add_node,
        drama_remove_node
    ]
}

#[cfg(test)]
mod tests;