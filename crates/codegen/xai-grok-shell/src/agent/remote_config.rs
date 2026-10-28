//! This module fetches the model catalog, caches it, and loads it at startup.

mod endpoint;
mod fetch;
mod manager;
mod model_fetch_auth;
mod prefetch;
mod resolution;
pub mod settings_get;
pub(crate) mod task_model_policy;

pub(crate) use model_fetch_auth::{
    ModelFetchAuth, external_provider_auth, models_fetch_enabled, task_model_error_for_catalog,
};
pub(in crate::agent::remote_config) use model_fetch_auth::{
    resolve_live_models_cache_scope, resolve_models_cache_scope,
};
pub(in crate::agent::remote_config) use prefetch::resolve_startup_endpoints;
pub(crate) use prefetch::{
    ResolvedModels, fetch_initial_models_blocking, start_initial_models_load,
};
pub(crate) use resolution::{
    CatalogSource, allowlist_denied_message, allowlist_excludes_all_message,
    allowlist_matches_nothing, available_models, fallback_model_id, models_endpoint_empty_message,
    resolve_catalog_key, resolve_default_model, resolve_model_catalog,
    selectable_catalog_key_for_persisted, validate_selectable,
};
#[cfg(test)]
pub(in crate::agent::remote_config) use xai_grok_cloud_config::Commit;
pub(in crate::agent) use xai_grok_cloud_config::SettingsRefresh;
pub(crate) use xai_grok_cloud_config::remote_settings::{
    DegradedStartCause, ModelGlobSet, ModelsCacheScope, is_campaign_only_flip,
    record_degraded_start,
};
pub(in crate::agent::remote_config) use xai_grok_cloud_config::resolve_disk_auth;

pub(in crate::agent::remote_config) type ModelsCacheManager =
    xai_grok_cloud_config::remote_settings::ModelsCacheManager<crate::agent::config::ModelEntry>;

pub(crate) use endpoint::{HttpModelsEndpoint, ModelsEndpoint};
pub(in crate::agent::remote_config) use fetch::fetch_models_uncommitted;
pub(crate) use fetch::prefetch_models_blocking;
pub(crate) use manager::ModelsManager;
#[cfg(test)]
pub(in crate::agent::remote_config) use xai_grok_cloud_config::remote_settings::ModelsPrefetch;
#[cfg(test)]
pub(in crate::agent::remote_config) use xai_grok_cloud_config::remote_settings::evaluate_models_commit;

// Re-exports reached only through the manager test module.
#[cfg(test)]
pub(crate) use endpoint::ModelsFetchFuture;
#[cfg(test)]
pub(crate) use fetch::build_prefetched_map;
#[cfg(test)]
pub(crate) use prefetch::resolve_prefetch_inputs_from_parts;
#[cfg(test)]
pub(crate) use xai_grok_cloud_config::remote_settings::{
    CACHE_TTL, CacheAuthMethod, MODELS_CACHE_FILE, degraded_log_level,
};
#[cfg(test)]
pub(crate) type ModelsCache =
    xai_grok_cloud_config::remote_settings::ModelsCache<crate::agent::config::ModelEntry>;

/// vesprism: 桌面设置页用的一条官方目录。不含密钥。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AccountCatalogModel {
    pub id: String,
    pub name: String,
    pub model: String,
    pub base_url: String,
    pub context_window: u64,
    pub system_prompt_label: String,
    pub api_backend: String,
    pub description: String,
    pub agent_type: String,
    pub auto_compact_threshold_percent: u8,
    pub supports_reasoning_effort: bool,
    pub reasoning_effort: String,
    pub reasoning_efforts: Vec<String>,
}

fn effort_name(effort: xai_grok_sampling_types::ReasoningEffort) -> String {
    effort.as_ref().to_string()
}

/// 选择器可见的目录行。`is_session_auth` 为假时丢掉仅 OAuth 可见的型号。
pub fn account_catalog_models(
    entries: &indexmap::IndexMap<String, crate::agent::config::ModelEntry>,
    is_session_auth: bool,
) -> Vec<AccountCatalogModel> {
    let mut out = Vec::new();
    for (key, entry) in entries {
        let info = entry.info();
        if !info.is_picker_eligible(is_session_auth) {
            continue;
        }
        let model = info.model.trim();
        if model.is_empty() {
            continue;
        }
        let id = info
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .unwrap_or(key.as_str())
            .to_string();
        if id.is_empty() {
            continue;
        }
        let base_url = if info.base_url.trim().is_empty() {
            crate::agent::config::EndpointsConfig::default().xai_api_base_url
        } else {
            info.base_url.clone()
        };
        let api_backend = serde_json::to_value(&info.api_backend)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(|| "responses".to_string());
        out.push(AccountCatalogModel {
            name: info
                .name
                .clone()
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| model.to_string()),
            model: model.to_string(),
            system_prompt_label: info
                .system_prompt_label
                .clone()
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| model.to_string()),
            id,
            base_url,
            context_window: info.context_window.get(),
            api_backend,
            description: info.description.clone().unwrap_or_default(),
            agent_type: info.agent_type.clone(),
            auto_compact_threshold_percent: info.auto_compact_threshold_percent.unwrap_or(0),
            supports_reasoning_effort: info.supports_reasoning_effort,
            reasoning_effort: info.reasoning_effort.map(effort_name).unwrap_or_default(),
            reasoning_efforts: info
                .reasoning_efforts
                .iter()
                .map(|option| effort_name(option.value))
                .collect(),
        });
    }
    out
}

/// 用磁盘上的登录态拉 `/v1/models`。没有凭证、或接口失败时返回 `None`。
pub fn fetch_account_catalog_blocking() -> Option<Vec<AccountCatalogModel>> {
    let auth = resolve_disk_auth(None);
    let session_auth = auth.as_ref().is_some_and(|a| a.is_session_auth());
    let models = fetch_initial_models_blocking(
        &tokio_util::sync::CancellationToken::new(),
        None,
        auth,
    )?;
    let rows = account_catalog_models(&models, session_auth);
    if rows.is_empty() { None } else { Some(rows) }
}

#[cfg(test)]
mod account_catalog_tests {
    use super::account_catalog_models;
    use crate::agent::config::{EndpointsConfig, ModelEntry};
    use indexmap::IndexMap;

    #[test]
    fn drops_hidden_and_api_key_only_rows() {
        let endpoints = EndpointsConfig::default();
        let mut visible = ModelEntry::fallback("grok-new", &endpoints);
        visible.info.name = Some("Grok New".into());
        visible.info.id = Some("grok-new".into());
        let mut hidden = ModelEntry::fallback("grok-hidden", &endpoints);
        hidden.info.hidden = true;
        let mut oauth_only = ModelEntry::fallback("grok-oauth", &endpoints);
        oauth_only.info.supported_in_api = false;

        let mut entries = IndexMap::new();
        entries.insert("grok-new".into(), visible);
        entries.insert("grok-hidden".into(), hidden);
        entries.insert("grok-oauth".into(), oauth_only);

        let session = account_catalog_models(&entries, true);
        let ids: Vec<&str> = session.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["grok-new", "grok-oauth"]);
        assert_eq!(session[0].name, "Grok New");

        let api_key = account_catalog_models(&entries, false);
        let ids: Vec<&str> = api_key.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["grok-new"]);
    }
}
