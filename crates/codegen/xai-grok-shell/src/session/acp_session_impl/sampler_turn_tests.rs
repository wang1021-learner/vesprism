use xai_grok_sampling_types::{SearchDateBound, ToolOverrides, WebSearchOptions, XSearchOptions};

use super::{
    CLASSIFIER_REQUEST_TOKEN_RESERVE, classifier_request_fits_context, resolve_configured_cutoff,
};

fn x_cut(to: &str) -> XSearchOptions {
    XSearchOptions {
        date_bound: Some(SearchDateBound::new(None, Some(to.into())).unwrap()),
    }
}

#[test]
fn classifier_request_bound_enforces_its_reserve_with_saturating_arithmetic() {
    let window = 12_000 + CLASSIFIER_REQUEST_TOKEN_RESERVE;
    for (input, context_window, expected) in [
        (12_000, window, true),
        (12_001, window, false),
        (u64::MAX, u64::MAX, false),
    ] {
        assert_eq!(
            classifier_request_fits_context(input, context_window),
            expected
        );
    }
}

#[test]
fn seed_cutoff_is_inherited_without_a_per_turn_update() {
    let seed = ToolOverrides {
        x_search: Some(x_cut("2020-01-01")),
        web_search: None,
        disabled: Vec::new(),
    };
    assert_eq!(resolve_configured_cutoff(Some(seed.clone()), None), seed);
}

#[test]
fn non_empty_base_cutoff_wins_per_tool_and_an_empty_one_reverts_to_the_seed() {
    let seed = ToolOverrides {
        x_search: Some(x_cut("2020-01-01")),
        web_search: Some(WebSearchOptions {
            allowed_domains: Some(vec!["x.com".into()]),
            excluded_domains: None,
        }),
        disabled: Vec::new(),
    };
    let base = ToolOverrides {
        x_search: Some(x_cut("2019-06-01")),
        web_search: Some(WebSearchOptions {
            allowed_domains: Some(vec![]),
            excluded_domains: None,
        }),
        disabled: Vec::new(),
    };
    let got = resolve_configured_cutoff(Some(seed.clone()), Some(&base));
    assert_eq!(got.x_search, Some(x_cut("2019-06-01")));
    assert_eq!(got.web_search, seed.web_search);
}

#[test]
fn inherited_cutoff_agrees_with_the_wire_echo_so_the_two_implementations_cannot_drift() {
    use xai_grok_sampling_types::{HostedTool, apply_tool_overrides};
    let web = WebSearchOptions {
        allowed_domains: Some(vec!["x.com".into()]),
        excluded_domains: None,
    };
    let cases = [
        (
            Some(ToolOverrides {
                x_search: Some(x_cut("2020-01-01")),
                web_search: None,
                disabled: Vec::new(),
            }),
            None,
        ),
        (
            Some(ToolOverrides {
                x_search: Some(x_cut("2020-01-01")),
                web_search: Some(web.clone()),
                disabled: Vec::new(),
            }),
            Some(ToolOverrides {
                x_search: Some(x_cut("2019-06-01")),
                web_search: None,
                disabled: Vec::new(),
            }),
        ),
        (
            None,
            Some(ToolOverrides {
                x_search: Some(x_cut("2018-01-01")),
                web_search: Some(web.clone()),
                disabled: Vec::new(),
            }),
        ),
    ];
    for (seed, base) in cases {
        let mut tools = vec![
            HostedTool::WebSearch { options: None },
            HostedTool::XSearch { options: None },
        ];
        apply_tool_overrides(&mut tools, seed.as_ref());
        let wire_echo = apply_tool_overrides(&mut tools, base.as_ref());
        let inherited = resolve_configured_cutoff(seed.clone(), base.as_ref());
        assert_eq!(wire_echo, inherited, "seed={seed:?} base={base:?}");
    }
}

// jike: 停用集随 cutoff 一起继承（子 agent 继承父会话工具停用）。
#[test]
fn disabled_inherits_with_the_cutoff() {
    let seed = ToolOverrides {
        x_search: None,
        web_search: None,
        disabled: vec!["bash".into()],
    };
    let base = ToolOverrides {
        x_search: None,
        web_search: None,
        disabled: vec!["bash".into(), "search".into()],
    };
    // 非空 base 整体替换 seed。
    assert_eq!(
        resolve_configured_cutoff(Some(seed.clone()), Some(&base)).disabled,
        base.disabled
    );
    // 空 base 回落到 seed。
    assert_eq!(
        resolve_configured_cutoff(Some(seed.clone()), None).disabled,
        seed.disabled
    );
    let empty = ToolOverrides::default();
    assert_eq!(
        resolve_configured_cutoff(Some(seed.clone()), Some(&empty)).disabled,
        seed.disabled
    );
}

// jike: 过滤按官方函数名精确匹配；别名在 grok-session 装配前展开。
#[test]
fn disabled_drops_official_function_names() {
    let disabled = ["run_terminal_command", "web_search"];
    let names = [
        "run_terminal_command",
        "web_search",
        "read_file",
        "search_replace",
    ];
    let kept: Vec<&str> = names
        .into_iter()
        .filter(|n| !disabled.contains(n))
        .collect();
    assert_eq!(kept, vec!["read_file", "search_replace"]);
    assert!(!disabled.contains(&"bash"));
}
