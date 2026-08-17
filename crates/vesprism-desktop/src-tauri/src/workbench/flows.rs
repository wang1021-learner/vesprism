//! 流程草稿 + 官方 sidecar 包。
//!
//! - 草稿：`~/.vesprism/flow-drafts/<id>.json`（含坐标，不发布）
//! - 发布：`$GROK_HOME/workflows/<id>.rhai` + `<id>.flow.yaml`（引擎发现/挂载）
//! - zip：根目录就这两文件；坐标永不进包
//!
//! 旧目录 `~/.vesprism/flows/<id>/` 只作读取回退，新发布不再写入。

use crate::commands::desktop_home_dir;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const ABS_HINTS: &[&str] = &["https://", "http://"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowYaml {
    pub id: String,
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub output_schema: Value,
    pub version: String,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

/// `.vesp` 自包含标准件的运行环境声明（`requirements.yaml`）。
/// models 是软约束（推荐模型，可映射/忽略），tools 是硬约束（缺了跑不动）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Requirements {
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveFlowRequest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub input_schema: Value,
    #[serde(default)]
    pub output_schema: Value,
    #[serde(default)]
    pub nodes: Value,
    #[serde(default)]
    pub edges: Value,
    #[serde(default)]
    pub publish: bool,
    #[serde(default)]
    pub stage: bool,
    pub rhai: Option<String>,
    pub prompts: Option<String>,
}

fn default_version() -> String {
    "1".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowListItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub published: bool,
    pub draft: bool,
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub published: bool,
    pub draft: bool,
    pub dependencies: Vec<String>,
    pub input_schema: Value,
    pub output_schema: Value,
    pub nodes: Value,
    pub edges: Value,
    pub rhai: Option<String>,
    pub prompts: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum ImportFlowResult {
    #[serde(rename = "ok")]
    Ok {
        id: String,
        version: String,
        #[serde(default)]
        requirements: Requirements,
        #[serde(default)]
        missing_tools: Vec<String>,
    },
    #[serde(rename = "conflict")]
    Conflict {
        id: String,
        existing_version: String,
        incoming_version: String,
        #[serde(default)]
        requirements: Requirements,
    },
    #[serde(rename = "missing_deps")]
    MissingDeps { id: String, missing: Vec<String> },
    #[serde(rename = "cancelled")]
    Cancelled,
}

fn drafts_dir() -> PathBuf {
    desktop_home_dir().join("flow-drafts")
}

fn packages_dir() -> PathBuf {
    desktop_home_dir().join("flows")
}

fn workflows_dir() -> PathBuf {
    desktop_home_dir().join("workflows")
}

fn package_dir(id: &str) -> PathBuf {
    packages_dir().join(id)
}

fn sidecar_rhai(id: &str) -> PathBuf {
    workflows_dir().join(format!("{id}.rhai"))
}

fn sidecar_yaml(id: &str) -> PathBuf {
    workflows_dir().join(format!("{id}.flow.yaml"))
}

fn draft_path(id: &str) -> PathBuf {
    drafts_dir().join(format!("{id}.json"))
}

pub fn is_valid_flow_id(id: &str) -> bool {
    let s = id.trim();
    if s.is_empty() || s.len() > 64 {
        return false;
    }
    let mut prev_hyphen = false;
    let mut started = false;
    for c in s.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            prev_hyphen = false;
            started = true;
        } else if c == '-' {
            if !started || prev_hyphen {
                return false;
            }
            prev_hyphen = true;
        } else {
            return false;
        }
    }
    started && !prev_hyphen
}

fn ensure_id(id: &str) -> Result<String, String> {
    let id = id.trim();
    if !is_valid_flow_id(id) {
        return Err(format!(
            "流程 id 无效: {id:?}。请用 1-64 位小写字母、数字、单连字符"
        ));
    }
    Ok(id.to_string())
}

pub fn strip_positions(nodes: &Value) -> Value {
    match nodes {
        Value::Array(arr) => Value::Array(
            arr.iter()
                .map(|n| {
                    let mut obj = match n {
                        Value::Object(m) => m.clone(),
                        other => return other.clone(),
                    };
                    obj.remove("position");
                    obj.remove("positionAbsolute");
                    obj.remove("width");
                    obj.remove("height");
                    obj.remove("selected");
                    obj.remove("dragging");
                    Value::Object(obj)
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

pub fn text_has_absolute_path(text: &str) -> bool {
    if text.contains("://") && ABS_HINTS.iter().any(|h| text.contains(h)) {
        // URL 允许；真正的盘符 / UNC / Unix 家目录才拦
    }
    let bytes = text.as_bytes();
    // C:\ or C:/
    for i in 0..bytes.len().saturating_sub(2) {
        let c = bytes[i];
        if c.is_ascii_alphabetic()
            && bytes[i + 1] == b':'
            && (bytes[i + 2] == b'\\' || bytes[i + 2] == b'/')
        {
            let ok_prev = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
            if ok_prev {
                return true;
            }
        }
    }
    if text.contains("\\\\") {
        return true;
    }
    for prefix in ["/home/", "/Users/", "/usr/", "/var/", "/opt/", "/tmp/"] {
        if text.contains(prefix) {
            return true;
        }
    }
    false
}

fn reject_abs(label: &str, text: &str) -> Result<(), String> {
    if text_has_absolute_path(text) {
        return Err(format!("{label} 含绝对路径，流程包内引用必须是相对路径或 id"));
    }
    Ok(())
}

fn write_yaml(meta: &FlowYaml) -> Result<String, String> {
    serde_yaml::to_string(meta).map_err(|e| format!("序列化 flow.yaml 失败: {e}"))
}

fn parse_yaml(text: &str) -> Result<FlowYaml, String> {
    serde_yaml::from_str(text).map_err(|e| format!("解析 flow.yaml 失败: {e}"))
}

fn collect_deps_from_nodes(nodes: &Value) -> Vec<String> {
    let mut deps = Vec::new();
    let Some(arr) = nodes.as_array() else {
        return deps;
    };
    for n in arr {
        let ty = n.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if ty != "flow" {
            continue;
        }
        let id = n
            .get("params")
            .and_then(|p| p.get("flowId"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if !id.is_empty() && !deps.iter().any(|d| d == id) {
            deps.push(id.to_string());
        }
    }
    deps.sort();
    deps
}

/// 从代办节点命令取第一个词当命令名（`cargo test` → `cargo`，`npm run x` → `npm`）。
fn command_name(cmd: &str) -> Option<String> {
    let first = cmd.trim().split_whitespace().next()?;
    let base = first
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(first)
        .trim()
        .trim_matches(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'));
    if base.is_empty() {
        None
    } else {
        Some(base.to_string())
    }
}

/// 从节点收集运行环境声明：agent 的 model（软）+ 代办节点的命令（硬）。
fn collect_requirements(nodes: &Value) -> Requirements {
    let mut models = Vec::new();
    let mut tools = Vec::new();
    let Some(arr) = nodes.as_array() else {
        return Requirements::default();
    };
    for n in arr {
        let ty = n.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let params = n.get("params");
        match ty {
            "agent" => {
                if let Some(m) = params.and_then(|p| p.get("model")).and_then(|v| v.as_str()) {
                    let m = m.trim();
                    if !m.is_empty() && !models.iter().any(|x| x == m) {
                        models.push(m.to_string());
                    }
                }
            }
            "tool" => {
                if let Some(c) = params
                    .and_then(|p| p.get("command"))
                    .and_then(|v| v.as_str())
                {
                    if let Some(name) = command_name(c) {
                        if !tools.iter().any(|x| x == &name) {
                            tools.push(name);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    models.sort();
    tools.sort();
    Requirements { models, tools }
}

fn command_available(cmd: &str) -> bool {
    if cmd.trim().is_empty() {
        return true;
    }
    #[cfg(windows)]
    let mut probe = std::process::Command::new("where");
    #[cfg(not(windows))]
    let mut probe = std::process::Command::new("which");
    probe.arg(cmd);
    probe
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn missing_tools(tools: &[String]) -> Vec<String> {
    tools
        .iter()
        .filter(|t| !command_available(t))
        .cloned()
        .collect()
}

fn mkdir(p: &Path) -> Result<(), String> {
    fs::create_dir_all(p).map_err(|e| format!("创建目录失败 {}: {e}", p.display()))
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        mkdir(parent)?;
    }
    fs::write(path, bytes).map_err(|e| format!("写入 {} 失败: {e}", path.display()))
}

fn read_to_string(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))
}

fn register_rhai(id: &str, rhai: &str) -> Result<(), String> {
    mkdir(&workflows_dir())?;
    write_file(&sidecar_rhai(id), rhai.as_bytes())
}

fn write_sidecar(id: &str, yaml: &str, rhai: &str) -> Result<(), String> {
    mkdir(&workflows_dir())?;
    write_file(&sidecar_yaml(id), yaml.as_bytes())?;
    write_file(&sidecar_rhai(id), rhai.as_bytes())
}

/// 组装单 `flows: [id]`：确认官方 sidecar 存在（旧包目录则迁移过去）。
pub fn register_flows(ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    for id in ids {
        let id = ensure_id(id)?;
        if sidecar_rhai(&id).is_file() && sidecar_yaml(&id).is_file() {
            continue;
        }
        let old_rhai = package_dir(&id).join("flow.rhai");
        let old_yaml = package_dir(&id).join("flow.yaml");
        if old_rhai.is_file() && old_yaml.is_file() {
            write_sidecar(&id, &read_to_string(&old_yaml)?, &read_to_string(&old_rhai)?)?;
            continue;
        }
        return Err(format!(
            "组装单引用的流程缺失 sidecar：{id}.rhai / {id}.flow.yaml"
        ));
    }
    Ok(())
}

fn load_draft(id: &str) -> Option<Value> {
    let p = draft_path(id);
    if !p.is_file() {
        return None;
    }
    fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn load_package_meta(id: &str) -> Option<FlowYaml> {
    for p in [sidecar_yaml(id), package_dir(id).join("flow.yaml")] {
        if p.is_file() {
            if let Some(meta) = fs::read_to_string(p).ok().and_then(|s| parse_yaml(&s).ok()) {
                return Some(meta);
            }
        }
    }
    None
}

fn load_published_rhai(id: &str) -> Option<String> {
    fs::read_to_string(sidecar_rhai(id))
        .ok()
        .or_else(|| fs::read_to_string(package_dir(id).join("flow.rhai")).ok())
}

fn write_package(req: &SaveFlowRequest, deps: &[String]) -> Result<(), String> {
    if req.description.trim().is_empty() {
        return Err("发布需要填写「给 agent 看的说明」".into());
    }
    let rhai = req
        .rhai
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "发布缺少 flow.rhai".to_string())?;
    reject_abs("flow.rhai", rhai)?;
    let graph = serde_json::json!({
        "nodes": strip_positions(&req.nodes),
        "edges": req.edges,
    });
    let graph_text = serde_json::to_string_pretty(&graph).map_err(|e| e.to_string())?;
    reject_abs("graph.json", &graph_text)?;
    if let Some(p) = req.prompts.as_deref() {
        reject_abs("prompts.md", p)?;
    }
    let meta = FlowYaml {
        id: req.id.clone(),
        name: req.name.clone(),
        description: req.description.clone(),
        input_schema: req.input_schema.clone(),
        output_schema: req.output_schema.clone(),
        version: req.version.clone(),
        dependencies: deps.to_vec(),
    };
    let yaml = write_yaml(&meta)?;
    reject_abs("flow.yaml", &yaml)?;
    for dep in deps {
        ensure_id(dep)?;
    }

    // 发布只写官方 sidecar；graph/坐标留在草稿。v1 内联后 dependencies 为空。
    let published = FlowYaml {
        dependencies: Vec::new(),
        ..meta
    };
    let published_yaml = write_yaml(&published)?;
    write_sidecar(&req.id, &published_yaml, rhai)?;
    let _ = graph_text;
    Ok(())
}

fn write_draft(req: &SaveFlowRequest) -> Result<(), String> {
    mkdir(&drafts_dir())?;
    let json = serde_json::json!({
        "id": req.id,
        "name": req.name,
        "description": req.description,
        "version": req.version,
        "input_schema": req.input_schema,
        "output_schema": req.output_schema,
        "nodes": req.nodes,
        "edges": req.edges,
        "rhai": req.rhai,
        "prompts": req.prompts,
    });
    let text = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    write_file(&draft_path(&req.id), text.as_bytes())
}

#[tauri::command]
pub fn save_flow(payload: SaveFlowRequest) -> Result<FlowRecord, String> {
    let id = ensure_id(&payload.id)?;
    let mut req = payload;
    req.id = id.clone();
    if req.name.trim().is_empty() {
        req.name = id.clone();
    }
    let mut deps = collect_deps_from_nodes(&req.nodes);
    deps.sort();
    deps.dedup();
    write_draft(&req)?;
    if req.publish {
        write_package(&req, &deps)?;
    } else if req.stage {
        if let Some(rhai) = req.rhai.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            register_rhai(&id, rhai)?;
        }
    }
    get_flow(id)
}

#[tauri::command]
pub fn list_flows() -> Result<Vec<FlowListItem>, String> {
    let mut map = std::collections::BTreeMap::<String, FlowListItem>::new();
    if drafts_dir().is_dir() {
        let rd = fs::read_dir(drafts_dir()).map_err(|e| e.to_string())?;
        for ent in rd.flatten() {
            let path = ent.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Some(v) = fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            else {
                continue;
            };
            let id = v
                .get("id")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if !is_valid_flow_id(&id) {
                continue;
            }
            map.insert(
                id.clone(),
                FlowListItem {
                    id,
                    name: v
                        .get("name")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    description: v
                        .get("description")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string(),
                    version: v
                        .get("version")
                        .and_then(|x| x.as_str())
                        .unwrap_or("1")
                        .to_string(),
                    published: false,
                    draft: true,
                    dependencies: collect_deps_from_nodes(v.get("nodes").unwrap_or(&Value::Null)),
                },
            );
        }
    }
    if workflows_dir().is_dir() {
        let rd = fs::read_dir(workflows_dir()).map_err(|e| e.to_string())?;
        for ent in rd.flatten() {
            let path = ent.path();
            let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let Some(id) = name.strip_suffix(".flow.yaml") else {
                continue;
            };
            if !is_valid_flow_id(id) {
                continue;
            }
            let Some(meta) = load_package_meta(id) else {
                continue;
            };
            let e = map.entry(meta.id.clone()).or_insert(FlowListItem {
                id: meta.id.clone(),
                name: meta.name.clone(),
                description: meta.description.clone(),
                version: meta.version.clone(),
                published: true,
                draft: false,
                dependencies: meta.dependencies.clone(),
            });
            e.published = true;
            e.version = meta.version;
            if e.name.is_empty() {
                e.name = meta.name;
            }
            if e.description.is_empty() {
                e.description = meta.description;
            }
            if e.dependencies.is_empty() {
                e.dependencies = meta.dependencies;
            }
        }
    }
    if packages_dir().is_dir() {
        let rd = fs::read_dir(packages_dir()).map_err(|e| e.to_string())?;
        for ent in rd.flatten() {
            if !ent.path().is_dir() {
                continue;
            }
            let Some(meta) = load_package_meta(&ent.file_name().to_string_lossy()) else {
                continue;
            };
            map.entry(meta.id.clone()).or_insert(FlowListItem {
                id: meta.id,
                name: meta.name,
                description: meta.description,
                version: meta.version,
                published: true,
                draft: false,
                dependencies: meta.dependencies,
            });
        }
    }
    Ok(map.into_values().collect())
}

#[tauri::command]
pub fn get_flow(id: String) -> Result<FlowRecord, String> {
    let id = ensure_id(&id)?;
    let draft = load_draft(&id);
    let pkg = load_package_meta(&id);
    if draft.is_none() && pkg.is_none() {
        return Err(format!("流程不存在: {id}"));
    }
    let mut rec = FlowRecord {
        id: id.clone(),
        name: id.clone(),
        description: String::new(),
        version: "1".into(),
        published: pkg.is_some(),
        draft: draft.is_some(),
        dependencies: Vec::new(),
        input_schema: serde_json::json!({"type":"object"}),
        output_schema: serde_json::json!({"type":"object"}),
        nodes: Value::Array(vec![]),
        edges: Value::Array(vec![]),
        rhai: None,
        prompts: None,
    };
    if let Some(meta) = pkg {
        rec.name = meta.name;
        rec.description = meta.description;
        rec.version = meta.version;
        rec.input_schema = meta.input_schema;
        rec.output_schema = meta.output_schema;
        rec.dependencies = meta.dependencies;
        rec.published = true;
        rec.rhai = load_published_rhai(&id);
        rec.prompts = fs::read_to_string(package_dir(&id).join("prompts.md")).ok();
        let old_graph = package_dir(&id).join("graph.json");
        if let Ok(g) = fs::read_to_string(old_graph) {
            if let Ok(v) = serde_json::from_str::<Value>(&g) {
                rec.nodes = v.get("nodes").cloned().unwrap_or(Value::Array(vec![]));
                rec.edges = v.get("edges").cloned().unwrap_or(Value::Array(vec![]));
            }
        }
    }
    if let Some(d) = draft {
        rec.draft = true;
        if let Some(s) = d.get("name").and_then(|x| x.as_str()) {
            rec.name = s.to_string();
        }
        if let Some(s) = d.get("description").and_then(|x| x.as_str()) {
            rec.description = s.to_string();
        }
        if let Some(s) = d.get("version").and_then(|x| x.as_str()) {
            rec.version = s.to_string();
        }
        if let Some(v) = d.get("input_schema") {
            rec.input_schema = v.clone();
        }
        if let Some(v) = d.get("output_schema") {
            rec.output_schema = v.clone();
        }
        if let Some(v) = d.get("nodes") {
            rec.nodes = v.clone();
        }
        if let Some(v) = d.get("edges") {
            rec.edges = v.clone();
        }
        rec.rhai = d
            .get("rhai")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .or(rec.rhai);
        rec.prompts = d
            .get("prompts")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .or(rec.prompts);
        rec.dependencies = collect_deps_from_nodes(&rec.nodes);
    }
    Ok(rec)
}

#[tauri::command]
pub fn delete_flow(id: String) -> Result<(), String> {
    let id = ensure_id(&id)?;
    let dp = draft_path(&id);
    if dp.exists() {
        fs::remove_file(&dp).map_err(|e| format!("删除草稿失败: {e}"))?;
    }
    let pkg = package_dir(&id);
    if pkg.exists() {
        fs::remove_dir_all(&pkg).map_err(|e| format!("删除流程包失败: {e}"))?;
    }
    let _ = fs::remove_file(sidecar_rhai(&id));
    let _ = fs::remove_file(sidecar_yaml(&id));
    Ok(())
}

fn add_zip_file(
    zip: &mut zip::ZipWriter<fs::File>,
    name: &str,
    bytes: &[u8],
) -> Result<(), String> {
    if text_has_absolute_path(name) {
        return Err("zip 条目名不能含绝对路径".into());
    }
    if name.contains("position") {
        return Err("zip 条目异常".into());
    }
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file(name, opts)
        .map_err(|e| format!("zip 写入 {name} 失败: {e}"))?;
    zip.write_all(bytes)
        .map_err(|e| format!("zip 写入 {name} 失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn export_flow(id: String, dest_path: String) -> Result<String, String> {
    let rec = get_flow(id)?;
    if rec.description.trim().is_empty() {
        return Err("导出需要「给 agent 看的说明」，请先发布或补全说明".into());
    }
    let rhai = rec
        .rhai
        .clone()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "导出缺少 flow.rhai，请先发布".to_string())?;
    reject_abs("flow.rhai", &rhai)?;
    let meta = FlowYaml {
        id: rec.id.clone(),
        name: rec.name.clone(),
        description: rec.description.clone(),
        input_schema: rec.input_schema.clone(),
        output_schema: rec.output_schema.clone(),
        version: rec.version.clone(),
        dependencies: rec.dependencies.clone(),
    };
    let published = FlowYaml {
        dependencies: Vec::new(),
        ..meta
    };
    let yaml = write_yaml(&published)?;
    if yaml.contains("position") {
        return Err("内部错误：契约仍含坐标字段".into());
    }

    let dest = PathBuf::from(&dest_path);
    if let Some(parent) = dest.parent() {
        mkdir(parent)?;
    }
    let file = fs::File::create(&dest).map_err(|e| format!("创建 zip 失败: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    add_zip_file(&mut zip, &format!("{}.flow.yaml", rec.id), yaml.as_bytes())?;
    add_zip_file(&mut zip, &format!("{}.rhai", rec.id), rhai.as_bytes())?;
    let reqs = collect_requirements(&rec.nodes);
    let reqs_yaml =
        serde_yaml::to_string(&reqs).map_err(|e| format!("序列化 requirements.yaml 失败: {e}"))?;
    add_zip_file(&mut zip, "requirements.yaml", reqs_yaml.as_bytes())?;
    zip.finish().map_err(|e| format!("关闭 zip 失败: {e}"))?;
    Ok(dest.display().to_string())
}

fn read_zip_entry(archive: &mut zip::ZipArchive<fs::File>, name: &str) -> Result<Option<String>, String> {
    match archive.by_name(name) {
        Ok(mut f) => {
            let mut buf = String::new();
            f.read_to_string(&mut buf)
                .map_err(|e| format!("读取 zip 内 {name} 失败: {e}"))?;
            Ok(Some(buf))
        }
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn import_flow(
    zip_path: String,
    conflict_mode: Option<String>,
) -> Result<ImportFlowResult, String> {
    let file = fs::File::open(&zip_path).map_err(|e| format!("打开 zip 失败: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("不是有效 zip: {e}"))?;
    if let Some(g) = read_zip_entry(&mut archive, "graph.json")? {
        if g.contains("\"position\"") {
            return Err("拒绝导入：zip 内 graph 含画布坐标".into());
        }
    }
    let (yaml, rhai) = read_zip_sidecar_pair(&mut archive)?;
    reject_abs("flow.yaml", &yaml)?;
    reject_abs("flow.rhai", &rhai)?;
    let mut meta = parse_yaml(&yaml)?;
    let id = ensure_id(&meta.id)?;
    meta.id = id.clone();
    meta.dependencies.clear();

    let reqs = read_zip_entry(&mut archive, "requirements.yaml")?
        .and_then(|s| serde_yaml::from_str::<Requirements>(&s).ok())
        .unwrap_or_default();
    let missing = missing_tools(&reqs.tools);

    if let Some(existing) = load_package_meta(&id) {
        let mode = conflict_mode.unwrap_or_default();
        if mode.is_empty() {
            return Ok(ImportFlowResult::Conflict {
                id,
                existing_version: existing.version,
                incoming_version: meta.version.clone(),
                requirements: reqs.clone(),
            });
        }
        match mode.as_str() {
            "cancel" => return Ok(ImportFlowResult::Cancelled),
            "overwrite" => {}
            "keep-both" => {
                let new_id = format!("{}-v{}", id, meta.version.replace('.', "-"));
                let new_id = ensure_id(&slug_keep_both(&new_id))?;
                let rhai = rhai.replace(&format!("name: \"{id}\""), &format!("name: \"{new_id}\""));
                meta.id = new_id.clone();
                write_imported(&meta, &rhai)?;
                return Ok(ImportFlowResult::Ok {
                    id: new_id,
                    version: meta.version,
                    requirements: reqs,
                    missing_tools: missing,
                });
            }
            other => return Err(format!("未知撞名处理: {other}")),
        }
    }

    write_imported(&meta, &rhai)?;
    Ok(ImportFlowResult::Ok {
        id: meta.id,
        version: meta.version,
        requirements: reqs,
        missing_tools: missing,
    })
}

fn slug_keep_both(raw: &str) -> String {
    let mut out = String::new();
    let mut hyphen = false;
    for c in raw.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
            hyphen = false;
        } else if !hyphen && !out.is_empty() {
            out.push('-');
            hyphen = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn write_imported(meta: &FlowYaml, rhai: &str) -> Result<(), String> {
    let published = FlowYaml {
        dependencies: Vec::new(),
        ..meta.clone()
    };
    write_sidecar(&meta.id, &write_yaml(&published)?, rhai)
}

fn read_zip_sidecar_pair(
    archive: &mut zip::ZipArchive<fs::File>,
) -> Result<(String, String), String> {
    let names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            archive.by_index(i).ok().map(|f| f.name().replace('\\', "/"))
        })
        .collect();
    if let Some(yaml_name) = names
        .iter()
        .find(|n| !n.contains('/') && n.ends_with(".flow.yaml"))
        .cloned()
    {
        let id = yaml_name.trim_end_matches(".flow.yaml");
        let rhai_name = format!("{id}.rhai");
        let yaml = read_zip_entry(archive, &yaml_name)?
            .ok_or_else(|| format!("zip 内缺少 {yaml_name}"))?;
        let rhai = read_zip_entry(archive, &rhai_name)?
            .ok_or_else(|| format!("zip 内缺少 {rhai_name}"))?;
        return Ok((yaml, rhai));
    }
    let yaml = read_zip_entry(archive, "flow.yaml")?
        .ok_or_else(|| "zip 内缺少 <id>.flow.yaml（或旧版 flow.yaml）".to_string())?;
    let rhai = read_zip_entry(archive, "flow.rhai")?
        .ok_or_else(|| "zip 内缺少 <id>.rhai（或旧版 flow.rhai）".to_string())?;
    Ok((yaml, rhai))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flow_id_rules() {
        assert!(is_valid_flow_id("demo-linear"));
        assert!(is_valid_flow_id("a"));
        assert!(!is_valid_flow_id(""));
        assert!(!is_valid_flow_id("Demo"));
        assert!(!is_valid_flow_id("-a"));
        assert!(!is_valid_flow_id("a-"));
        assert!(!is_valid_flow_id("a--b"));
    }

    #[test]
    fn strip_positions_drops_coords() {
        let nodes = serde_json::json!([
            {"id":"s","type":"start","params":{},"position":{"x":1,"y":2}},
            {"id":"e","type":"end","params":{},"position":{"x":3,"y":4}}
        ]);
        let stripped = strip_positions(&nodes);
        let text = stripped.to_string();
        assert!(!text.contains("position"));
        assert!(text.contains("\"s\""));
    }

    #[test]
    fn absolute_paths_detected() {
        assert!(text_has_absolute_path(r#"C:\Users\me\a"#));
        assert!(text_has_absolute_path("/home/u/proj"));
        assert!(!text_has_absolute_path("flows/other-id"));
        assert!(!text_has_absolute_path("read file README.md"));
    }

    #[test]
    fn sidecar_filenames_match_official_layout() {
        assert!(sidecar_rhai("refund").ends_with("refund.rhai"));
        assert!(sidecar_yaml("refund").ends_with("refund.flow.yaml"));
        assert!(!sidecar_yaml("refund").to_string_lossy().contains("position"));
    }
}
