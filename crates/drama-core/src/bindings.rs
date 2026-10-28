//! 生成 `bindings/drama.ts`。字面量全部取自 serde 序列化结果，Rust 改了 TS 跟着变。
//! 更新文件：`$env:DRAMA_UPDATE_BINDINGS=1; cargo test -p drama-core`
use serde::Serialize;

use crate::error::LinkError;
use crate::event::{JOB_EVENT, JobErrorCode, JobStatus};
use crate::model::{NodeKind, PortType};

fn lit<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).expect("serialize")
}

fn union<T: Serialize>(items: &[T]) -> String {
    items.iter().map(lit).collect::<Vec<_>>().join(" | ")
}

pub fn typescript() -> String {
    use JobStatus::*;
    use NodeKind::*;
    use PortType::*;
    let ports = union(&[Line, CharacterLook, Image, Video, Audio, FinalCut]);
    let kinds = union(&[Script, Character, ShotGroup, Shot, Voice, Export]);
    let port_table = NodeKind::ALL
        .iter()
        .map(|k| {
            let (i, o) = k.default_ports();
            format!("{}: {{ inputs: {}, outputs: {} }}", lit(k), lit(&i).replace(',', ", "), lit(&o).replace(',', ", "))
        })
        .collect::<Vec<_>>()
        .join(", ");
    let status = union(&[Queued, Running, Done, Failed, Cancelled, NeedsLogin]);
    let codes = union(&[
        JobErrorCode::UnconfirmedSubmit,
        JobErrorCode::ProviderFailed,
    ]);
    let errors = [
        LinkError::TypeMismatch,
        LinkError::Cycle,
        LinkError::ScriptLocked,
        LinkError::NotFound,
    ]
    .iter()
    .map(|e| {
        lit(e)
            .replace("\"code\"", "code")
            .replace(':', ": ")
            .replace('{', "{ ")
            .replace('}', " }")
    })
    .collect::<Vec<_>>()
    .join(" | ");
    format!(
        "// 由 drama-core 生成，勿手改。更新：DRAMA_UPDATE_BINDINGS=1 cargo test -p drama-core\n\
export type EntityId = string;\n\
export type PortType = {ports};\n\
export type NodeKind = {kinds};\n\
export interface DramaNode {{ id: EntityId; kind: NodeKind; outputs: PortType[]; inputs: PortType[]; locked: boolean; needsUpdate: boolean; text: string; }}\n\
/** 端口表（后端 NodeKind::default_ports 导出）。连线预判：from.outputs 和 to.inputs 都含 port 才允许，否则后端回 type_mismatch。 */\n\
export const DRAMA_PORTS: Record<NodeKind, {{ inputs: PortType[]; outputs: PortType[] }}> = {{ {port_table} }};\n\
export function dramaCanLink(from: NodeKind, to: NodeKind, port: PortType): boolean {{ return DRAMA_PORTS[from].outputs.includes(port) && DRAMA_PORTS[to].inputs.includes(port); }}\n\
/** 生成结果素材。path 是后端校验过的绝对路径（在项目 assets/ 下），用 convertFileSrc 转成 asset 地址 */\n\
export interface DramaAsset {{ path: string; mime: string; width?: number; height?: number; durationMs?: number; }}\n\
interface DramaNodeViewBase extends DramaNode {{ upstreamStale: boolean; }}\n\
/** 值是最近一次成功的结果；最近一次失败不清空，保留上一次成功 */\n\
export interface DramaShotNodeView extends DramaNodeViewBase {{ kind: \"shot\"; image: DramaAsset | null; video: DramaAsset | null; }}\n\
export interface DramaOtherNodeView extends DramaNodeViewBase {{ kind: Exclude<NodeKind, \"shot\">; asset: DramaAsset | null; }}\n\
export type DramaNodeView = DramaShotNodeView | DramaOtherNodeView;\n\
export const DRAMA_COMMANDS = {{ loadGraph: \"drama_load_graph\", link: \"drama_link\", unlink: \"drama_unlink\", setLayout: \"drama_set_layout\", setText: \"drama_set_text\", retryConfirmed: \"drama_retry_confirmed\", exportFinal: \"drama_export\", createProject: \"drama_create_project\", listProjects: \"drama_list_projects\", startJob: \"drama_start_job\", listJobs: \"drama_list_jobs\", addNode: \"drama_add_node\", removeNode: \"drama_remove_node\" }} as const;\n\
export const DRAMA_JOB_EVENT = \"drama://job\";\n\
export interface DramaNodeLayout {{ x: number; y: number; collapsed: boolean; }}\n\
export interface DramaPosition {{ x: number; y: number; }}\n\
/** drama_add_node 参数；返回 DramaAddNodeResult，新节点 id 由后端生成 */\n\
export interface DramaAddNodeArgs {{ projectId: string; kind: NodeKind; position: DramaPosition; }}\n\
export interface DramaAddNodeResult {{ graph: DramaGraphView; nodeId: EntityId; }}\n\
/** drama_remove_node 参数；返回 DramaGraphView。定稿的节点返回 script_locked */\n\
export interface DramaRemoveNodeArgs {{ projectId: string; nodeId: EntityId; }}\n\
/** 连线 + 是否违反当前端口表。invalid=true 的线是旧项目遗留：照常显示（建议标红）、可删除，不参与生成，导出会被 invalid_link 拦住 */\n\
export interface DramaLinkView extends DramaLink {{ invalid: boolean; }}\n\
export interface DramaGraphView {{ nodes: DramaNodeView[]; links: DramaLinkView[]; /** 按节点编号；没存过位置的节点不出现 */ layout: Record<EntityId, DramaNodeLayout>; }}\n\
export type DramaCommandErrorCode = \"type_mismatch\" | \"cycle\" | \"script_locked\" | \"not_found\" | \"stale_not_confirmed\" | \"invalid_link\" | \"io\";\n\
/** invalid_link 时 links 是项目里全部非法连线（连线没有单独的 id，用 from/to/port/sourceItem 标识，可直接传给 drama_unlink） */\n\
export interface DramaCommandError {{ code: DramaCommandErrorCode; message: string; links?: DramaLink[]; }}\n\
export interface DramaProjectArg {{ /** ULID，不接受路径 */ projectId: string; }}\n\
export interface DramaLinkArgs extends DramaProjectArg {{ link: DramaLink; }}\n\
export interface DramaLayoutArgs extends DramaProjectArg {{ nodeId: EntityId; x: number; y: number; collapsed: boolean; }}\n\
export interface DramaRetryArgs extends DramaProjectArg {{ jobId: string; }}\n\
export interface DramaExportArgs extends DramaProjectArg {{ exportNodeId: EntityId; staleConfirmed: boolean; }}\n\
export interface DramaCreateProjectArgs {{ /** 留空或全空格时后端用「未命名项目」 */ name?: string; }}\n\
export interface DramaProjectSummary {{ projectId: string; name: string; /** unix 毫秒 */ updatedAt: number; }}\n\
export interface DramaBrokenProject {{ projectId: string; message: string; }}\n\
export interface DramaProjectList {{ /** 按更新时间倒序 */ projects: DramaProjectSummary[]; /** 打不开的库，排最后、不可点 */ broken: DramaBrokenProject[]; }}\n\
export interface DramaStartJobArgs extends DramaProjectArg {{ nodeId: EntityId; }}\n\
/** drama_list_jobs 参数就是 DramaProjectArg，返回 JobEvent[]（当前状态）。重试沿用原 jobId。 */\n\
export interface DramaLink {{ from: EntityId; to: EntityId; port: PortType; sourceItem?: EntityId; }}\n\
export type LinkError = {errors};\n\
export const JOB_EVENT = \"{JOB_EVENT}\";\n\
export type JobStatus = {status};\n\
export type JobErrorCode = {codes};\n\
export interface JobEvent {{ jobId: EntityId; nodeId: EntityId; status: JobStatus; progress: number; costUsd: number | null; errorCode: JobErrorCode | null; error: string | null; }}\n"
    )
}

#[cfg(test)]
mod tests {
    use crate::event::JobEvent;
    use crate::model::Node;

    const PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/bindings/drama.ts");

    #[test]
    fn bindings_file_is_up_to_date() {
        let want = super::typescript();
        if std::env::var_os("DRAMA_UPDATE_BINDINGS").is_some() {
            std::fs::write(PATH, &want).unwrap();
        }
        let have = std::fs::read_to_string(PATH)
            .unwrap_or_default()
            .replace("\r\n", "\n");
        assert_eq!(
            have, want,
            "bindings/drama.ts 过期：设 DRAMA_UPDATE_BINDINGS=1 重跑 cargo test 生成"
        );
    }

    #[test]
    fn node_view_shape_shot_has_image_video_others_have_asset() {
        use crate::model::{Node, NodeKind};
        let mut g = crate::graph::Graph::default();
        for (id, kind) in [("s", NodeKind::Shot), ("v", NodeKind::Voice)] {
            let (inputs, outputs) = kind.default_ports();
            g.add_node(Node { id: id.into(), kind, inputs, outputs, locked: false, needs_update: false, text: String::new() });
        }
        let j = serde_json::to_value(g.snapshot()).unwrap();
        let shot = &j["nodes"][0];
        assert!(shot["image"].is_null() && shot.get("image").is_some() && shot.get("video").is_some());
        assert!(shot.get("asset").is_none());
        let voice = &j["nodes"][1];
        assert!(voice.get("asset").is_some() && voice["asset"].is_null());
        assert!(voice.get("image").is_none() && voice.get("video").is_none());
        // 角色 → 配音：生成的 TS 端口表里角色出 character_look、配音收 character_look（dramaCanLink 为真）
        let ts = super::typescript();
        assert!(ts.contains(r#""character": { inputs: [], outputs: ["character_look"] }"#));
        assert!(ts.contains(r#""voice": { inputs: ["line", "character_look"], outputs: ["audio"] }"#));
        assert!(ts.contains("return DRAMA_PORTS[from].outputs.includes(port) && DRAMA_PORTS[to].inputs.includes(port);"));
        assert!(super::typescript().contains(r#""shot": { inputs: ["line", "character_look", "image", "audio"], outputs: ["image", "video"] }"#));
    }

    #[test]
    fn link_view_is_flat_with_invalid_flag_and_error_code_is_exported() {
        use crate::model::{Link, LinkView, PortType};
        let v = LinkView {
            link: Link { from: "a".into(), to: "b".into(), port: PortType::Line, source_item: None },
            invalid: true,
        };
        assert_eq!(serde_json::to_string(&v).unwrap(), r#"{"from":"a","to":"b","port":"line","invalid":true}"#);
        let back: LinkView = serde_json::from_str(r#"{"from":"a","to":"b","port":"line","invalid":false}"#).unwrap();
        assert!(!back.invalid && back.from == "a");
        let ts = super::typescript();
        assert!(ts.contains("export interface DramaLinkView extends DramaLink { invalid: boolean; }"));
        assert!(ts.contains("links: DramaLinkView[]"));
        assert!(ts.contains(r#""invalid_link""#) && ts.contains("links?: DramaLink[]"));
    }

    #[test]
    fn struct_field_names_match_bindings() {
        let node: Node = serde_json::from_str(
            r#"{"id":"n","kind":"shot","outputs":[],"inputs":[],"locked":false,"needsUpdate":true}"#,
        )
        .unwrap();
        assert!(node.needs_update);
        let ev: JobEvent = serde_json::from_str(
            r#"{"jobId":"j","nodeId":"n","status":"needs_login","progress":0.0,"costUsd":null,"errorCode":"unconfirmed_submit","error":null}"#,
        )
        .unwrap();
        assert_eq!(ev.job_id, "j");
        assert_eq!(
            ev.error_code,
            Some(crate::event::JobErrorCode::UnconfirmedSubmit)
        );
    }
}
