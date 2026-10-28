use std::collections::{HashMap, HashSet};

use crate::error::LinkError;
use crate::model::{EntityId, GraphView, Link, LinkView, Node, NodeView};

/// 内存中的引用图；后续由 project.sqlite 装载。
#[derive(Debug, Default)]
pub struct Graph {
    pub(crate) nodes: HashMap<EntityId, Node>,
    pub(crate) links: HashSet<Link>,
    /// 节点当前生成输入的 hash
    pub(crate) hashes: HashMap<EntityId, String>,
    /// 节点内各项（如台词）的 hash：节点 id -> 项 id -> hash
    pub(crate) item_hashes: HashMap<EntityId, HashMap<EntityId, String>>,
}

impl Graph {
    pub fn add_node(&mut self, node: Node) {
        self.nodes.insert(node.id.clone(), node);
    }

    /// 导出前快照用：当前带角标的节点，按 id 排序。直接标的是 needs_update，更下游的是 upstream_stale。
    pub fn stale_flags(&self) -> Vec<(EntityId, &'static str)> {
        let mut v: Vec<_> = self
            .nodes
            .values()
            .filter_map(|n| {
                if n.needs_update {
                    Some((n.id.clone(), "needs_update"))
                } else if self.upstream_stale(&n.id) {
                    Some((n.id.clone(), "upstream_stale"))
                } else {
                    None
                }
            })
            .collect();
        v.sort();
        v
    }
    /// 整张图给前端：节点按 id 排序、带现算的 upstreamStale；连线排序。
    pub fn snapshot(&self) -> GraphView {
        let mut ids: Vec<&EntityId> = self.nodes.keys().collect();
        ids.sort();
        let nodes = ids.into_iter().filter_map(|id| self.view(id)).collect();
        let mut links: Vec<LinkView> = self
            .links
            .iter()
            .map(|l| LinkView { link: l.clone(), invalid: !self.link_ok(l) })
            .collect();
        links.sort_by(|a, b| (&a.from, &a.to, &a.source_item).cmp(&(&b.from, &b.to, &b.source_item)));
        GraphView { nodes, links, layout: Default::default() }
    }

    /// 这条线按当前端口表是否合法：源节点出得了这个端口、目标节点收得了。
    fn link_ok(&self, l: &Link) -> bool {
        match (self.nodes.get(&l.from), self.nodes.get(&l.to)) {
            (Some(a), Some(b)) => a.outputs.contains(&l.port) && b.inputs.contains(&l.port),
            _ => false,
        }
    }

    pub fn is_invalid(&self, l: &Link) -> bool {
        !self.link_ok(l)
    }

    /// 全部非法连线，排序。导出前检查用。
    pub fn invalid_links(&self) -> Vec<Link> {
        let mut v: Vec<Link> = self.links.iter().filter(|l| !self.link_ok(l)).cloned().collect();
        v.sort_by(|a, b| (&a.from, &a.to, &a.source_item).cmp(&(&b.from, &b.to, &b.source_item)));
        v
    }

    /// 合法连线（生成输入、导出素材都只看这些）。非法连线不在里面。
    pub fn links(&self) -> impl Iterator<Item = &Link> {
        self.links.iter().filter(|l| self.link_ok(l))
    }

    /// 指向某节点的合法连线，排序。
    pub fn generation_inputs(&self, id: &str) -> Vec<&Link> {
        let mut v: Vec<&Link> = self.links().filter(|l| l.to == id).collect();
        v.sort_by(|a, b| (&a.from, &a.source_item).cmp(&(&b.from, &b.source_item)));
        v
    }

    /// 节点生成输入的 hash：自己的正文 + 合法上游的 hash。非法连线不参与。
    pub fn input_hash(&self, id: &str) -> Option<String> {
        let n = self.nodes.get(id)?;
        let ups: Vec<&str> = self
            .parents(id)
            .map(|p| self.hashes.get(p).map(String::as_str).unwrap_or(p.as_str()))
            .collect();
        Some(crate::hash::node_hash(n.kind, &serde_json::json!({ "text": n.text }), None, &ups))
    }

    pub fn node(&self, id: &str) -> Option<&Node> {
        self.nodes.get(id)
    }

    pub fn link(&mut self, link: Link) -> Result<(), LinkError> {
        let from = self.nodes.get(&link.from).ok_or(LinkError::NotFound)?;
        let to = self.nodes.get(&link.to).ok_or(LinkError::NotFound)?;
        if to.locked {
            return Err(LinkError::ScriptLocked);
        }
        if !from.outputs.contains(&link.port) || !to.inputs.contains(&link.port) {
            return Err(LinkError::TypeMismatch);
        }
        if link.from == link.to || self.reaches(&link.to, &link.from) {
            return Err(LinkError::Cycle);
        }
        if let Some(item) = &link.source_item {
            // 挂某一句台词：这句必须属于上游那份剧本
            if !self
                .item_hashes
                .get(&link.from)
                .is_some_and(|m| m.contains_key(item))
            {
                return Err(LinkError::NotFound);
            }
        }
        let target = link.to.clone();
        if self.links.insert(link) {
            self.mark(&[target]);
        }
        Ok(())
    }

    /// 删节点，连着它的线一起删；原来的直接下游标「需更新」。定稿的节点不能删。
    pub fn remove_node(&mut self, id: &str) -> Result<(), LinkError> {
        let n = self.nodes.get(id).ok_or(LinkError::NotFound)?;
        if n.locked {
            return Err(LinkError::ScriptLocked);
        }
        let downstream: Vec<EntityId> = self.children(id).filter(|c| *c != id).cloned().collect();
        self.links.retain(|l| l.from != id && l.to != id);
        self.nodes.remove(id);
        self.hashes.remove(id);
        self.item_hashes.remove(id);
        self.mark(&downstream);
        Ok(())
    }

    /// 删连线。合法的线删了要给下游标「需更新」；非法的线本来就不是生成输入，删它不标，定稿节点上的也能删。
    pub fn unlink(&mut self, link: &Link) -> Result<(), LinkError> {
        let locked = self.nodes.get(&link.to).ok_or(LinkError::NotFound)?.locked;
        let valid = self.link_ok(link);
        if valid && locked {
            return Err(LinkError::ScriptLocked);
        }
        if self.links.remove(link) && valid {
            self.mark(&[link.to.clone()]);
        }
        Ok(())
    }

    /// 写入节点新 hash。和旧值不同时，只给直接下游标「需更新」，不自动重跑；返回被标的节点。
    /// 第一次写入（没有旧值）不标。
    pub fn set_hash(&mut self, id: &str, hash: String) -> Vec<EntityId> {
        let changed = matches!(self.hashes.get(id), Some(old) if *old != hash);
        self.hashes.insert(id.to_string(), hash);
        if !changed {
            return Vec::new();
        }
        let targets: Vec<EntityId> = {
            let mut v: Vec<EntityId> = self.children(id).cloned().collect();
            v.sort();
            v.dedup();
            v
        };
        self.mark(&targets);
        targets
    }

    /// 改节点正文。正文变了就标自己「需更新」，并把新 hash 传给直接下游。
    pub fn set_text(&mut self, id: &str, text: String) -> Result<(), LinkError> {
        let (kind, content) = {
            let n = self.nodes.get_mut(id).ok_or(LinkError::NotFound)?;
            if n.locked {
                return Err(LinkError::ScriptLocked);
            }
            if n.text == text {
                return Ok(());
            }
            n.text = text;
            n.needs_update = true;
            (n.kind, serde_json::json!({ "text": n.text }))
        };
        let hash = crate::hash::node_hash(kind, &content, None, &[]);
        self.set_hash(id, hash);
        Ok(())
    }

    /// 从这个节点往上收集正文，上游在前，自己在后。给出生图提示词。
    pub fn prompt_text(&self, id: &str) -> String {
        let mut seen = HashSet::new();
        let mut lines = Vec::new();
        self.write_prompt(id, &mut seen, &mut lines);
        lines.join("\n")
    }

    fn write_prompt(&self, id: &str, seen: &mut HashSet<String>, lines: &mut Vec<String>) {
        if !seen.insert(id.to_string()) {
            return;
        }
        let mut ups: Vec<String> = self.parents(id).cloned().collect();
        ups.sort_by(|a, b| {
            let rank = |id: &str| {
                self.nodes.get(id).map(|n| match n.kind {
                    crate::model::NodeKind::Script => 0,
                    crate::model::NodeKind::Character => 1,
                    crate::model::NodeKind::ShotGroup => 2,
                    crate::model::NodeKind::Voice => 3,
                    crate::model::NodeKind::Shot => 4,
                    crate::model::NodeKind::Export => 5,
                }).unwrap_or(9)
            };
            rank(a).cmp(&rank(b)).then(a.cmp(b))
        });
        for up in ups {
            self.write_prompt(&up, seen, lines);
        }
        let Some(n) = self.nodes.get(id) else { return };
        let t = n.text.trim();
        if t.is_empty() {
            return;
        }
        let label = match n.kind {
            crate::model::NodeKind::Script => "剧本",
            crate::model::NodeKind::Character => "角色",
            crate::model::NodeKind::ShotGroup => "分镜",
            crate::model::NodeKind::Shot => "画面",
            crate::model::NodeKind::Voice => "配音",
            crate::model::NodeKind::Export => "导出",
        };
        lines.push(format!("{label}：{t}"));
    }

    /// 某个节点重新生成完成后调用：只清它自己的「需更新」。
    pub fn clear_needs_update(&mut self, id: &str) {
        if let Some(n) = self.nodes.get_mut(id) {
            n.needs_update = false;
        }
    }

    /// 只读、现算：往上任何一级有「需更新」就是 true。不存库、不算 hash、不触发重跑。
    pub fn upstream_stale(&self, id: &str) -> bool {
        let mut stack: Vec<&EntityId> = self.parents(id).collect();
        let mut seen = HashSet::new();
        while let Some(cur) = stack.pop() {
            if !seen.insert(cur) {
                continue;
            }
            if self.nodes.get(cur).is_some_and(|n| n.needs_update) {
                return true;
            }
            stack.extend(self.parents(cur));
        }
        false
    }

    /// 发给前端的节点：带上现算的 upstreamStale。
    pub fn view(&self, id: &str) -> Option<NodeView> {
        self.nodes.get(id).map(|n| {
            let shot = n.kind == crate::model::NodeKind::Shot;
            NodeView {
                node: n.clone(),
                upstream_stale: self.upstream_stale(id),
                image: shot.then_some(None),
                video: shot.then_some(None),
                asset: (!shot).then_some(None),
            }
        })
    }

    fn parents<'a>(&'a self, id: &'a str) -> impl Iterator<Item = &'a EntityId> + 'a {
        self.links
            .iter()
            .filter(move |l| l.to == id && self.link_ok(l))
            .map(|l| &l.from)
    }

    pub fn hash(&self, id: &str) -> Option<&str> {
        self.hashes.get(id).map(String::as_str)
    }

    /// 写入节点内各项的 hash（如剧本每句台词）。只给挂在「变了/被删」那几项上的直接下游标「需更新」；
    /// 挂整个节点（source_item 为空）的连线，任一项变化都标。第一次写入不标。
    pub fn set_item_hashes(&mut self, id: &str, items: HashMap<EntityId, String>) -> Vec<EntityId> {
        let old = self.item_hashes.insert(id.to_string(), items.clone());
        let Some(old) = old else { return Vec::new() };
        let mut changed: HashSet<&EntityId> = items
            .iter()
            .filter(|(k, h)| old.get(*k).is_some_and(|o| o != *h))
            .map(|(k, _)| k)
            .collect();
        changed.extend(old.keys().filter(|k| !items.contains_key(*k)));
        let added = items.keys().any(|k| !old.contains_key(k));
        if changed.is_empty() && !added {
            return Vec::new();
        }
        let mut targets: Vec<EntityId> = self
            .links
            .iter()
            .filter(|l| l.from == id && self.link_ok(l))
            .filter(|l| match &l.source_item {
                Some(item) => changed.contains(item),
                None => true,
            })
            .map(|l| l.to.clone())
            .collect();
        targets.sort();
        targets.dedup();
        self.mark(&targets);
        targets
    }

    fn mark(&mut self, ids: &[EntityId]) {
        for id in ids {
            if let Some(n) = self.nodes.get_mut(id) {
                n.needs_update = true;
            }
        }
    }

    fn children<'a>(&'a self, id: &'a str) -> impl Iterator<Item = &'a EntityId> + 'a {
        self.links
            .iter()
            .filter(move |l| l.from == id && self.link_ok(l))
            .map(|l| &l.to)
    }

    fn reaches(&self, start: &str, goal: &str) -> bool {
        let mut stack = vec![start.to_string()];
        let mut seen = HashSet::new();
        while let Some(cur) = stack.pop() {
            if cur == goal {
                return true;
            }
            if seen.insert(cur.clone()) {
                stack.extend(self.children(&cur).cloned());
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{NodeKind, PortType::*};

    fn node(
        id: &str,
        kind: NodeKind,
        ins: &[crate::model::PortType],
        outs: &[crate::model::PortType],
    ) -> Node {
        Node {
            id: id.into(),
            kind,
            inputs: ins.to_vec(),
            outputs: outs.to_vec(),
            locked: false,
            needs_update: false,
            text: String::new(),
        }
    }

    fn sample() -> Graph {
        let mut g = Graph::default();
        g.add_node(node("script", NodeKind::Script, &[], &[Line]));
        g.add_node(node("char", NodeKind::Character, &[], &[CharacterLook]));
        g.add_node(node(
            "shot",
            NodeKind::Shot,
            &[Line, CharacterLook, Audio],
            &[Image, Video],
        ));
        g.add_node(node("voice", NodeKind::Voice, &[Line, CharacterLook], &[Audio]));
        g.add_node(node(
            "export",
            NodeKind::Export,
            &[Video, Audio, Image],
            &[FinalCut],
        ));
        g
    }

    fn l(from: &str, to: &str, port: crate::model::PortType) -> Link {
        Link {
            from: from.into(),
            to: to.into(),
            port,
            source_item: None,
        }
    }

    fn clear(g: &mut Graph) {
        for n in g.nodes.values_mut() {
            n.needs_update = false;
        }
    }

    #[test]
    fn prompt_puts_upstream_text_before_the_node() {
        let mut g = sample();
        g.link(l("script", "shot", Line)).unwrap();
        g.link(l("char", "shot", CharacterLook)).unwrap();
        g.set_text("script", "雨夜巷口".into()).unwrap();
        g.set_text("char", "黑衣少年".into()).unwrap();
        g.set_text("shot", "回头看".into()).unwrap();
        assert_eq!(
            g.prompt_text("shot"),
            "剧本：雨夜巷口\n角色：黑衣少年\n画面：回头看"
        );
        assert!(g.node("shot").unwrap().needs_update);
    }

    #[test]
    fn type_mismatch_rejected() {
        let mut g = sample();
        assert_eq!(
            g.link(l("char", "export", CharacterLook)),
            Err(LinkError::TypeMismatch)
        );
    }

    #[test]
    fn cycle_rejected() {
        let mut g = sample();
        g.add_node(node("a", NodeKind::Shot, &[Image], &[Image]));
        g.add_node(node("b", NodeKind::Shot, &[Image], &[Image]));
        g.link(l("a", "b", Image)).unwrap();
        assert_eq!(g.link(l("b", "a", Image)), Err(LinkError::Cycle));
        assert_eq!(g.link(l("a", "a", Image)), Err(LinkError::Cycle));
    }

    #[test]
    fn locked_target_rejected() {
        let mut g = sample();
        g.nodes.get_mut("shot").unwrap().locked = true;
        assert_eq!(
            g.link(l("script", "shot", Line)),
            Err(LinkError::ScriptLocked)
        );
    }

    #[test]
    fn unlink_marks_direct_downstream_only() {
        let mut g = sample();
        g.link(l("script", "voice", Line)).unwrap();
        g.link(l("voice", "shot", Audio)).unwrap();
        g.link(l("shot", "export", Video)).unwrap();
        g.link(l("char", "shot", CharacterLook)).unwrap();
        clear(&mut g);
        g.unlink(&l("script", "voice", Line)).unwrap();
        assert!(g.node("voice").unwrap().needs_update);
        assert!(!g.node("shot").unwrap().needs_update, "只标直接下游");
        assert!(!g.node("export").unwrap().needs_update);
        assert!(
            g.upstream_stale("shot") && g.upstream_stale("export"),
            "间接下游现算 upstreamStale"
        );
        assert!(!g.upstream_stale("char") && !g.upstream_stale("voice"));
        let v = serde_json::to_value(g.view("export").unwrap()).unwrap();
        assert_eq!(v["upstreamStale"], true);
        assert_eq!(v["needsUpdate"], false);
        assert!(!g.node("char").unwrap().needs_update);
        assert!(!g.node("script").unwrap().needs_update);
    }

    #[test]
    fn error_code_serializes_for_frontend() {
        let v = serde_json::to_value(LinkError::Cycle).unwrap();
        assert_eq!(v, serde_json::json!({"code": "cycle"}));
    }
    #[test]
    fn clearing_one_node_keeps_others_marked() {
        let mut g = sample();
        g.link(l("script", "voice", Line)).unwrap();
        g.link(l("char", "shot", CharacterLook)).unwrap();
        assert!(g.node("voice").unwrap().needs_update && g.node("shot").unwrap().needs_update);
        g.clear_needs_update("voice");
        assert!(!g.node("voice").unwrap().needs_update);
        assert!(
            g.node("shot").unwrap().needs_update,
            "没重新生成的节点保持需更新"
        );
    }

    #[test]
    fn source_item_must_belong_to_upstream_script() {
        let mut g = sample();
        let item = |id: &str| Link {
            from: "script".into(),
            to: "voice".into(),
            port: Line,
            source_item: Some(id.into()),
        };
        assert_eq!(
            g.link(item("L1")),
            Err(LinkError::NotFound),
            "剧本还没有这句"
        );
        let _ = g.set_item_hashes("script", [("L1".to_string(), "h".to_string())].into());
        assert_eq!(g.link(item("L9")), Err(LinkError::NotFound));
        g.link(item("L1")).unwrap();
        // 删掉这句：线保留，下游标需更新
        clear(&mut g);
        assert_eq!(
            g.set_item_hashes("script", Default::default()),
            vec!["voice".to_string()]
        );
        assert!(g.links.contains(&item("L1")));
        assert!(g.node("voice").unwrap().needs_update);
    }

    #[test]
    fn remove_node_drops_its_links_and_marks_downstream() {
        let mut g = Graph::default();
        for (id, k) in [("s", crate::model::NodeKind::Script), ("v", crate::model::NodeKind::Voice), ("e", crate::model::NodeKind::Export)] {
            let (i, o) = k.default_ports();
            g.add_node(Node { id: id.into(), kind: k, inputs: i, outputs: o, locked: false, needs_update: false, text: String::new() });
        }
        use crate::model::PortType::*;
        g.link(Link { from: "s".into(), to: "v".into(), port: Line, source_item: None }).unwrap();
        g.link(Link { from: "v".into(), to: "e".into(), port: Audio, source_item: None }).unwrap();
        g.nodes.get_mut("e").unwrap().needs_update = false;
        g.remove_node("v").unwrap();
        assert!(g.node("v").is_none());
        assert!(g.links.is_empty());
        assert!(g.node("e").unwrap().needs_update);
        assert_eq!(g.remove_node("v"), Err(LinkError::NotFound));
        g.nodes.get_mut("s").unwrap().locked = true;
        assert_eq!(g.remove_node("s"), Err(LinkError::ScriptLocked));
        assert!(g.node("s").is_some());
    }

    /// 端口表：每一对 (上游类型, 下游类型, 端口) 都试一遍，允许的必须正好是这张表，其余 type_mismatch。
    #[test]
    fn port_table_allows_exactly_the_agreed_pairs() {
        use crate::model::PortType;
        use NodeKind::*;
        let ports = [Line, CharacterLook, Image, Video, Audio, FinalCut];
        let allowed: HashSet<(NodeKind, NodeKind, PortType)> = [
            (Script, ShotGroup, Line), (Script, Shot, Line), (Script, Voice, Line),
            (Character, ShotGroup, CharacterLook), (Character, Shot, CharacterLook), (Character, Voice, CharacterLook),
            (ShotGroup, ShotGroup, Line), (ShotGroup, ShotGroup, CharacterLook),
            (ShotGroup, Shot, Line), (ShotGroup, Shot, CharacterLook),
            (ShotGroup, Voice, Line), (ShotGroup, Voice, CharacterLook),
            (Shot, Shot, Image), (Shot, Export, Image), (Shot, Export, Video),
            (Voice, Shot, Audio), (Voice, Export, Audio),
        ]
        .into_iter()
        .collect();
        let mut ok = 0;
        for a in NodeKind::ALL {
            for b in NodeKind::ALL {
                for p in ports {
                    let mut g = Graph::default();
                    for (id, k) in [("a", a), ("b", b)] {
                        let (i, o) = k.default_ports();
                        g.add_node(node(id, k, &i, &o));
                    }
                    let r = g.link(l("a", "b", p));
                    // 前端预判（同一张表）必须和后端结果一致
                    let (_, ao) = a.default_ports();
                    let (bi, _) = b.default_ports();
                    let predicted = ao.contains(&p) && bi.contains(&p);
                    if allowed.contains(&(a, b, p)) {
                        assert_eq!(r, Ok(()), "{a:?}->{b:?} {p:?}");
                        ok += 1;
                    } else {
                        assert_eq!(r, Err(LinkError::TypeMismatch), "{a:?}->{b:?} {p:?}");
                    }
                    assert_eq!(predicted, r.is_ok(), "{a:?}->{b:?} {p:?}");
                }
            }
        }
        assert_eq!(ok, allowed.len());
        // 点名几条
        assert!(!allowed.contains(&(ShotGroup, Export, Image)), "分镜组不出图");
        assert!(ShotGroup.default_ports().1.iter().all(|p| *p != Image));
        assert!(!Voice.default_ports().0.contains(&Image), "配音不收图");
    }

    /// 旧项目遗留的非法连线：shot_group 现在不出图，库里却有 shot_group -> shot (image)。
    fn with_stale_illegal_link() -> (Graph, Link) {
        let mut g = Graph::default();
        for (id, k) in [("sg", NodeKind::ShotGroup), ("shot", NodeKind::Shot), ("script", NodeKind::Script)] {
            let (i, o) = k.default_ports();
            g.add_node(node(id, k, &i, &o));
        }
        g.link(l("script", "shot", Line)).unwrap();
        let bad = l("sg", "shot", Image);
        g.links.insert(bad.clone());
        clear(&mut g);
        (g, bad)
    }

    #[test]
    fn invalid_link_is_flagged_but_not_input_hash_prompt_or_stale() {
        let (mut g, bad) = with_stale_illegal_link();
        assert!(g.is_invalid(&bad));
        let flags: Vec<(String, bool)> = g.snapshot().links.iter().map(|x| (x.from.clone(), x.invalid)).collect();
        assert_eq!(flags, [("script".to_string(), false), ("sg".to_string(), true)], "只有非法那条 invalid=true");
        assert_eq!(g.invalid_links(), [bad.clone()]);
        // 生成输入只有合法的那条
        let ins: Vec<&str> = g.generation_inputs("shot").iter().map(|x| x.from.as_str()).collect();
        assert_eq!(ins, ["script"]);
        assert!(g.links().all(|x| *x != bad));
        // hash：和「根本没有这条线」的图一样
        let (mut clean, _) = with_stale_illegal_link();
        clean.links.remove(&bad);
        g.nodes.get_mut("sg").unwrap().text = "分镜正文".into();
        g.set_hash("sg", "h-sg".into());
        clean.set_hash("sg", "h-sg".into());
        assert_eq!(g.input_hash("shot"), clean.input_hash("shot"));
        // 提示词不带非法上游的字
        g.nodes.get_mut("script").unwrap().text = "雨夜".into();
        assert_eq!(g.prompt_text("shot"), "剧本：雨夜");
        // 上游变了/带「需更新」，不传给非法线的下游
        g.set_hash("sg", "h-sg-2".into());
        assert!(!g.node("shot").unwrap().needs_update, "非法线不标下游");
        g.nodes.get_mut("sg").unwrap().needs_update = true;
        assert!(!g.upstream_stale("shot"));
        assert!(g.stale_flags().iter().all(|(id, _)| id != "shot"));
    }

    #[test]
    fn deleting_invalid_link_works_and_does_not_mark_downstream_but_cannot_be_recreated() {
        let (mut g, bad) = with_stale_illegal_link();
        assert_eq!(g.unlink(&bad), Ok(()));
        assert!(!g.links.contains(&bad));
        assert!(!g.node("shot").unwrap().needs_update, "删非法线不标下游");
        assert_eq!(g.link(bad.clone()), Err(LinkError::TypeMismatch), "不能再连出来");
        assert!(g.links.iter().all(|x| *x != bad));
        // 合法的线删了照旧标下游
        assert_eq!(g.unlink(&l("script", "shot", Line)), Ok(()));
        assert!(g.node("shot").unwrap().needs_update);
        // 定稿节点上的非法线也能删；合法线仍然不行
        let (mut g, bad) = with_stale_illegal_link();
        g.nodes.get_mut("shot").unwrap().locked = true;
        assert_eq!(g.unlink(&l("script", "shot", Line)), Err(LinkError::ScriptLocked));
        assert_eq!(g.unlink(&bad), Ok(()));
    }
}
