# Grok Build 桌面化改造 · 笔记第八天

> 日期：2026-07-26  
> 范围：外部项目对照与文档沉淀、白色主题重设计、New chat 静默体验、多厂商模型字段 GUI 对齐、推理强度（settings 勾选 + Composer 滑条）。  
> 代码主目录：`crates/jike-grok-desktop/`、`crates/grok-session/`  
> 关联文档：  
> - `Grok桌面客户端 功能大纲.md`（代码对照更新）  
> - `桌面端-外部参考与待办对照.md`  
> - `docs/桌面端-UI主题设计说明.md`  
> - `docs/桌面端-模型字段对照清单.md`

---

## 1. 本日目标与结论

| 主题 | 目标 | 结果 |
|------|------|------|
| 外部对照 | 看 Pi / OpenWorker，明确能学什么 | 完成；**与产品引擎无关**，仅交互/安全灵感 |
| 功能大纲 | 按现码核对大纲 | 完成代码对照更新 |
| 文档沉淀 | 外部参考、UI、模型字段三份 md | 完成 |
| UI 主题 | 白为主、去橙色、中性灰 | 完成（`App.css` 全面改 token） |
| New chat UX | 不提示「创建/启动会话」、静默重建 | 完成 |
| 模型 GUI | 对齐官方 `ModelEntryConfig` 子集（除全局 `[models]` 采样默认） | 完成 |
| 名称语义 | UI「模型名称」= API model id；隐藏内部 `m-xxx` | 完成 |
| 推理强度 | 设置页仅勾选「支持推理」；会话侧滑动调档 | 完成 |

**总评：** 从「能配几个模型」推进到「多厂商字段可配 + 推理档位可热切」；产品交互向 Claude Code / Codex 靠拢；配色定调白 + 中性灰。

---

## 2. 外部项目对照（调研，非合入）

### 2.1 背景

本地分析 clone（**与业务仓库无关**，仅调研）：

| 目录 | 项目 |
|------|------|
| `D:\grokbuild\pi-analysis` | [earendil-works/pi](https://github.com/earendil-works/pi) 终端 coding agent |
| `D:\grokbuild\openworker-analysis` | [andrewyng/openworker](https://github.com/andrewyng/openworker) Tauri 桌面 AI 同事 |

用户明确：**跟我们项目没有关系**，不要把外部栈当实现路径。

### 2.2 结论（写进 `桌面端-外部参考与待办对照.md`）

| 可参考 | 明确不做 |
|--------|----------|
| 密钥进系统密钥环、审批文案、工具结果可读性 | 换 TS 引擎 / Pi runtime |
| Pi Skills 的「可发现」、会话分支产品语义 | OpenWorker 25+ SaaS 连接器 |
| 长会话虚拟列表（二期） | 为对标堆主题/商店/i18n |

**原则不变：** 引擎继续用官方 `xai-grok-shell` 库内嵌 + ACP；只把官方已有能力接到 GUI。

---

## 3. 文档更新清单

| 文档 | 内容 |
|------|------|
| `Grok桌面客户端 功能大纲.md` | 2026-07-26 对照现码：CWD 持久化、模型热切、token 用量、跨工作区侧栏等标 ✅ |
| `桌面端-外部参考与待办对照.md` | Pi/OpenWorker 对照 + 可参考/不做 + 待办分层 |
| `docs/桌面端-UI主题设计说明.md` | 白底中性 token（后续实现已去橙，以代码为准） |
| `docs/桌面端-模型字段对照清单.md` | 官方字段 vs 桌面 UI/读写对照 |

---

## 4. UI 主题：白色为主、去橙色

### 4.1 需求演进

1. 初版参考 Pi 暖橙用户气泡 / 橙焦点。  
2. 用户反馈：**配色太丑，白色为主**。  
3. 进一步：**不要纯黑 focus 环、不要橙色强调**（侧栏选中、气泡、按钮均中性）。

### 4.2 实现要点

| 文件 | 改动 |
|------|------|
| `src/App.css` | `:root` 全面中性：canvas `#f5f5f5`、surface 白、文字灰阶、CTA 深炭、无橙 accent |
| `src/components/BrandLogo.tsx` | 品牌标重做，适配浅色 |
| `public/favicon.svg` / `index.html` | 轻量品牌资源同步 |

**用户气泡：** 浅灰底 + 浅灰边，非橙渐变。  
**Focus / 选中：** 中性灰 hover / 浅灰底，无橙条、无橙 ring。

### 4.3 备份

- `src/App.css.bak-before-theme`：主题大改前备份（未跟踪亦可）。

---

## 5. New chat / 启动会话 UX

### 5.1 问题

- 界面出现「请先启动会话」「创建对话中」等，像后台状态泄漏。  
- Header 有「启动会话」按钮，与侧栏 **New chat** 双入口、语义重复。

### 5.2 目标

- 用户只感知 **New chat**；重建过程**静默**。  
- 输入框 placeholder 固定为「输入消息…」，不因 starting 改文案。  
- Header **不**再展示启动会话。

### 5.3 实现要点

| 文件 | 改动 |
|------|------|
| `Header/index.tsx` | 去掉启动会话按钮；只保留标题/侧栏折叠等 |
| `Composer/index.tsx` | `starting` 仅内部用（`_starting`）；placeholder 恒定 |
| `App.tsx` | New chat / 工作区切换时静默 `restart`；去掉误导性 banner 文案 |

**结果：** 新建对话 = 清屏 + 后台重建会话，无「创建中」打扰。

---

## 6. 模型体系改动（详述）

> 本日模型相关是改动最重的一块：从「精简几项表单」扩到 **官方 per-model 可配子集的 GUI 对齐**，并补上 **会话级推理强度热切**。  
> 更细的字段对照表见 `docs/桌面端-模型字段对照清单.md`（若与本文冲突，以代码为准）。

### 6.1 改之前 vs 改之后

| 维度 | 第七天及更早 | 第八天（今日） |
|------|--------------|----------------|
| 设置页可见字段 | model / base_url / context_window(K) / API Key 等精简项 | 连接 + 推理开关 + 密钥 + **高级折叠**一整套 |
| 多厂商 | 只能靠手写 toml（`api_backend` / `extra_headers`） | **GUI 可配**，保存写入 `config.toml` |
| 名称 | 曾有「显示名」与 API id 分叉讨论 | **只保留「模型名称」= API model id** |
| 内部 id | 已自动生成 `m-…` | 继续隐藏，列表/下拉**从不展示** `m-xxx` |
| 推理 | 几乎无桌面能力 | 配置写 `supports_reasoning_effort` + `reasoning_effort` + `reasoning_efforts`；会话用滑条热切 |
| 保存后 | reload + 切默认模型 | 同上；切模型/推理会带 `reasoningEffort` meta |
| 全局 `[models]` 采样默认 | 无 UI | **仍无 UI**（本期明确不做） |

**核心结论：** 引擎（`ModelEntryConfig`）本来就能多厂商 + 推理；缺的是桌面读写与交互。今日把 **per-model 用户可配子集** 接到 GUI，而不是重写引擎。

### 6.2 三层数据模型（必须分清）

用户眼里只有「模型名称」，实现里有三层 id：

| 层 | 字段 / 概念 | 示例 | 谁看见 |
|----|-------------|------|--------|
| **配置段主键** | `[model.<id>]` 的 `id` | `m-a1b2c3d4e5f6` | 仅磁盘/内部；UI **不展示、不可改** |
| **API 模型 id** | 官方 `model`；UI 标签 **「模型名称」** | `deepseek-chat`、`claude-sonnet-4-6` | 用户填写；列表、Composer 下拉主文案 |
| **展示名** | 官方 `name` | 与 `model` **强制相同** | 无独立输入框；保存时 `name = model` |

补充：

- **env_key**：自动生成（如按 id 派生），用户不填；密钥写 `$GROK_HOME/.env`，**不写** `config.toml` 的 `api_key`。  
- **system_prompt_label**：保存时 `autoSystemPromptLabel(model)` 自动生成，**无自由编辑 GUI**（明确不做）。  
- **默认模型**：`[models].default` = 当前设置页选中的那条 `id`（内部 id）。

#### 6.2.1 命名强制规则（保存路径）

`App.tsx` → `saveSettings` 规范化：

```text
model   = trim(用户「模型名称」)
name    = model          // 强制同步，禁止双名字
id      = 原内部 id      // 草稿新建时已生成 m-…
env_key = resolveEnvKey  // 空则自动
system_prompt_label = autoSystemPromptLabel(model)
```

`commands.rs` → `upsert_model_entry` 再次写入：

```text
entry_tbl["model"] = model_id
entry_tbl["name"]  = model_id   // 避免旧 name 残留
```

#### 6.2.2 新建模型草稿（`startAddModel`）

| 项 | 行为 |
|----|------|
| id | `m-` + 随机 hex（`crypto.randomUUID` 截断等），保证 `validate_model_id` 合法 |
| 继承 | 从当前选中/首条模板抄 `base_url`、`api_backend`、`agent_type` |
| 默认 | `supports_reasoning_effort=false`，`reasoning_effort='medium'`（仅勾选后才写盘） |
| 采样类 | temperature/top_p/… 一律 `0` 或空，表示「不写配置、用引擎默认」 |
| 草稿标记 | 进入 `draftModelIds`；未保存可「放弃」从内存删掉 |

### 6.3 设置页信息架构

```
设置 → 模型 tab
├── 左侧：模型列表（标题 = model 或占位；副标题可带 api_backend）
│         [ + 新增 ]  [ 删除 ]（至少保留 1 条）
└── 右侧表单（按 section）
    ├── 连接
    │     模型名称 / Base URL / API 协议卡片
    │     上下文窗口 (K) / 描述
    ├── 推理
    │     ☑ 此模型支持推理 / 思考   ← 仅能力声明
    ├── 密钥
    │     未配置：粘贴 API Key → 写 .env
    │     已配置：只读「已配置 · 变量名」
    └── 高级选项（折叠）
          采样 / 超时重试 / 流式工具 / 压缩阈值
          agent_type / use_concise
          extra_headers（多行 Header: value）
          可见性 / 懒惰检测 / 压缩相关头
```

标签规范：**中文说明 + 括号英文键名**（如 `温度 (temperature)`），方便对照官方 toml。

### 6.4 字段全表（UI → 类型 → TOML）

#### 6.4.1 连接区（常显）

| UI 标签 | `ModelEntry` / DTO | 写入 toml | 校验 / 语义 |
|---------|-------------------|-----------|-------------|
| 模型名称 | `model`（同步 `name`） | `model` + `name` | 必填；trim 后非空 |
| Base URL | `base_url` | `base_url` | 必填；OpenAI 兼容常带 `/v1` |
| API 协议 | `api_backend` | `api_backend` | 三选一，见下 |
| 上下文窗口 (K) | `context_window`（token 数） | `context_window` | **必填**；UI 用 K，存盘用 `K*1000` |
| 描述 | `description` | `description`（空则删键） | 可选 |

**API 协议三选一卡片**（`API_BACKENDS`）：

| 值 | 典型用途 |
|----|----------|
| `chat_completions` | OpenAI 兼容 / DeepSeek / 多数中转（默认） |
| `responses` | OpenAI Responses API 形态 |
| `messages` | Anthropic Messages（Claude 等） |

保存前校验：`api_backend ∈ {chat_completions, responses, messages}`。  
Rust 侧 `normalize_api_backend` 同样约束。

#### 6.4.2 推理区（常显，仅开关）

| UI | 字段 | 写盘行为 |
|----|------|----------|
| ☑ 此模型支持推理 / 思考 | `supports_reasoning_effort` | `true` 时写入；`false` 时 **删除** 相关键 |
| （无档位 UI） | `reasoning_effort` | 勾选时默认 **`medium`** 写入；取消勾选清空 |
| （无 UI） | `reasoning_efforts` | 勾选时自动写标准数组六档（见 §7） |

产品语义：**设置页只声明「能不能推」**；「推多狠」在 Composer 滑条改（会话级，走 ACP meta）。

#### 6.4.3 密钥区

| 行为 | 说明 |
|------|------|
| 存储位置 | `$GROK_HOME/.env`，键名 = `env_key` |
| config.toml | **不写** `api_key` 明文 |
| 已配置 | 展示 `is_set` + 变量名，**不回显**明文 |
| 未配置 | password 输入 + 显示/隐藏；点总保存时 `save_env_key` |

#### 6.4.4 高级区（折叠）

**「0 / 空 / null = 不写盘」约定：** 与官方「省略 = 用默认」一致，避免用 0 覆盖引擎默认。

| UI 标签 | 字段 | 写盘规则 |
|---------|------|----------|
| 温度 (temperature) | `temperature: f64` | `>0` 写入 Float；否则 `remove` |
| 核采样 (top_p) | `top_p` | 同上 |
| 最大生成长度 | `max_completion_tokens` | `>0` 写 Integer；否则 remove |
| API 专用地址 | `api_base_url` | 非空写 String；空 remove（与 base_url 可分离的企业场景） |
| 最大重试次数 | `max_retries` | `>0` 写；否则 remove |
| 流式空闲超时秒 | `inference_idle_timeout_secs` | `>0` 写；否则 remove（占位提示默认约 300） |
| 流式工具调用 | `stream_tool_calls: boolean \| null` | `null`=不写；`Some(true/false)` 写 Bool |
| 自动压缩阈值 % | `auto_compact_threshold_percent` | `1–100` 写；`0` remove（占位约 85） |
| 智能体类型 | `agent_type` | 默认 `grok-build` |
| 简洁模式 | `use_concise` | 仅 `true` 写入；false remove |
| 额外请求头 | `extra_headers` | 多行 `Header-Name: value` → Table；全空 remove |
| 隐藏模型 | `hidden` | 仅 true 写入 |
| API Key 用户可见 | `supported_in_api` | 默认 true **省略**；false 才写 `false` |
| 懒惰检测·启用 | `laziness_enabled` | 与 max_nudges 合成子表 `laziness_detector` |
| 每会话最大提醒 | `laziness_max_nudges` | → `laziness_detector.max_nudges_per_session` |
| 剩余压缩次数 | `compactions_remaining` | `""` / `dynamic` / `off` / 数字字符串（`write_tri_mode`） |
| 压缩触发 Token | `compaction_at_tokens` | 同上；UI 支持选「固定 token 数」再填数字 |

**extra_headers 编辑：**

- 前端 `headersToText` / `textToHeaders`；  
- 编辑中用 `headersDraft` 避免受控框光标跳动；  
- 用途示例：Claude `anthropic-version: 2023-06-01`，或厂商要求的 `x-api-key` 等。

**laziness_detector 写盘形态：**

```toml
[model.xxx.laziness_detector]
enabled = true
max_nudges_per_session = 3   # 仅 >0 时写入
```

两者皆关且 max=0 时 **整段 remove**。

### 6.5 读写路径与「保留未知键」

#### 6.5.1 读（打开设置 / 启动加载）

```
get_model_settings
  → 解析 $GROK_HOME/config.toml
  → parse_model_entries → Vec<ModelEntryDto>
  → 前端 map 成 ModelEntry（App.tsx loadModelsFromDisk）
```

注意：`supports_reasoning_effort`、headers、laziness 子表等均从 toml **读回**，避免保存一轮丢字段。

#### 6.5.2 写（保存设置）

```
前端校验 + emptyModelEntry 规范化
  → invoke('save_model_settings', { defaultId, models })
  → 每条 upsert_model_entry([model.<id>], …)
  → 写 [models].default = defaultId
  → 可选 save_env_key
  → invoke('reload_models')          // 热更新 agent catalog，不销毁会话
  → 若 ready：set_current_model(defaultId, reasoningEffort?)
  → 若 cwd 变更且 ready：restart_session（唯一会清聊天的情况）
```

#### 6.5.3 upsert 保留策略

`upsert_model_entry` **按字段 insert/remove**，**不** `clear` 整张表：

- 桌面认识的键：按 §6.4 规则覆盖或删除；  
- 桌面不认识的键（手写 `auth_scheme`、未来官方新字段等）：**原样保留**；  
- **删除整个模型**时：整段 `[model.<id>]` 去掉，手写补丁一并没。

因此：高级用户仍可手写 toml 补桌面未暴露项；但若删模型或改 id，需自行迁移。

### 6.6 校验清单（保存时）

| 条件 | 错误提示语义 |
|------|----------------|
| models 为空 | 至少需要配置一个模型 |
| model 名为空 | 该条无效 |
| context_window ≤ 0 | 必须填 K（如 128、256、1000） |
| api_backend 非法 | 仅三选一 |
| 默认 id 不在列表 | 请选择有效默认模型 |
| 要写 Key 但 env_key 空 | 无法生成密钥存储名 |
| 至少保留 1 条模型 | 删除按钮在 length≤1 时禁用 |

Rust `validate_model_entry` / `validate_model_id` 与前端双重约束。

### 6.7 Composer 侧模型交互

| 交互 | 行为 |
|------|------|
| 模型下拉 | 展示 `m.model \|\| m.id`；副信息可含「支持推理」、非默认 backend、上下文 K |
| 切换模型 | `switchCurrentModel` → `set_current_model`；支持推理则带 effort |
| 与设置默认 | 设置保存会把 **当前选中** 写成 `[models].default`，并尽量同步会话 |
| 不重启会话 | 切模型 / 切推理 **不清聊天**（官方 SetSessionModel） |

`syncSessionModel(modelId, effortOverride?)`：启动/新会话/恢复后调用，避免 UI 下拉与引擎当前模型不一致；支持推理时附带 meta。

### 6.8 端到端调用链（配置 vs 会话）

**A. 改配置（持久化）**

```
Settings 表单
  → save_model_settings → config.toml [model.*]
  → reload_models (ext x.ai/internal/reload_models)
  → （可选）set_current_model 对齐默认
```

**B. 会话内切模型 / 推理（不写 toml 档位，只影响当前 session）**

```
Composer 模型菜单 / 思考滑条
  → invoke set_current_model { modelId, reasoningEffort? }
  → ActorCommand::SetModel
  → GrokSession::set_model(id, Option<&str>)
  → ACP SetSessionModelRequest
       + meta: { "reasoningEffort": "medium" }  // 有值才带
```

说明：

- 配置里的 `reasoning_effort` = **该模型的默认档**（新建会话 / 首次同步用）；  
- 滑条改的是 **当前会话运行时** 强度，经 ACP meta 下发；  
- 若需「把滑条结果写回 config 默认」，本期**未做**（需再点设置保存且表单里改默认——而表单又不暴露六档，故会话档与配置默认可暂时分离，以会话 state `reasoningEffort` 为准）。

### 6.9 类型与后端结构锚点

| 层 | 路径 | 符号 |
|----|------|------|
| 前端类型 | `src/types/index.ts` | `ModelEntry`、`emptyModelEntry`、`REASONING_LEVELS`、`ApiBackend` |
| 设置 UI | `src/components/Modals/SettingsModal.tsx` | 分区表单、`API_BACKENDS`、headers 互转 |
| 业务编排 | `src/App.tsx` | `startAddModel`、`saveSettings`、`syncSessionModel`、`switchCurrentModel`、`switchReasoningEffort` |
| Composer | `src/components/Composer/index.tsx` | 模型菜单 + effort 滑条 |
| Tauri DTO | `src-tauri/src/commands.rs` | `ModelEntryDto`、`upsert_model_entry`、`set_current_model` |
| Actor | `src-tauri/src/state.rs` | `SetModel { model_id, reasoning_effort, reply }` |
| 会话封装 | `crates/grok-session/src/lib.rs` | `set_model`、`reload_models` |
| 官方配置源 | `xai-grok-shell/.../agent/config.rs` | `ModelEntryConfig` |

### 6.10 配置落盘示例（今日 GUI 可产生）

```toml
[models]
default = "m-a1b2c3d4e5f6"

[model.m-a1b2c3d4e5f6]
model = "claude-sonnet-4-6"
name = "claude-sonnet-4-6"
base_url = "https://api.anthropic.com"
env_key = "JIKE_KEY_m_a1b2c3d4e5f6"   # 示例形态，以实际 autoEnvKey 为准
context_window = 200000
api_backend = "messages"
description = "工作用 Claude"
system_prompt_label = "…"               # 自动生成
supports_reasoning_effort = true
reasoning_effort = "medium"
reasoning_efforts = ["none", "minimal", "low", "medium", "high", "xhigh"]
agent_type = "grok-build"
extra_headers = { anthropic-version = "2023-06-01" }
# temperature / top_p 等：用户填了才出现
```

对应 `.env` 一行：`JIKE_KEY_…=sk-…`（键名以生成逻辑为准）。

### 6.11 明确不做 / 仍缺口

| 项 | 原因 / 状态 |
|----|-------------|
| 全局 `[models]` 默认 temperature/top_p/headers | 用户本期明确不做；仅写 `default` |
| `api_key` 写入 toml | 安全策略：只用 env |
| `name` 与 `model` 分离的「友好名」 | 产品定案单一名称 |
| `system_prompt_label` 自由编辑 | 防误填；自动生成 |
| `auth_scheme` / `supports_backend_search` / `show_model_fingerprint` 等 | 极少用；可手写 toml，upsert 保留 |
| `reasoning_efforts` 自定义子集 | 固定写满六档，不做每模型裁剪 UI |
| 滑条结果写回 config 默认档 | 未做；会话 state 优先 |
| Anthropic 一键模板按钮 | 未做；靠 extra_headers 手填 + hint |

### 6.12 与「懒惰检测 / 自动压缩」关系

| 能力 | 配置从哪来 | 运行谁做 |
|------|------------|----------|
| 懒惰检测 | 高级区 → `laziness_detector` | 官方 shell 引擎 |
| 上下文自动压缩 | `auto_compact_threshold_percent` + 压缩头字段 | 官方 compaction 路径 |
| 桌面职责 | **只读写配置 + 展示 token 用量** | 不自研算法 |

---

## 7. 推理强度交互（Claude / Codex 风格 · 详述）

### 7.1 产品定案（交互分工）

| 位置 | 做什么 | 不做什么 |
|------|--------|----------|
| **设置 → 模型 → 推理** | 勾选「支持推理」；默认档写入 `medium` | 不在设置里点六档、不做滑条 |
| **Composer 底行左侧** | 当前模型 `supports_reasoning_effort && ready` 时显示 **滑条** | 不弹下拉菜单（用户明确：要滑动不要点击选择） |

对照：Claude Code / Codex 在切换模型旁调 effort；我们把 effort 放在模型 chip 左侧，强度用 range。

### 7.2 档位定义

前端 `REASONING_LEVELS`（`types/index.ts`）：

| index | value | UI 文案 |
|------:|-------|---------|
| 0 | `none` | 关闭 |
| 1 | `minimal` | 最低 |
| 2 | `low` | 低 |
| 3 | `medium` | 中（默认） |
| 4 | `high` | 高 |
| 5 | `xhigh` | 最强 |

Rust `normalize_reasoning_effort` 额外接受别名：`off`→`none`，`max`→`xhigh`；非法值保存时报错。

勾选支持推理时，`upsert` 固定写入：

```toml
supports_reasoning_effort = true
reasoning_effort = "medium"   # 或规范化后的默认
reasoning_efforts = ["none", "minimal", "low", "medium", "high", "xhigh"]
```

取消勾选：三键全部 `remove`。

### 7.3 会话状态

| State | 含义 |
|-------|------|
| `reasoningEffort`（App.tsx） | 当前会话使用的档位字符串 |
| 初始化 | 默认 `'medium'`；随 sync/切模型/滑条更新 |
| 与配置关系 | 切到支持推理的模型时：`effortOverride \|\| entry.reasoning_effort \|\| 当前 state \|\| 'medium'` |

### 7.4 调用链（逐步）

**滑条拖动（同模型改强度）：**

```
<input type="range" value=effortIndex />
  onChange → REASONING_LEVELS[idx].value
  → onSwitchReasoningEffort(effort)
  → switchReasoningEffort:
       校验 supports_reasoning_effort
       invoke('set_current_model', {
         modelId: selectedModelId,  // 模型不变
         reasoningEffort: effort,
       })
       setReasoningEffort(effort)
  → commands::set_current_model
  → Actor SetModel { model_id, reasoning_effort: Some(...) }
  → GrokSession::set_model(id, Some(effort))
  → SetSessionModelRequest::new(session, ModelId)
       .meta({ "reasoningEffort": effort.to_ascii_lowercase() })
  → connection.set_session_model(req)
```

**切换模型（菜单点选）：**

```
onSwitchModel(id)
  → switchCurrentModel:
       若新模型 supports_reasoning_effort
         带 entry.reasoning_effort || 当前 reasoningEffort || 'medium'
       否则 reasoningEffort: null（不传 meta）
  → 同上 set_current_model 链
```

**启动 / New chat / 保存后对齐：**

```
syncSessionModel(defaultId) 或 saveSettings 内 set_current_model
  → 保证引擎当前模型 = UI 选中；推理 meta 按是否支持带上
```

### 7.5 滑条 UI 实现细节

#### 7.5.1 演进

1. **芯片 + 下拉菜单 / 分段按钮**：点击选择；芯片文案「思考·中」与底行绝对定位免责文案重叠。  
2. **用户要求**：滑动选择；不要挡底部说明。  
3. **最终**：`type=range` + 左右分栏。

#### 7.5.2 结构

```tsx
<div className="composer-below">
  <div className="composer-below-left">
    {showReasoning && (
      <div className="effort-slider-wrap">
        <span>思考</span>
        <input type="range" min={0} max={5} step={1} value={effortIndex} … />
        <span>{effortLabel}</span>  {/* 中 / 高 / … */}
      </div>
    )}
    {/* 模型 chip + 下拉 */}
  </div>
  <div className="composer-below-right">
    {/* 上下文 token 环形用量 */}
  </div>
</div>
```

| 条件 | 表现 |
|------|------|
| `showReasoning` | `selectedModel.supports_reasoning_effort && ready` |
| disabled | `!ready \|\| isGenerating` |
| 样式 | `.effort-slider*` 中性灰轨道、白圆拇指；无橙色 |

布局：`composer-below` 使用 `justify-content: space-between`；去掉免责文案 `position: absolute` 盖住左侧控件。

### 7.6 与官方协议的对应关系

| 桌面 | 协议 / 配置 |
|------|-------------|
| 配置 `supports_reasoning_effort` | 官方 model catalog 能力位 |
| 配置 `reasoning_effort` | 模型默认档（进 catalog） |
| 配置 `reasoning_efforts` | 官方允许的档位列表（我们写满标准六档） |
| 运行时 meta `reasoningEffort` | ACP `SetSessionModel` 的 `_meta` / meta map |

桌面**不**自己实现推理采样；只传档位字符串给 shell。

### 7.7 边界与注意

| 场景 | 行为 |
|------|------|
| 模型不支持推理 | 不显示滑条；set_model 不带 meta |
| 拖滑条过快 | 每档一次 invoke（与 range onChange 一致）；未做 debounce |
| 生成中 | 滑条 disabled，避免中途改档竞态 |
| 配置默认 medium，用户滑到 high | 会话为 high；**config 仍 medium** 直至设置保存逻辑扩展 |
| 非法 effort 字符串 | 后端 normalize 失败 → 保存配置报错；会话侧依赖前端 LEVELS |

---


## 8. 主要改动文件一览

### 8.1 前端

| 路径 | 说明 |
|------|------|
| `src/App.css` | 白主题 token；composer 底行；effort 滑条；设置页字段样式 |
| `src/App.tsx` | 模型字段映射；`reasoningEffort` state；`switchReasoningEffort` / 切模型带 meta |
| `src/types/index.ts` | `ModelEntry` 扩展；`REASONING_LEVELS` |
| `src/components/Composer/index.tsx` | 滑条 + 左/右底行；静默 placeholder |
| `src/components/Modals/SettingsModal.tsx` | 多厂商字段 + 推理勾选 + 高级区中文标签 |
| `src/components/Header/index.tsx` | 去掉启动会话 |
| `src/components/BrandLogo.tsx` | 品牌 |
| `src/components/Sidebar/index.tsx` | 主题适配（中性选中态等） |

### 8.2 后端 / 会话

| 路径 | 说明 |
|------|------|
| `src-tauri/src/commands.rs` | `ModelEntryDto` 扩展；`set_current_model` 可选 `reasoning_effort` |
| `src-tauri/src/state.rs` | `SetModel { reasoning_effort }` |
| `crates/grok-session/src/lib.rs` | `set_model` 写 ACP meta `reasoningEffort` |

### 8.3 文档

| 路径 | 说明 |
|------|------|
| `Grok桌面客户端 功能大纲.md` | 代码对照 |
| `桌面端-外部参考与待办对照.md` | 外部参考与待办 |
| `docs/桌面端-UI主题设计说明.md` | 主题说明 |
| `docs/桌面端-模型字段对照清单.md` | 字段对照 |

---

## 9. 修复与小坑

| 问题 | 处理 |
|------|------|
| JSX 注释夹在 textarea 属性中间导致 Vite/oxc 解析失败 | 注释移出属性列表 |
| oxlint：`startSession` 未用依赖 | 去掉多余 `pushMessage` dep |
| TS：`starting` 未使用 | 解构为 `_starting` |
| 思考 chip 挡住底行 | 改为左滑条 + 右用量，去掉 absolute 免责覆盖 |

**校验：** `npx tsc -p tsconfig.app.json --noEmit` 通过。

---

## 10. 架构关系（本日相关切片）

```
设置页 保存模型
  → save_model_settings / upsert [model.<id>] + .env
  → reload_models（热更新 catalog）

Composer 切模型 / 拖思考滑条
  → set_current_model(modelId, reasoningEffort?)
  → GrokSession::set_model
  → ACP SetSessionModel + meta.reasoningEffort
  （不重启会话、不清聊天）
```

---

## 11. 未做 / 后续可排期

| 项 | 说明 |
|----|------|
| 全局 `[models]` 默认采样 UI | 用户本期明确不做 |
| 密钥进系统密钥环 | 外部对照 P0 灵感，仍明文 `.env` |
| 思考气泡点击折叠 | 大纲仍「部分」 |
| 全文搜索 / 虚拟列表 | 仍未做 |
| MCP 配置 GUI | 引擎有、桌面无 |
| 滑条轨道随档位渐变填充 | 可选 polish |
| 主题说明 md 与最终「无橙」实现同步修订 | 文档仍可能残留橙气泡描述，以 `App.css` 为准 |

---

## 12. 本日一句话

> **文档对齐现码 + 白/灰 UI 定调 + 多厂商模型 GUI 补齐 + 推理「设置勾选、会话滑动」接上官方 meta。**

---

*承接第七天（设置页重构、自报家门、双气泡修复等）。*
)
