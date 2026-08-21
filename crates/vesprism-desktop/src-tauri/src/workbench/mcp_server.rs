//! 内置 MCP server：`database_query`（SQLite）+ `knowledge_search`（FTS5 本地知识库）。
//!
//! 官方引擎原生支持 MCP（`<cwd>/.mcp.json` 自动加载、子 agent 继承父会话工具），
//! 因此本 server 不修改官方一行代码，即可让工作台流程里的 agent 真正执行
//! SQL / 检索知识库。运行方式：exe 带 `--vesprism-mcp-server` 参数走 stdio 传输。
//!
//! 边界（诚实说明）：
//! - SQL 由流程作者编写、本机真实执行；agent 调用 MCP 工具会走官方权限审批。
//! - 知识库索引为 FTS5 关键词全文检索（非语义向量）；文档目录变更后传 `rebuild: true` 重建。

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

pub const MCP_SERVER_FLAG: &str = "--vesprism-mcp-server";
/// `.mcp.json` 里注册的 server 名。
pub const MCP_SERVER_NAME: &str = "vesprism";

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// 默认 SQLite 数据库文件：`~/.vesprism/mcp/db.sqlite`。
pub fn default_db_path() -> PathBuf {
    home().join(".vesprism").join("mcp").join("db.sqlite")
}

/// 知识库根目录：`~/.vesprism/knowledge/<kb>/`。
pub fn knowledge_root() -> PathBuf {
    home().join(".vesprism").join("knowledge")
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具 schema
// ─────────────────────────────────────────────────────────────────────────────

fn tool_database_query() -> Tool {
    let schema: JsonObject = serde_json::from_value(json!({
        "type": "object",
        "properties": {
            "sql": { "type": "string", "description": "要执行的 SQL 语句（SELECT 返回行，其他返回影响行数）" },
            "db_path": { "type": "string", "description": "SQLite 数据库文件路径；省略用默认库 ~/.vesprism/mcp/db.sqlite" }
        },
        "required": ["sql"],
        "additionalProperties": false
    }))
    .expect("database_query schema");
    Tool::new(
        Cow::Borrowed("database_query"),
        Cow::Borrowed("对本地 SQLite 数据库执行 SQL 并返回结果。支持 SELECT / INSERT / UPDATE / DELETE / CREATE 等。注意：一次调用只执行一条语句（分号分隔的多语句不支持）；SQL 里的字符串请用单引号包裹。"),
        Arc::new(schema),
    )
}

fn tool_knowledge_search() -> Tool {
    let schema: JsonObject = serde_json::from_value(json!({
        "type": "object",
        "properties": {
            "query": { "type": "string", "description": "检索关键词（FTS5 语法，如：错误 OR 重试）" },
            "knowledge_base": { "type": "string", "description": "知识库名 = ~/.vesprism/knowledge/<名>/ 目录；省略列出所有知识库" },
            "limit": { "type": "integer", "description": "最多返回片段数，默认 5" },
            "rebuild": { "type": "boolean", "description": "true 时先重建该知识库的全文索引再检索" }
        },
        "required": ["query"],
        "additionalProperties": false
    }))
    .expect("knowledge_search schema");
    Tool::new(
        Cow::Borrowed("knowledge_search"),
        Cow::Borrowed("在本地知识库做全文检索（FTS5），返回命中片段与来源文件。知识库 = ~/.vesprism/knowledge/<名>/ 目录下的 .md/.txt 文档。"),
        Arc::new(schema),
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct VesprismMcpServer {
    tools: Arc<Vec<Tool>>,
    /// 知识库根目录（产品默认 ~/.vesprism/knowledge；测试可注入临时目录）。
    knowledge_root: PathBuf,
}

impl Default for VesprismMcpServer {
    fn default() -> Self {
        Self::new()
    }
}

impl VesprismMcpServer {
    pub fn new() -> Self {
        Self::with_roots(knowledge_root())
    }

    pub fn with_roots(knowledge_root: PathBuf) -> Self {
        Self {
            tools: Arc::new(vec![tool_database_query(), tool_knowledge_search()]),
            knowledge_root,
        }
    }

    fn handle_database_query(&self, args: &HashMap<String, Json>) -> Result<CallToolResult, McpError> {
        let sql = args
            .get("sql")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| McpError::invalid_params("'sql' is a required property", None))?;
        let db_path = args
            .get("db_path")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(default_db_path);
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                McpError::invalid_params(format!("无法创建数据库目录: {e}"), None)
            })?;
        }
        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| McpError::internal_error(format!("打开数据库失败: {e}"), None))?;
        let stmt_kind = sql_leading_keyword(sql);
        let result = if matches!(stmt_kind.as_str(), "SELECT" | "WITH" | "PRAGMA" | "EXPLAIN") {
            query_rows(&conn, sql)
        } else {
            write_rows(&conn, sql)
        };
        let payload = result.map_err(|e| McpError::internal_error(format!("SQL 执行失败: {e}"), None))?;
        Ok(CallToolResult::success(vec![ContentBlock::text(
            serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".into()),
        )]))
    }

    fn handle_knowledge_search(&self, args: &HashMap<String, Json>) -> Result<CallToolResult, McpError> {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| McpError::invalid_params("'query' is a required property", None))?;
        let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(5).clamp(1, 50) as usize;
        let rebuild = args.get("rebuild").and_then(|v| v.as_bool()).unwrap_or(false);
        let kb = args
            .get("knowledge_base")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(PathBuf::from);

        let root = self.knowledge_root.clone();
        let hits = search_knowledge(&root, kb.as_deref(), query, limit, rebuild)
            .map_err(|e| McpError::internal_error(format!("知识库检索失败: {e}"), None))?;
        let payload = if hits.is_empty() {
            json!({ "hits": [], "note": "未命中；可尝试更换关键词，或用 rebuild:true 重建索引" })
        } else {
            json!({ "hits": hits })
        };
        Ok(CallToolResult::success(vec![ContentBlock::text(
            serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".into()),
        )]))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SQLite 执行
// ─────────────────────────────────────────────────────────────────────────────

/// 剥离 SQL 前导注释（`--` 行注释 / `/* */` 块注释）后取首词大写，用于读/写路径判断。
fn sql_leading_keyword(sql: &str) -> String {
    let mut rest = sql.trim_start();
    loop {
        if let Some(t) = rest.strip_prefix("--") {
            match t.find('\n') {
                Some(i) => rest = t[i + 1..].trim_start(),
                None => return String::new(),
            }
        } else if let Some(t) = rest.strip_prefix("/*") {
            match t.find("*/") {
                Some(i) => rest = t[i + 2..].trim_start(),
                None => return String::new(),
            }
        } else {
            break;
        }
    }
    rest.split_whitespace().next().unwrap_or("").to_ascii_uppercase()
}

fn query_rows(conn: &rusqlite::Connection, sql: &str) -> anyhow::Result<Json> {
    let mut stmt = conn.prepare(sql)?;
    let col_names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|c| c.to_string())
        .collect();
    let rows: Vec<Json> = stmt
        .query_map([], |row| {
            let mut map = serde_json::Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let val = match row.get_ref(i) {
                    Ok(rusqlite::types::ValueRef::Null) => Json::Null,
                    Ok(rusqlite::types::ValueRef::Integer(n)) => json!(n),
                    Ok(rusqlite::types::ValueRef::Real(f)) => json!(f),
                    Ok(rusqlite::types::ValueRef::Text(t)) => json!(String::from_utf8_lossy(t)),
                    Ok(rusqlite::types::ValueRef::Blob(b)) => json!(String::from_utf8_lossy(b)),
                    Err(_) => Json::Null,
                };
                map.insert(name.clone(), val);
            }
            Ok(Json::Object(map))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(json!({ "rows": rows, "row_count": rows.len() }))
}

fn write_rows(conn: &rusqlite::Connection, sql: &str) -> anyhow::Result<Json> {
    let affected = conn.execute(sql, [])?;
    let last_id = conn.last_insert_rowid();
    Ok(json!({ "affected_rows": affected, "last_insert_rowid": last_id }))
}

// ─────────────────────────────────────────────────────────────────────────────
// 知识库 FTS5
// ─────────────────────────────────────────────────────────────────────────────

/// 扫描 `<root>/<kb>/` 下 .md/.txt 文档建 FTS5 索引，返回命中片段。
fn search_knowledge(
    root: &Path,
    kb: Option<&Path>,
    query: &str,
    limit: usize,
    rebuild: bool,
) -> anyhow::Result<Vec<Json>> {
    if !root.exists() {
        return Ok(vec![]);
    }
    // 枚举知识库目录（指定或全部）
    let kbs: Vec<PathBuf> = if let Some(kb) = kb {
        let p = root.join(kb);
        if p.is_dir() {
            vec![p]
        } else {
            return Err(anyhow::anyhow!("知识库不存在: {}", p.display()));
        }
    } else {
        std::fs::read_dir(root)?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect()
    };

    let mut hits: Vec<Json> = Vec::new();
    for kb_dir in kbs {
        let index_path = kb_dir.join("index.sqlite");
        // 单一连接 + 显式事务：DELETE 与 INSERT 同事务，中途失败自动 ROLLBACK，
        // 不会出现「旧索引已删光、新数据没写入」的空索引。
        let mut conn = rusqlite::Connection::open(&index_path)?;
        // trigram tokenizer：支持中文子串检索（默认 unicode61 会把连续中文当作整词，搜不到子串）。
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(title, content, source, tokenize = 'trigram');",
        )?;
        let count: i64 = conn.query_row("SELECT count(*) FROM docs", [], |r| r.get(0))?;
        log::info!("[vesprism-mcp] kb={} count={count} rebuild={rebuild}", kb_dir.display());
        if rebuild || count == 0 {
            let tx = conn.transaction()?;
            tx.execute_batch("DELETE FROM docs;")?;
            {
                let mut stmt = tx.prepare("INSERT INTO docs(title, content, source) VALUES (?1, ?2, ?3)")?;
                for entry in std::fs::read_dir(&kb_dir)? {
                    let entry = entry?;
                    let path = entry.path();
                    if !path.is_file() {
                        continue;
                    }
                    let ext = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    if ext != "md" && ext != "txt" {
                        continue;
                    }
                    let content = std::fs::read_to_string(&path).unwrap_or_default();
                    let title = path
                        .file_name()
                        .and_then(|f| f.to_str())
                        .unwrap_or("")
                        .to_string();
                    stmt.execute(rusqlite::params![title, content, path.display().to_string()])?;
                }
            }
            tx.commit()?;
        }
        // trigram 的 MATCH 要求每个查询词 ≥3 个 unicode 字符；含短词时退化为 LIKE 兜底。
        if query.split_whitespace().all(|w| w.chars().count() >= 3) {
            let mut stmt = conn.prepare(
                "SELECT title, source, snippet(docs, 1, '[', ']', '…', 30) AS snip FROM docs WHERE docs MATCH ?1 ORDER BY bm25(docs) LIMIT ?2",
            )?;
            let rows = stmt.query_map(rusqlite::params![query, limit as i64], |row| {
                Ok(json!({
                    "knowledge_base": kb_dir.file_name().and_then(|f| f.to_str()).unwrap_or(""),
                    "title": row.get::<_, String>(0).unwrap_or_default(),
                    "source": row.get::<_, String>(1).unwrap_or_default(),
                    "snippet": row.get::<_, String>(2).unwrap_or_default(),
                }))
            })?;
            for r in rows {
                hits.push(r?);
            }
        } else {
            let escaped = query.replace('%', "\\%").replace('_', "\\_");
            let pattern = format!("%{escaped}%");
            let mut stmt = conn.prepare(
                "SELECT title, source, substr(content, 1, 200) AS snip FROM docs WHERE title LIKE ?1 ESCAPE '\\' OR content LIKE ?1 ESCAPE '\\' OR source LIKE ?1 ESCAPE '\\' LIMIT ?2",
            )?;
            let rows = stmt.query_map(rusqlite::params![pattern, limit as i64], |row| {
                Ok(json!({
                    "knowledge_base": kb_dir.file_name().and_then(|f| f.to_str()).unwrap_or(""),
                    "title": row.get::<_, String>(0).unwrap_or_default(),
                    "source": row.get::<_, String>(1).unwrap_or_default(),
                    "snippet": row.get::<_, String>(2).unwrap_or_default(),
                }))
            })?;
            for r in rows {
                hits.push(r?);
            }
        }
    }
    hits.truncate(limit);
    Ok(hits)
}

// ─────────────────────────────────────────────────────────────────────────────
// ServerHandler impl
// ─────────────────────────────────────────────────────────────────────────────

impl ServerHandler for VesprismMcpServer {
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
        let tools = self.tools.clone();
        async move {
            Ok(ListToolsResult {
                tools: (*tools).clone(),
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
        match request.name.as_ref() {
            "database_query" => self.handle_database_query(&args),
            "knowledge_search" => self.handle_knowledge_search(&args),
            other => Err(McpError::invalid_params(
                format!("unknown tool: {other}"),
                None,
            )),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 独立运行入口（stdio 传输）
// ─────────────────────────────────────────────────────────────────────────────

/// exe 带 `--vesprism-mcp-server` 时调用：以 stdio 传输运行内置 MCP server。
pub fn run_mcp_server_stdio() -> i32 {
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("[vesprism-mcp] tokio runtime 创建失败: {e}");
            return 1;
        }
    };
    rt.block_on(async move {
        let server = VesprismMcpServer::new();
        // stdio 传输：直接传 (tokio stdin, stdout)，避免依赖 rmcp 的 transport-io feature。
        let transport = (tokio::io::stdin(), tokio::io::stdout());
        match rmcp::service::serve_server(server, transport).await {
            Ok(running) => {
                // 驻留：serve_server 只完成握手就返回 RunningService，消息循环在它内部
                // spawn 的后台任务里跑。必须 await waiting() 直到连接关闭（客户端退出/
                // 取消/错误），否则 RunningService 被 drop（DropGuard 取消服务）→ 进程
                // 握手完立即退出 → 官方客户端误判掉线并秒级自动拉起，日志刷屏死循环。
                match running.waiting().await {
                    Ok(reason) => {
                        log::info!("[vesprism-mcp] server quit: {reason:?}");
                        0
                    }
                    Err(e) => {
                        eprintln!("[vesprism-mcp] server join error: {e}");
                        1
                    }
                }
            }
            Err(e) => {
                eprintln!("[vesprism-mcp] server 初始化失败: {e}");
                // 客户端正常断开（如会话关闭）不算错误
                if matches!(
                    e,
                    rmcp::service::ServerInitializeError::ConnectionClosed(_)
                ) {
                    0
                } else {
                    1
                }
            }
        }
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// `.mcp.json` 挂载
// ─────────────────────────────────────────────────────────────────────────────

/// 把内置 MCP server 挂载进 `<cwd>/.mcp.json`（合并写入，不覆盖用户已有 server）。
/// 官方监听该文件变更并热加载；子 agent 继承父会话工具。
pub fn ensure_mcp_mount(cwd: &Path) -> anyhow::Result<PathBuf> {
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
    // mcpServers 必须是对象；否则不覆盖用户配置（避免破坏），直接报错让用户手动修。
    match config.get("mcpServers") {
        None => {}
        Some(v) if v.is_object() => {}
        Some(_) => {
            return Err(anyhow::anyhow!(
                "{}.mcp.json 的 mcpServers 字段不是对象，拒绝改写；请手动修复后重试",
                cwd.display()
            ));
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
    let entry = json!({
        "command": exe.display().to_string(),
        "args": [MCP_SERVER_FLAG]
    });
    servers_obj.insert(MCP_SERVER_NAME.to_string(), entry);
    let text = serde_json::to_string_pretty(&config)?;
    std::fs::write(&mcp_json, text)?;
    Ok(mcp_json)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_kb(name: &str) -> PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "vesprism-mcp-test-{}-{stamp}",
            std::process::id()
        ));
        let kb = dir.join(name);
        std::fs::create_dir_all(&kb).unwrap();
        kb
    }

    #[test]
    fn database_query_select_and_write() {
        let db_path = std::env::temp_dir()
            .join(format!("vesprism-mcp-test-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&db_path);
        {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT);")
                .unwrap();
        }
        let server = VesprismMcpServer::new();
        // 写
        let mut args = HashMap::new();
        args.insert("sql".into(), json!("INSERT INTO t (name) VALUES ('vesprism'), ('flow')"));
        args.insert("db_path".into(), json!(db_path.display().to_string()));
        let res = server.handle_database_query(&args).unwrap();
        let text = extract_text(&res);
        assert!(text.contains("\"affected_rows\": 2"), "got {text}");
        // 读
        args.insert("sql".into(), json!("SELECT id, name FROM t ORDER BY id"));
        let res = server.handle_database_query(&args).unwrap();
        let text = extract_text(&res);
        assert!(text.contains("vesprism") && text.contains("flow"), "got {text}");
        assert!(text.contains("\"row_count\": 2"), "got {text}");
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn knowledge_search_builds_index_and_finds() {
        let kb = tmp_kb("docs");
        std::fs::write(kb.join("intro.md"), "vesprism 是一个本地优先的 AI 工作台，支持数据库节点与知识库检索。").unwrap();
        std::fs::write(kb.join("notes.txt"), "重试与超时：失败后自动重试三次。").unwrap();
        let root = kb.parent().unwrap().to_path_buf();
        let mut args = HashMap::new();
        args.insert("query".into(), json!("重试"));
        args.insert("knowledge_base".into(), json!("docs"));
        let server = VesprismMcpServer::with_roots(root.clone());
        let res = server.handle_knowledge_search(&args).unwrap();
        let text = extract_text(&res);
        assert!(text.contains("notes.txt"), "got {text}");
        assert!(text.contains("重试"), "got {text}");
        // 未知知识库报错
        args.insert("knowledge_base".into(), json!("nope"));
        let err = server.handle_knowledge_search(&args).unwrap_err();
        assert!(err.message.contains("不存在"), "got {err:?}");
        let _ = std::fs::remove_dir_all(root);
    }

    fn extract_text(res: &CallToolResult) -> String {
        res.content
            .iter()
            .filter_map(|b| match b {
                ContentBlock::Text(t) => Some(t.text.to_string()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn ensure_mcp_mount_writes_mergeable_entry_and_protects_bad_config() {
        let dir = std::env::temp_dir().join(format!("vesprism-mcp-mount-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // 用户已有 server → 合并保留
        std::fs::write(
            dir.join(".mcp.json"),
            r#"{"mcpServers": {"github": {"command": "npx", "args": ["-y", "mcp-server-github"]}}}"#,
        )
        .unwrap();
        let path = ensure_mcp_mount(&dir).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert!(parsed["mcpServers"]["github"]["command"] == "npx");
        assert!(parsed["mcpServers"]["vesprism"]["command"].is_string());
        assert_eq!(parsed["mcpServers"]["vesprism"]["args"][0], MCP_SERVER_FLAG);
        // mcpServers 非对象 → 拒绝改写
        std::fs::write(dir.join(".mcp.json"), r#"{"mcpServers": "broken"}"#).unwrap();
        let err = ensure_mcp_mount(&dir).unwrap_err();
        assert!(err.to_string().contains("不是对象"), "got {err:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
