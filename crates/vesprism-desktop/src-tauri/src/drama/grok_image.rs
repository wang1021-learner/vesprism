//! 出图走 Grok Imagine。没有参考图时 `POST /v1/images/generations`；
//! 连了角色定妆或上游画面时 `POST /v1/images/edits`。登录态和桌面账号是同一份。
use base64::Engine;
use drama_core::asset::AssetMeta;
use drama_core::provider::ProviderError;

pub const IMAGE_MODEL: &str = "grok-imagine-image-quality";
const MAX_REF_BYTES: usize = 8 * 1024 * 1024;

/// 上游已经生成好的图，作为这次出图的参考。
pub struct RefImage {
    pub mime: String,
    pub bytes: Vec<u8>,
}

pub fn decode_image_body(body: &str) -> Result<Vec<u8>, ProviderError> {
    let v: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| ProviderError::Failed(format!("图片响应无法解析: {e}")))?;
    let b64 = v
        .get("data")
        .and_then(|d| d.as_array())
        .and_then(|a| a.first())
        .and_then(|row| row.get("b64_json").and_then(|s| s.as_str()))
        .unwrap_or("");
    if b64.is_empty() {
        return Err(ProviderError::Failed("接口没有返回图片".into()));
    }
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| ProviderError::Failed(format!("图片解码失败: {e}")))
}

pub fn image_meta(data: &[u8]) -> AssetMeta {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        let (width, height) = png_size(data);
        AssetMeta { mime: "image/png".into(), width, height, duration_ms: None }
    } else if data.len() >= 2 && data[0] == 0xFF && data[1] == 0xD8 {
        AssetMeta { mime: "image/jpeg".into(), width: None, height: None, duration_ms: None }
    } else {
        AssetMeta { mime: "image/png".into(), width: None, height: None, duration_ms: None }
    }
}

fn png_size(data: &[u8]) -> (Option<u32>, Option<u32>) {
    match png::Decoder::new(std::io::Cursor::new(data)).read_info() {
        Ok(reader) => {
            let info = reader.info();
            (Some(info.width), Some(info.height))
        }
        Err(_) => (None, None),
    }
}

fn image_model() -> String {
    std::env::var("GROK_IMAGE_GEN_MODEL_OVERRIDE")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| IMAGE_MODEL.to_string())
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{mime};base64,{b64}")
}

fn env_key() -> Option<String> {
    for name in ["XAI_API_KEY", "GROK_API_KEY"] {
        if let Ok(value) = std::env::var(name) {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// 请求路径和 JSON。没有参考图走文生图，有参考图走改图。
pub fn image_request(prompt: &str, aspect: &str, refs: &[RefImage]) -> (&'static str, serde_json::Value) {
    let model = image_model();
    let refs: Vec<&RefImage> = refs.iter().filter(|r| !r.bytes.is_empty() && r.bytes.len() <= MAX_REF_BYTES).collect();
    if refs.is_empty() {
        return (
            "images/generations",
            serde_json::json!({
                "model": model,
                "prompt": prompt,
                "n": 1,
                "aspect_ratio": aspect,
                "resolution": "1k",
                "response_format": "b64_json",
            }),
        );
    }
    let urls: Vec<serde_json::Value> = refs
        .iter()
        .map(|r| serde_json::json!({ "url": data_url(&r.mime, &r.bytes) }))
        .collect();
    let mut payload = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "n": 1,
        "resolution": "1k",
        "response_format": "b64_json",
    });
    let obj = payload.as_object_mut().expect("object");
    if urls.len() == 1 {
        let url = urls.into_iter().next().expect("one");
        obj.insert("image".into(), url);
    } else {
        obj.insert("images".into(), serde_json::Value::Array(urls));
        obj.insert("aspect_ratio".into(), serde_json::json!(aspect));
    }
    ("images/edits", payload)
}

/// 用已登录账号出一张图。`refs` 非空时把这些图一起交给改图接口。
pub fn imagine(prompt: &str, aspect: &str, refs: &[RefImage]) -> Result<Vec<u8>, ProviderError> {
    let cfg = crate::account::load_agent_config().map_err(|e| ProviderError::Failed(e))?;
    let base = cfg.endpoints.xai_api_base_url.clone();
    let grok_com = cfg.grok_com_config.clone();
    let proxy = cfg.endpoints.proxy_url();
    let key = env_key();
    let (path, payload) = image_request(prompt, aspect, refs);
    let url = format!("{}/{}", base.trim_end_matches('/'), path);
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| ProviderError::Failed(e.to_string()))?;
    rt.block_on(async move {
        let token = if let Some(key) = key {
            key
        } else {
            xai_grok_shell::auth::try_ensure_fresh_auth(&grok_com, proxy)
                .await
                .map(|auth| auth.key)
                .filter(|key| !key.trim().is_empty())
                .ok_or(ProviderError::Auth)?
        };
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .map_err(|e| ProviderError::Failed(e.to_string()))?;
        let response = client
            .post(&url)
            .bearer_auth(token)
            .json(&payload)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    ProviderError::Timeout
                } else {
                    ProviderError::Failed(format!("出图请求失败: {e}"))
                }
            })?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ProviderError::Auth);
        }
        let text = response
            .text()
            .await
            .map_err(|e| ProviderError::Failed(e.to_string()))?;
        if !status.is_success() {
            let preview: String = text.chars().take(180).collect();
            return Err(ProviderError::Failed(format!("出图失败 HTTP {status}: {preview}")));
        }
        decode_image_body(&text)
    })
}

#[cfg(test)]
mod tests {
    use super::decode_image_body;

    #[test]
    fn reads_b64_image() {
        let body = r#"{"data":[{"b64_json":"aGk="}]}"#;
        assert_eq!(decode_image_body(body).unwrap(), b"hi");
    }

    #[test]
    fn empty_body_is_an_error() {
        assert!(decode_image_body(r#"{"data":[]}"#).is_err());
    }

    #[test]
    fn text_only_uses_generations() {
        let (path, body) = super::image_request("雨夜", "16:9", &[]);
        assert_eq!(path, "images/generations");
        assert_eq!(body["prompt"], "雨夜");
        assert_eq!(body["aspect_ratio"], "16:9");
        assert!(body.get("image").is_none());
    }

    #[test]
    fn one_reference_uses_edit() {
        let (path, body) = super::image_request(
            "回头看",
            "16:9",
            &[super::RefImage { mime: "image/png".into(), bytes: b"hi".to_vec() }],
        );
        assert_eq!(path, "images/edits");
        assert_eq!(body["image"]["url"], "data:image/png;base64,aGk=");
        assert!(body.get("images").is_none());
        assert!(body.get("aspect_ratio").is_none());
    }

    #[test]
    fn two_references_send_aspect() {
        let refs = [
            super::RefImage { mime: "image/png".into(), bytes: b"a".to_vec() },
            super::RefImage { mime: "image/jpeg".into(), bytes: b"b".to_vec() },
        ];
        let (path, body) = super::image_request("回头看", "16:9", &refs);
        assert_eq!(path, "images/edits");
        assert_eq!(body["images"].as_array().map(|a| a.len()), Some(2));
        assert_eq!(body["aspect_ratio"], "16:9");
    }
}
