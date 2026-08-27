//! 电脑操作 MCP：`--vesprism-computer-mcp` stdio。
//! 挂到工作区 `.mcp.json` 的 `vesprism-computer`。默认不挂；设置里打开才写。

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value as Json};
use xai_grok_mcp::rmcp;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, ContentBlock, ErrorData as McpError, JsonObject,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
};
use rmcp::ServerHandler;

use crate::computer;

pub const MCP_FLAG: &str = "--vesprism-computer-mcp";
pub const MCP_NAME: &str = "vesprism-computer";

fn tool_shot() -> Tool {
    let schema: JsonObject = serde_json::from_value(json!({
        "type": "object",
        "properties": {},
        "additionalProperties": false
    }))
    .expect("schema");
    Tool::new(
        Cow::Borrowed("computer_screenshot"),
        Cow::Borrowed("截取当前整屏（含多显示器虚拟屏），返回缩小后的 PNG 与宽高。点击请用本图坐标。电脑操作关闭时会失败。"),
        Arc::new(schema),
    )
}

fn tool_click() -> Tool {
    let schema: JsonObject = serde_json::from_value(json!({
        "type": "object",
        "properties": {
            "x": { "type": "integer", "description": "截图上的 X 像素" },
            "y": { "type": "integer", "description": "截图上的 Y 像素" },
            "button": { "type": "string", "description": "left（默认）/ right / middle" }
        },
        "required": ["x", "y"],
        "additionalProperties": false
    }))
    .expect("schema");
    Tool::new(
        Cow::Borrowed("computer_click"),
        Cow::Borrowed("按截图坐标点击。会先把光标移过去再按下。电脑操作关闭时会失败。"),
        Arc::new(schema),
    )
}

fn tool_type() -> Tool {
    let schema: JsonObject = serde_json::from_value(json!({
        "type": "object",
        "properties": {
            "text": { "type": "string", "description": "要键入的文本（Unicode）" }
        },
        "required": ["text"],
        "additionalProperties": false
    }))
    .expect("schema");
    Tool::new(
        Cow::Borrowed("computer_type"),
        Cow::Borrowed("向当前焦点窗口键入文字。电脑操作关闭时会失败。"),
        Arc::new(schema),
    )
}

fn tool_key() -> Tool {
    let schema: JsonObject = serde_json::from_value(json!({
        "type": "object",
        "properties": {
            "key": { "type": "string", "description": "如 enter、tab、esc、ctrl+c、alt+f4、pageup" }
        },
        "required": ["key"],
        "additionalProperties": false
    }))
    .expect("schema");
    Tool::new(
        Cow::Borrowed("computer_key"),
        Cow::Borrowed("发送快捷键或功能键。电脑操作关闭时会失败。"),
        Arc::new(schema),
    )
}

fn tool_size() -> Tool {
    let schema: JsonObject = serde_json::from_value(json!({
        "type": "object",
        "properties": {},
        "additionalProperties": false
    }))
    .expect("schema");
    Tool::new(
        Cow::Borrowed("computer_screen_size"),
        Cow::Borrowed("返回物理虚拟屏宽高（像素）。电脑操作关闭时会失败。"),
        Arc::new(schema),
    )
}

struct ComputerMcp;

impl ServerHandler for ComputerMcp {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: rmcp::service::RequestContext<rmcp::service::RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        async move {
            Ok(ListToolsResult {
                tools: vec![tool_shot(), tool_click(), tool_type(), tool_key(), tool_size()],
                next_cursor: None,
                meta: None,
            })
        }
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: rmcp::service::RequestContext<rmcp::service::RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let args: HashMap<String, Json> = request
            .arguments
            .unwrap_or_default()
            .into_iter()
            .collect();
        let text = match request.name.as_ref() {
            "computer_screenshot" => {
                let shot = computer::screenshot().map_err(|e| McpError::internal_error(e, None))?;
                serde_json::to_string(&computer::shot_to_json(&shot)).unwrap_or_else(|_| "{}".into())
            }
            "computer_click" => {
                let x = args.get("x").and_then(|v| v.as_i64()).ok_or_else(|| {
                    McpError::invalid_params("'x' is required", None)
                })?;
                let y = args.get("y").and_then(|v| v.as_i64()).ok_or_else(|| {
                    McpError::invalid_params("'y' is required", None)
                })?;
                let button = args.get("button").and_then(|v| v.as_str()).unwrap_or("left");
                computer::click(x as i32, y as i32, button)
                    .map_err(|e| McpError::internal_error(e, None))?
            }
            "computer_type" => {
                let text = args
                    .get("text")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| McpError::invalid_params("'text' is required", None))?;
                computer::type_text(text).map_err(|e| McpError::internal_error(e, None))?
            }
            "computer_key" => {
                let key = args
                    .get("key")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| McpError::invalid_params("'key' is required", None))?;
                computer::press_key(key).map_err(|e| McpError::internal_error(e, None))?
            }
            "computer_screen_size" => {
                let (w, h) = computer::screen_size().map_err(|e| McpError::internal_error(e, None))?;
                serde_json::to_string(&json!({ "width": w, "height": h })).unwrap_or_else(|_| "{}".into())
            }
            other => {
                return Err(McpError::invalid_params(
                    format!("unknown tool: {other}"),
                    None,
                ));
            }
        };
        Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
    }
}

pub fn run_stdio() -> i32 {
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("[vesprism-computer] tokio 失败: {e}");
            return 1;
        }
    };
    rt.block_on(async move {
        let transport = (tokio::io::stdin(), tokio::io::stdout());
        match rmcp::service::serve_server(ComputerMcp, transport).await {
            Ok(running) => match running.waiting().await {
                Ok(_) => 0,
                Err(e) => {
                    eprintln!("[vesprism-computer] {e}");
                    1
                }
            },
            Err(e) => {
                eprintln!("[vesprism-computer] 初始化失败: {e}");
                1
            }
        }
    })
}

fn mutate_mcp_json(cwd: &Path, write: bool) -> anyhow::Result<PathBuf> {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("vesprism-desktop"));
    let mcp_json = cwd.join(".mcp.json");
    let mut config: serde_json::Value = if mcp_json.exists() {
        match std::fs::read_to_string(&mcp_json) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| json!({})),
            Err(_) => json!({}),
        }
    } else {
        json!({})
    };
    match config.get("mcpServers") {
        None => {}
        Some(v) if v.is_object() => {}
        Some(_) => {
            anyhow::bail!(
                "{}.mcp.json 的 mcpServers 字段不是对象，拒绝改写",
                cwd.display()
            );
        }
    }
    let servers = config
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut());
    let servers_obj = match servers {
        Some(s) => s,
        None => {
            config["mcpServers"] = json!({});
            config["mcpServers"].as_object_mut().expect("just created")
        }
    };
    if write {
        servers_obj.insert(
            MCP_NAME.to_string(),
            json!({
                "command": exe.display().to_string(),
                "args": [MCP_FLAG]
            }),
        );
    } else {
        servers_obj.remove(MCP_NAME);
    }
    let text = serde_json::to_string_pretty(&config)?;
    std::fs::write(&mcp_json, text)?;
    Ok(mcp_json)
}

pub fn ensure_mount(cwd: &Path) -> anyhow::Result<PathBuf> {
    mutate_mcp_json(cwd, true)
}

pub fn unmount(cwd: &Path) -> anyhow::Result<PathBuf> {
    mutate_mcp_json(cwd, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mount_and_unmount_merge() {
        let dir = std::env::temp_dir().join(format!(
            "vesprism-computer-mcp-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(".mcp.json"),
            r#"{"mcpServers":{"other":{"command":"x"}}}"#,
        )
        .unwrap();
        ensure_mount(&dir).unwrap();
        let raw = std::fs::read_to_string(dir.join(".mcp.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(v["mcpServers"][MCP_NAME]["args"][0] == MCP_FLAG);
        assert_eq!(v["mcpServers"]["other"]["command"], "x");
        unmount(&dir).unwrap();
        let raw = std::fs::read_to_string(dir.join(".mcp.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(v["mcpServers"].get(MCP_NAME).is_none());
        assert_eq!(v["mcpServers"]["other"]["command"], "x");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
