//! 把桌面端选中的文件/文件夹收成官方 ACP `ContentBlock`。
//!
//! 引擎 `parse_prompt` 已经认：
//! - `Image` → 多模态图
//! - `Resource`（EmbeddedResource）→ `<attached_files>` / `<file_contents>`
//! - `ResourceLink` → `@path` 再读盘
//!
//! 文件用 EmbeddedResource 内嵌正文（不依赖会话 cwd，闲聊也能带盘外文件）。
//! 文件夹列目录 + 内嵌少量文本子文件。

use agent_client_protocol::{
    BlobResourceContents, ContentBlock, EmbeddedResource, EmbeddedResourceResource, ImageContent,
    ResourceLink, TextResourceContents,
};
use base64::Engine as _;
use std::path::{Path, PathBuf};

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
const MAX_FOLDER_LIST: usize = 40;
const MAX_FOLDER_EMBED: usize = 8;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PromptAttach {
    pub kind: String,
    pub path: String,
}

pub fn build_prompt_blocks(
    text: &str,
    attachments: &[PromptAttach],
) -> anyhow::Result<Vec<ContentBlock>> {
    let mut blocks: Vec<ContentBlock> = Vec::new();
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        blocks.push(trimmed.to_string().into());
    }
    for item in attachments {
        let path = PathBuf::from(item.path.trim());
        if path.as_os_str().is_empty() {
            continue;
        }
        match item.kind.trim() {
            "folder" => blocks.extend(blocks_for_folder(&path)?),
            kind => blocks.push(block_for_file(&path, kind == "image")?),
        }
    }
    if blocks.is_empty() {
        anyhow::bail!("消息不能为空");
    }
    Ok(blocks)
}

fn file_uri(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    if s.starts_with("file://") {
        s
    } else {
        format!("file://{s}")
    }
}

fn image_mime(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn read_limited(path: &Path) -> anyhow::Result<Vec<u8>> {
    let meta = std::fs::metadata(path)
        .map_err(|e| anyhow::anyhow!("读附件失败 {}: {e}", path.display()))?;
    if !meta.is_file() {
        anyhow::bail!("{} 不是文件", path.display());
    }
    if meta.len() > MAX_READ_BYTES {
        anyhow::bail!(
            "{} 过大（{} bytes），上限 {MAX_READ_BYTES}",
            path.display(),
            meta.len()
        );
    }
    std::fs::read(path).map_err(|e| anyhow::anyhow!("读附件失败 {}: {e}", path.display()))
}

fn block_for_file(path: &Path, force_image: bool) -> anyhow::Result<ContentBlock> {
    if !path.exists() {
        anyhow::bail!("附件不存在: {}", path.display());
    }
    if path.is_dir() {
        return Ok(blocks_for_folder(path)?
            .into_iter()
            .next()
            .unwrap_or_else(|| format!("文件夹 `{}`", path.display()).into()));
    }
    let bytes = read_limited(path)?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();
    if force_image || image_mime(&ext).is_some() {
        if let Some(mime) = image_mime(&ext) {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            return Ok(ContentBlock::Image(ImageContent::new(b64, mime.to_string())));
        }
    }
    if let Ok(text) = String::from_utf8(bytes.clone()) {
        if !text.contains('\0') {
            return Ok(ContentBlock::Resource(EmbeddedResource::new(
                EmbeddedResourceResource::TextResourceContents(TextResourceContents::new(
                    text,
                    file_uri(path),
                )),
            )));
        }
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(ContentBlock::Resource(EmbeddedResource::new(
        EmbeddedResourceResource::BlobResourceContents(
            BlobResourceContents::new(b64, file_uri(path))
                .mime_type(Some("application/octet-stream".into())),
        ),
    )))
}

fn blocks_for_folder(path: &Path) -> anyhow::Result<Vec<ContentBlock>> {
    if !path.is_dir() {
        anyhow::bail!("{} 不是文件夹", path.display());
    }
    let mut names: Vec<(bool, String, PathBuf)> = Vec::new();
    let read = std::fs::read_dir(path)
        .map_err(|e| anyhow::anyhow!("读文件夹失败 {}: {e}", path.display()))?;
    for entry in read {
        let entry = entry.map_err(|e| anyhow::anyhow!("读文件夹条目失败: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        names.push((is_dir, name, entry.path()));
    }
    names.sort_by(|a, b| match (a.0, b.0) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.1.to_lowercase().cmp(&b.1.to_lowercase()),
    });

    let mut listing = format!("用户附上文件夹 `{}`：\n", path.display());
    let mut embed_candidates: Vec<PathBuf> = Vec::new();
    for (i, (is_dir, name, child)) in names.iter().enumerate() {
        if i >= MAX_FOLDER_LIST {
            listing.push_str(&format!("… 另有 {} 项未列出\n", names.len() - MAX_FOLDER_LIST));
            break;
        }
        if *is_dir {
            listing.push_str(&format!("- {name}/\n"));
        } else {
            listing.push_str(&format!("- {name}\n"));
            if embed_candidates.len() < MAX_FOLDER_EMBED {
                embed_candidates.push(child.clone());
            }
        }
    }

    let mut meta = agent_client_protocol::Meta::new();
    meta.insert("kind".into(), serde_json::Value::String("folder".into()));
    let link = ResourceLink::new(
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string()),
        file_uri(path),
    )
    .meta(Some(meta));

    let mut blocks = vec![listing.into(), ContentBlock::ResourceLink(link)];
    for child in embed_candidates {
        if let Ok(block) = block_for_file(&child, false) {
            if matches!(block, ContentBlock::Image(_)) {
                continue;
            }
            blocks.push(block);
        }
    }
    Ok(blocks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embeds_small_text_file() {
        let p = std::env::temp_dir().join(format!("vesp-attach-{}.rs", std::process::id()));
        std::fs::write(&p, "fn main() {}\n").unwrap();
        let blocks = build_prompt_blocks(
            "看这个",
            &[PromptAttach {
                kind: "file".into(),
                path: p.to_string_lossy().into_owned(),
            }],
        )
        .unwrap();
        assert_eq!(blocks.len(), 2);
        assert!(matches!(blocks[1], ContentBlock::Resource(_)));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn empty_without_attachments_fails() {
        assert!(build_prompt_blocks("  ", &[]).is_err());
    }

    #[test]
    fn folder_lists_and_links() {
        let dir = std::env::temp_dir().join(format!("vesp-attach-dir-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("a.txt"), "hello\n").unwrap();
        let blocks = build_prompt_blocks(
            "",
            &[PromptAttach {
                kind: "folder".into(),
                path: dir.to_string_lossy().into_owned(),
            }],
        )
        .unwrap();
        assert!(blocks.len() >= 2);
        assert!(matches!(blocks[1], ContentBlock::ResourceLink(_)));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
