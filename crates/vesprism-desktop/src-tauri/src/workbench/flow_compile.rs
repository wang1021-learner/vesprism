//! 画布 JSON → 官方 Rhai。sidecar 只写这里的编译结果，不信前端送来的脚本。

use super::agents::{list_agents, AgentListItem};
use super::flows::{ensure_id, load_draft, SaveFlowRequest};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
struct Node {
    id: String,
    ty: String,
    params: Value,
}

#[derive(Clone)]
struct Edge {
    from: String,
    to: String,
    label: String,
}

#[derive(Clone, Default)]
struct Preset {
    #[allow(dead_code)]
    name: String,
    description: String,
    system_prompt: String,
    model: String,
    agent_type: String,
    isolation: Option<bool>,
    output_schema: Option<Value>,
    disabled_tools: Vec<String>,
    permission_rules: Vec<String>,
    skills: Vec<String>,
}

pub fn compile_save_request(req: &SaveFlowRequest) -> Result<String, String> {
    let nodes = parse_nodes(&req.nodes)?;
    let edges = parse_edges(&req.edges)?;
    let (nodes, edges) = inline_flows(&req.id, nodes, edges, &mut Vec::new())?;
    let presets = load_presets();
    compile_to_rhai(&req.id, &req.name, &req.description, &nodes, &edges, &presets)
}

fn parse_nodes(v: &Value) -> Result<Vec<Node>, String> {
    let arr = v
        .as_array()
        .ok_or_else(|| "nodes 必须是数组".to_string())?;
    if arr.len() > 200 {
        return Err("节点过多".into());
    }
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for n in arr {
        let id = n
            .get("id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if id.is_empty() || id.len() > 128 {
            return Err("节点 id 不合法".into());
        }
        if !seen.insert(id.clone()) {
            return Err(format!("重复节点 id：{id}"));
        }
        let ty = n
            .get("type")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if !matches!(
            ty.as_str(),
            "start"
                | "agent"
                | "tool"
                | "http"
                | "database"
                | "knowledge"
                | "variable"
                | "transform"
                | "loop"
                | "loop_end"
                | "flow"
                | "branch"
                | "parallel"
                | "join"
                | "end"
        ) {
            return Err(format!("未知节点类型：{ty}"));
        }
        let params = n.get("params").cloned().unwrap_or(Value::Object(Default::default()));
        out.push(Node { id, ty, params });
    }
    Ok(out)
}

fn parse_edges(v: &Value) -> Result<Vec<Edge>, String> {
    let arr = v
        .as_array()
        .ok_or_else(|| "edges 必须是数组".to_string())?;
    if arr.len() > 400 {
        return Err("边过多".into());
    }
    Ok(arr
        .iter()
        .map(|e| Edge {
            from: e.get("from").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            to: e.get("to").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            label: e.get("label").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        })
        .collect())
}

fn load_presets() -> HashMap<String, Preset> {
    let mut map = HashMap::new();
    let Ok(list) = list_agents() else {
        return map;
    };
    for a in list {
        if a.error.is_some() {
            continue;
        }
        map.insert(a.id.clone(), preset_from_agent(&a));
    }
    map
}

fn preset_from_agent(a: &AgentListItem) -> Preset {
    Preset {
        name: a.name.clone(),
        description: a.description.clone().unwrap_or_default(),
        system_prompt: a.system_prompt.clone().unwrap_or_default(),
        model: a.model.clone().unwrap_or_default(),
        agent_type: a.agent_type.clone().unwrap_or_default(),
        isolation: Some(a.isolation),
        output_schema: a.output_schema.clone(),
        disabled_tools: a.disabled_tools.clone(),
        permission_rules: a.permission_rules.clone(),
        skills: a.skills.clone(),
    }
}

fn inline_flows(
    draft_id: &str,
    mut nodes: Vec<Node>,
    mut edges: Vec<Edge>,
    visiting: &mut Vec<String>,
) -> Result<(Vec<Node>, Vec<Edge>), String> {
    if visiting.iter().any(|id| id == draft_id) {
        visiting.push(draft_id.to_string());
        return Err(format!("子流程循环引用：{}", visiting.join(" → ")));
    }
    visiting.push(draft_id.to_string());
    loop {
        let Some(idx) = nodes.iter().position(|n| n.ty == "flow") else {
            break;
        };
        let fn_node = nodes[idx].clone();
        let flow_id = param_str(&fn_node.params, "flowId");
        if flow_id.is_empty() {
            return Err(format!("节点 {} 未填写子流程 id", fn_node.id));
        }
        let id = ensure_id(&flow_id)?;
        let draft = load_draft(&id).ok_or_else(|| {
            format!("无法内联「{id}」：找不到画布图（请先打开并保存该流程）")
        })?;
        let inner_nodes = parse_nodes(draft.get("nodes").unwrap_or(&Value::Array(vec![])))?;
        let inner_edges = parse_edges(draft.get("edges").unwrap_or(&Value::Array(vec![])))?;
        let (inner_nodes, inner_edges) = inline_flows(&id, inner_nodes, inner_edges, visiting)?;
        let spliced = splice_flow(&fn_node, &nodes, &edges, &inner_nodes, &inner_edges);
        nodes = spliced.0;
        edges = spliced.1;
    }
    visiting.pop();
    Ok((nodes, edges))
}

fn splice_flow(
    fn_node: &Node,
    nodes: &[Node],
    edges: &[Edge],
    inner_nodes: &[Node],
    inner_edges: &[Edge],
) -> (Vec<Node>, Vec<Edge>) {
    let start_ids: HashSet<String> = inner_nodes
        .iter()
        .filter(|n| n.ty == "start")
        .map(|n| n.id.clone())
        .collect();
    let end_ids: HashSet<String> = inner_nodes
        .iter()
        .filter(|n| n.ty == "end")
        .map(|n| n.id.clone())
        .collect();
    let prefix = format!("{}__", fn_node.id);
    let body: Vec<Node> = inner_nodes
        .iter()
        .filter(|n| n.ty != "start" && n.ty != "end")
        .map(|n| Node {
            id: format!("{prefix}{}", n.id),
            ty: n.ty.clone(),
            params: n.params.clone(),
        })
        .collect();
    let remap = |id: &str| -> Option<String> {
        if start_ids.contains(id) || end_ids.contains(id) {
            None
        } else {
            Some(format!("{prefix}{id}"))
        }
    };
    let mut mid: Vec<Edge> = Vec::new();
    for e in inner_edges {
        if let (Some(from), Some(to)) = (remap(&e.from), remap(&e.to)) {
            mid.push(Edge {
                from,
                to,
                label: e.label.clone(),
            });
        }
    }
    let incoming: Vec<&Edge> = edges.iter().filter(|e| e.to == fn_node.id).collect();
    let outgoing: Vec<&Edge> = edges.iter().filter(|e| e.from == fn_node.id).collect();
    let mut entry: Vec<String> = inner_edges
        .iter()
        .filter(|e| start_ids.contains(&e.from))
        .filter_map(|e| remap(&e.to))
        .collect();
    if entry.is_empty() {
        let mid_to: HashSet<_> = mid.iter().map(|e| e.to.clone()).collect();
        let roots: Vec<_> = body
            .iter()
            .filter(|n| !mid_to.contains(&n.id))
            .map(|n| n.id.clone())
            .collect();
        entry = if roots.is_empty() {
            body.iter().map(|n| n.id.clone()).collect()
        } else {
            roots
        };
    }
    let mut exit: Vec<String> = inner_edges
        .iter()
        .filter(|e| end_ids.contains(&e.to))
        .filter_map(|e| remap(&e.from))
        .collect();
    if exit.is_empty() {
        let mid_from: HashSet<_> = mid.iter().map(|e| e.from.clone()).collect();
        let leaves: Vec<_> = body
            .iter()
            .filter(|n| !mid_from.contains(&n.id))
            .map(|n| n.id.clone())
            .collect();
        exit = if leaves.is_empty() {
            body.iter().map(|n| n.id.clone()).collect()
        } else {
            leaves
        };
    }
    let mut spliced = mid;
    if body.is_empty() {
        for inc in &incoming {
            for out in &outgoing {
                spliced.push(Edge {
                    from: inc.from.clone(),
                    to: out.to.clone(),
                    label: if inc.label.is_empty() {
                        out.label.clone()
                    } else {
                        inc.label.clone()
                    },
                });
            }
        }
    } else {
        for inc in &incoming {
            if entry.is_empty() {
                for out in &outgoing {
                    spliced.push(Edge {
                        from: inc.from.clone(),
                        to: out.to.clone(),
                        label: if inc.label.is_empty() {
                            out.label.clone()
                        } else {
                            inc.label.clone()
                        },
                    });
                }
            } else {
                for t in &entry {
                    spliced.push(Edge {
                        from: inc.from.clone(),
                        to: t.clone(),
                        label: inc.label.clone(),
                    });
                }
            }
        }
        for src in &exit {
            for out in &outgoing {
                spliced.push(Edge {
                    from: src.clone(),
                    to: out.to.clone(),
                    label: out.label.clone(),
                });
            }
        }
    }
    let nodes: Vec<Node> = nodes
        .iter()
        .filter(|n| n.id != fn_node.id)
        .cloned()
        .chain(body)
        .collect();
    let edges: Vec<Edge> = edges
        .iter()
        .filter(|e| e.from != fn_node.id && e.to != fn_node.id)
        .cloned()
        .chain(spliced)
        .collect();
    (nodes, edges)
}

fn compile_to_rhai(
    id: &str,
    name: &str,
    description: &str,
    nodes: &[Node],
    edges: &[Edge],
    presets: &HashMap<String, Preset>,
) -> Result<String, String> {
    if nodes.iter().any(|n| n.ty == "flow") {
        return Err("仍有未内联的 flow 节点，不能编译".into());
    }
    validate_idents(nodes)?;
    let map: HashMap<String, Node> = nodes.iter().map(|n| (n.id.clone(), n.clone())).collect();
    let start = nodes.iter().find(|n| n.ty == "start");
    let phases: Vec<String> = nodes
        .iter()
        .filter(|n| n.ty != "start" && n.ty != "end")
        .map(|n| format!("        #{{ title: \"{}\" }}", esc(&phase_title(n))))
        .collect();
    let desc = {
        let d = description.trim();
        if d.is_empty() {
            let n = name.trim();
            if n.is_empty() { id.to_string() } else { n.to_string() }
        } else {
            d.to_string()
        }
    };
    let mut lines = Vec::new();
    lines.push("let meta = #{".into());
    lines.push(format!("    name: \"{}\",", esc(id)));
    lines.push(format!("    description: \"{}\",", esc(&desc)));
    lines.push(format!("    when_to_use: \"{}\",", esc(&desc)));
    if !phases.is_empty() {
        lines.push("    phases: [".into());
        lines.push(phases.join(",\n"));
        lines.push("    ],".into());
    }
    lines.push("};".into());
    lines.push(String::new());
    lines.push("let input = args;".into());
    lines.push("if input == () { input = #{}; }".into());
    lines.push(String::new());
    let last = if let Some(s) = start {
        walk(
            &s.id,
            "input",
            &map,
            edges,
            &mut lines,
            &mut HashSet::new(),
            presets,
            None,
        )?
    } else {
        "input".into()
    };
    lines.push(String::new());
    lines.push(format!("complete(#{{ ok: true, output: {last} }});"));
    lines.push(String::new());
    Ok(lines.join("\n"))
}

fn validate_idents(nodes: &[Node]) -> Result<(), String> {
    let mut seen: HashMap<String, String> = HashMap::new();
    const RESERVED: &[&str] = &["input", "prev", "item", "attempt", "args", "meta"];
    for n in nodes {
        let v = ident(&n.id);
        if let Some(prior) = seen.get(&v) {
            if prior != &n.id {
                return Err(format!(
                    "节点「{prior}」与「{}」编译后的变量名冲突（{v}）",
                    n.id
                ));
            }
        }
        seen.insert(v.clone(), n.id.clone());
        if RESERVED.contains(&v.as_str())
            || v.starts_with("par_")
            || v.starts_with("loop_")
            || v.starts_with("v_")
        {
            return Err(format!(
                "节点 id「{}」编译后的变量名 {v} 与引擎保留变量冲突",
                n.id
            ));
        }
    }
    Ok(())
}

fn walk(
    current_id: &str,
    prev_var: &str,
    nodes: &HashMap<String, Node>,
    edges: &[Edge],
    lines: &mut Vec<String>,
    visiting: &mut HashSet<String>,
    presets: &HashMap<String, Preset>,
    stop_at: Option<&str>,
) -> Result<String, String> {
    if stop_at == Some(current_id) {
        return Ok(prev_var.to_string());
    }
    if visiting.contains(current_id) {
        lines.push(format!("log(\"skip cycle at {}\");", esc(current_id)));
        return Ok(prev_var.to_string());
    }
    let Some(node) = nodes.get(current_id) else {
        return Ok(prev_var.to_string());
    };
    visiting.insert(current_id.to_string());
    let outs = outgoing(edges, current_id);
    if node.ty == "end" {
        visiting.remove(current_id);
        return Ok(prev_var.to_string());
    }
    if node.ty == "parallel" || (outs.len() > 1 && node.ty != "branch") {
        let p_var = format!("par_{}", ident(&node.id));
        lines.push(format!("phase(\"{}\");", esc(&phase_title(node))));
        lines.push(format!(
            "log(\"node {} parallel fan-out ({} branches)\");",
            esc(&node.id),
            outs.len()
        ));
        lines.push(format!("let {p_var}_jobs = [];"));
        let mut branch_nodes = Vec::new();
        for e in &outs {
            if let Some(bn) = nodes.get(&e.to) {
                visiting.insert(bn.id.clone());
                lines.push(format!(
                    "{p_var}_jobs.push({});",
                    build_agent_job_map(bn, prev_var, presets)?
                ));
                branch_nodes.push(bn.clone());
            }
        }
        lines.push(format!("let {p_var} = parallel({p_var}_jobs);"));
        let mut downstream: Vec<String> = Vec::new();
        for bn in &branch_nodes {
            for e in outgoing(edges, &bn.id) {
                if !downstream.contains(&e.to) {
                    downstream.push(e.to.clone());
                }
            }
        }
        visiting.remove(current_id);
        if downstream.len() == 1 {
            let next = &downstream[0];
            if stop_at == Some(next.as_str()) {
                return Ok(p_var);
            }
            return walk(next, &p_var, nodes, edges, lines, visiting, presets, stop_at);
        }
        if downstream.len() > 1 {
            return Err(format!(
                "并行节点「{}」的各个分支必须汇聚到同一个 join",
                node.id
            ));
        }
        return Ok(p_var);
    }
    if node.ty == "loop" {
        let body_node = outs.first().and_then(|e| nodes.get(&e.to)).cloned();
        let Some(body_node) = body_node else {
            visiting.remove(current_id);
            return Ok(prev_var.to_string());
        };
        let body_outs = outgoing(edges, &body_node.id);
        let loop_arr = format!("loop_{}_arr", ident(&node.id));
        let res_var = format!("loop_{}_res", ident(&node.id));
        lines.push(format!("phase(\"{}\");", esc(&phase_title(node))));
        lines.push(format!("log(\"node {} loop over {prev_var}\");", esc(&node.id)));
        lines.push(format!("let {loop_arr} = {prev_var};"));
        lines.push(format!("let {res_var} = [];"));
        lines.push(format!("for item in {loop_arr} {{"));
        let body_out = emit_node(&body_node, "item", lines, presets)?;
        lines.push(format!("    {res_var}.push({body_out});"));
        lines.push("}".into());
        visiting.insert(body_node.id.clone());
        if let Some(end_e) = body_outs.first() {
            if nodes.get(&end_e.to).is_some_and(|n| n.ty == "loop_end") {
                visiting.insert(end_e.to.clone());
                visiting.remove(current_id);
                return walk(&end_e.to, &res_var, nodes, edges, lines, visiting, presets, stop_at);
            }
        }
        visiting.remove(current_id);
        return Ok(res_var);
    }
    if node.ty == "branch" {
        let branch_res = format!("v_{}_res", ident(&node.id));
        lines.push(format!("phase(\"{}\");", esc(&phase_title(node))));
        lines.push(format!("log(\"node {} branch\");", esc(&node.id)));
        lines.push(format!("let {branch_res} = {prev_var};"));
        let join_id = find_shared_join(&outs.iter().map(|e| e.to.clone()).collect::<Vec<_>>(), nodes, edges);
        let arm_stop = join_id.as_deref().or(stop_at);
        let binary = outs.len() == 2
            && !outs.iter().any(|e| {
                let l = e.label.trim();
                !l.is_empty()
                    && !matches!(
                        l.to_ascii_lowercase().as_str(),
                        "success" | "yes" | "true" | "ok" | "是" | "成功"
                            | "failure" | "no" | "false" | "否" | "失败"
                    )
            });
        if binary {
            let cond_p = param_str(&node.params, "condition");
            let expr = param_str(&node.params, "expression");
            let cond = if cond_p == "failure" {
                format!("!({prev_var} != () && {prev_var}.success)")
            } else if cond_p == "expression" && !expr.trim().is_empty() {
                expr
            } else {
                format!("{prev_var} != () && {prev_var}.success")
            };
            let yes = outs
                .iter()
                .find(|e| {
                    matches!(
                        e.label.trim().to_ascii_lowercase().as_str(),
                        "success" | "yes" | "true" | "ok" | "是" | "成功"
                    )
                })
                .cloned()
                .unwrap_or_else(|| outs[0].clone());
            let no = outs.iter().find(|e| e.to != yes.to || e.label != yes.label);
            lines.push(format!("if ({cond}) {{"));
            let yes_var = walk(&yes.to, prev_var, nodes, edges, lines, visiting, presets, arm_stop)?;
            lines.push(format!("    {branch_res} = {yes_var};"));
            if let Some(no) = no {
                lines.push("} else {".into());
                let no_var = walk(&no.to, prev_var, nodes, edges, lines, visiting, presets, arm_stop)?;
                lines.push(format!("    {branch_res} = {no_var};"));
            }
            lines.push("}".into());
        } else {
            for (i, edge) in outs.iter().enumerate() {
                let is_last = i + 1 == outs.len();
                let lbl = esc(edge.label.trim());
                let cond = if !lbl.is_empty() {
                    format!(
                        "({prev_var} != () && (({prev_var}.output != () && ((type_of({prev_var}.output) == \"map\" && ({prev_var}.output.branch == \"{lbl}\" || {prev_var}.output.decision == \"{lbl}\" || {prev_var}.output.status == \"{lbl}\")) || (type_of({prev_var}.output) == \"string\" && ({prev_var}.output == \"{lbl}\" || {prev_var}.output.contains(\"{lbl}\"))))) || ({prev_var}.branch == \"{lbl}\") || ({prev_var} == \"{lbl}\")))"
                    )
                } else {
                    "true".into()
                };
                if i == 0 {
                    lines.push(format!("if ({cond}) {{"));
                } else if is_last && edge.label.is_empty() {
                    lines.push("} else {".into());
                } else {
                    lines.push(format!("}} else if ({cond}) {{"));
                }
                let arm = walk(&edge.to, prev_var, nodes, edges, lines, visiting, presets, arm_stop)?;
                lines.push(format!("    {branch_res} = {arm};"));
            }
            lines.push("}".into());
        }
        visiting.remove(current_id);
        if let Some(join) = join_id {
            if stop_at != Some(join.as_str()) {
                return walk(&join, &branch_res, nodes, edges, lines, visiting, presets, stop_at);
            }
        }
        return Ok(branch_res);
    }
    let produced = emit_node(node, prev_var, lines, presets)?;
    let last = if let Some(next) = outs.first() {
        walk(&next.to, &produced, nodes, edges, lines, visiting, presets, stop_at)?
    } else {
        produced
    };
    visiting.remove(current_id);
    Ok(last)
}

fn find_arm_join(
    start_id: &str,
    nodes: &HashMap<String, Node>,
    edges: &[Edge],
) -> Option<String> {
    let mut seen = HashSet::new();
    let mut cur = Some(start_id.to_string());
    while let Some(id) = cur {
        if !seen.insert(id.clone()) {
            break;
        }
        let n = nodes.get(&id)?;
        let ins = incoming(edges, &id);
        if n.ty == "join" || n.ty == "end" || ins.len() > 1 {
            return Some(id);
        }
        let outs = outgoing(edges, &id);
        if outs.is_empty() {
            return Some(id);
        }
        if outs.len() > 1 {
            return find_shared_join(
                &outs.iter().map(|e| e.to.clone()).collect::<Vec<_>>(),
                nodes,
                edges,
            );
        }
        cur = Some(outs[0].to.clone());
    }
    None
}

fn find_shared_join(
    arm_starts: &[String],
    nodes: &HashMap<String, Node>,
    edges: &[Edge],
) -> Option<String> {
    if arm_starts.is_empty() {
        return None;
    }
    let mut shared: Option<String> = None;
    for start in arm_starts {
        let join = find_arm_join(start, nodes, edges)?;
        match &shared {
            None => shared = Some(join),
            Some(s) if s != &join => return None,
            _ => {}
        }
    }
    shared
}

fn emit_node(
    n: &Node,
    prev_var: &str,
    lines: &mut Vec<String>,
    presets: &HashMap<String, Preset>,
) -> Result<String, String> {
    match n.ty.as_str() {
        "start" | "end" | "loop" | "loop_end" | "branch" | "parallel" => Ok(prev_var.to_string()),
        "agent" => emit_agent(n, prev_var, lines, presets),
        "tool" => emit_simple_agent(n, prev_var, lines, "tool", &tool_task(n, prev_var)),
        "http" => emit_simple_agent(n, prev_var, lines, "http", &http_task(n, prev_var)),
        "database" => emit_simple_agent(n, prev_var, lines, "database", &database_task(n, prev_var)),
        "knowledge" => emit_simple_agent(n, prev_var, lines, "knowledge", &knowledge_task(n, prev_var)),
        "variable" => Ok(emit_variable(n, prev_var, lines)),
        "transform" => Ok(emit_transform(n, prev_var, lines)),
        "join" => Ok(emit_join(n, prev_var, lines)),
        "flow" => Err(format!("节点 {} 仍是 flow，发布/试跑前必须内联", n.id)),
        other => Err(format!("未知节点类型：{other}")),
    }
}

fn emit_agent(
    n: &Node,
    prev_var: &str,
    lines: &mut Vec<String>,
    presets: &HashMap<String, Preset>,
) -> Result<String, String> {
    let resolved = resolve_agent(n, presets)?;
    let task = agent_task(n, prev_var, &resolved);
    lines.push(format!("phase(\"{}\");", esc(&phase_title(n))));
    lines.push(format!("log(\"node {}\");", esc(&n.id)));
    let mut opts = vec![format!("label: \"{}\"", esc(&n.id))];
    if !resolved.model.is_empty() {
        opts.push(format!("model: \"{}\"", esc(&resolved.model)));
    }
    if !resolved.agent_type.is_empty() {
        opts.push(format!("agent_type: \"{}\"", esc(&resolved.agent_type)));
    }
    push_isolation(&mut opts, resolved.isolation);
    if let Some(schema) = &resolved.output_schema {
        opts.push(format!("output_schema: {}", json_to_rhai(schema)));
    }
    if !resolved.disabled_tools.is_empty() {
        let list = resolved
            .disabled_tools
            .iter()
            .map(|t| format!("\"{}\"", esc(t)))
            .collect::<Vec<_>>()
            .join(", ");
        opts.push(format!("disabled_tools: [{list}]"));
    }
    if !resolved.permission_rules.is_empty() {
        let list = resolved
            .permission_rules
            .iter()
            .map(|t| format!("\"{}\"", esc(t)))
            .collect::<Vec<_>>()
            .join(", ");
        opts.push(format!("permission_rules: [{list}]"));
    }
    let tokens = param_num(&n.params, "maxOutputTokens");
    if tokens > 0.0 {
        opts.push(format!("max_output_tokens: {}", tokens.floor() as i64));
    }
    push_timeout_ms(&mut opts, n);
    let opts_s = opts.join(", ");
    wrap_retry(n, lines, "agent", |target, lines| {
        lines.push(format!(
            "let {target} = agent(json_encode({task}), #{{ {opts_s} }});"
        ));
    })
}

fn emit_simple_agent(
    n: &Node,
    _prev_var: &str,
    lines: &mut Vec<String>,
    kind: &str,
    task: &str,
) -> Result<String, String> {
    lines.push(format!("phase(\"{}\");", esc(&phase_title(n))));
    lines.push(format!("log(\"node {} {kind}\");", esc(&n.id)));
    let mut opts = vec![format!("label: \"{}\"", esc(&n.id))];
    if let Some(schema) = n.params.get("outputSchema") {
        if !schema.is_null() {
            opts.push(format!("output_schema: {}", json_to_rhai(schema)));
        }
    }
    push_timeout_ms(&mut opts, n);
    let opts_s = opts.join(", ");
    let task = task.to_string();
    wrap_retry(n, lines, kind, |target, lines| {
        lines.push(format!(
            "let {target} = agent(json_encode({task}), #{{ {opts_s} }});"
        ));
    })
}

fn wrap_retry(
    n: &Node,
    lines: &mut Vec<String>,
    kind: &str,
    mut call: impl FnMut(&str, &mut Vec<String>),
) -> Result<String, String> {
    let v = ident(&n.id);
    let retry = param_num(&n.params, "retry");
    let retry = if retry > 0.0 { retry.floor() as i64 } else { 0 };
    if retry <= 0 {
        call(&v, lines);
        lines.push(format!(
            "if {v} == () || !{v}.success {{ complete(#{{ ok: false, node: \"{}\", error: \"{kind} failed\" }}); }}",
            esc(&n.id)
        ));
        return Ok(v);
    }
    lines.push(format!("let {v} = ();"));
    lines.push(format!("for attempt in 0..{} {{", retry + 1));
    call(&format!("{v}_try"), lines);
    lines.push(format!("  if {v}_try != () && {v}_try.success {{ {v} = {v}_try; break; }}"));
    lines.push("}".into());
    lines.push(format!(
        "if {v} == () || !{v}.success {{ complete(#{{ ok: false, node: \"{}\", error: \"{kind} failed after {} attempts\" }}); }}",
        esc(&n.id),
        retry + 1
    ));
    Ok(v)
}

fn emit_variable(n: &Node, prev_var: &str, lines: &mut Vec<String>) -> String {
    let v = ident(&n.id);
    let raw = param_str(&n.params, "value");
    let ty = param_str(&n.params, "valueType");
    lines.push(format!("phase(\"{}\");", esc(&phase_title(n))));
    lines.push(format!("log(\"node {} variable\");", esc(&n.id)));
    let lit = if raw.contains("{{") {
        interpolate_rhai(&raw, prev_var)
    } else if ty == "number" {
        raw.parse::<f64>()
            .ok()
            .filter(|n| n.is_finite())
            .map(|n| n.to_string())
            .unwrap_or_else(|| format!("\"{}\"", esc(&raw)))
    } else if ty == "boolean" {
        if raw == "true" || raw == "1" {
            "true".into()
        } else {
            "false".into()
        }
    } else if ty == "json" {
        serde_json::from_str::<Value>(&raw)
            .map(|v| json_to_rhai(&v))
            .unwrap_or_else(|_| format!("\"{}\"", esc(&raw)))
    } else {
        format!("\"{}\"", esc(&raw))
    };
    lines.push(format!("let {v} = {lit};"));
    v
}

fn emit_transform(n: &Node, prev_var: &str, lines: &mut Vec<String>) -> String {
    let v = ident(&n.id);
    let code = param_str(&n.params, "code");
    lines.push(format!("phase(\"{}\");", esc(&phase_title(n))));
    lines.push(format!("log(\"node {} transform\");", esc(&n.id)));
    if code.trim().is_empty() {
        lines.push(format!("let {v} = {prev_var};"));
        return v;
    }
    lines.push(format!("let {v} = ();"));
    lines.push("try {".into());
    lines.push(format!("    {v} = {{ let input = {prev_var}; ({code}) }};"));
    lines.push("} catch (err) {".into());
    lines.push(format!(
        "    complete(#{{ ok: false, node: \"{}\", error: err.to_string() }});",
        esc(&n.id)
    ));
    lines.push("}".into());
    v
}

fn emit_join(n: &Node, prev_var: &str, lines: &mut Vec<String>) -> String {
    let v = ident(&n.id);
    let mode = param_str(&n.params, "mergeMode");
    let mode = if mode.is_empty() { "merge_json".into() } else { mode };
    lines.push(format!("phase(\"{}\");", esc(&phase_title(n))));
    lines.push(format!(
        "log(\"node {} join (mode: {})\");",
        esc(&n.id),
        esc(&mode)
    ));
    if mode == "list" {
        lines.push(format!("let {v} = {prev_var};"));
    } else if mode == "all_success" {
        lines.push(format!("let {v} = #{{ ok: true, results: {prev_var} }};"));
    } else {
        lines.push(format!("let {v} = #{{}};"));
        lines.push(format!("if type_of({prev_var}) == \"array\" {{"));
        lines.push(format!("    for item in {prev_var} {{"));
        lines.push("        if type_of(item) == \"map\" {".into());
        lines.push("            let payload = item;".into());
        lines.push("            if item.contains(\"output\") && type_of(item.output) == \"map\" {".into());
        lines.push("                payload = item.output;".into());
        lines.push("            }".into());
        lines.push(format!("            for k in payload.keys() {{ {v}[k] = payload[k]; }}"));
        lines.push("        }".into());
        lines.push("    }".into());
        lines.push(format!("}} else {{ {v} = {prev_var}; }}"));
    }
    v
}

fn resolve_agent(n: &Node, presets: &HashMap<String, Preset>) -> Result<Preset, String> {
    let preset_id = param_str(&n.params, "presetId");
    let mut model = param_str(&n.params, "model");
    let mut agent_type = param_str(&n.params, "agentType");
    let mut isolation = n.params.get("isolation").and_then(|v| v.as_bool());
    let mut out = Preset::default();
    if !preset_id.is_empty() {
        let resolved = presets.get(&preset_id).ok_or_else(|| {
            format!("Agent「{preset_id}」不存在，无法编译节点 {}", n.id)
        })?;
        out = resolved.clone();
        if model.is_empty() {
            model = resolved.model.clone();
        }
        if agent_type.is_empty() {
            agent_type = resolved.agent_type.clone();
        }
        if isolation.is_none() {
            isolation = resolved.isolation;
        }
    }
    out.model = model;
    out.agent_type = agent_type;
    out.isolation = isolation;
    if let Some(s) = n.params.get("skills").and_then(|v| v.as_array()) {
        let skills: Vec<String> = s
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect();
        if !skills.is_empty() {
            out.skills = skills;
        }
    }
    Ok(out)
}

fn agent_task(n: &Node, prev_var: &str, resolved: &Preset) -> String {
    let mut fields = vec![format!("node_id: {}", json_to_rhai(&Value::String(n.id.clone())))];
    let persona = resolved.system_prompt.trim();
    let persona = if persona.is_empty() {
        resolved.description.trim()
    } else {
        persona
    };
    if !persona.is_empty() {
        fields.push(format!("persona: {}", json_to_rhai(&Value::String(persona.into()))));
    }
    let role = param_str(&n.params, "role");
    if !role.trim().is_empty() {
        fields.push(format!("role: {}", interpolate_rhai(&role, prev_var)));
    }
    let prompt = param_str(&n.params, "prompt");
    if !prompt.trim().is_empty() {
        fields.push(format!("prompt: {}", interpolate_rhai(&prompt, prev_var)));
    }
    if !resolved.skills.is_empty() {
        fields.push(format!(
            "skills: {}",
            json_to_rhai(&Value::Array(
                resolved
                    .skills
                    .iter()
                    .map(|s| Value::String(s.clone()))
                    .collect()
            ))
        ));
    }
    fields.push(format!("input: {prev_var}"));
    format!("#{{ {} }}", fields.join(", "))
}

fn tool_task(n: &Node, prev_var: &str) -> String {
    let cmd = {
        let c = param_str(&n.params, "command");
        if c.is_empty() {
            param_str(&n.params, "toolName")
        } else {
            c
        }
    };
    let mut fields = vec![
        format!("node_id: {}", json_to_rhai(&Value::String(n.id.clone()))),
        "kind: \"tool\"".into(),
    ];
    if !cmd.trim().is_empty() {
        fields.push(format!("command: {}", interpolate_rhai(&cmd, prev_var)));
    }
    if let Some(args) = n.params.get("args") {
        if args.as_object().is_some_and(|o| !o.is_empty()) {
            fields.push(format!("args: {}", json_to_rhai(args)));
        }
    }
    let timeout = param_num(&n.params, "timeoutSecs");
    if timeout > 0.0 {
        fields.push(format!("timeout_secs: {}", timeout.floor() as i64));
    }
    fields.push(format!("input: {prev_var}"));
    format!("#{{ {} }}", fields.join(", "))
}

fn http_task(n: &Node, prev_var: &str) -> String {
    let method = param_str(&n.params, "method").to_uppercase();
    let method = if method.is_empty() { "GET".into() } else { method };
    let url = param_str(&n.params, "url");
    let headers = param_str(&n.params, "headers");
    let body = param_str(&n.params, "body");
    let timeout = param_num(&n.params, "timeoutSecs");
    let mut text = vec![format!(
        "发起一次真实的 HTTP {method} 请求到「{url}」，把响应内容（状态码、响应头、响应体）作为结果返回。"
    )];
    if !headers.trim().is_empty() {
        text.push(format!("请求头（每行一条 Name: value）：\n{headers}"));
    }
    if !body.trim().is_empty() {
        text.push(format!("请求体：\n{body}"));
    }
    if timeout > 0.0 {
        text.push(format!(
            "请求必须设置超时：{} 秒内无响应即视为失败。",
            timeout.floor() as i64
        ));
    }
    text.push("要求：请求必须真实发出，禁止伪造或编造响应；请求失败时如实报告错误。".into());
    text.push("纯 GET 且无需自定义请求头/请求体时可用 web_fetch；需要自定义方法、请求头或请求体时用 shell 工具（bash 用 curl，PowerShell 用 curl.exe 或 Invoke-RestMethod）。".into());
    format!(
        "#{{ node_id: {}, kind: \"http\", prompt: {}, input: {prev_var} }}",
        json_to_rhai(&Value::String(n.id.clone())),
        interpolate_rhai(&text.join("\n"), prev_var)
    )
}

fn database_task(n: &Node, prev_var: &str) -> String {
    let sql = param_str(&n.params, "sql");
    let db = param_str(&n.params, "dbPath");
    let mut text = vec![
        "用 database_query 工具对本地 SQLite 数据库真实执行 SQL 并返回结果（SELECT 返回行，其他返回影响行数）。".into(),
        format!("SQL：\n{sql}"),
    ];
    if !db.trim().is_empty() {
        text.push(format!(
            "数据库文件：{db}（省略用默认库 ~/.vesprism/mcp/db.sqlite）"
        ));
    }
    text.push("要求：必须真实执行，禁止编造查询结果；执行失败时如实报告错误。".into());
    format!(
        "#{{ node_id: {}, kind: \"database\", prompt: {}, input: {prev_var} }}",
        json_to_rhai(&Value::String(n.id.clone())),
        interpolate_rhai(&text.join("\n"), prev_var)
    )
}

fn knowledge_task(n: &Node, prev_var: &str) -> String {
    let kb = param_str(&n.params, "knowledgeBase");
    let query = param_str(&n.params, "query");
    let limit = param_num(&n.params, "limit");
    let mut text = vec![format!(
        "用 knowledge_search 工具在本地知识库「{kb}」全文检索：{query}"
    )];
    if limit > 0.0 {
        text.push(format!("最多返回 {} 条命中片段。", limit.floor() as i64));
    }
    text.push("要求：必须真实检索，返回命中片段与来源文件，禁止编造内容；检索失败时如实报告错误。".into());
    format!(
        "#{{ node_id: {}, kind: \"knowledge\", prompt: {}, input: {prev_var} }}",
        json_to_rhai(&Value::String(n.id.clone())),
        interpolate_rhai(&text.join("\n"), prev_var)
    )
}

fn build_agent_job_map(
    n: &Node,
    prev_var: &str,
    presets: &HashMap<String, Preset>,
) -> Result<String, String> {
    if n.ty == "agent" {
        let resolved = resolve_agent(n, presets)?;
        let task = agent_task(n, prev_var, &resolved);
        let mut opts = vec![
            format!("prompt: json_encode({task})"),
            format!("label: \"{}\"", esc(&n.id)),
        ];
        if !resolved.model.is_empty() {
            opts.push(format!("model: \"{}\"", esc(&resolved.model)));
        }
        if !resolved.agent_type.is_empty() {
            opts.push(format!("agent_type: \"{}\"", esc(&resolved.agent_type)));
        }
        push_isolation(&mut opts, resolved.isolation);
        if let Some(schema) = &resolved.output_schema {
            opts.push(format!("output_schema: {}", json_to_rhai(schema)));
        }
        if !resolved.disabled_tools.is_empty() {
            let list = resolved
                .disabled_tools
                .iter()
                .map(|t| format!("\"{}\"", esc(t)))
                .collect::<Vec<_>>()
                .join(", ");
            opts.push(format!("disabled_tools: [{list}]"));
        }
        if !resolved.permission_rules.is_empty() {
            let list = resolved
                .permission_rules
                .iter()
                .map(|t| format!("\"{}\"", esc(t)))
                .collect::<Vec<_>>()
                .join(", ");
            opts.push(format!("permission_rules: [{list}]"));
        }
        return Ok(format!("#{{ {} }}", opts.join(", ")));
    }
    if n.ty == "tool" {
        return Ok(format!(
            "#{{ prompt: json_encode({}), label: \"{}\" }}",
            tool_task(n, prev_var),
            esc(&n.id)
        ));
    }
    if n.ty == "http" {
        return Ok(format!(
            "#{{ prompt: json_encode({}), label: \"{}\" }}",
            http_task(n, prev_var),
            esc(&n.id)
        ));
    }
    Ok(format!(
        "#{{ prompt: json_encode(#{{ node_id: {}, input: {prev_var} }}), label: \"{}\" }}",
        json_to_rhai(&Value::String(n.id.clone())),
        esc(&n.id)
    ))
}

fn push_isolation(opts: &mut Vec<String>, isolation: Option<bool>) {
    match isolation {
        Some(true) => opts.push("isolation_worktree: true".into()),
        Some(false) => opts.push("isolation_worktree: false".into()),
        None => {}
    }
}

fn push_timeout_ms(opts: &mut Vec<String>, n: &Node) {
    let secs = param_num(&n.params, "timeoutSecs");
    if secs > 0.0 {
        opts.push(format!("timeout_ms: {}", (secs.floor() as i64) * 1000));
    }
}

fn interpolate_rhai(text: &str, prev_var: &str) -> String {
    let re = regex_lite_split(text);
    if re.exprs == 0 {
        return format!("\"{}\"", esc(text));
    }
    if re.parts.len() == 1 && re.parts[0].1 {
        if let Some(e) = to_expr(&re.parts[0].0, prev_var) {
            return e;
        }
        return format!("\"{}\"", esc(text));
    }
    let pieces: Vec<String> = re
        .parts
        .iter()
        .map(|(val, is_expr)| {
            if *is_expr {
                to_expr(val, prev_var)
                    .map(|e| format!("{e}.to_string()"))
                    .unwrap_or_else(|| format!("\"{}\"", esc(&format!("{{{{{val}}}}}"))))
            } else {
                format!("\"{}\"", esc(val))
            }
        })
        .collect();
    if pieces.len() == 1 {
        pieces[0].clone()
    } else {
        pieces.join(" + ")
    }
}

struct Split {
    parts: Vec<(String, bool)>,
    exprs: usize,
}

fn regex_lite_split(text: &str) -> Split {
    let mut parts = Vec::new();
    let mut last = 0;
    let bytes = text.as_bytes();
    let mut i = 0;
    let mut exprs = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'{' && bytes[i + 1] == b'{' {
            if let Some(end) = text[i + 2..].find("}}") {
                let inner_start = i + 2;
                let inner_end = inner_start + end;
                if i > last {
                    parts.push((text[last..i].to_string(), false));
                }
                parts.push((text[inner_start..inner_end].trim().to_string(), true));
                exprs += 1;
                last = inner_end + 2;
                i = last;
                continue;
            }
        }
        i += 1;
    }
    if last < text.len() {
        parts.push((text[last..].to_string(), false));
    }
    Split { parts, exprs }
}

fn to_expr(v: &str, prev_var: &str) -> Option<String> {
    let key = v.to_ascii_lowercase();
    if key == "prev" {
        return Some(prev_var.to_string());
    }
    if key == "input" || key == "start.input" {
        return Some("input".into());
    }
    if let Some((base, deep)) = split_output_deep(v) {
        let b = base.to_ascii_lowercase();
        let root = if b == "prev" {
            prev_var.to_string()
        } else if b == "input" || b == "start" {
            "input".into()
        } else {
            ident(&base)
        };
        return Some(format!("{root}.output{deep}"));
    }
    if let Some(base) = v.strip_suffix(".output").or_else(|| {
        let l = v.to_ascii_lowercase();
        if l.ends_with(".output") {
            Some(&v[..v.len() - 7])
        } else {
            None
        }
    }) {
        let k = base.to_ascii_lowercase();
        if k == "prev" {
            return Some(format!("{prev_var}.output"));
        }
        return Some(format!("{}.output", ident(base)));
    }
    None
}

fn split_output_deep(v: &str) -> Option<(String, String)> {
    let lower = v.to_ascii_lowercase();
    let idx = lower.find(".output.")?;
    let base = &v[..idx];
    let deep = &v[idx + 7..]; // starts with .xxx
    if deep.is_empty() || !deep.starts_with('.') {
        return None;
    }
    if !deep[1..]
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
    {
        return None;
    }
    Some((base.to_string(), deep.to_string()))
}

fn outgoing(edges: &[Edge], id: &str) -> Vec<Edge> {
    edges.iter().filter(|e| e.from == id).cloned().collect()
}

fn incoming(edges: &[Edge], id: &str) -> Vec<Edge> {
    edges.iter().filter(|e| e.to == id).cloned().collect()
}

fn param_str(params: &Value, key: &str) -> String {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn param_num(params: &Value, key: &str) -> f64 {
    params
        .get(key)
        .and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_i64().map(|i| i as f64))
                .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
        })
        .unwrap_or(0.0)
}

fn ident(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .collect();
    if cleaned
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
    {
        cleaned
    } else {
        format!("n_{cleaned}")
    }
}

fn phase_title(n: &Node) -> String {
    let label = param_str(&n.params, "label");
    let label = label.trim();
    if label.is_empty() {
        n.id.clone()
    } else {
        let base: String = label.chars().take(40).collect();
        format!("{} · {}", base, n.id)
    }
}

fn esc(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\r', "")
        .replace('\n', "\\n")
}

fn json_to_rhai(v: &Value) -> String {
    match v {
        Value::Null => "()".into(),
        Value::String(s) => format!("\"{}\"", esc(s)),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => if *b { "true".into() } else { "false".into() },
        Value::Array(arr) => {
            let inner = arr.iter().map(json_to_rhai).collect::<Vec<_>>().join(", ");
            format!("[{inner}]")
        }
        Value::Object(map) => {
            let inner = map
                .iter()
                .map(|(k, val)| format!("\"{}\": {}", esc(k), json_to_rhai(val)))
                .collect::<Vec<_>>()
                .join(", ");
            format!("#{{ {inner} }}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demo_nodes() -> Value {
        serde_json::json!([
            {"id":"start-1","type":"start","params":{"label":"起点"}},
            {"id":"agent-1","type":"agent","params":{"label":"摘要","role":"需求与代码分析专家","prompt":"请分析输入"}},
            {"id":"end-1","type":"end","params":{"label":"终点"}}
        ])
    }
    fn demo_edges() -> Value {
        serde_json::json!([
            {"from":"start-1","to":"agent-1"},
            {"from":"agent-1","to":"end-1"}
        ])
    }

    #[test]
    fn compiles_demo_without_frontend_rhai() {
        let nodes = parse_nodes(&demo_nodes()).unwrap();
        let edges = parse_edges(&demo_edges()).unwrap();
        let rhai = compile_to_rhai("demo-linear", "示例流程", "", &nodes, &edges, &HashMap::new())
            .unwrap();
        assert!(rhai.contains("let meta = #{"));
        assert!(rhai.contains("name: \"demo-linear\""));
        assert!(rhai.contains("phase(\"摘要 · agent-1\")"));
        assert!(rhai.contains("agent("));
        assert!(rhai.contains("complete("));
        assert!(!rhai.contains("position"));
    }

    #[test]
    fn rejects_unknown_agent_preset() {
        let mut nodes = parse_nodes(&demo_nodes()).unwrap();
        nodes[1].params["presetId"] = Value::String("coding".into());
        let edges = parse_edges(&demo_edges()).unwrap();
        let err = compile_to_rhai("demo-linear", "示例", "", &nodes, &edges, &HashMap::new())
            .unwrap_err();
        assert!(err.contains("coding"));
    }

    #[test]
    fn ignores_client_supplied_script_shape() {
        let req = SaveFlowRequest {
            id: "demo-linear".into(),
            name: "示例".into(),
            description: "说明".into(),
            version: "1".into(),
            input_schema: serde_json::json!({"type":"object"}),
            output_schema: serde_json::json!({"type":"object"}),
            nodes: demo_nodes(),
            edges: demo_edges(),
            publish: true,
            stage: false,
            ephemeral: false,
            rhai: Some("agent(\"pwn\")".into()),
            prompts: None,
        };
        let rhai = compile_save_request(&req).unwrap();
        assert!(rhai.contains("let meta = #{"));
        assert!(!rhai.contains("agent(\"pwn\")"));
    }
}
