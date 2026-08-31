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
}
