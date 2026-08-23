//! bash 审批记忆的规范化钥匙。
//!
//! `evaluate_bash` 已剥掉 `timeout` / `env` / `nice`；本模块再递归
//! `bash -c` / `bash -lc` 内层脚本，避免包装路径不同就被当成新命令。
//! 禁止把仅含 shell 二进制（如 `bash`）的钥匙写入「总是允许」。

use super::bash_command_splitting::{
    is_setup_command, try_parse_shell, try_parse_word_only_commands_sequence, unwrap_wrappers,
};
use super::policy::{InlineShellScript, ShellWord, head_is_exec_vehicle, shell_dash_c_script};
use super::state::PermissionState;

const MAX_INLINE_DEPTH: usize = 8;

const BANNED_GRANT_HEADS: &[&str] = &[
    "bash",
    "sh",
    "dash",
    "zsh",
    "ksh",
    "pwsh",
    "powershell",
    "cmd",
    "cmd.exe",
];

pub(crate) fn program_basename(word: &str) -> &str {
    let base = word.rsplit(['/', '\\']).next().unwrap_or(word);
    base.strip_suffix(".exe")
        .or_else(|| base.strip_suffix(".EXE"))
        .unwrap_or(base)
}

pub(crate) fn is_banned_grant_head(word: &str) -> bool {
    let base = program_basename(word);
    BANNED_GRANT_HEADS
        .iter()
        .any(|head| base.eq_ignore_ascii_case(head))
}

/// 会授权「随便开一个 shell」而不是具体程序的钥匙。
/// `bash`、`bash -lc`、`sh -c` 禁止落盘；内层脚本可以。
pub(crate) fn is_banned_grant_key(key: &str) -> bool {
    let mut parts = key.split_whitespace();
    let Some(head) = parts.next() else {
        return true;
    };
    is_banned_grant_head(head)
}

fn word_boundary_prefix(segment: &str, allowed: &str) -> bool {
    segment == allowed
        || (segment.starts_with(allowed) && segment.as_bytes().get(allowed.len()) == Some(&b' '))
}

/// 一条脚本可命中 `allowed_bash_commands` 的钥匙：剥包装后的拼接，
/// 再加上内嵌 `bash -c` / `-lc` 脚本剥过的命令。
pub(crate) fn expanded_grant_keys(cmd: &str) -> Vec<String> {
    let mut out = Vec::new();
    collect_keys(cmd, MAX_INLINE_DEPTH, &mut out);
    out
}

pub(crate) fn expanded_grant_keys_from_words(words: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    collect_keys_from_words(words, MAX_INLINE_DEPTH, &mut out);
    out
}

fn collect_keys(cmd: &str, depth: usize, out: &mut Vec<String>) {
    if depth == 0 {
        return;
    }
    let Some(tree) = try_parse_shell(cmd) else {
        return;
    };
    let Some(segments) = try_parse_word_only_commands_sequence(&tree, cmd) else {
        return;
    };
    for segment in segments {
        collect_keys_from_words(unwrap_wrappers(segment.words()), depth, out);
    }
}

fn collect_keys_from_words(words: &[String], depth: usize, out: &mut Vec<String>) {
    if depth == 0 || words.is_empty() || is_setup_command(words) {
        return;
    }
    let joined = words.join(" ");
    if !is_banned_grant_key(&joined) {
        out.push(joined);
    }
    let shell_words: Vec<ShellWord<'_>> = words.iter().map(ShellWord::from).collect();
    if let InlineShellScript::Literal(index) = shell_dash_c_script(&shell_words)
        && let Some(script) = words.get(index)
    {
        collect_keys(script, depth.saturating_sub(1), out);
    }
}

/// 额外落盘内层钥匙，使之后的 `bash -lc 'git status'` 能命中 `git status`。
pub(crate) fn extra_persist_keys(labeled_prefix: &str) -> Vec<String> {
    expanded_grant_keys(labeled_prefix)
        .into_iter()
        .filter(|key| key != labeled_prefix && !is_banned_grant_key(key))
        .collect()
}

/// 从已剥过的词列表展开要额外落盘的内层钥匙。
pub(crate) fn extra_persist_keys_from_words(words: &[String]) -> Vec<String> {
    let joined = words.join(" ");
    expanded_grant_keys_from_words(words)
        .into_iter()
        .filter(|key| key != &joined && !is_banned_grant_key(key))
        .collect()
}

/// `words`（已分解、已剥包装的一段）是否被已落盘的 bash 授权覆盖，含内嵌脚本。
pub(crate) fn words_covered_by_grants(words: &[String], state: &PermissionState) -> bool {
    if words.is_empty() {
        return false;
    }
    let keys = expanded_grant_keys_from_words(words);
    let exact_only = head_is_exec_vehicle(words);
    keys.iter().any(|key| {
        if exact_only && key.as_str() == words.join(" ") {
            return state.allowed_bash_commands.contains(key.as_str());
        }
        state
            .allowed_bash_commands
            .iter()
            .any(|grant| word_boundary_prefix(key, grant))
            || state
                .allowed_bash_globs
                .iter()
                .any(|glob| super::policy::bash_pattern_matches_command(glob, key))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peels_bash_lc_to_inner_command() {
        let keys = expanded_grant_keys("bash -lc 'git status'");
        assert!(
            keys.iter().any(|k| k == "git status"),
            "应展开出内层 git status，实际 {keys:?}"
        );
        assert!(keys.iter().all(|k| !is_banned_grant_key(k)));
    }

    #[test]
    fn peels_bin_bash_c() {
        let keys = expanded_grant_keys("/bin/bash -c 'cargo test'");
        assert!(keys.iter().any(|k| k == "cargo test"), "{keys:?}");
    }

    #[test]
    fn wrapper_then_inline_shell() {
        let keys = expanded_grant_keys("env FOO=1 bash -lc 'git status'");
        assert!(keys.iter().any(|k| k == "git status"), "{keys:?}");
    }

    #[test]
    fn bans_bare_shell_grant_keys() {
        assert!(is_banned_grant_key("bash"));
        assert!(is_banned_grant_key("/bin/bash"));
        assert!(is_banned_grant_key("bash -lc"));
        assert!(is_banned_grant_key("pwsh -c"));
        assert!(!is_banned_grant_key("git status"));
    }

    #[test]
    fn grant_on_inner_covers_wrapped_invocation() {
        let mut state = PermissionState::default();
        state.allowed_bash_commands.insert("git status".into());
        let words = vec!["bash".into(), "-lc".into(), "git status".into()];
        assert!(words_covered_by_grants(&words, &state));
    }
}
