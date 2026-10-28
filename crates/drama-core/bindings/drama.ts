// 由 drama-core 生成，勿手改。更新：DRAMA_UPDATE_BINDINGS=1 cargo test -p drama-core
export type EntityId = string;
export type PortType = "line" | "character_look" | "image" | "video" | "audio" | "final_cut";
export type NodeKind = "script" | "character" | "shot_group" | "shot" | "voice" | "export";
export interface DramaNode { id: EntityId; kind: NodeKind; outputs: PortType[]; inputs: PortType[]; locked: boolean; needsUpdate: boolean; text: string; }
/** 端口表（后端 NodeKind::default_ports 导出）。连线预判：from.outputs 和 to.inputs 都含 port 才允许，否则后端回 type_mismatch。 */
export const DRAMA_PORTS: Record<NodeKind, { inputs: PortType[]; outputs: PortType[] }> = { "script": { inputs: [], outputs: ["line"] }, "character": { inputs: [], outputs: ["character_look"] }, "shot_group": { inputs: ["line", "character_look"], outputs: ["line", "character_look"] }, "shot": { inputs: ["line", "character_look", "image", "audio"], outputs: ["image", "video"] }, "voice": { inputs: ["line", "character_look"], outputs: ["audio"] }, "export": { inputs: ["video", "image", "audio"], outputs: ["final_cut"] } };
export function dramaCanLink(from: NodeKind, to: NodeKind, port: PortType): boolean { return DRAMA_PORTS[from].outputs.includes(port) && DRAMA_PORTS[to].inputs.includes(port); }
/** 生成结果素材。path 是后端校验过的绝对路径（在项目 assets/ 下），用 convertFileSrc 转成 asset 地址 */
export interface DramaAsset { path: string; mime: string; width?: number; height?: number; durationMs?: number; }
interface DramaNodeViewBase extends DramaNode { upstreamStale: boolean; }
/** 值是最近一次成功的结果；最近一次失败不清空，保留上一次成功 */
export interface DramaShotNodeView extends DramaNodeViewBase { kind: "shot"; image: DramaAsset | null; video: DramaAsset | null; }
export interface DramaOtherNodeView extends DramaNodeViewBase { kind: Exclude<NodeKind, "shot">; asset: DramaAsset | null; }
export type DramaNodeView = DramaShotNodeView | DramaOtherNodeView;
export const DRAMA_COMMANDS = { loadGraph: "drama_load_graph", link: "drama_link", unlink: "drama_unlink", setLayout: "drama_set_layout", setText: "drama_set_text", retryConfirmed: "drama_retry_confirmed", exportFinal: "drama_export", createProject: "drama_create_project", listProjects: "drama_list_projects", startJob: "drama_start_job", listJobs: "drama_list_jobs", addNode: "drama_add_node", removeNode: "drama_remove_node" } as const;
export const DRAMA_JOB_EVENT = "drama://job";
export interface DramaNodeLayout { x: number; y: number; collapsed: boolean; }
export interface DramaPosition { x: number; y: number; }
/** drama_add_node 参数；返回 DramaAddNodeResult，新节点 id 由后端生成 */
export interface DramaAddNodeArgs { projectId: string; kind: NodeKind; position: DramaPosition; }
export interface DramaAddNodeResult { graph: DramaGraphView; nodeId: EntityId; }
/** drama_remove_node 参数；返回 DramaGraphView。定稿的节点返回 script_locked */
export interface DramaRemoveNodeArgs { projectId: string; nodeId: EntityId; }
/** 连线 + 是否违反当前端口表。invalid=true 的线是旧项目遗留：照常显示（建议标红）、可删除，不参与生成，导出会被 invalid_link 拦住 */
export interface DramaLinkView extends DramaLink { invalid: boolean; }
export interface DramaGraphView { nodes: DramaNodeView[]; links: DramaLinkView[]; /** 按节点编号；没存过位置的节点不出现 */ layout: Record<EntityId, DramaNodeLayout>; }
export type DramaCommandErrorCode = "type_mismatch" | "cycle" | "script_locked" | "not_found" | "stale_not_confirmed" | "invalid_link" | "io";
/** invalid_link 时 links 是项目里全部非法连线（连线没有单独的 id，用 from/to/port/sourceItem 标识，可直接传给 drama_unlink） */
export interface DramaCommandError { code: DramaCommandErrorCode; message: string; links?: DramaLink[]; }
export interface DramaProjectArg { /** ULID，不接受路径 */ projectId: string; }
export interface DramaLinkArgs extends DramaProjectArg { link: DramaLink; }
export interface DramaLayoutArgs extends DramaProjectArg { nodeId: EntityId; x: number; y: number; collapsed: boolean; }
export interface DramaRetryArgs extends DramaProjectArg { jobId: string; }
export interface DramaExportArgs extends DramaProjectArg { exportNodeId: EntityId; staleConfirmed: boolean; }
export interface DramaCreateProjectArgs { /** 留空或全空格时后端用「未命名项目」 */ name?: string; }
export interface DramaProjectSummary { projectId: string; name: string; /** unix 毫秒 */ updatedAt: number; }
export interface DramaBrokenProject { projectId: string; message: string; }
export interface DramaProjectList { /** 按更新时间倒序 */ projects: DramaProjectSummary[]; /** 打不开的库，排最后、不可点 */ broken: DramaBrokenProject[]; }
export interface DramaStartJobArgs extends DramaProjectArg { nodeId: EntityId; }
/** drama_list_jobs 参数就是 DramaProjectArg，返回 JobEvent[]（当前状态）。重试沿用原 jobId。 */
export interface DramaLink { from: EntityId; to: EntityId; port: PortType; sourceItem?: EntityId; }
export type LinkError = { code: "type_mismatch" } | { code: "cycle" } | { code: "script_locked" } | { code: "not_found" };
export const JOB_EVENT = "drama://job";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "needs_login";
export type JobErrorCode = "unconfirmed_submit" | "provider_failed";
export interface JobEvent { jobId: EntityId; nodeId: EntityId; status: JobStatus; progress: number; costUsd: number | null; errorCode: JobErrorCode | null; error: string | null; }
