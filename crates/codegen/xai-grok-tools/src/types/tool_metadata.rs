//! `ToolMetadata` —— grok-tools 专门的工具元数据 Trait 与上下文辅助模块。
//!
//! 每个工具结构体均需要实现两个核心 Trait：
//! 1. `xai_tool_runtime::Tool` —— 强类型的输入 Args / 输出 Output 映射以及包含实际执行逻辑的 `run()` 方法。
//! 2. `ToolMetadata` —— 包含工具分类 kind、命名空间 namespace、描述模板以及指纹/提醒项等可选覆写。
//!
//! 仅有三个方法是强制要求的（`kind`、`tool_namespace` 和 `description_template`）；
//! 所有其他方法均有基于 `kind()` 自动派生的合理默认实现。
//!
//! ## 上下文辅助工具
//!
//! 工具在运行时通过 `xai_tool_runtime::ToolCallContext` 的扩展机制访问会话状态。
//! 本模块提供了提取 `SharedResources`、解析工作目录 `Cwd` 以及读取行为版本等通用辅助函数。

use std::path::PathBuf;

use crate::types::definition::ToolDefinition;
use crate::types::requirements::{Expr, ToolRequirement};
use crate::types::resources::SharedResources;
use crate::types::template_renderer::TemplateRenderer;
use crate::types::tool::{ToolKind, ToolNamespace};

/// Grok 工具专属的元数据 Trait。
///
/// 每个具体的工具结构体在实现 `xai_tool_runtime::Tool` 的同时实现此 Trait。
/// 仅需实现 `kind()`、`namespace()` 和 `description_template()` 三个基础方法；
/// 其他方法提供默认行为。
///
/// `ToolRegistry` 会保存每个工具 `ToolMetadata` 实现的类型擦除句柄，
/// 以便在分发后调用 `versioned_definition()` 等版本化渲染方法。
pub trait ToolMetadata: Send + Sync {
    /// 高层语义分类（Read、Edit、Search、Execute 等）。
    /// 驱动描述模板渲染（如 `${{ tools.by_kind.search }}`）以及默认 `is_read_only()` 的推导。
    fn kind(&self) -> ToolKind;

    /// 命名空间分组（GrokBuild、Cursor、OpenCode 等）。
    /// 用于在注册时构造全限定工具 ID（例如 `"GrokBuild:grep"`）。
    fn tool_namespace(&self) -> ToolNamespace;

    /// MiniJinja 原始描述模板，支持 `${{ tools.by_kind.X }}` 与 `${{ params.tool.param }}` 占位符。
    /// 在 Finalize 阶段由 `TemplateRenderer` 解析渲染。
    fn description_template(&self) -> &str;

    // -----------------------------------------------------------------------
    // 默认实现 —— 仅在需要特殊覆盖时进行重写
    // -----------------------------------------------------------------------

    /// 标识工具是否为纯只读（不修改文件系统或产生外部副作用）。
    /// 默认实现：直接派生自 `kind().is_read_only()`。
    fn is_read_only(&self) -> bool {
        self.kind().is_read_only()
    }

    /// 标识该工具在执行期间可能发出的通知类型变体标签。
    /// 默认实现：无。标签对应 `ToolNotification` 的 serde `type` 鉴别器
    /// （即 [`notification_schema_catalog`](crate::notification::notification_schema_catalog) 的键）。
    fn emitted_notifications(&self) -> &'static [&'static str] {
        &[]
    }

    /// 在 Finalize 阶段求值的工具依赖要求表达式。
    /// 默认实现：`Expr::True`（无特殊依赖要求）。
    fn requires_expr(&self) -> Expr<ToolRequirement> {
        Expr::True
    }

    /// 供 `xai_tool_runtime::Tool::description()` 使用的模型安全兜底描述：
    /// 去掉原始模板中所有 `${{ … }}` / `${% … %}` 标记后的文本。
    ///
    /// 注册表路径（`versioned_definition`）会在 finalize 后的 toolset 上下文中
    /// 正确渲染模板；此处仅服务绕过注册表的调用方，它们绝不能看到原始模板语法。
    fn sanitized_description_template(&self) -> String {
        crate::types::template_renderer::strip_template_markers(self.description_template())
    }

    /// 根据给定的契约版本构建工具定义 (ToolDefinition)。
    ///
    /// 默认实现：通过 `TemplateRenderer` 渲染 `description_template()` 并重新映射 Schema 参数名称。
    /// 针对需要感知参数动态修改 Schema 或 Description 的工具可覆盖重写（例如 BashTool 禁用时移除 `is_background`）。
    fn versioned_definition(
        &self,
        _contract_version: Option<&str>,
        client_name: &str,
        description_override: Option<&str>,
        renderer: &TemplateRenderer,
        param_map: &std::collections::HashMap<String, String>,
        input_schema: &serde_json::Value,
        _effective_params: &serde_json::Value,
    ) -> ToolDefinition {
        let raw_desc = description_override.unwrap_or_else(|| self.description_template());
        let description = renderer.render(raw_desc).unwrap_or_else(|e| {
            crate::types::template_renderer::strip_markers_on_render_failure(raw_desc, &e)
        });
        let remapped_schema = if param_map.is_empty() {
            input_schema.clone()
        } else {
            crate::util::remap::remap_schema_properties(input_schema, param_map)
        };
        ToolDefinition::function(client_name, Some(&description), remapped_schema)
    }
}

/// 从运行时工具调用上下文 `ToolCallContext` 中提取共享资源句柄 `SharedResources`。
///
/// `ToolBridge` 在将调用分发给 `LocalRegistry` 前，会将 `SharedResources` 注入至 `ctx.extensions`。
pub fn shared_resources(
    ctx: &xai_tool_runtime::ToolCallContext,
) -> Result<SharedResources, xai_tool_runtime::ToolError> {
    ctx.extensions
        .get::<SharedResources>()
        .map(|arc| (*arc).clone())
        .ok_or_else(|| {
            xai_tool_runtime::ToolError::custom(
                "missing_resources",
                "SharedResources not available in ToolCallContext extensions",
            )
        })
}

/// 从运行时上下文中解析当前工作目录 `PathBuf`。
///
/// 优先检查 `Cwd` 扩展（当调用方显式提供了单次调用的工作目录覆盖时设置），
/// 若不存在则降级使用 `SharedResources` 中保存的全局 `Cwd`。
pub async fn resolve_cwd(
    ctx: &xai_tool_runtime::ToolCallContext,
    resources: &SharedResources,
) -> Result<PathBuf, xai_tool_runtime::ToolError> {
    if let Some(cwd) = ctx.extensions.get::<xai_tool_runtime::Cwd>() {
        return Ok(cwd.0.clone());
    }
    let res = resources.lock().await;
    res.get::<crate::types::resources::Cwd>()
        .map(|c| c.0.clone())
        .ok_or_else(|| {
            xai_tool_runtime::ToolError::custom("missing_cwd", "Cwd not available in Resources")
        })
}

/// 构造包含 `SharedResources` 和全新 UUIDv7 调用 ID 的测试用 `ToolCallContext`。
///
/// 测试辅助函数 —— 替代了此前分散在数十个工具测试中重复编写的 `make_ctx` / `runtime_ctx` 逻辑。
/// 如果测试需要特定的调用 ID，请使用 [`test_ctx_with_call_id`]。
pub fn test_ctx(resources: SharedResources) -> xai_tool_runtime::ToolCallContext {
    let mut ctx = xai_tool_runtime::ToolCallContext::default();
    ctx.extensions.insert(resources);
    // 默认开启流式进度，以便现有单元测试可以覆盖流式执行路径。
    ctx.extensions
        .insert(xai_tool_runtime::WorkspaceViewerContext {
            stream_tool_progress: true,
        });
    ctx
}

/// 与 [`test_ctx`] 类似，但允许调用方指定特定的调用 ID。
///
/// 若传入的 `call_id` 不是合法的 `ToolCallId`，将自动降级为生成新的 UUIDv7 ID。
pub fn test_ctx_with_call_id(
    resources: SharedResources,
    call_id: &str,
) -> xai_tool_runtime::ToolCallContext {
    let id = xai_tool_protocol::ToolCallId::new(call_id)
        .unwrap_or_else(|_| xai_tool_protocol::ToolCallId::new_v7());
    let mut ctx = xai_tool_runtime::ToolCallContext::new(id);
    ctx.extensions.insert(resources);
    ctx.extensions
        .insert(xai_tool_runtime::WorkspaceViewerContext {
            stream_tool_progress: true,
        });
    ctx
}

/// 从运行时上下文读取行为版本设置（如果已配置）。
pub fn behavior_version(ctx: &xai_tool_runtime::ToolCallContext) -> Option<String> {
    ctx.extensions
        .get::<xai_tool_runtime::BehaviorVersion>()
        .map(|v| v.0.clone())
}

/// This tool's own canonical→client param-name map, stamped on the dispatch
/// context by `prepare_dispatch` / `call_raw`. Returns an empty (identity)
/// map when absent — e.g. unit tests that call `Tool::run` directly — so
/// callers resolve to canonical names. Prefer this over kind-wide
/// [`crate::types::template_renderer::TemplateRenderer::param_for_kind`] when
/// naming *this* tool's own params (a sibling tool sharing the `ToolKind`
/// can rename the same field differently).
pub fn invoking_param_names(
    ctx: &xai_tool_runtime::ToolCallContext,
) -> crate::types::resources::InvokingToolParamNames {
    ctx.extensions
        .get::<crate::types::resources::InvokingToolParamNames>()
        .map(|arc| (*arc).clone())
        .unwrap_or_default()
}
