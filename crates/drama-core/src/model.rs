use serde::{Deserialize, Serialize};

/// 实体 id（ULID 字符串），终身不变；界面镜号只是显示序号。
pub type EntityId = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PortType {
    Line,
    CharacterLook,
    Image,
    Video,
    Audio,
    FinalCut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Script,
    Character,
    ShotGroup,
    Shot,
    Voice,
    Export,
}

impl NodeKind {
    pub const ALL: [NodeKind; 6] = [
        NodeKind::Script,
        NodeKind::Character,
        NodeKind::ShotGroup,
        NodeKind::Shot,
        NodeKind::Voice,
        NodeKind::Export,
    ];

    /// 端口表（新建节点的默认端口）：(输入, 输出)。前端连线预判用同一张表（见 bindings）。
    /// 分镜组是容器，自己不生成：台词和角色形象原样传给组里的镜头，不出图。
    pub fn default_ports(self) -> (Vec<PortType>, Vec<PortType>) {
        use PortType::*;
        let (i, o): (&[PortType], &[PortType]) = match self {
            NodeKind::Script => (&[], &[Line]),
            NodeKind::Character => (&[], &[CharacterLook]),
            NodeKind::ShotGroup => (&[Line, CharacterLook], &[Line, CharacterLook]),
            NodeKind::Shot => (&[Line, CharacterLook, Image, Audio], &[Image, Video]),
            NodeKind::Voice => (&[Line, CharacterLook], &[Audio]),
            NodeKind::Export => (&[Video, Image, Audio], &[FinalCut]),
        };
        (i.to_vec(), o.to_vec())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: EntityId,
    pub kind: NodeKind,
    /// 输出端口类型
    pub outputs: Vec<PortType>,
    /// 可接受的输入端口类型
    pub inputs: Vec<PortType>,
    /// 剧本定稿后为 true，不再接受连线变更
    pub locked: bool,
    pub needs_update: bool,
    /// 节点上的正文：剧本、角色、画面描述。空字符串表示还没写。
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub from: EntityId,
    pub to: EntityId,
    pub port: PortType,
    /// 连线挂在源节点里的哪一项（如剧本的某一句台词 id）；为空表示挂整个节点
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_item: Option<EntityId>,
}
/// 发给前端的节点视图。`upstream_stale` 只读现算，不存库、不算 hash。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeView {
    #[serde(flatten)]
    pub node: Node,
    pub upstream_stale: bool,
    /// 镜头节点：最近一次成功生成的图片 / 视频（没有为 null）。其他节点不带这两个字段。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<Option<crate::asset::AssetRef>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<Option<crate::asset::AssetRef>>,
    /// 非镜头节点：最近一次成功的产物（没有为 null）。镜头节点不带这个字段。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset: Option<Option<crate::asset::AssetRef>>,
}

/// 画布上一个节点的位置。只存位置，不参与 hash，不触发生成。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct NodeLayout {
    pub x: f64,
    pub y: f64,
    pub collapsed: bool,
}

/// 发给前端的连线：连线本身 + 是否违反当前端口表（旧项目里留下来的非法连线）。
/// 非法连线照常读出、可删除，但不算生成输入、不进 hash、不影响下游「需更新」，导出会被拦。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkView {
    #[serde(flatten)]
    pub link: Link,
    pub invalid: bool,
}

impl std::ops::Deref for LinkView {
    type Target = Link;
    fn deref(&self) -> &Link {
        &self.link
    }
}

/// 命令返回的整张图。`layout` 按节点编号给位置，没存过位置的节点不出现。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphView {
    pub nodes: Vec<NodeView>,
    pub links: Vec<LinkView>,
    #[serde(default)]
    pub layout: std::collections::BTreeMap<EntityId, NodeLayout>,
}
