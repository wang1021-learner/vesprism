use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct WorkbenchArtifactDto {
    pub kind: String,
    pub id: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkbenchBindingDto {
    pub session_id: String,
    pub active_workbench_view: Option<String>,
    pub artifacts: Vec<WorkbenchArtifactDto>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BindWorkbenchArtifactRequest {
    pub session_id: String,
    pub kind: String,
    pub id: String,
    #[serde(default)]
    pub active_workbench_view: Option<String>,
}

#[tauri::command]
pub fn get_workbench_binding(session_id: String) -> Result<Option<WorkbenchBindingDto>, String> {
    let Some(binding) = crate::session_index::get_thread_workbench_binding(&session_id)? else {
        return Ok(None);
    };
    Ok(Some(WorkbenchBindingDto {
        session_id: binding.session_id,
        active_workbench_view: binding.active_workbench_view,
        artifacts: binding
            .artifacts
            .into_iter()
            .map(|item| WorkbenchArtifactDto {
                kind: item.kind,
                id: item.id,
                updated_at_ms: item.updated_at_ms,
            })
            .collect(),
        updated_at_ms: binding.updated_at_ms,
    }))
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkbenchSessionDto {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub cwd: String,
    pub preview: String,
    pub num_messages: usize,
}

/// 侧栏「工作台」会话记录：有产物绑定的画布/编制干活会话，不和主聊天混。
#[tauri::command]
pub fn list_workbench_sessions(limit: Option<u32>) -> Result<Vec<WorkbenchSessionDto>, String> {
    let listed = crate::session_index::list_workbench_threads(limit)?;
    Ok(listed
        .into_iter()
        .map(|r| WorkbenchSessionDto {
            id: r.id,
            title: r.title,
            updated_at: r.updated_at,
            cwd: r.cwd,
            preview: r.preview,
            num_messages: r.num_messages,
        })
        .collect())
}

#[tauri::command]
pub fn list_workbench_bindings(
    session_ids: Vec<String>,
) -> Result<Vec<WorkbenchBindingDto>, String> {
    let mut out = Vec::new();
    for id in session_ids {
        if let Some(binding) = get_workbench_binding(id)? {
            out.push(binding);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn bind_workbench_artifact(
    payload: BindWorkbenchArtifactRequest,
) -> Result<Option<WorkbenchBindingDto>, String> {
    crate::session_index::add_thread_workbench_artifact(
        &payload.session_id,
        &payload.kind,
        &payload.id,
        payload.active_workbench_view.as_deref(),
    )?;
    get_workbench_binding(payload.session_id)
}
