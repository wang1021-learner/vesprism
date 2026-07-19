# `xai-grok-agent`（中文翻译）

> **⚠️ 免责声明**：本文件是对英文原版 `README.md` 的中文翻译，仅供参考。以英文原版 [`README.md`](README.md) 为准。

---

代理构建器、定义解析和系统提示组装。

本 crate 从 `xai-grok-shell` 中提取了一个一等公民的 `Agent` 类型。
`Agent` 将工具、系统提示、系统提醒策略、压缩策略和模型配置捆绑成一个
可由任何宿主使用的单一、可移植对象 — 无论该宿主是
`xai-grok-shell`、其他进程内宿主还是无头批处理运行器。

## 快速入门

### 从定义文件

代理定义是**带有 YAML frontmatter 的 Markdown 文件**，存储在
项目级目录 `.grok/agents/` 或用户级目录 `~/.grok/agents/` 下。

```rust
use xai_grok_agent::{AgentDefinition, AgentBuilder};
use xai_grok_tools::notification::ToolNotificationHandle;

// 1. 解析定义文件
let def = AgentDefinition::from_file(".grok/agents/code-reviewer.md")?;

// 2. 构建代理
let agent = AgentBuilder::new(cwd, None, ToolNotificationHandle::noop())
    .from_definition(def)
    .build()
    .await?;

// 3. 使用
println!("Agent: {}", agent.name());
println!("Prompt: {}", agent.system_prompt());
let tool_defs = agent.tool_definitions().await;
```

### 编程方式（无文件）

```rust
let agent = AgentBuilder::new(cwd, None, ToolNotificationHandle::noop())
    .with_name("my-agent")
    .with_description("A custom agent")
    .with_tools(vec!["read_file".into(), "grep".into()])
    .build()
    .await?;
```

### 发现所有定义

```rust
use xai_grok_agent::discovery;

// 在 .grok/agents/ 目录中查找所有 .md 文件
let definitions = discovery::discover(&cwd);

// 按名称查找特定代理（先检查内置，再查用户目录）
let reviewer = discovery::by_name("code-reviewer");

// 项目级优先查找
let agent = discovery::by_name_in_cwd("my-agent", &cwd);
```

## 代理定义文件格式

代理定义是带有 YAML frontmatter 的 Markdown 文件：

```markdown
---
name: my-agent
description: What this agent does
# ... 其他配置字段
---

System prompt body goes here...
```

**frontmatter**（在 `---` 分隔符之间）是 YAML 配置。
**body**（在关闭 `---` 之后）是系统提示内容。

### 最简示例（扩展基础模板）

```markdown
---
name: code-reviewer
description: Reviews code for quality and security
tools:
  - read_file
  - grep
  - list_dir
permissionMode: plan
---

You are a senior code reviewer. Analyze code and provide
actionable feedback organized by severity.
```

使用 `promptMode: extend`（默认值）时，body 会追加到基础模板中，
其中包含工具调用约定、格式规则和用户信息。作者只需编写与角色相关的内容。

### 完整提示覆盖

```markdown
---
name: custom-agent
description: Agent with full control over the system prompt
promptMode: full
tools:
  - read_file
  - search_replace
  - run_terminal_cmd
---

You are a custom agent.

Use ${{ tools.read_file }} to read files.
Use ${{ tools.search_replace }} to edit files.

${%- if tools.run_terminal_cmd %}
Use ${{ tools.run_terminal_cmd }} for shell commands.
${%- endif %}

<user_info>
OS: ${{ os_name }}
Shell: ${{ shell_path }}
Working Directory: ${{ working_directory }}
Date: ${{ current_date }}
</user_info>
```

使用 `promptMode: full` 时，body 就是完整的系统提示，
通过 MiniJinja 使用自定义 `${{ }}`/`${% %}` 分隔符进行渲染
（以避免与散文中的字面 `{{ }}` 冲突）。

### 带完成要求的模式（编排模式）

```markdown
---
name: orchestrator-worker
description: Worker agent that must signal completion before ending a turn
completionRequirement:
  tool: complete_task
  reminder: >
    You stopped without calling `complete_task`.
    Please continue and call it when done.
  recovery:
    maxRetries: 5
    baseDelayMs: 5000
    maxDelayMs: 60000
toolConfig:
  wait_for_instruction:
    retry:
      maxRetries: 1440
      baseDelayMs: 5000
      maxDelayMs: 30000
---

You are a worker agent in an orchestrated multi-agent workflow.
You MUST call `complete_task` before ending your response.
```

## Frontmatter 模式参考

所有 frontmatter 键使用**驼峰命名**。

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|---|---|---|---|---|
| `name` | `string` | **是** | — | 唯一代理 ID（小写、连字符） |
| `description` | `string` | **是** | — | 何时/为何使用此代理 |
| `promptMode` | `string` | 否 | `"extend"` | `"extend"` 或 `"full"` |
| `tools` | `string[]` | 否 | 继承所有 | 工具白名单。省略 = 所有工具。`[]` = 无 |
| `disallowedTools` | `string[]` | 否 | `[]` | 拒绝名单（优先于 `tools`） |
| `permissionMode` | `string` | 否 | `"default"` | `"default"`、`"acceptEdits"`、`"dontAsk"`、`"plan"` |
| `skills` | `string[]` | 否 | `[]` | 预加载的技能名称 |
| `agentsMd` | `bool` | 否 | `true` | 发现并注入 AGENTS.md 文件 |
| `outputFormat` | `string` | 否 | `"default"` | `"default"` 或 `"concise"` |
| `bash` | `object` | 否 | 默认值 | Bash 工具配置覆盖 |
| `bash.timeoutSecs` | `float` | 否 | `120.0` | Bash 命令超时 |
| `bash.outputByteLimit` | `int` | 否 | `200000` | 最大输出字节 |
| `bash.cmdPrefix` | `string` | 否 | `null` | 命令前缀 |
| `toolNameOverrides` | `map<string,string>` | 否 | `{}` | 规范名 → 模型端名称映射 |
| `paramNameOverrides` | `map<string,map>` | 否 | `{}` | 按工具参数名映射 |
| `completionRequirement` | `object` | 否 | `null` | 回合结束前必须调用的工具 |
| `completionRequirement.tool` | `string` | 是* | — | 规范工具名 |
| `completionRequirement.reminder` | `string` | 是* | — | 未调用时的提醒文本 |
| `completionRequirement.recovery` | `object` | 否 | `null` | 线束的恢复策略 |
| `toolConfig` | `map<string,object>` | 否 | `{}` | 按工具执行配置 |
| `toolConfig.*.retry` | `object` | 否 | `null` | 工具的重试配置 |

*仅在设置 `completionRequirement` 时需填写。

## 提示组装

```
promptMode: extend                     promptMode: full
──────────────────                     ─────────────────
1. 基础模板 (MiniJinja)                  1. Markdown body (MiniJinja, ${{ }}/${% %})
   (工具约定、格式、                     2. AGENTS.md 段（如果 agentsMd: true）
    user_info、后台任务)                3. 技能段
2. Markdown body 追加
3. AGENTS.md 段（如果 agentsMd: true）
4. 技能段
```

### 模板变量（全模式）

| 变量 | 描述 |
|---|---|
| `${{ tools.read_file }}` | `read_file` 解析后的名称（如果禁用则为空） |
| `${{ tools.search_replace }}` | `search_replace` 解析后的名称 |
| `${{ tools.run_terminal_cmd }}` | `run_terminal_cmd` 解析后的名称 |
| `${{ tools.grep }}` | `grep` 解析后的名称 |
| `${{ tools.list_dir }}` | `list_dir` 解析后的名称 |
| `${{ tools.todo_write }}` | `todo_write` 解析后的名称 |
| `${{ tools.skill }}` | `skill` 解析后的名称 |
| `${{ tools.get_task_output }}` | `get_task_output` 解析后的名称 |
| `${{ tools.kill_task }}` | `kill_task` 解析后的名称 |
| `${{ tools.web_search }}` | `web_search` 解析后的名称 |
| `${{ os_name }}` | 操作系统（如 `"macos"`、`"linux"`） |
| `${{ shell_path }}` | Shell 路径（如 `"/bin/zsh"`） |
| `${{ working_directory }}` | 工作区路径 |
| `${{ current_date }}` | 用户本地时区的当前日期（`YYYY-MM-DD`） |

条件语句：`${%- if tools.todo_write %}...${%- endif %}` —
工具被禁用时跳过该块。

## 发现规则

代理定义从多个位置按优先级发现：

1. **项目级**（最高优先级）：`.grok/agents/*.md` — 从 `cwd` 向上遍历到 Git 仓库根目录。文件越靠近 `cwd` 优先级越高。
2. **用户级**：`~/.grok/agents/*.md`
3. **兼容路径**（最低优先级）：用户主目录下的其他供应商代理目录（启用时）
4. **内置**：`default_grok_build()`、`browser_use()`

基于名称的去重确保最高优先级的定义胜出。例如，项目中的 `.grok/agents/code-reviewer.md` 会遮蔽用户级同名定义。

## crate 关系

```
┌──────────────────┐
│  xai-grok-agent  │  ← 本 crate
│  (Agent, Builder, │
│   Definition)     │
└────────┬─────────┘
         │ 依赖
         ▼
┌──────────────────┐
│  xai-grok-tools  │
│  (ToolBridge,    │
│   ToolRegistry,  │
│   ToolState)     │
└────────▲─────────┘
         │ 依赖
┌────────┴─────────�
│  xai-grok-shell  │  使用 AgentBuilder 创建
│  (session host)  │ 会话设置期间的 Agent
└──────────────────┘
```

- **`xai-grok-tools`**：提供 `ToolBridge`、`ToolRegistry`、
  `ToolState`、`SystemReminderLayer` 和工具实现。
  `xai-grok-agent` 依赖它进行工具设置。
- **`xai-grok-shell`**：应用外壳。在会话创建期间使用 `AgentBuilder`
  构建 `Agent`。shell 重新导出 `xai-grok-agent` 的部分模块（AGENTS.md
  发现、技能发现、基础提示渲染）。

## 内置代理

| 名称 | 提示模式 | 描述 |
|---|---|---|
| `grok-build` | extend | 软件工程任务的默认代理 |
| `browser-use` | full | 网页浏览与交互代理 |

## 错误处理

`AgentBuilder::build()` 返回 `Result<Agent, AgentBuildError>`：

| 错误 | 何时发生 |
|---|---|
| `ParseError` | YAML 格式错误、缺少 `---`、类型错误 |
| `MissingField` | 必填字段（`name`/`description`）缺失 |
| `UnknownToolOverride` | `toolNameOverrides` 引用了不存在的工具 |
| `IoError` | AGENTS.md/技能发现期间的读取错误 |
| `MiniJinjaError` | 模板渲染失败 |

未知 frontmatter 字段会被**静默忽略**以保持向前兼容性 —
为新版本编写的旧版本也能工作。

## 开发

```bash
# 检查
cargo check -p xai-grok-agent

# 测试
cargo test -p xai-grok-agent

# Clippy
cargo clippy -p xai-grok-agent --fix --allow-dirty

# 格式化
cargo fmt --all
```
