# xai-grok-test-support（中文翻译）

> **⚠️ 免责声明**：本文件是对英文原版 `README.md` 的中文翻译，仅供参考。以英文原版 [`README.md`](README.md) 为准。

---

grok-build 各 crate 的共享测试基础设施：模拟推理服务器、
SSE 线格式生成器、ACP stdio 客户端、无头运行器和沙箱进程环境。
由 `xai-grok-shell` 集成测试、`xai-grok-pager-pty-harness`（`ContentController`）和
`xai-grok-sampler` 测试消费。

> **及时性规则：** 在同一 PR 中更新本 README 和 `src/` —
> 审查者应将无 README 差异的 `src/` 差异视为不完整。

如何测试的发现位于 pager PTY 线束 crate（`xai-grok-pager-pty-harness`）中。
本文件是共享测试支持表面的 API 参考。

## 模块图

| 模块 | 提供内容 |
|--------|------------------|
| `mock_server` | `MockInferenceServer` — 在 `127.0.0.1:0` 上提供 `/v1/chat/completions`、`/v1/responses`、`/v1/messages`、`/v1/models`、`/v1/settings`、`/v1/user`。`/v1/models` 条目为 `MockModelEntry`（重新导出为 `MockModel` 供 PTY 测试用）：`new(id)` / `with_agent_type(id, ty)` 以及可链接的 `with_api_backend`、`with_supports_backend_search(bool)` → `supportsBackendSearch`、`with_supports_reasoning_effort(bool)` → `supportsReasoningEffort`、`with_reasoning_effort(&str)` → `reasoningEffort`、`with_reasoning_efforts(Vec<Value>)` → `reasoningEfforts`（原始选项表/裸字符串），全部作为顶层发出，由 `parse_remote_model_value` 读取。推理端点有三种响应模式，优先级 **scripted > required-auth > mode**：(1) **echo**（默认）流式传输 `Echo: <last user message>`，折叠空白；(2) **fixed** 通过 `set_response(text)` 设置，字节精确重建换行保留（围栏代码块存活）；(3) **scripted** 通过 `enqueue_response` 设置。构造函数（`start`、`start_with_models`、`start_with_required_auth`）返回 `anyhow::Result`。Settings 在设置前返回 404（`set_settings(impl Serialize)`、`preset_allow_access()` 用于 `{"allow_access": true}` 网关）；scripted `/v1/settings` 单次（`enqueue_response`）优先于稳态值（过期快照测试）。`/v1/user` 提供最小的 `UserInfo`，其 `subscriptionTier` 由 `set_user_subscription_tier(Option<&str>)` 控制（`None` = 免费）；其日志条目保留查询字符串（例如 `/v1/user?include=subscription`）以便订阅检查节奏可计数。请求日志：`requests()`（带有 body、`authorization`、完整 POST 标头 + `header(name)` 访问器的 `LogEntry`）、`request_bodies()`、`request_count()`、`has_chat_completion_request()` / `has_responses_request()`（每个端点精确匹配）、`messages_request_count()`、`last_system_prompt()`、`request_log_summary()`。**存储：** `POST /v1/storage` 具有可切换的 401（`set_storage_unauthorized`）；接受的上传通过 `storage_uploads()` → `StorageUpload { path, size, body, authorization }`（`body` 保留最多 256 KiB，超过后为空；`authorization` 是原始标头）。运行时调节：`set_models`、`set_messages_stop_reason`。丢弃时关闭。 |
| `scripted` | 纯数据脚本（表面上无 axum 类型）：`SseEvent { event, data }`（`::data`、`::with_event`）、`ScriptedBody::{Json, Sse, Raw}`（`Raw` = 字节可控的畸形 SSE）、`ScriptedResponse { status, headers, body }`（`::sse`、`::json`、`::text`）。`enqueue_response(path, response)` 按 **每个路径** FIFO 排队；由三个推理端点消费，空时回落到活动模式。scripted SSE 主体遵守服务器的 `set_chunk_delay` 节奏，与 echo/fixed 模式相同。验证是急切的 — 错误的 status/header 在入队调用点 panic。第 2 阶段可脚本化模拟格式的种子。 |
| `sse` | 三种线格式作为事件列表构建器：`chat_completion_events` / `responses_api_events` / `messages_api_events(text, model, stop_reason)`（echo 风格，折叠空白）加字节精确变体 `chat_completion_events_exact` / `responses_api_events_exact`（messages 是单增量，按构造字节精确）。精确/echo 分割是承载性的 — 参见模块内字节精确性测试。还有返回 `SseEvent` 的 scripted 场景构建器（用于 `ScriptedResponse::sse`）：`responses_api_reasoning_only_events(reasoning, model)` — 完成推理摘要增量但无消息/输出文本的推理项，因此 shell 收集器将回合分类为 `EmptyReason::ReasoningOnly`（模型死循环触发器）；`responses_api_reasoning_and_text_events(reasoning, text, model)` — 推理增量然后正常文本答案（普通推理模型回合）；`responses_api_reasoning_then_tool_call_events(reasoning, call_id, name, arguments, model)` 及其 Chat Completions 对应物 `chat_completions_reasoning_then_tool_call_events(...)` — 推理增量然后一个工具调用（思考然后调用的回合，其工具调用完成思考并使回合保持非空）；死循环检查三人组：`responses_api_doom_loop_check_events(triggers, reasoning, model)` — 注定推理仅回合，带有按 `triggers` 累积前缀重新发送的命名 `response.doom_loop_check` 帧，加上 `response.completed` 上的终端 `doom_loop_check.triggers` 副本，`responses_api_doom_loop_terminal_only_events(triggers, reasoning, text, model)` — 正常答案，其终端响应单独携带该字段，和 `responses_api_with_doom_loop_frame(check_frame_data, reasoning, text, model)` — 将带有调用者提供的负载的一个命名检查帧（字节精确 `xai_grok_sampling_types::doom_loop::SAMPLE_CHECK_EVENT_DATA{,_CUMULATIVE}` 固定装置或畸形变体）拼接到普通回合中。 |
| `acp_client` | `GrokStdioClient` — 通过 `agent-client-protocol` 在真实管道上驱动 `grok agent stdio`：生成变体（`spawn`、`spawn_with_home`、`spawn_with_home_and_env`、`spawn_with_home_env_and_args`）、初始化/身份验证、会话创建/加载、提示、`*_with_timeout` 包装器、捕获的文本 + stderr。`RawStdioClient` — 原始线同胞，用于类型化 `ClientSideConnection` 永远无法生成的字节（转义斜杠方法 `"session\/prompt"`、字符串 UUID id — Xcode/Foundation 形状）：`send_line` 逐字写入一行；`response_for_id` 通过精确字符串 id id 匹配响应（匹配即是 id-echo 断言），跳过通知，自动拒绝代理 → 客户端请求 -32601，并在超时时 panic 并显示跳过流量诊断（计数 + 最后几行；`0 other messages` = 真正的沉默）。两者都通过一个闭合的 `spawn_agent_process` 生成（沙箱 env + 调试日志 kill-list 存在一次）位于 `process::spawn_piped_with_stderr_capture`（crate 内部 `process` 模块：管道、`kill_on_drop`、stderr 排水 — 也由 `leader::LeaderStdioClient` 使用）之上。 |
| `headless` | `run_headless(server, args, cwd)` / `run_headless_with_cmd(cmd)` → `HeadlessResult { status, stdout, stderr, timed_out }`（60s 上限）、`assert_headless_success`、`assert_no_crashes`（panic/SIGSEGV/链接器模式）、`stderr_tail`。 |
| `env` | `grok_binary()`（`GROK_BINARY` env → `CARGO_BIN_EXE` → `xai-grok-pager` 的本地调试构建）、`git_workdir()`（临时 git 仓库，强制完整 libgit2 初始化）、`test_env_cmd_tokio(cmd, mock_url, home)`（沙箱 HOME **和 GROK_HOME** — Windows 通过 USERPROFILE 解析 `~`，所以仅 HOME 无法沙箱 — + mock 端点 + 遥测 kill-switch）。 |
| `leader` | 仅 Unix `LeaderStdioClient`（`grok agent --leader stdio`，`env_clear`-闭合，沙箱 `GROK_LEADER_SOCKET`；`spawn_with_binary` 为版本偏斜通道运行显式二进制，通过 `leader_binary()` / `client_binary()` 按角色解析，遵守 `GROK_BINARY_LEADER` / `GROK_BINARY_CLIENT`）+ 锁文件助手：`leader_lock_path`、`read_leader_pid`、`pid_alive`、`wait_for_live_leader`、`wait_for_new_leader`、`wait_for_replay_notifications`、`leader_log`。 |
| `uds_proxy` | 仅 Unix `UdsProxy` — 用于 leader IPC 套接字的帧感知（4 字节 BE 长度前缀）中间人。`UdsProxy::spawn(proxy_path, upstream_path, FaultPlan)`；`FaultPlan { direction, drop_frame, sever_mid_frame, delay, duplicate_frame }`（从 1 开始的帧索引，每个连接每个方向）；运行时 `FaultHandle::sever_now()` + `forwarded(direction)` 计数器；帧体限制在 64 MiB（leader-transport 奇偶性 — 损坏的长度会错误而不是分配）。零生产更改：将 `LeaderClient::connect` / `GROK_LEADER_SOCKET` 指向代理路径。 |

## 消费者矩阵

| 消费者 | 使用 | 备注 |
|----------|------|-------|
| `xai-grok-shell` `tests/*.rs` | 一切 | 直接导入（`use xai_grok_test_support::*` 或模块路径）；无局部垫片。 |
| `xai-grok-pager-pty-harness` `src/content.rs` | `MockInferenceServer`、`MockModelEntry`（重新导出为 `MockModel`） | `ContentController` 包装服务器并在**线束侧保留 HOME 沙箱 `TempDir` + `env_for_pager()`**；在构造时预设 `allow_access` + 固定默认响应。 |
| `xai-grok-sampler` `tests/test_actor.rs` | `sse` 生成器 | 仅快乐路径负载；actor 保留自己的路由器用于 stall/条件固定装置。 |

## 添加功能

**响应模式**（`mock_server.rs`）：扩展私有 `ResponseMode` 枚举
+ 添加设置器；将新分支接入**所有三个**推理处理程序（每个路由中的
匹配）；scripted 响应仍必须胜出。扩展 crate 内测试：
新模式的一个 HTTP 往返加上
`scripted_responses_serve_fifo_per_path_then_fall_back` 中的一段以证明回退
触达它。echo 锁定测试（`echo_mode_echoes_last_user_message`）必须
未经修改地通过 — echo 字节被冻结。

**线格式**（`sse.rs`）：添加 echo 风格构建器，如果客户端
逐字节重建文本，则添加基于增量 fn 的 `_exact` 变体；
然后在 `mock_server`（所有模式）中添加服务臂，如果是新端点则添加路由。扩展字节精确性锁定
（`deltas_reconstruct_multiline_response_byte_for_byte`、
`deltas_preserve_runs_of_whitespace`）— 它们是围栏
代码块（mermaid）在流式传输中存活的契约。**scripted 场景构建器**（一个
表达 echo/fixed 模式无法表达的特定完成方式的构建器，例如
`responses_api_reasoning_only_events`）而是为
`ScriptedResponse::sse` 返回 `SseEvent`，不需要 `mock_server` 模式接线，并附带一个
断言其事件形状的模块内形状测试。

**scripted 主体类型**（`scripted.rs`）：新 `ScriptedBody` 变体 + render
臂在 `into_response_paced` 中 + 数据可以在 `validate` 中无效时的急迫检查。添加一个断言客户端可见字节的 crate 内测试（`Raw`
字节精确性测试是模板）并保持
`scripted_response_takes_precedence_over_required_auth` green — 优先级是
契约的一部分。
