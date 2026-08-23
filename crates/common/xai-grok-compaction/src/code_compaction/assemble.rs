//! Compacted-history assembly (grok-build's rebuild structure, generic).
//!
//! Moved from `xai-chat-state::compaction_utils::build_compacted_history` and
//! made generic over a write-side item factory so any harness can assemble
//! the canonical post-compaction history:
//!
//! ```text
//! [SP, UP', AGENTS_MD?, reminder?, UQ_last?, recent…, summary]
//! ```
//!
//! grok-build is the canonical harness. The summary carrier text is built by
//! [`super::summary::format_compact_summary_content`].

use crate::item::CompactionItemFactory;

use super::summary::{format_compact_summary_content, wrap_user_query};

/// Input data for building a compacted conversation history.
///
/// All fields are plain data — no I/O, no network, no shell dependencies.
/// The caller is responsible for:
/// - Generating the `compaction_summary` via the LLM.
/// - Rendering the optional `system_reminder` (which may depend on
///   harness-specific backends such as memory search).
/// - Providing the `user_message_prefix` (e.g. `<user_info>` block).
/// - Extracting `last_user_query` / `recent_messages` from its own state.
pub struct CompactedHistoryParts<T> {
    /// The original system message from the conversation.
    pub system_message: T,
    /// The user-info / project-layout prefix (not wrapped in `<user_query>`).
    pub user_message_prefix: String,
    /// Pre-rendered AGENTS.md `<system-reminder>` block to re-inject after the
    /// user prefix. `None` means no project instructions to re-inject.
    pub agents_md_reminder: Option<String>,
    /// The last real user query text (raw, unwrapped).
    pub last_user_query: Option<String>,
    /// Messages retained verbatim from after the last real user turn.
    pub recent_messages: Vec<T>,
    /// The LLM-generated compaction summary text.
    pub compaction_summary: String,
    /// 可选的预渲染 `<system-reminder>`，插在最后一条用户消息之上。
    /// `None` 表示不插入运行态提醒。
    pub system_reminder: Option<String>,
    /// Pre-built transcript hint appended to the summary (`None` to omit).
    pub transcript_hint: Option<String>,
}

/// 用纯数据拼出压缩后的对话历史。
///
/// 返回的 `Vec<T>` 顺序为：
///
/// 1. **系统消息** —— 原系统提示。
/// 2. **用户前缀** —— 如 `<user_info>`（不含 `<user_query>`）。
/// 3. **AGENTS.md 提醒**（若有）—— 项目说明原样回灌。
/// 4. **系统提醒**（若有）—— 运行态，插在最后一条真用户消息之上。
/// 5. **最后一条用户提问**（若有）—— 包在 `<user_query>` 里。
/// 6. **近期消息**（若有）—— 最后一轮用户之后原样保留。
/// 7. **压缩摘要** —— 模型可见的最后一项，便于前缀缓存命中。
///
/// 纯函数，无 I/O。
pub fn assemble_compacted_history<T: CompactionItemFactory>(
    parts: CompactedHistoryParts<T>,
) -> Vec<T> {
    let mut compacted: Vec<T> = vec![
        parts.system_message,
        T::new_user_meta(parts.user_message_prefix),
    ];

    // 把 AGENTS.md 当用户消息回灌，项目说明不依赖摘要模型。
    // `ProjectInstructions` 标签给恢复会话时的幂等守卫识别，避免压缩后再插一份。
    if let Some(ref reminder) = parts.agents_md_reminder {
        compacted.push(T::new_project_instructions(reminder.clone()));
    }

    // 运行态（cwd / 文件 / 任务）放在最后一条真用户消息之上：
    // 回合中压缩时前缀尽量不动，摘要作为模型看到的最后一项。
    if let Some(ref reminder) = parts.system_reminder {
        compacted.push(T::new_system_reminder(reminder.clone()));
    }

    // 最后一条用户提问包进 <user_query>，与其它入口一致。
    if let Some(ref last_query) = parts.last_user_query {
        compacted.push(T::new_user(wrap_user_query(last_query.as_str())));
    }

    // 沿用带 `<user_query>` 包装的续写正文，会话位置提示接在摘要后面。
    let mut formatted_summary = format_compact_summary_content(&parts.compaction_summary);
    if let Some(ref hint) = parts.transcript_hint {
        formatted_summary.push_str(hint);
    }
    let summary_item = T::new_user_meta(formatted_summary);

    // 先近期消息，摘要始终垫底。
    for msg in parts.recent_messages {
        compacted.push(msg);
    }
    compacted.push(summary_item);

    compacted
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal mock item recording which factory constructor produced it.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) enum MockItem {
        System(String),
        User(String),
        UserMeta(String),
        ProjectInstructions(String),
        SystemReminder(String),
        Recent(String),
    }

    impl CompactionItemFactory for MockItem {
        fn new_user(text: String) -> Self {
            Self::User(text)
        }
        fn new_user_meta(text: String) -> Self {
            Self::UserMeta(text)
        }
        fn new_project_instructions(text: String) -> Self {
            Self::ProjectInstructions(text)
        }
        fn new_system_reminder(text: String) -> Self {
            Self::SystemReminder(text)
        }
    }

    fn parts(recent: Vec<MockItem>) -> CompactedHistoryParts<MockItem> {
        CompactedHistoryParts {
            system_message: MockItem::System("sys".into()),
            user_message_prefix: "<user_info>OS: macos</user_info>".into(),
            agents_md_reminder: Some("AGENTS.md content".into()),
            last_user_query: Some("fix the bug".into()),
            recent_messages: recent,
            compaction_summary: "Summary: did things.".into(),
            system_reminder: Some("<system-reminder>state</system-reminder>".into()),
            transcript_hint: None,
        }
    }

    #[test]
    fn grok_build_order_recent_before_summary() {
        let recent = vec![MockItem::Recent("a1".into()), MockItem::Recent("t1".into())];
        let out = assemble_compacted_history(parts(recent));
        // [sys, prefix, agents_md, reminder, query, a1, t1, summary]
        assert_eq!(out.len(), 8);
        assert_eq!(out[0], MockItem::System("sys".into()));
        assert_eq!(
            out[1],
            MockItem::UserMeta("<user_info>OS: macos</user_info>".into())
        );
        assert_eq!(
            out[2],
            MockItem::ProjectInstructions("AGENTS.md content".into())
        );
        assert_eq!(
            out[3],
            MockItem::SystemReminder("<system-reminder>state</system-reminder>".into())
        );
        assert_eq!(
            out[4],
            MockItem::User("<user_query>\nfix the bug\n</user_query>".into())
        );
        assert_eq!(out[5], MockItem::Recent("a1".into()));
        assert_eq!(out[6], MockItem::Recent("t1".into()));
        let MockItem::UserMeta(summary) = &out[7] else {
            panic!("expected UserMeta summary last, got {:?}", out[7]);
        };
        assert!(summary.starts_with("This session is being continued"));
    }

    #[test]
    fn omits_optional_sections() {
        let mut p = parts(vec![]);
        p.agents_md_reminder = None;
        p.last_user_query = None;
        p.system_reminder = None;
        let out = assemble_compacted_history(p);
        // [sys, prefix, summary]
        assert_eq!(out.len(), 3);
        assert!(
            matches!(&out[2], MockItem::UserMeta(s) if s.starts_with("This session is being continued"))
        );
    }

    #[test]
    fn appends_transcript_hint_after_summary() {
        let mut p = parts(vec![]);
        p.transcript_hint = Some("\n\n<transcript_location>/x</transcript_location>".into());
        let out = assemble_compacted_history(p);
        let Some(MockItem::UserMeta(summary)) = out.last() else {
            panic!("expected UserMeta summary last, got {:?}", out.last());
        };
        assert!(summary.ends_with("</transcript_location>"));
    }
}
