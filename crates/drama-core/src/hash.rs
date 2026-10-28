//! 生成输入的 hash：固定序列化顺序（对象键排序），用 blake3。
//! 算进去：节点类型、内容、模型、模型版本、分辨率、时长、seed、上游 hash。
//! 不算：画布布局（canvas_layout 不经过这里）、显示用文案（DISPLAY_KEYS）。
use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{EntityId, NodeKind};

const VERSION_TAG: &str = "drama-hash-v1";

/// 只用于显示、不影响生成结果的字段，算 hash 前去掉。
pub const DISPLAY_KEYS: &[&str] = &["label", "title", "displayName", "note", "color"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenParams {
    pub model: String,
    pub model_version: String,
    pub resolution: String,
    pub duration_ms: u64,
    pub seed: u64,
}

/// 剧本里的一句台词。`speaker` 是角色 id。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptLine {
    pub id: EntityId,
    pub speaker: EntityId,
    pub text: String,
}

/// 固定顺序的 JSON：对象键排序、去掉显示字段，不依赖 serde_json 的 map 实现。
pub fn canonical(v: &Value) -> String {
    let mut out = String::new();
    write_canonical(v, &mut out);
    out
}

fn write_canonical(v: &Value, out: &mut String) {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<&String> = m
                .keys()
                .filter(|k| !DISPLAY_KEYS.contains(&k.as_str()))
                .collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String((*k).clone()).to_string());
                out.push(':');
                write_canonical(&m[*k], out);
            }
            out.push('}');
        }
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(x, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

/// 节点生成输入的 hash。上游 hash 先排序，连线顺序不影响结果。
pub fn node_hash(
    kind: NodeKind,
    content: &Value,
    params: Option<&GenParams>,
    upstream: &[&str],
) -> String {
    let mut ups: Vec<&str> = upstream.to_vec();
    ups.sort_unstable();
    let params = params
        .map(|p| canonical(&serde_json::to_value(p).expect("params")))
        .unwrap_or_default();
    let mut h = blake3::Hasher::new();
    for part in [
        VERSION_TAG,
        &canonical(&serde_json::to_value(kind).expect("kind")),
        &canonical(content),
        &params,
    ] {
        h.update(part.as_bytes());
        h.update(&[0]);
    }
    for u in ups {
        h.update(u.as_bytes());
        h.update(&[0]);
    }
    h.finalize().to_hex().to_string()
}

/// 每句台词一个 hash（只算说话人和台词正文）。
pub fn line_hashes(lines: &[ScriptLine]) -> HashMap<EntityId, String> {
    lines
        .iter()
        .map(|l| {
            let mut h = blake3::Hasher::new();
            for part in [VERSION_TAG, "line", &l.speaker, &l.text] {
                h.update(part.as_bytes());
                h.update(&[0]);
            }
            (l.id.clone(), h.finalize().to_hex().to_string())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::graph::Graph;
    use crate::model::{Link, Node, PortType, PortType::*};

    fn params() -> GenParams {
        GenParams {
            model: "m".into(),
            model_version: "1".into(),
            resolution: "1080x1920".into(),
            duration_ms: 3000,
            seed: 7,
        }
    }

    fn node(id: &str, kind: NodeKind, ins: &[PortType], outs: &[PortType]) -> Node {
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

    fn link(from: &str, to: &str, port: PortType, item: Option<&str>) -> Link {
        Link {
            from: from.into(),
            to: to.into(),
            port,
            source_item: item.map(Into::into),
        }
    }

    fn line(id: &str, text: &str) -> ScriptLine {
        ScriptLine {
            id: id.into(),
            speaker: "hero".into(),
            text: text.into(),
        }
    }

    #[test]
    fn key_order_and_upstream_order_do_not_change_hash() {
        let a = json!({"prompt": "雨夜", "style": {"b": 1, "a": 2}});
        let b: Value = serde_json::from_str(r#"{"style":{"a":2,"b":1},"prompt":"雨夜"}"#).unwrap();
        assert_eq!(canonical(&a), canonical(&b));
        let p = params();
        assert_eq!(
            node_hash(NodeKind::Shot, &a, Some(&p), &["u1", "u2"]),
            node_hash(NodeKind::Shot, &b, Some(&p), &["u2", "u1"])
        );
    }

    #[test]
    fn every_generation_param_changes_hash() {
        let c = json!({"prompt": "x"});
        let base = node_hash(NodeKind::Shot, &c, Some(&params()), &[]);
        let variants: Vec<Box<dyn Fn(&mut GenParams)>> = vec![
            Box::new(|p| p.model = "m2".into()),
            Box::new(|p| p.model_version = "2".into()),
            Box::new(|p| p.resolution = "720x1280".into()),
            Box::new(|p| p.duration_ms = 3001),
            Box::new(|p| p.seed = 8),
        ];
        for f in variants {
            let mut p = params();
            f(&mut p);
            assert_ne!(node_hash(NodeKind::Shot, &c, Some(&p), &[]), base);
        }
        assert_ne!(
            node_hash(
                NodeKind::Shot,
                &json!({"prompt": "y"}),
                Some(&params()),
                &[]
            ),
            base
        );
        assert_ne!(
            node_hash(NodeKind::Shot, &c, Some(&params()), &["up"]),
            base
        );
    }

    #[test]
    fn display_text_does_not_change_hash() {
        let p = params();
        let a = node_hash(NodeKind::Shot, &json!({"prompt": "x"}), Some(&p), &[]);
        let b = node_hash(
            NodeKind::Shot,
            &json!({"prompt": "x", "label": "镜头 3", "note": "备注"}),
            Some(&p),
            &[],
        );
        assert_eq!(a, b);
    }

    #[test]
    fn upstream_hash_change_marks_direct_downstream_only() {
        let mut g = Graph::default();
        g.add_node(node("char", NodeKind::Character, &[], &[CharacterLook]));
        g.add_node(node("shot", NodeKind::Shot, &[CharacterLook], &[Video]));
        g.add_node(node("export", NodeKind::Export, &[Video], &[FinalCut]));
        g.link(link("char", "shot", CharacterLook, None)).unwrap();
        g.link(link("shot", "export", Video, None)).unwrap();
        for id in [
            "char", "shot", "export", "script", "voice1", "voice2", "shot1", "group",
        ] {
            g.clear_needs_update(id);
        }
        assert!(g.set_hash("char", "v1".into()).is_empty(), "第一次写入不标");
        assert!(g.set_hash("char", "v1".into()).is_empty(), "没变不标");
        assert_eq!(g.set_hash("char", "v2".into()), vec!["shot".to_string()]);
        assert!(g.node("shot").unwrap().needs_update);
        assert!(
            !g.node("export").unwrap().needs_update,
            "只标直接下游，不连锁"
        );
        assert!(!g.node("char").unwrap().needs_update);
    }

    #[test]
    fn editing_one_line_marks_only_its_dependents() {
        let mut g = Graph::default();
        g.add_node(node("script", NodeKind::Script, &[], &[Line]));
        g.add_node(node("voice1", NodeKind::Voice, &[Line], &[Audio]));
        g.add_node(node("voice2", NodeKind::Voice, &[Line], &[Audio]));
        g.add_node(node("shot1", NodeKind::Shot, &[Audio], &[Video]));
        let v1 = vec![line("L1", "你来了。"), line("L2", "我一直在等。")];
        assert!(g.set_item_hashes("script", line_hashes(&v1)).is_empty());
        g.link(link("script", "voice1", Line, Some("L1"))).unwrap();
        g.link(link("script", "voice2", Line, Some("L2"))).unwrap();
        g.link(link("voice1", "shot1", Audio, None)).unwrap();
        for id in [
            "char", "shot", "export", "script", "voice1", "voice2", "shot1", "group",
        ] {
            g.clear_needs_update(id);
        }
        let v2 = vec![line("L1", "你终于来了。"), line("L2", "我一直在等。")];
        assert_eq!(
            g.set_item_hashes("script", line_hashes(&v2)),
            vec!["voice1".to_string()]
        );
        assert!(g.node("voice1").unwrap().needs_update);
        assert!(!g.node("voice2").unwrap().needs_update, "没改的那句不标");
        assert!(!g.node("shot1").unwrap().needs_update, "只标直接下游");
        // 同样内容再写一次不标
        for id in [
            "char", "shot", "export", "script", "voice1", "voice2", "shot1", "group",
        ] {
            g.clear_needs_update(id);
        }
        assert!(g.set_item_hashes("script", line_hashes(&v2)).is_empty());
    }

    #[test]
    fn deleting_a_line_marks_its_dependents_and_whole_node_links() {
        let mut g = Graph::default();
        g.add_node(node("script", NodeKind::Script, &[], &[Line]));
        g.add_node(node("voice1", NodeKind::Voice, &[Line], &[Audio]));
        g.add_node(node("voice2", NodeKind::Voice, &[Line], &[Audio]));
        g.add_node(node("group", NodeKind::ShotGroup, &[Line], &[Video]));
        let _ = g.set_item_hashes("script", line_hashes(&[line("L1", "a"), line("L2", "b")]));
        g.link(link("script", "voice1", Line, Some("L1"))).unwrap();
        g.link(link("script", "voice2", Line, Some("L2"))).unwrap();
        g.link(link("script", "group", Line, None)).unwrap();
        for id in [
            "char", "shot", "export", "script", "voice1", "voice2", "shot1", "group",
        ] {
            g.clear_needs_update(id);
        }
        let marked = g.set_item_hashes("script", line_hashes(&[line("L2", "b")]));
        assert_eq!(marked, vec!["group".to_string(), "voice1".to_string()]);
        assert!(!g.node("voice2").unwrap().needs_update);
    }

    #[test]
    fn speaker_change_counts_as_line_change() {
        let a = line_hashes(&[line("L1", "a")]);
        let b = line_hashes(&[ScriptLine {
            id: "L1".into(),
            speaker: "villain".into(),
            text: "a".into(),
        }]);
        assert_ne!(a["L1"], b["L1"]);
    }

    #[test]
    fn link_source_item_serializes_camel_case_and_is_optional() {
        let l = link("script", "voice1", Line, Some("L1"));
        assert_eq!(
            serde_json::to_value(&l).unwrap(),
            json!({"from": "script", "to": "voice1", "port": "line", "sourceItem": "L1"})
        );
        let plain: Link = serde_json::from_str(r#"{"from":"a","to":"b","port":"video"}"#).unwrap();
        assert_eq!(plain.source_item, None);
        assert!(
            !serde_json::to_string(&plain)
                .unwrap()
                .contains("sourceItem")
        );
    }
    #[test]
    fn upstream_stale_follows_chain_and_clears_after_regen() {
        let mut g = Graph::default();
        g.add_node(node("script", NodeKind::Script, &[], &[Line]));
        g.add_node(node("voice", NodeKind::Voice, &[Line], &[Audio]));
        g.add_node(node("shot", NodeKind::Shot, &[Audio], &[Video]));
        g.add_node(node("export", NodeKind::Export, &[Video], &[FinalCut]));
        g.link(link("script", "voice", Line, None)).unwrap();
        g.link(link("voice", "shot", Audio, None)).unwrap();
        g.link(link("shot", "export", Video, None)).unwrap();
        for id in ["script", "voice", "shot", "export"] {
            g.clear_needs_update(id);
        }
        g.set_hash("voice", "v1".into());
        assert_eq!(g.set_hash("voice", "v2".into()), vec!["shot".to_string()]);
        g.clear_needs_update("shot");
        // 只让配音带「需更新」
        g.set_hash("script", "s1".into());
        assert!(g.set_hash("script", "s2".into()) == vec!["voice".to_string()]);
        assert!(g.node("voice").unwrap().needs_update);
        assert!(g.upstream_stale("shot") && g.upstream_stale("export"));
        assert!(!g.upstream_stale("script"));
        assert!(!g.node("shot").unwrap().needs_update && !g.node("export").unwrap().needs_update);
        g.clear_needs_update("voice");
        assert!(!g.upstream_stale("shot") && !g.upstream_stale("export"));
    }
}
