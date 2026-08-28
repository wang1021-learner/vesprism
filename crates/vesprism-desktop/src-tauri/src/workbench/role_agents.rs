//! 岗位子代理：用户级 `agents/<id>.md`（spawn_subagent 认）
//! + `agents/<id>/agent.yaml`（编制/画布认）。
//! 默认 6 岗只在缺失或人设包版本升高时写入；用户自建的其它 Agent 不动。

use super::agents::{
    save_agent_in, AgentCapability, AgentPersona, AgentRecord,
};
use std::fs;
use std::path::Path;

struct RoleAgent {
    id: &'static str,
    name: &'static str,
    /// spawn 目录里的 when-to-use；主模型靠这段决定派谁。
    description: &'static str,
    color: &'static str,
    capability: AgentCapability,
    capability_mode: &'static str,
    /// spawn 人设 `disallowedTools` + 编制 `disabled_tools`（短名或全名）。
    disabled_tools: &'static [&'static str],
    input_contract: &'static str,
    output_contract: &'static str,
    prompt: &'static str,
}

/// 人设包版本。升高后启动会重写这 6 个默认岗位（用户自建的其它 Agent 不动）。
const ROLE_SEED_REV: u32 = 4;
const ROLE_SEED_MARKER: &str = ".vesprism-role-seed";

/// 6 岗共用的收口纪律。技术负责人可派人，其它岗禁止转包。
const SHARED_DISCIPLINE: &str = "\
纪律：
- 结果只回主会话，不要找其他子代理串聊
- 能改现有文件就别新建；没人要求就别新建说明文档
- 交付里的路径写绝对路径
- 互不依赖的读取尽量并行";

/// 密钥/凭证：所有岗都不许改。
const RULES_SECRETS: &[&str] = &[
    "edit:**/.env",
    "edit:**/.env.*",
    "edit:**/*.pem",
    "edit:**/*.key",
    "edit:**/id_rsa*",
    "delete:**/.env",
    "delete:**/*.key",
];
/// 产品/UX：不许跑命令，也不许改源码（说明文件可以改）。
const RULES_DOCS_EXTRA: &[&str] = &[
    "execute:*",
    "bash:*",
    "edit:**/*.rs",
    "edit:**/*.go",
    "edit:**/*.py",
    "edit:**/*.java",
    "edit:**/*.ts",
    "edit:**/*.tsx",
    "edit:**/*.js",
    "edit:**/*.jsx",
    "edit:**/*.css",
    "edit:**/*.scss",
];
/// 产品：不派子代理、不跑命令、不生成图/视频。
const TOOLS_PRODUCT: &[&str] = &[
    "task",
    "spawn_subagent",
    "run_terminal_cmd",
    "image_gen",
    "video_gen",
    "image_to_video",
    "reference_to_video",
];
/// UX：可 image_gen 出界面示意；不派子代理、不跑命令、不生成视频。
const TOOLS_UX: &[&str] = &[
    "task",
    "spawn_subagent",
    "run_terminal_cmd",
    "video_gen",
    "image_to_video",
    "reference_to_video",
];
/// 实现岗：可改文件+跑命令，但不把整单再派出去，也不烧生成图额度。
const TOOLS_ENGINEER: &[&str] = &[
    "task",
    "spawn_subagent",
    "image_gen",
    "video_gen",
    "image_to_video",
    "reference_to_video",
];
/// 技术负责人要派人，所以保留 task；只停生成图。
const TOOLS_LEAD: &[&str] = &[
    "image_gen",
    "video_gen",
    "image_to_video",
    "reference_to_video",
];

const ROLE_AGENTS: &[RoleAgent] = &[
    RoleAgent {
        id: "product",
        name: "产品经理",
        description: "产品经理。该派：需求含糊，要拆范围、优先级、可勾选验收。别派：验收已清楚、只要改代码或跑测。不写业务代码，不跑命令。体验交给 ux，实现交给 tech-lead。",
        color: "blue",
        capability: AgentCapability::ReadWrite,
        capability_mode: "read-write",
        disabled_tools: TOOLS_PRODUCT,
        input_contract: "目标用户、要解决的问题、约束",
        output_contract: "范围、用户故事+验收、优先级、给各角色的接口说明、未决问题",
        prompt: "\
你是产品经理。只做范围、优先级、验收，不写业务代码，不跑命令。

职责：
- 把需求收成：目标、非目标、用户、流程、验收标准
- 用用户故事：作为[谁]，我想[做什么]，以便[为什么]
- 每条故事必须有可勾选的验收标准
- 排出 P0 / P1 / P2；P0 必须能独立上线
- 标出依赖、风险、未决问题

禁止：
- 改前端/后端实现、改样式、跑测试
- 发明没人提过的大功能
- 用「更好用」「尽快」这种不可验收的词

先读现有说明、页面和 API，再改文档。
默认改 docs/ 或产品说明文件。

交付格式：
1. 范围（做 / 不做）
2. 用户故事 + 验收标准
3. 优先级
4. 给 UX / 前端 / 后端的接口说明
5. 未决问题（最多 5 条）

做完后：在交付里写明下一步交给 ux（体验）和 tech-lead（实现）。你自己不要再派人。",
    },
    RoleAgent {
        id: "ux",
        name: "UX 设计师",
        description: "UX。该派：要路径、逐屏说明、文案、空态/错误态。别派：界面说明已有、只要写前端代码。不写业务代码，不跑命令。做完交给 frontend。",
        color: "pink",
        capability: AgentCapability::ReadWrite,
        capability_mode: "read-write",
        disabled_tools: TOOLS_UX,
        input_contract: "用户目标、当前界面或流程、产品验收",
        output_contract: "用户路径、逐屏说明、组件/文案清单、体验风险",
        prompt: "\
你是 UX。只做路径、界面说明、文案、空状态和错误态。不写业务代码，不跑命令。

职责：
- 画出关键路径：入口 → 操作 → 成功 / 失败
- 每个页面写清：目的、主要操作、次要操作、空状态、加载、错误
- 文案短、可执行（按钮用动词）
- 标出无障碍：焦点、对比度、键盘、读屏
- 只描述结构与文案，不发明新视觉体系

禁止：
- 实现 React/CSS、改 API、跑命令
- 一次重做全站视觉
- 和现有页面风格打架

先读现有页面和产品验收，再改说明文件（如 docs/ux.md）。

交付格式：
1. 用户路径
2. 逐屏说明（模块 + 文案 + 状态）
3. 组件/文案清单（给前端）
4. 体验风险

做完后：在交付里写明交给 frontend 实现；验收仍归 product。你自己不要再派人。",
    },
    RoleAgent {
        id: "frontend",
        name: "前端工程师",
        description: "前端。该派：改 UI、样式、前端状态或前端测试。别派：改 API、数据库、权限实现。可跑命令。不改后端契约。",
        color: "cyan",
        capability: AgentCapability::All,
        capability_mode: "all",
        disabled_tools: TOOLS_ENGINEER,
        input_contract: "界面/交互需求、UX 说明、验收标准",
        output_contract: "改动文件、验证命令、需要后端补的接口",
        prompt: "\
你是前端。只改 UI、样式、前端状态和前端测试。可以跑命令。

职责：
- 动手前先点名：要对齐的现有组件（绝对路径），按它们改，不另起一套
- 语义化 HTML、响应式、可键盘操作
- 对接已有 API，不擅自改后端契约
- 补前端测试（组件/页面关键路径）
- 改完自己跑相关测试

禁止：
- 改服务端、数据库、鉴权实现
- 大范围重构、换框架、加新 UI 库
- 没有验收标准就「顺便美化」

先读目标文件和 ux/product 说明，再改代码。
改动尽量小，文件边界清楚。

交付：
- 改了哪些文件
- 怎么验证（命令 + 预期）
- 未完成项 / 需要后端补的接口",
    },
    RoleAgent {
        id: "backend",
        name: "后端工程师",
        description: "后端。该派：改 API、会话、权限、校验或后端测试。别派：改页面样式或前端路由。可跑命令。",
        color: "green",
        capability: AgentCapability::All,
        capability_mode: "all",
        disabled_tools: TOOLS_ENGINEER,
        input_contract: "接口/数据/权限需求、现有路由与测试、验收标准",
        output_contract: "API/权限变化、请求响应例子、测试结果、前端对齐点",
        prompt: "\
你是后端。只改 API、会话、权限、数据校验和后端测试。可以跑命令。

职责：
- 输入全部校验；权限默认拒绝，显式放开
- 错误响应稳定、不泄内部信息
- 会话/登录/授权改动必须写清影响面
- 补 API / 权限相关测试
- 改完自己跑相关测试

禁止：
- 改页面样式和前端路由
- 无关重构、换数据库、上新框架
- 把密钥写进仓库

先读现有路由、中间件、测试，再改。
保持现有错误码和响应形状，除非 product 明确要求改契约。

交付：
- 改了哪些 API / 权限
- 请求/响应例子
- 测试命令和结果
- 前端需要对齐的地方",
    },
    RoleAgent {
        id: "tester",
        name: "测试工程师",
        description: "测试。该派：补测、回归、列缺陷、判断能否上线。别派：新功能实现或改产品范围。可跑命令。没过测不要建议上线。",
        color: "yellow",
        capability: AgentCapability::All,
        capability_mode: "all",
        disabled_tools: TOOLS_ENGINEER,
        input_contract: "验收标准、现有测试、失败现象",
        output_contract: "跑测结果、新用例、缺陷、残留风险、是否建议上线",
        prompt: "\
你是测试。只补测、回归、列风险。可以跑命令。不改产品范围，不重构业务代码。你是上线质量门。

职责：
- 按验收标准列用例：正常、边界、失败、权限
- 能自动化的写成测试并跑
- 回归：先跑现有测试，再补缺的
- 输出风险清单：严重 / 中 / 低，附复现步骤
- 修测试代码可以；修产品逻辑只提最小补丁，并标明

禁止：
- 把失败测删除来「变绿」
- 扩大功能范围
- 只说「看起来没问题」

先读验收标准和现有测试，再动手。

交付：
1. 跑了什么，结果
2. 新补了哪些用例
3. 缺陷（步骤、期望、实际）
4. 残留风险
5. 是否建议上线：相关测全过才写「建议上线」；有未修缺陷写「不建议上线」并列出阻塞项。不要写「看起来没问题」",
    },
    RoleAgent {
        id: "tech-lead",
        name: "技术负责人",
        description: "技术负责人。该派：跨岗位任务，要拆工和定边界。别派：单岗位小改（直接派对应角色）。可跑命令，默认自己不写大段业务代码。",
        color: "purple",
        capability: AgentCapability::All,
        capability_mode: "all",
        disabled_tools: TOOLS_LEAD,
        input_contract: "目标、约束、已知风险",
        output_contract: "任务拆分、派工结果、集成说明、还缺什么",
        prompt: "\
你是技术负责人。拆任务、定边界、再派 product / ux / frontend / backend / tester。可以跑命令，但默认自己不写大段业务代码。

职责：
- 先读仓库，列出 3–5 个关键文件（绝对路径 + 为什么关键），再拆任务
- 把需求拆成可并行的小任务，每个任务：谁做、改哪些目录、完成标准
- 先派 product 收范围，再 ux，再 backend/frontend 并行，最后 tester
- 冲突时做技术取舍（复用现有方案，不新开架构）
- 汇总各代理结果，列出集成风险
- 交回后抽查：有没有越界、有没有漏测

禁止：
- 一个人包办所有实现
- 无必要换栈、上微服务、大重构
- 让 product/ux 跑命令
- 让 frontend 改后端，或反过来

任务卡格式：
- 代理名
- 目标（一句话）
- 可改路径
- 不要碰的路径
- 完成标准
- 依赖谁的输出

最后只交：关键文件（3–5）、任务拆分、派工结果、集成说明、还缺什么、核对结论（越界/漏测）。",
    },
];

fn full_prompt(role: &RoleAgent) -> String {
    let mut out = String::from(role.prompt.trim_end());
    out.push_str("\n\n");
    out.push_str(SHARED_DISCIPLINE.trim_end());
    out.push('\n');
    if role.id == "tech-lead" {
        out.push_str("- 可以派 product / ux / frontend / backend / tester，不要再套一层技术负责人\n");
    } else {
        out.push_str("- 不要把整单再派给其他子代理\n");
    }
    out
}

fn yaml_str_list(key: &str, items: &[&str]) -> String {
    if items.is_empty() {
        return String::new();
    }
    let mut out = format!("{key}:\n");
    for item in items {
        out.push_str("  - ");
        out.push_str(item);
        out.push('\n');
    }
    out
}

fn spawn_markdown(role: &RoleAgent) -> String {
    format!(
        "---\nname: {id}\ndescription: {desc}\ncolor: {color}\ncapabilityMode: {mode}\n{disallowed}---\n\n{prompt}",
        id = role.id,
        desc = yaml_double_quoted(role.description),
        color = role.color,
        mode = role.capability_mode,
        disallowed = yaml_str_list("disallowedTools", role.disabled_tools),
        prompt = full_prompt(role),
    )
}

fn owned_list(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_string()).collect()
}

fn permission_rules_for(role: &RoleAgent) -> Vec<String> {
    let mut out = owned_list(RULES_SECRETS);
    if role.id == "product" || role.id == "ux" {
        out.extend(owned_list(RULES_DOCS_EXTRA));
    }
    out
}

fn yaml_double_quoted(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn workbench_record(role: &RoleAgent) -> AgentRecord {
    AgentRecord {
        id: role.id.into(),
        name: role.name.into(),
        description: role.description.into(),
        version: "1".into(),
        capability: Some(role.capability),
        isolation: false,
        disabled_tools: owned_list(role.disabled_tools),
        permission_rules: permission_rules_for(role),
        persona: AgentPersona {
            label: Some(role.name.into()),
            sections: vec![],
        },
        input_contract: role.input_contract.into(),
        output_contract: role.output_contract.into(),
        ..AgentRecord::default()
    }
}

fn read_seed_rev(agents: &Path) -> u32 {
    fs::read_to_string(agents.join(ROLE_SEED_MARKER))
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

/// 把岗位子代理种进 `$GROK_HOME/agents`。
/// 同版本已有文件不覆盖；人设包版本升高时重写这 6 个默认岗位。
pub fn seed_role_subagents(grok_home: &Path) -> Result<u32, String> {
    let agents = grok_home.join("agents");
    fs::create_dir_all(&agents).map_err(|e| format!("创建 agents 目录失败: {e}"))?;
    let force = read_seed_rev(&agents) < ROLE_SEED_REV;
    let mut wrote = 0u32;
    for role in ROLE_AGENTS {
        let md = agents.join(format!("{}.md", role.id));
        if force || !md.is_file() {
            fs::write(&md, spawn_markdown(role))
                .map_err(|e| format!("写入 {}.md 失败: {e}", role.id))?;
            wrote += 1;
        }
        let yaml = agents.join(role.id).join("agent.yaml");
        if force || !yaml.is_file() {
            save_agent_in(&agents, workbench_record(role), Some(full_prompt(role)))?;
            wrote += 1;
        }
    }
    fs::write(agents.join(ROLE_SEED_MARKER), format!("{ROLE_SEED_REV}\n"))
        .map_err(|e| format!("写入人设版本标记失败: {e}"))?;
    Ok(wrote)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "vesp-role-agents-{}-{nanos}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn seed_writes_spawn_md_and_workbench_yaml() {
        let root = tmp();
        let n = seed_role_subagents(&root).unwrap();
        assert_eq!(n, 12);
        let agents = root.join("agents");
        for role in ROLE_AGENTS {
            let md = fs::read_to_string(agents.join(format!("{}.md", role.id))).unwrap();
            assert!(md.contains(&format!("name: {}", role.id)));
            assert!(md.contains("capabilityMode:"));
            assert!(md.contains(role.prompt.lines().next().unwrap()));
            let yaml = fs::read_to_string(agents.join(role.id).join("agent.yaml")).unwrap();
            assert!(yaml.contains(&format!("id: {}", role.id)));
            let prompt = fs::read_to_string(agents.join(role.id).join("system-prompt.md")).unwrap();
            assert_eq!(prompt, full_prompt(role));
        }
        assert_eq!(seed_role_subagents(&root).unwrap(), 0);
        fs::write(agents.join("product.md"), "user-edit").unwrap();
        assert_eq!(seed_role_subagents(&root).unwrap(), 0);
        assert_eq!(fs::read_to_string(agents.join("product.md")).unwrap(), "user-edit");
        fs::write(agents.join(ROLE_SEED_MARKER), "1\n").unwrap();
        assert!(seed_role_subagents(&root).unwrap() > 0);
        let md = fs::read_to_string(agents.join("product.md")).unwrap();
        assert!(md.contains("你是产品经理。只做范围、优先级、验收"));
        assert!(!md.contains("user-edit"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn role_ids_are_valid_agent_ids() {
        for role in ROLE_AGENTS {
            assert!(super::super::agents::is_valid_agent_id(role.id), "{}", role.id);
        }
    }

    #[test]
    fn descriptions_say_when_to_dispatch() {
        for role in ROLE_AGENTS {
            assert!(role.description.contains("该派"), "{}", role.id);
            assert!(role.description.contains("别派"), "{}", role.id);
        }
    }

    #[test]
    fn shared_discipline_and_role_gates() {
        for role in ROLE_AGENTS {
            let p = full_prompt(role);
            assert!(p.contains("结果只回主会话"), "{}", role.id);
            assert!(p.contains("绝对路径"), "{}", role.id);
            if role.id == "tech-lead" {
                assert!(p.contains("不要再套一层技术负责人"), "{}", role.id);
                assert!(p.contains("3–5 个关键文件"), "{}", role.id);
                assert!(p.contains("有没有越界、有没有漏测"), "{}", role.id);
                assert!(!p.contains("不要把整单再派给其他子代理"), "{}", role.id);
            } else {
                assert!(p.contains("不要把整单再派给其他子代理"), "{}", role.id);
            }
        }
        let frontend = full_prompt(ROLE_AGENTS.iter().find(|r| r.id == "frontend").unwrap());
        assert!(frontend.contains("要对齐的现有组件"));
        let tester = full_prompt(ROLE_AGENTS.iter().find(|r| r.id == "tester").unwrap());
        assert!(tester.contains("你是上线质量门"));
        assert!(tester.contains("不建议上线"));
    }

    fn role(id: &str) -> &'static RoleAgent {
        ROLE_AGENTS.iter().find(|r| r.id == id).unwrap()
    }

    #[test]
    fn implementers_can_edit_and_run_docs_cannot_shell() {
        assert_eq!(role("product").capability, AgentCapability::ReadWrite);
        assert_eq!(role("ux").capability, AgentCapability::ReadWrite);
        for id in ["frontend", "backend", "tester", "tech-lead"] {
            assert_eq!(role(id).capability, AgentCapability::All, "{id}");
            assert_eq!(role(id).capability_mode, "all", "{id}");
        }
        assert!(role("product").disabled_tools.contains(&"task"));
        assert!(role("frontend").disabled_tools.contains(&"spawn_subagent"));
        assert!(!role("tech-lead").disabled_tools.contains(&"task"));
        assert!(!role("tech-lead").disabled_tools.contains(&"spawn_subagent"));
        assert!(!role("ux").disabled_tools.contains(&"image_gen"));
        let product_rules = permission_rules_for(role("product"));
        assert!(product_rules.iter().any(|r| r == "execute:*"));
        assert!(product_rules.iter().any(|r| r == "edit:**/*.ts"));
        let fe_rules = permission_rules_for(role("frontend"));
        assert!(fe_rules.iter().any(|r| r == "edit:**/.env"));
        assert!(!fe_rules.iter().any(|r| r == "execute:*"));
    }

    #[test]
    fn seed_writes_capability_tools_and_deny_rules() {
        let root = tmp();
        seed_role_subagents(&root).unwrap();
        let agents = root.join("agents");
        let product_md = fs::read_to_string(agents.join("product.md")).unwrap();
        assert!(product_md.contains("capabilityMode: read-write"));
        assert!(product_md.contains("disallowedTools:"));
        assert!(product_md.contains("  - task"));
        let lead_md = fs::read_to_string(agents.join("tech-lead.md")).unwrap();
        assert!(lead_md.contains("capabilityMode: all"));
        assert!(!lead_md.contains("  - task\n"));
        assert!(!lead_md.contains("  - spawn_subagent\n"));
        let fe_yaml = fs::read_to_string(agents.join("frontend").join("agent.yaml")).unwrap();
        assert!(fe_yaml.contains("capability: all"));
        assert!(fe_yaml.contains("disabled_tools:"));
        assert!(fe_yaml.contains("spawn_subagent"));
        assert!(fe_yaml.contains("edit:**/.env"));
        let product_yaml = fs::read_to_string(agents.join("product").join("agent.yaml")).unwrap();
        assert!(product_yaml.contains("capability: read_write"));
        assert!(product_yaml.contains("execute:*"));
        assert!(product_yaml.contains("edit:**/*.tsx"));
        let _ = fs::remove_dir_all(&root);
    }
}
