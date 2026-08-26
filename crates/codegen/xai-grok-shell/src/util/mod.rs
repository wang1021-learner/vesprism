pub mod config;
pub(crate) mod dual_clock;
pub mod grok_auth_credentials;
pub mod hooks;
pub mod limits;
pub(crate) mod subprocess;
pub(crate) mod text_sanitize;
pub(crate) mod user_identity;

// The foundation utilities live in `xai-grok-shell-base` (upstream of this
// crate so they build in parallel). Re-exported at the original paths so
// existing `crate::util::…` / `xai_grok_shell::util::…` users compile
// unchanged.
pub use xai_grok_shell_base::util::*;

pub(crate) fn is_user_instruction_path(
    path: &std::path::Path,
    grok_home: &std::path::Path,
    vendor_homes: &[(std::path::PathBuf, bool)],
    workspace_roots: &[&std::path::Path],
) -> bool {
    let parent = path.parent();
    let grok_rules = grok_home.join("rules");
    let is_exact_home_surface = parent
        .is_some_and(|parent| parent == grok_home || parent == grok_rules)
        || vendor_homes.iter().any(|(vendor_home, named_enabled)| {
            parent.is_some_and(|parent| {
                (*named_enabled && parent == vendor_home) || parent == vendor_home.join("rules")
            })
        });
    if is_exact_home_surface {
        return true;
    }
    // Both prefixes are workspace because forks mix display-rewritten and on-disk paths.
    if workspace_roots.iter().any(|root| path.starts_with(root)) {
        return false;
    }
    path.starts_with(grok_home)
        || vendor_homes
            .iter()
            .any(|(vendor_home, _)| path.starts_with(vendor_home))
}

/// 持有 `JoinHandle`，在 Drop 时 `abort()`。
///
/// 把派生任务绑到当前异步作用域：父 future 被取消（例如回合中止丢掉工具循环）
/// 时一并拆掉派生任务，避免它在后台继续跑。对已结束的任务 `abort` 是空操作，
/// 正常走完作用域也安全。
pub(crate) struct AbortOnDrop<T = ()>(pub tokio::task::JoinHandle<T>);

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[cfg(test)]
mod abort_on_drop_tests {
    use super::AbortOnDrop;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[tokio::test]
    async fn drop_aborts_unfinished_task() {
        let started = Arc::new(tokio::sync::Notify::new());
        let started_flag = started.clone();
        let finished = Arc::new(AtomicBool::new(false));
        let finished_flag = finished.clone();
        {
            let handle = tokio::spawn(async move {
                started_flag.notify_one();
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                finished_flag.store(true, Ordering::SeqCst);
            });
            let _guard = AbortOnDrop(handle);
            started.notified().await;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!finished.load(Ordering::SeqCst));
    }
}

/// Expand a leading `~` to the home directory; other paths pass through.
pub(crate) fn expand_home(s: &str) -> std::path::PathBuf {
    if let Some(stripped) = s.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    } else if s == "~"
        && let Some(home) = dirs::home_dir()
    {
        return home;
    }
    std::path::PathBuf::from(s)
}

#[cfg(test)]
mod expand_home_tests {
    use super::expand_home;

    #[test]
    fn passthrough_for_absolute_path() {
        assert_eq!(
            expand_home("/abs/path"),
            std::path::PathBuf::from("/abs/path")
        );
    }

    #[test]
    fn passthrough_for_relative_path() {
        assert_eq!(
            expand_home("rel/path"),
            std::path::PathBuf::from("rel/path")
        );
    }

    #[test]
    fn bare_tilde() {
        let home = dirs::home_dir().expect("home_dir required for this test");
        assert_eq!(expand_home("~"), home);
    }

    #[test]
    fn tilde_slash() {
        let home = dirs::home_dir().expect("home_dir required for this test");
        assert_eq!(expand_home("~/foo/bar"), home.join("foo/bar"));
    }

    #[test]
    fn does_not_handle_user_tilde() {
        // `~bob/path` is treated as a literal relative path.
        assert_eq!(
            expand_home("~bob/path"),
            std::path::PathBuf::from("~bob/path")
        );
    }
}

#[cfg(test)]
mod is_user_instruction_path_tests {
    use super::is_user_instruction_path;
    use std::path::Path;

    #[test]
    fn grok_home_named_file_nested_in_workspace_is_user_scoped() {
        assert!(is_user_instruction_path(
            Path::new("/repo/config/AGENTS.md"),
            Path::new("/repo/config"),
            &[],
            &[Path::new("/repo")],
        ));
        assert!(!is_user_instruction_path(
            Path::new("/repo/config/src/AGENTS.md"),
            Path::new("/repo/config"),
            &[],
            &[Path::new("/repo")],
        ));
    }

    #[test]
    fn workspace_descendants_under_grok_home_stay_project_scoped() {
        assert!(!is_user_instruction_path(
            Path::new("/custom/grok/worktrees/repo/src/AGENTS.md"),
            Path::new("/custom/grok"),
            &[],
            &[Path::new("/custom/grok/worktrees/repo")],
        ));
    }
}
