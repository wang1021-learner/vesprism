//! 桌面端安全闸门：纯函数，供 IPC 命令在写盘 / 起进程前调用。

use std::path::{Path, PathBuf};

pub const MAX_IMPORT_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_SIDECAR_RHAI_BYTES: usize = 512 * 1024;
pub const MAX_BOOK_JSON_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_ENV_VALUE_BYTES: usize = 64 * 1024;

/// 密钥值：拒绝换行 / NUL，避免 `.env` 被拆成第二行注入。
pub fn sanitize_env_value(value: &str) -> Result<&str, String> {
    if value.len() > MAX_ENV_VALUE_BYTES {
        return Err("密钥值过长".into());
    }
    if value.contains('\n') || value.contains('\r') || value.contains('\0') {
        return Err("密钥值不能包含换行或空字节".into());
    }
    Ok(value)
}

/// 写成 `KEY="…"`，内部引号与反斜杠转义。dotenvy 能读。
pub fn format_env_line(key: &str, value: &str) -> Result<String, String> {
    let value = sanitize_env_value(value)?;
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    Ok(format!("{key}=\"{escaped}\""))
}

/// zip 条目名：相对、无 `..`、无盘符、无绝对路径。导入导出同一套。
pub fn zip_entry_name_ok(name: &str) -> bool {
    if name.is_empty() || name.contains('\0') {
        return false;
    }
    let n = name.replace('\\', "/");
    if n.contains("..") || n.starts_with('/') || n.starts_with("~/") {
        return false;
    }
    if n.contains(':') {
        return false;
    }
    true
}

/// sidecar rhai 必须像画布编译产物，且有体积上限。
pub fn accept_sidecar_rhai(rhai: &str) -> Result<(), String> {
    if rhai.len() > MAX_SIDECAR_RHAI_BYTES {
        return Err("flow.rhai 超过 512KB".into());
    }
    if rhai.contains('\0') {
        return Err("flow.rhai 含空字节".into());
    }
    if !rhai.contains("let meta") {
        return Err("sidecar rhai 必须是编译产物（缺少 let meta）".into());
    }
    Ok(())
}

/// 总是允许只认「命令/目标」正文；空命令不退化为整类工具。
pub fn always_signature(description: &str) -> Option<String> {
    let mut collecting = false;
    let mut parts: Vec<String> = Vec::new();
    for line in description.replace('\r', "").lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed
            .strip_prefix("命令：")
            .or_else(|| trimmed.strip_prefix("目标："))
        {
            collecting = true;
            let rest = rest.trim();
            if !rest.is_empty() {
                parts.push(rest.to_string());
            }
            continue;
        }
        if collecting {
            if trimmed.starts_with("类型：") || trimmed.starts_with("工具：") {
                break;
            }
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
        }
    }
    let cmd = parts.join(" ");
    let cmd = cmd.split_whitespace().collect::<Vec<_>>().join(" ");
    if cmd.is_empty() {
        None
    } else {
        Some(format!("cmd:{cmd}"))
    }
}

pub fn path_is_within_root(child: &Path, root: &Path) -> bool {
    let c = child
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    let r = root
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    c == r || c.starts_with(&format!("{r}/"))
}

/// PTY cwd 必须落在已登记的根（当前 Tab cwd / scratch / 写台）之内。
pub fn pty_cwd_is_allowed(requested: &Path, allowed_roots: &[PathBuf]) -> bool {
    let Ok(req) = requested.canonicalize() else {
        return false;
    };
    allowed_roots.iter().any(|root| {
        root.canonicalize()
            .ok()
            .is_some_and(|r| path_is_within_root(&req, &r))
    })
}

/// 用 magic bytes 定图片后缀；对不上就拒绝。
pub fn sniff_image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("png");
    }
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return Some("jpg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    None
}

pub fn sanitize_mcp_server_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 64 {
        return Err("MCP 名称须为 1–64 个字符".into());
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphabetic() {
        return Err("MCP 名称须以字母开头".into());
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("MCP 名称仅允许字母、数字、_、-".into());
    }
    Ok(name.to_string())
}

fn mcp_command_stem(command: &str) -> String {
    Path::new(command)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(command)
        .trim()
        .to_ascii_lowercase()
}

fn mcp_stdio_command_ok(command: &str) -> bool {
    const ALLOW: &[&str] = &[
        "npx", "npm", "pnpm", "yarn", "bun", "bunx", "deno", "uv", "uvx", "node", "nodejs",
        "python", "python3", "py", "docker", "podman", "cargo", "go", "php", "ruby", "java",
    ];
    let stem = mcp_command_stem(command);
    ALLOW.contains(&stem.as_str())
}

pub fn path_looks_like_system_root(path: &Path) -> bool {
    let n = path
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    let n = n.strip_prefix("//?/").unwrap_or(&n);
    let n = n.trim_end_matches('/');
    let banned = [
        "/windows",
        "/windows/system32",
        "/program files",
        "/program files (x86)",
        "/etc",
        "/usr",
        "/bin",
        "/sbin",
        "/system",
        "/private/etc",
        "c:/windows",
        "c:/program files",
        "c:/program files (x86)",
    ];
    banned.iter().any(|b| n == *b || n.starts_with(&format!("{b}/")))
}

/// 前端 MCP upsert：只留官方认的字段；stdio 命令必须是包管理器/运行时，不能是 shell。
pub fn sanitize_mcp_config(config: &serde_json::Value) -> Result<serde_json::Value, String> {
    let obj = config
        .as_object()
        .ok_or_else(|| "MCP 配置必须是 JSON 对象".to_string())?;
    let text = serde_json::to_string(config).unwrap_or_default();
    if text.len() > 64 * 1024 {
        return Err("MCP 配置过大".into());
    }
    let mut out = serde_json::Map::new();
    if let Some(cmd) = obj.get("command").and_then(|v| v.as_str()) {
        let cmd = cmd.trim();
        if cmd.is_empty() || cmd.contains('\0') || cmd.contains('\n') || cmd.contains('\r') {
            return Err("MCP 启动命令不合法".into());
        }
        if !mcp_stdio_command_ok(cmd) {
            return Err(format!(
                "不允许的 MCP 启动命令「{cmd}」。请用 npx / uvx / node / python / docker 等"
            ));
        }
        if cmd.contains('/') || cmd.contains('\\') {
            if path_looks_like_system_root(Path::new(cmd)) {
                return Err("MCP 启动命令不能指向系统目录".into());
            }
        }
        out.insert("command".into(), serde_json::Value::String(cmd.to_string()));
    }
    if let Some(args) = obj.get("args") {
        let arr = args
            .as_array()
            .ok_or_else(|| "MCP args 必须是字符串数组".to_string())?;
        if arr.len() > 64 {
            return Err("MCP args 过多".into());
        }
        let mut clean = Vec::new();
        for a in arr {
            let s = a
                .as_str()
                .ok_or_else(|| "MCP args 必须是字符串".to_string())?;
            if s.contains('\0') || s.contains('\n') || s.contains('\r') {
                return Err("MCP args 不能含换行".into());
            }
            if s.len() > 4096 {
                return Err("MCP 参数过长".into());
            }
            clean.push(serde_json::Value::String(s.to_string()));
        }
        out.insert("args".into(), serde_json::Value::Array(clean));
    }
    if let Some(url) = obj.get("url").and_then(|v| v.as_str()) {
        let url = url.trim();
        let lower = url.to_ascii_lowercase();
        if !(lower.starts_with("https://") || lower.starts_with("http://")) {
            return Err("MCP URL 只允许 http(s)".into());
        }
        if url.contains('\n') || url.contains('\r') || url.contains('\0') {
            return Err("MCP URL 不合法".into());
        }
        out.insert("url".into(), serde_json::Value::String(url.to_string()));
    }
    if let Some(ty) = obj.get("type").and_then(|v| v.as_str()) {
        let ty = ty.trim().to_ascii_lowercase();
        if ty != "http" && ty != "sse" && ty != "stdio" {
            return Err("MCP type 只允许 stdio / http / sse".into());
        }
        out.insert("type".into(), serde_json::Value::String(ty));
    }
    if let Some(en) = obj.get("enabled").and_then(|v| v.as_bool()) {
        out.insert("enabled".into(), serde_json::Value::Bool(en));
    }
    if let Some(env) = obj.get("env") {
        let map = env
            .as_object()
            .ok_or_else(|| "MCP env 必须是对象".to_string())?;
        let mut clean = serde_json::Map::new();
        for (k, v) in map {
            let val = v
                .as_str()
                .ok_or_else(|| "MCP env 值必须是字符串".to_string())?;
            sanitize_env_value(val)?;
            if k.is_empty() || k.contains('\0') || k.contains('=') {
                return Err("MCP env 键不合法".into());
            }
            clean.insert(k.clone(), serde_json::Value::String(val.to_string()));
        }
        out.insert("env".into(), serde_json::Value::Object(clean));
    }
    if let Some(headers) = obj.get("headers") {
        let map = headers
            .as_object()
            .ok_or_else(|| "MCP headers 必须是对象".to_string())?;
        let mut clean = serde_json::Map::new();
        for (k, v) in map {
            let val = v
                .as_str()
                .ok_or_else(|| "MCP header 值必须是字符串".to_string())?;
            if val.contains('\n') || val.contains('\r') || val.contains('\0') {
                return Err("MCP header 不能含换行".into());
            }
            clean.insert(k.clone(), serde_json::Value::String(val.to_string()));
        }
        out.insert("headers".into(), serde_json::Value::Object(clean));
    }
    if out.get("command").is_none() && out.get("url").is_none() {
        return Err("MCP 配置需要 command 或 url".into());
    }
    Ok(serde_json::Value::Object(out))
}

pub fn skill_add_path_shape_ok(path: &str) -> bool {
    let p = path.trim().replace('\\', "/").trim_end_matches('/').to_string();
    if p.is_empty() || p.contains('\0') {
        return false;
    }
    let base = p.rsplit('/').next().unwrap_or("");
    base.eq_ignore_ascii_case("skill.md") || !base.to_ascii_lowercase().ends_with(".md")
}

/// 技能路径必须真实存在、含 SKILL.md，且不能落在系统目录。
pub fn sanitize_skill_add_path(path: &str) -> Result<PathBuf, String> {
    if !skill_add_path_shape_ok(path) {
        return Err("请选择技能文件夹，或名为 SKILL.md 的文件".into());
    }
    let p = PathBuf::from(path.trim());
    let canonical = p
        .canonicalize()
        .map_err(|_| "技能路径不存在或无法访问".to_string())?;
    if path_looks_like_system_root(&canonical) {
        return Err("不能从系统目录添加技能".into());
    }
    let dir = if canonical
        .file_name()
        .and_then(|s| s.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case("skill.md"))
    {
        canonical.parent().unwrap_or(&canonical).to_path_buf()
    } else {
        canonical.clone()
    };
    if !dir.join("SKILL.md").is_file() && !dir.join("skill.md").is_file() {
        return Err("该目录没有 SKILL.md".into());
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn env_value_rejects_newline_injection() {
        assert!(sanitize_env_value("foo\nMALICIOUS_KEY=bar").is_err());
        assert!(sanitize_env_value("foo\rbar").is_err());
        assert!(sanitize_env_value("ok-secret").is_ok());
        let line = format_env_line("XAI_API_KEY", "ab\"c").unwrap();
        assert_eq!(line, r#"XAI_API_KEY="ab\"c""#);
        assert!(format_env_line("K", "a\nb").is_err());
    }

    #[test]
    fn zip_entry_names_match_export_rules() {
        assert!(zip_entry_name_ok("flow.yaml"));
        assert!(zip_entry_name_ok("demo.rhai"));
        assert!(!zip_entry_name_ok("/etc/passwd"));
        assert!(!zip_entry_name_ok("../x.rhai"));
        assert!(!zip_entry_name_ok(r"C:\Windows\a.rhai"));
        assert!(!zip_entry_name_ok("foo/../../etc/passwd"));
        assert!(!zip_entry_name_ok(""));
    }

    #[test]
    fn sidecar_rhai_must_look_compiled() {
        assert!(accept_sidecar_rhai("let meta = #{ name: \"a\" };\n").is_ok());
        assert!(accept_sidecar_rhai("agent(\"pwn\")").is_err());
        let mut big = String::from("let meta = #{}; ");
        big.push_str(&"x".repeat(MAX_SIDECAR_RHAI_BYTES));
        assert!(accept_sidecar_rhai(&big).is_err());
    }

    #[test]
    fn always_sig_uses_command_not_kind() {
        let sig = always_signature("类型：运行终端命令\n命令：\nnpm run build").unwrap();
        assert_eq!(sig, "cmd:npm run build");
        assert!(always_signature("类型：运行终端命令").is_none());
        let a = always_signature("类型：运行终端命令\n命令：\nnpm  run   build").unwrap();
        let b = always_signature("类型：运行终端命令\n命令：\nnpm run build").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn pty_cwd_stays_inside_allowed_roots() {
        let root = std::env::temp_dir().join(format!(
            "vesprism-pty-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let proj = root.join("proj");
        let other = root.join("other");
        fs::create_dir_all(proj.join("src")).unwrap();
        fs::create_dir_all(&other).unwrap();
        let roots = [proj.clone()];
        assert!(pty_cwd_is_allowed(&proj, &roots));
        assert!(pty_cwd_is_allowed(&proj.join("src"), &roots));
        assert!(!pty_cwd_is_allowed(&other, &roots));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn paste_image_sniffs_magic_not_mime_claim() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];
        assert_eq!(sniff_image_ext(&png), Some("png"));
        assert_eq!(sniff_image_ext(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(sniff_image_ext(b"not-an-image"), None);
    }

    #[test]
    fn mcp_upsert_rejects_shell_and_file_url() {
        assert!(sanitize_mcp_server_name("filesystem").is_ok());
        assert!(sanitize_mcp_server_name("1bad").is_err());
        let ok = serde_json::json!({"command":"npx","args":["-y","@x/y"],"enabled":true});
        assert!(sanitize_mcp_config(&ok).is_ok());
        let shell = serde_json::json!({"command":"cmd.exe","args":["/c","calc"]});
        assert!(sanitize_mcp_config(&shell).is_err());
        let bash = serde_json::json!({"command":"bash","args":["-lc","id"]});
        assert!(sanitize_mcp_config(&bash).is_err());
        let file = serde_json::json!({"url":"file:///etc/passwd"});
        assert!(sanitize_mcp_config(&file).is_err());
        let http = serde_json::json!({"url":"https://example.com/mcp","type":"http","enabled":true});
        assert!(sanitize_mcp_config(&http).is_ok());
    }

    #[test]
    fn skill_path_shape_and_system_root() {
        assert!(skill_add_path_shape_ok(r"D:\skills\foo\SKILL.md"));
        assert!(skill_add_path_shape_ok("D:/skills/foo"));
        assert!(!skill_add_path_shape_ok("readme.md"));
        assert!(path_looks_like_system_root(Path::new(r"C:\Windows\System32")));
        assert!(path_looks_like_system_root(Path::new("/etc/passwd")));
        assert!(!path_looks_like_system_root(Path::new(r"D:\proj\skills\foo")));
    }
}
