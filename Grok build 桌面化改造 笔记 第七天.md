# Grok Build 桌面化改造 · 笔记第七天

> 范围：`jike-grok-desktop` 设置页与模型配置、系统人设（自报家门）、用户消息双份显示、启动会话与下拉模型不同步等问题与改法。  
> 代码主目录：`crates/jike-grok-desktop/`  
> 引擎相关改动：`crates/codegen/xai-grok-shell/`、`crates/codegen/xai-grok-agent/`

---

## 1. 本日目标概览

| 主题 | 目标 |
|------|------|
| 设置入口 | 精简 Header / 侧栏设置按钮位置 |
| 设置 UI | 从单层弹窗改为「左侧菜单 + 右侧内容」的设置页 |
| 模型表单 | 降低填写成本：配置 id / 显示名 / env_key / 系统提示标签自动化 |
| 上下文窗口 | 最终定案：用户自行填写（单位 K） |
| 自报家门 | 会话内 A→B 切换模型时，系统身份随 B 更新 |
| 启动对齐 | 进入应用后会话模型与下拉默认一致，无需来回切换 |
| 消息双份 | 修复用户气泡「你好」变成「你好你好」 |

---

## 2. 设置入口调整

### 2.1 需求

- 删除 **Header 右侧** 设置按钮（`title="设置"`）。
- 侧栏 **收起** 时顶部图标区仍要保留设置（后来用户明确「侧边栏收起要」）。
- 侧栏 **展开** 时底部账户旁保留设置。

### 2.2 实现要点

| 文件 | 改动 |
|------|------|
| `src/components/Header/index.tsx` | 移除 `onOpenSettings` prop 与 ⚙ 按钮 |
| `src/components/Sidebar/index.tsx` | 收起态底部保留 ⚙；展开态 footer 保留 ⚙ |
| `src/App.tsx` | Header 不再传入 `onOpenSettings` |

### 2.3 结果

- 设置入口：**仅侧栏**（展开底部 / 收起图标区）。
- Header 只保留状态 + 启动/新会话。

---

## 3. 设置页 UI 重构

### 3.1 问题

原 `SettingsModal` 为单列堆叠（CWD + 模型下拉 + 字段 + API Key），信息密度高、不像「设置界面」。

### 3.2 目标结构

```
┌ 设置 ──────────────────────────────── ✕ ┐
│ 通用 │  右侧内容区                        │
│ 模型 │  [模型列表] │ [编辑表单 + API Key]  │
├──────────────────────────────────────────┤
│                          取消    保存      │
└──────────────────────────────────────────┘
```

### 3.3 实现要点

| 文件 | 改动 |
|------|------|
| `src/components/Modals/SettingsModal.tsx` | 左侧 `settings-nav`（通用 / 模型）；模型区双栏列表+详情；默认 tab 为「模型」 |
| `src/App.css` | `.settings-shell` 大弹层；布局、列表、表单、footer 样式；尺寸约 `1120×860`（可随 `96vw/94vh` 收缩） |

### 3.4 交互逻辑（未变的后端）

- 打开：`openSettings()` → `workspace_cwd` / `get_model_settings` / `env_file_location` / Key 状态。
- 保存：`save_env_key`（可选）→ `save_model_settings` → `reload_models` →（若 ready）`set_current_model`。
- **不** `restart_session`、**不**清空聊天（市面常见「热更新配置」体验）。

### 3.5 已知限制（CWD）

- 设置里「工作目录」目前主要是展示 + 本地 state。
- 保存逻辑**不写 CWD**；真正会话仍用后端 `workspace_cwd`。
- 若以后要「改 CWD 并生效」，需：持久化 + 视情况 `restart_session` / 刷新列表。

---

## 4. 模型表单字段演进（逐步简化）

### 4.1 字段含义（给后续同学）

| 字段 | 含义 | 最终是否让用户填 |
|------|------|------------------|
| **配置 id** | `config.toml` 里 `[model.<id>]` 的主键，内部切换/默认模型用 | ❌ 自动随机生成（如 `m-a1b2c3…`） |
| **显示名称** | 界面展示名 | ❌ 与 API 模型 ID 相同，保存时 `name = model` |
| **API 模型 ID** | 请求 API 的 `model` 字符串（如 `deepseek-v4-pro`） | ✅ 必填 |
| **Base URL** | API 根地址 | ✅ 必填 |
| **env_key** | 密钥存在哪个环境变量名下 | ❌ 自动生成（见下） |
| **API Key** | 密钥明文（写入 `.env`） | ✅ 首次必填；已设置后锁定不可点改 |
| **上下文窗口** | 自动压缩阈值用的 token 上限 | ✅ 用户填 **K**（如 `128`/`1000`） |
| **system_prompt_label** | 系统提示里「我是谁」的文案 | ❌ 自动拼接 |

### 4.2 配置 id 自动随机

**原因**：用户不必理解内部主键；已保存 id 改主键风险大。

**做法**（`App.tsx` `startAddModel`）：

- 用 `crypto.randomUUID()` 截断生成 `m-<12 hex>`，保证与 `validate_model_id` 合法字符一致。
- 表单**不再展示**配置 id 输入框。
- 列表可用 API 模型 ID 作为主标题。

### 4.3 显示名称 = API 模型 ID

**原因**：减少重复填写。

**做法**：

- 去掉「显示名称」输入。
- 保存时：`name: model`（trim 后）。
- Composer 下拉、切换提示：展示 `m.model || m.id`。

### 4.4 env_key 不让用户填

**原因**：多数用户不理解「环境变量名」；但桌面端存 Key 仍依赖合法变量名。

**做法**：

```ts
// 由配置 id 生成合法 env 名（字母/数字/下划线）
function autoEnvKey(modelId: string): string {
  // → JIKE_<SANITIZED_ID>_API_KEY
}

// 已有 env_key（如 DEEPSEEK_API_KEY）则保留，兼容旧配置
function resolveEnvKey(entry): string { ... }
```

- 设置 UI **去掉 env_key 输入**。
- 保存 API Key 时用 `resolveEnvKey`；打开设置时给缺失项补全。
- Key 已设置：展示「已配置」灰条，**不可再点输入**（防误改）；未设置才出现密码框。

**密钥路径**（示意）：

`%USERPROFILE%\.jike-grok-desktop\.env`

### 4.5 系统提示标签自动拼接

**原因**：人设文案易与 API 模型不一致；手填易过时。

**做法**（保存时）：

```ts
const SYSTEM_PROMPT_LABEL_SUFFIX = '（由 xAI Grok Build 二次开发框架驱动）'

function autoSystemPromptLabel(apiModelId: string): string {
  return `${apiModelId.trim()}${SYSTEM_PROMPT_LABEL_SUFFIX}`
}
// 例：deepseek-v4-pro（由 xAI Grok Build 二次开发框架驱动）
```

- 表单去掉「系统提示标签」输入。
- **旧配置**不会自动改：需对每个模型再点一次「保存」，或新开会话后才能完全吃到新文案（见第 5 节）。

### 4.6 上下文窗口：从自动到手填

**讨论过的方案**：

| 方案 | 结论 |
|------|------|
| 手填完整 token 数（如 1000000） | 易错、体验差 |
| 「是否支持 1M」开关，默认 128K/256K | 默认值争议大；市面（OpenCode / CC Switch / Hermes）多不让用户管窗口 |
| 按模型名规则表自动推断 | 用户认为不能写死 256K；规则表难覆盖所有型号 |
| 可选手填 K + 空则推断 | 做过一版，用户最终放弃 |
| **最终：用户自己填 K** | 当前方案 |

**最终 UI**：

- 标签：`上下文窗口 (K)`
- 例：`128` → 128000 tokens；`1000` → **1M**（注意：**不是** 10000K）
- 保存时若 `context_window <= 0`：前端报错提示填写

**换算备忘**：

| 填写 K | tokens | 说法 |
|--------|--------|------|
| 128 | 128,000 | 128K |
| 256 | 256,000 | 256K |
| **1000** | **1,000,000** | **1M** |
| 10000 | 10,000,000 | 10M（一般不是 1M） |

### 4.7 用户现在加模型最短清单

1. API 模型 ID  
2. Base URL  
3. 上下文窗口 (K)  
4. API Key（该模型首次）  
5. 保存  

---

## 5. 自报家门（system_prompt_label）与切模型

### 5.1 现象

- 下拉已是 `deepseek-v4-pro`。  
- 模型仍说自己是 **DeepSeek V4 Flash**。  
- 或：必须来回切换一次才变成 Pro。

### 5.2 原因拆解

#### （1）「切模型」与「换人设」不是一回事

| 操作 | 实际效果 |
|------|----------|
| Composer `set_current_model` | 换 API 采样配置（谁在算） |
| 旧引擎路径 | 重写 system 时仍用 **Agent 里已缓存的 system_prompt()**，**不**按新模型的 `system_prompt_label` 重算 |
| 结果 | 干活可能是 Pro，工牌还是 Flash |

类比：换工程师继续干同一摊活，但工牌没换。

#### （2）启动时 UI 与会话未对齐（更关键）

```
进入应用
  ├─ loadModelsFromDisk → 下拉显示 default = pro
  └─ start_session → 引擎用自身默认（常为 flash 人设）
  └─ 没有 set_current_model(pro)
```

用户「来回切换」等于手动补了一次 `set_current_model`，人设才对上。

#### （3）保存设置不重启会话

- 设计目标：热更新 catalog，不中断对话。  
- 副作用：仅写盘不够，会话内人设要靠 `set_current_model` 的 prompt 重写逻辑（见下）。

### 5.3 引擎改动：A→B 切模型时更新人设

**涉及文件**：

| 文件 | 改动 |
|------|------|
| `xai-grok-agent/src/agent.rs` | 新增 `set_system_prompt_label`：改 `prompt_context` 并 `finalize_prompt` 重渲染 |
| `xai-grok-shell/.../commands.rs` | `SessionCommand::SetSessionModel` 增加 `system_prompt_label: Option<String>` |
| `xai-grok-shell/.../handlers/model_switch.rs` | 解析 `resolve_system_prompt_label` 后传入命令 |
| `xai-grok-shell/.../model_switch.rs`（session） | 重写 system 前若 label 变化则 `set_system_prompt_label` 并持久化 prompt |
| `run_loop.rs` | 解构并传入新字段 |

**行为**：

- 同一会话从模型 A 切到 B → 系统消息头按 B 的 label 重渲染。  
- 聊天记录保留，无需强制新会话。  
- 需 **重新编译** 带 shell 的桌面/agent 进程后才生效。

### 5.4 桌面改动：启动 / 新会话 / 恢复会话后同步模型

**文件**：`src/App.tsx`

```ts
// 抽取
const syncSessionModel = async (modelId: string) => {
  await invoke('set_current_model', { modelId })
  setSelectedModelId(modelId)
}

// startSession 成功后
const modelId = await loadModelsFromDisk()
await invoke('start_session', { cwd })
setReady(true)
await syncSessionModel(modelId)

// restartSession / load_session 成功后同理
// restart：优先当前 selectedModelId，否则再 loadModelsFromDisk
```

**效果**：进入界面直接聊，下拉是 pro 则会话与人设也应是 pro，不必来回切换。

### 5.5 使用注意

1. 每个模型在设置里 **保存一次**，保证 `config.toml` 中 `system_prompt_label` 已是自动拼接文案。  
2. 引擎改动必须 **编译进当前运行的 agent**。  
3. 若 config 里某条模型的 label 仍是旧 Flash 文案，只切模型不够，需再保存该条配置。

---

## 6. 用户消息双份显示（「你好你好」）

### 6.1 现象

- 输入一次「你好」，气泡显示「你好你好」。  
- 「你确定吗」→「你确定吗你确定吗」。  
- 不是输入框真的输入两遍，是 **同一条用户消息被画了两次**。

### 6.2 根因

```
onSend:
  ① pushMessage('user', text)     // 乐观 UI → 气泡「你好」
  ② invoke('send_prompt', { text })
协议回显:
  ③ user_text_chunk + append=true
     且 streamingRole === 'user'
  → last.text + payload = 「你好」+「你好」
```

助手/思考流式用 `append` 正确；**用户整段回显不能当流式分片 append**。

### 6.3 修改方法

**文件**：`src/App.tsx`

1. **发送后**：`pushMessage('user', text)` 后立刻 `streamingRole.current = null`，避免回显走 append 拼接分支。  
2. **`user_text_chunk` 处理**：
   - 若最后一条已是 **相同** user 文案 → **忽略**（乐观 + 回显去重）；  
   - 仅当 `streamingRole === 'user'` 时才按分片 append；  
   - 否则在已有非空 user 气泡时不重复建泡。

### 6.4 是否符合开发逻辑？

| 评价 | 说明 |
|------|------|
| ✅ 正确 | 定位是双写，不是 IME/输入框 bug |
| ✅ 可接受 | 乐观 UI + 回显去重是聊天应用常见做法 |
| ⚠️ 补丁级 | 用「文案相等 / last 非空」启发式，不如显式 `pendingUserText` 清晰 |

**更干净的两种标准方案**（后续可重构）：

| 方案 | 做法 | 优劣 |
|------|------|------|
| A. 单一数据源 | 发送不乐观插入，只渲染协议/历史事件 | 最干净，气泡可能晚一拍 |
| B. pending 标记 | `pendingUserText = text`，回显相等则消费掉 | 意图清晰，推荐长期用 |
| 当前 | 乐观 + 去重忽略 | 已止血，可维护 |

---

## 7. 保存设置与会话生命周期（备忘）

| 操作 | 是否重启会话 | 说明 |
|------|--------------|------|
| 设置保存 | 否 | `reload_models` + 可选 `set_current_model` |
| Composer 切模型 | 否 | `set_current_model`（现会更新人设） |
| Header「新会话」 | 是 | `restart_session`，空会话磁盘清理逻辑保留 |
| 打开历史会话 | 加载 | `load_session` 后现也会 `syncSessionModel` |

---

## 8. 关键 / 修改文件清单

### 桌面前端

- `crates/jike-grok-desktop/src/App.tsx`  
  - 模型 id / env_key / system_prompt_label / context 保存逻辑  
  - `openSettings` / `saveSettings` / `startAddModel`  
  - `syncSessionModel`、启动/新会话/恢复后对齐模型  
  - `user_text_chunk` 去重、发送后 `streamingRole` 清理  
- `crates/jike-grok-desktop/src/components/Modals/SettingsModal.tsx`  
  - 设置页布局与表单字段精简  
- `crates/jike-grok-desktop/src/components/Header/index.tsx`  
  - 移除设置按钮  
- `crates/jike-grok-desktop/src/components/Sidebar/index.tsx`  
  - 设置入口仅侧栏  
- `crates/jike-grok-desktop/src/components/Composer/index.tsx`  
  - 下拉展示 API 模型 ID  
- `crates/jike-grok-desktop/src/App.css`  
  - 设置页样式、Key 已配置态等  
- `crates/jike-grok-desktop/src/types/index.ts`  
  - 类型与（曾存在的）推断常量清理  

### 引擎（自报家门随切模型更新）

- `crates/codegen/xai-grok-agent/src/agent.rs`  
- `crates/codegen/xai-grok-shell/src/session/commands.rs`  
- `crates/codegen/xai-grok-shell/src/agent/handlers/model_switch.rs`  
- `crates/codegen/xai-grok-shell/src/session/acp_session_impl/model_switch.rs`  
- `crates/codegen/xai-grok-shell/src/session/acp_session_impl/run_loop.rs`  

---

## 9. 验证清单（建议手测）

1. **设置入口**  
   - Header 无设置；侧栏展开/收起均有设置。  

2. **新增模型**  
   - 只填 API 模型 ID、Base URL、K、Key → 保存成功。  
   - Composer 下拉出现该 API 模型 ID。  

3. **API Key 已配置**  
   - 再进设置显示「已配置」，无法再点输入。  

4. **上下文 K**  
   - 填 `1000` 保存后 config 中为 `1000000`。  
   - 不填保存应报错提示。  

5. **启动对齐**  
   - 默认模型为 pro 时，冷启动直接问「你是什么模型」→ 应报 pro 相关身份，无需来回切。  

6. **会话内切模型**  
   - A 聊几句 → 切 B → 再问身份 → 应为 B（需引擎新编译）。  

7. **用户消息不双份**  
   - 发送「你好」气泡仅为「你好」一次。  

8. **新会话**  
   - 空会话不污染侧栏；有内容的会话标题为第一句用户话。  

---

## 10. 后续可选工作

| 项 | 说明 |
|----|------|
| CWD 真正可配置 | 保存写配置 + restart / 刷列表 |
| `pendingUserText` 重构 | 替代启发式用户消息去重 |
| 上下文窗口 | 若再引入自动策略，建议预设模型表或 models.dev，避免写死 256K |
| Logo | 当前侧栏 `✦` + Tauri/Vite 默认图标，未做品牌化 |
| 设置「关于」等菜单 | 左侧 nav 可扩展 |

---

## 11. 一句话总结

本日把设置做成可运营的模型管理页，并砍掉对用户不友好的字段；同时修了三条主线体验：**人设随模型走（引擎 + 启动同步）**、**用户气泡不双写**、**表单与市面「少填」方向对齐（最终上下文仍手填 K）**。

---

*文档对应开发会话：设置 UI / 模型配置简化 / system_prompt_label / 双份消息 / syncSessionModel。*  
*若与代码不一致，以仓库当前 `main` 与上述路径为准。*
