//! 会话后端缝：桌面绑这套 API，Grok 实现绑官方 ACP。
//! 今天唯一实现是 [`crate::GrokSession`]；不在这里换引擎。

use crate::{PromptAttach, SessionStatus};
use serde::{Deserialize, Serialize};

/// 本后端会哪些能力。Grok 实现全开；以后别的后端按支持情况关掉，桌面藏按钮。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCaps {
    pub recap: bool,
    pub ask_mode: bool,
    pub memory: bool,
    pub hunks: bool,
    pub rewind: bool,
    pub git_write: bool,
    pub imagine: bool,
    pub schedule: bool,
    pub queue_edit: bool,
    pub plugins: bool,
    pub hooks: bool,
    pub compact: bool,
}

impl SessionCaps {
    /// 官方 Grok 循环：桌面已接的能力都标 true。
    pub const GROK: Self = Self {
        recap: true,
        ask_mode: true,
        memory: true,
        hunks: true,
        rewind: true,
        git_write: true,
        imagine: true,
        schedule: true,
        queue_edit: true,
        plugins: true,
        hooks: true,
        compact: true,
    };
}

/// 起会话参数。桌面不要拼 `x.ai/flows`；以后可加 `agent_type`。
#[derive(Debug, Clone, Default)]
pub struct StartOpts {
    pub cwd: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub flows: Vec<String>,
    pub agent_type: Option<String>,
}

/// 会话后端。Actor 今天握 [`crate::GrokSession`]（本 trait 的实现）。
#[async_trait::async_trait(?Send)]
pub trait SessionBackend {
    fn caps(&self) -> SessionCaps;
    fn session_id(&self) -> String;
    fn subscribe_status(&self) -> tokio::sync::watch::Receiver<SessionStatus>;

    async fn send_prompt_with_attachments(
        &self,
        text: String,
        attachments: Vec<PromptAttach>,
        prompt_id: String,
    ) -> anyhow::Result<()>;

    async fn cancel(&self) -> anyhow::Result<()>;

    async fn recap(&self, auto: bool) -> anyhow::Result<serde_json::Value>;

    async fn memory_flush(&self) -> anyhow::Result<serde_json::Value>;

    async fn memory_rewrite(
        &self,
        params: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value>;

    /// `action` 为 hunk-tracker 动作名（如 `get-files`），实现里再拼官方方法名。
    async fn hunk_call(
        &self,
        action: &str,
        params: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value>;

    async fn edit_queued_prompt(&self, id: &str, new_text: &str) -> anyhow::Result<()>;

    async fn plugins_list(&self) -> anyhow::Result<serde_json::Value>;
    async fn plugins_action(&self, action: serde_json::Value) -> anyhow::Result<serde_json::Value>;
    async fn hooks_list(&self) -> anyhow::Result<serde_json::Value>;
    async fn hooks_action(&self, action: serde_json::Value) -> anyhow::Result<serde_json::Value>;
    async fn scheduler_delete(&self, task_id: &str) -> anyhow::Result<serde_json::Value>;
    async fn session_info(&self) -> anyhow::Result<serde_json::Value>;
    async fn session_usage(&self) -> anyhow::Result<serde_json::Value>;
    async fn compact_conversation(
        &self,
        user_context: Option<&str>,
    ) -> anyhow::Result<serde_json::Value>;

    /// 未收编的官方扩展逃生口。桌面新功能不要再走这条。
    async fn ext_json(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::watch;

    struct FakeBackend {
        id: String,
        status: watch::Sender<SessionStatus>,
        last_send: std::cell::RefCell<Option<String>>,
    }

    #[async_trait::async_trait(?Send)]
    impl SessionBackend for FakeBackend {
        fn caps(&self) -> SessionCaps {
            SessionCaps::GROK
        }
        fn session_id(&self) -> String {
            self.id.clone()
        }
        fn subscribe_status(&self) -> watch::Receiver<SessionStatus> {
            self.status.subscribe()
        }
        async fn send_prompt_with_attachments(
            &self,
            text: String,
            _attachments: Vec<PromptAttach>,
            _prompt_id: String,
        ) -> anyhow::Result<()> {
            *self.last_send.borrow_mut() = Some(text);
            Ok(())
        }
        async fn cancel(&self) -> anyhow::Result<()> {
            Ok(())
        }
        async fn recap(&self, _auto: bool) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({ "ok": true }))
        }
        async fn memory_flush(&self) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({}))
        }
        async fn memory_rewrite(
            &self,
            _params: serde_json::Value,
        ) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({}))
        }
        async fn hunk_call(
            &self,
            _action: &str,
            _params: serde_json::Value,
        ) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({ "files": [] }))
        }
        async fn edit_queued_prompt(&self, _id: &str, _new_text: &str) -> anyhow::Result<()> {
            Ok(())
        }
        async fn plugins_list(&self) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({ "plugins": [] }))
        }
        async fn plugins_action(
            &self,
            _action: serde_json::Value,
        ) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({ "ok": true }))
        }
        async fn hooks_list(&self) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({ "hooks": [] }))
        }
        async fn hooks_action(
            &self,
            _action: serde_json::Value,
        ) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({ "ok": true }))
        }
        async fn scheduler_delete(&self, _task_id: &str) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({ "ok": true }))
        }
        async fn session_info(&self) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({ "sessionId": self.id }))
        }
        async fn session_usage(&self) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({}))
        }
        async fn compact_conversation(
            &self,
            _user_context: Option<&str>,
        ) -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::json!({ "ok": true }))
        }
        async fn ext_json(
            &self,
            _method: &str,
            _params: serde_json::Value,
        ) -> anyhow::Result<serde_json::Value> {
            anyhow::bail!("fake 无 ext")
        }
    }

    #[tokio::test]
    async fn fake_backend_can_start_send() {
        let (tx, _rx) = watch::channel(SessionStatus::Idle);
        let b = FakeBackend {
            id: "s1".into(),
            status: tx,
            last_send: std::cell::RefCell::new(None),
        };
        let backend: &dyn SessionBackend = &b;
        assert_eq!(backend.session_id(), "s1");
        assert!(backend.caps().recap);
        backend
            .send_prompt_with_attachments("hi".into(), vec![], "p1".into())
            .await
            .unwrap();
        assert_eq!(b.last_send.borrow().as_deref(), Some("hi"));
        assert!(backend.recap(false).await.unwrap().get("ok").is_some());
    }
}
