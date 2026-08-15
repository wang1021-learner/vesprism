/**
 * 会话事件处理（从 App.tsx 抽出，便于独立测试 + 保持组件文件 fast-refresh 纯净）。
 * 事件路由：先按 ev.tab_id 写对应 tab 的 map（非活跃 tab 也照常更新），
 * 仅活跃 tab 由 patchTab 内部额外投影到全局 atom。
 */
import {
  $activeTabId,
  $models,
  $settingsDefaultModelId,
  $workspaceCwd,

  $securityPolicy,
  $sessionPolicyOverride,
  findTabBySessionId,
  getTabState,
  hasTab,
  patchTab,
  pushToast,
  trackSubagentRunning,
  untrackSubagentRunning,
  upsertSubagent,
  bumpGitHeadRevision,
  setBackgroundTask,
} from '../store'
import { loadSession, respondPermission, setCurrentModel, startSession } from '../bridge'
import { beginAttachRuntime, finishAttachRuntime, pushTranscriptEvent } from './sessionOpen'
import { refreshSubagentTabMessages } from './openSubagentTab'
import { parsePermissionDescription } from '../types'
import type { SessionStatus } from '../types'
import {
  isAlwaysAllowed,
  isSessionAllowed,
  permissionSignature,
  pickAllowStrict,
  isReadOnlyPermission,
  pickDeny,
} from './permissionMemory'
import { evaluatePermission } from './executionPolicy'
import { keepTail } from './terminalCards'

export function handleSessionEvent(ev: import('../bridge').SessionEventPayload) {
  // 事件路由：先按 ev.tab_id 写对应 tab 的 map（非活跃 tab 也照常更新——
  // 后台 tab 崩溃、收消息、Plan F 恢复重放都依赖它）；仅活跃 tab 由
  // patchTab 内部额外投影到全局 atom。单 tab 时代的「非活跃即丢弃」闸门已移除。
  const tabId = ev.tab_id || $activeTabId.get()
  if (tabId && !hasTab(tabId)) return // 已关闭 tab 的迟到事件
  if (pushTranscriptEvent(ev, tabId)) return

  switch (ev.type) {
    case 'turn_ended': {
      // 旧回合（被中断）的迟到 turn_ended：不置 idle（新回合可能正在跑）
      const st = getTabState(tabId)
      const msgs = st?.messages ?? []
      let stale = false
      if (ev.prompt_id && msgs.length > 0) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') {
            stale = Boolean(msgs[i].promptId) && msgs[i].promptId !== ev.prompt_id
            break
          }
        }
      }
      if (!stale) {
        patchTab(tabId, { status: 'idle', permission: null, userQuestion: null })
      }
      break
    }
    case 'error':
      patchTab(tabId, { error: ev.message || 'Unknown error', status: 'idle' })
      break
    case 'permission_request': {
      if (getTabState(tabId)?.phase === 'loading') break
      if (ev.request_id != null && ev.options?.length) {
        const raw = ev.description || '工具权限请求'
        const parsed = parsePermissionDescription(raw)
        const req = {
          id: String(ev.request_id),
          tool: raw,
          options: ev.options.map((o) => ({ id: o.id, name: o.name, kind: o.kind })),
          kindLabel: parsed.kindLabel,
          title: parsed.title,
          command: parsed.command,
          summary: parsed.summary,
          securityFindings: ev.security_findings ?? [],
        }
        const sig = permissionSignature(req)
        const base = $securityPolicy.get()
        const override = $sessionPolicyOverride.get()
        const policy = override ? { ...base, executionPolicy: override } : base
        const cwd =
          getTabState(tabId)?.cwd || $workspaceCwd.get() || policy.cwd
        const decision = evaluatePermission(
          { command: req.command, kindLabel: req.kindLabel },
          { ...policy, cwd },
        )
        if (decision.action === 'deny') {
          const deny = pickDeny(req.options)
          if (deny) {
            void respondPermission(tabId, Number(ev.request_id), deny.id).catch((e) => {
              console.warn('[perm] 策略自动拒绝失败:', e)
              patchTab(tabId, { permission: req })
            })
            pushToast(decision.reason, 'error')
            patchTab(tabId, { permission: null })
            break
          }
        }
        if (decision.action === 'allow' || decision.action === 'sandbox') {
          const allow = pickAllowStrict(req.options)
          if (allow) {
            void respondPermission(tabId, Number(ev.request_id), allow.id).catch((e) => {
              console.warn('[perm] 策略自动放行失败:', e)
              patchTab(tabId, { permission: req })
            })
            pushToast(decision.reason, decision.action === 'sandbox' ? 'info' : 'success')
            patchTab(tabId, { permission: null })
            break
          }
        }
        if (isReadOnlyPermission(req)) {
          const allow = pickAllowStrict(req.options)
          if (allow) {
            void respondPermission(tabId, Number(ev.request_id), allow.id).catch((e) => {
              console.warn('[perm] 只读工具自动放行失败:', e)
              patchTab(tabId, { permission: req })
            })
            patchTab(tabId, { permission: null })
            break
          }
        }
        // 记忆命中（本次会话/总是允许）→ 自动放行，不弹审批条。
        const sessionHit = isSessionAllowed(tabId, sig)
        const alwaysHit = isAlwaysAllowed(sig)
        if (sessionHit || alwaysHit) {
          const allow = pickAllowStrict(req.options)
          if (allow) {
            console.log('[perm] 记忆自动放行', { tabId, sig, sessionHit, alwaysHit })
            void (async () => {
              try {
                await respondPermission(tabId, Number(ev.request_id), allow.id)
              } catch (e) {
                // 自动放行失败：弹窗兜底，避免引擎干等
                console.warn('[perm] 自动放行失败:', e)
                patchTab(tabId, { permission: req })
              }
            })()
            // 清掉可能残留的旧弹窗（旧 request_id 已失效，留着点了也没用）
            patchTab(tabId, { permission: null })
            break
          }
          console.warn('[perm] 记忆命中但无明确 allow 选项', { sig, options: req.options })
        }
        patchTab(tabId, { permission: req })
      }
      break
    }
    case 'user_question_request':
      if (getTabState(tabId)?.phase === 'loading') break
      if (ev.request_id != null && ev.questions?.length) {
        patchTab(tabId, {
          userQuestion: {
            requestId: ev.request_id,
            toolCallId: ev.tool_call_id || `ask_${ev.request_id}`,
            mode: ev.mode || 'default',
            questions: ev.questions.map((q) => ({
              question: q.question,
              options: (q.options || []).map((o) => ({
                label: o.label,
                description: o.description,
                preview: o.preview,
              })),
              multiSelect: q.multiSelect,
            })),
          },
        })
      }
      break
    case 'subagent_spawned':
      if (ev.subagent_id) {
        upsertSubagent(tabId, {
          subagentId: ev.subagent_id,
          parentSessionId: ev.parent_session_id || '',
          childSessionId: ev.child_session_id || '',
          subagentType: ev.subagent_type || 'general-purpose',
          description: ev.description || '',
          model: ev.model,
          status: 'running',
        })
        trackSubagentRunning(ev.subagent_id, ev.parent_session_id || '')
        // 官方语义：不自动开 Tab；会话流内嵌子任务行，用户点「打开」才 attach（viewer）
      }
      break
    case 'subagent_progress':
      if (ev.subagent_id) {
        upsertSubagent(tabId, {
          subagentId: ev.subagent_id,
          parentSessionId: ev.parent_session_id,
          childSessionId: ev.child_session_id,
          status: 'running',
          durationMs: ev.duration_ms,
          turnCount: ev.turn_count,
          toolCallCount: ev.tool_call_count,
          tokensUsed: ev.tokens_used,
          contextUsagePct: ev.context_usage_pct,
          toolsUsed: ev.tools_used,
          errorCount: ev.error_count,
        })
        // 子 Agent 在父进程跑，子 Tab 无实时 chunk → 仅当用户正在看该子 Tab 时刷磁盘投影
        // （官方 viewer 语义：事件驱动；非活跃不轮询，避免每 2s 全量 IO + 重渲染）
        const progSid = (ev.child_session_id || '').trim()
        if (progSid) {
          const childTabId = findTabBySessionId(progSid)
          if (childTabId && childTabId === $activeTabId.get()) {
            void refreshSubagentTabMessages(progSid)
          }
        }
      }
      break
    case 'subagent_finished':
      if (ev.subagent_id) {
        const st = (ev.status || 'completed').toLowerCase()
        const status =
          st === 'failed' || st === 'cancelled' || st === 'completed'
            ? (st as 'failed' | 'cancelled' | 'completed')
            : 'completed'
        upsertSubagent(tabId, {
          subagentId: ev.subagent_id,
          childSessionId: ev.child_session_id,
          status,
          error: ev.error,
          toolCallCount: ev.tool_calls,
          turnCount: ev.turns,
          durationMs: ev.duration_ms,
          tokensUsed: ev.tokens_used,
          output: ev.output,
        })
        // finished 事件不带父会话 id：用 tab 内已存条目兜底。
        const parentFallback =
          getTabState(tabId)?.subagents.find((s) => s.subagentId === ev.subagent_id)
            ?.parentSessionId ?? ''
        untrackSubagentRunning(ev.subagent_id, parentFallback)
        // 结束后再刷一次；磁盘若还没有 assistant，用 output 兜底写入子 Tab
        const doneSid = (ev.child_session_id || '').trim()
        if (doneSid) {
          void refreshSubagentTabMessages(doneSid, {
            outputFallback: ev.output,
          })
        }
      }
      break
    case 'status_changed':
      if (getTabState(tabId)?.phase === 'loading') break
      if (ev.status) patchTab(tabId, { status: ev.status as SessionStatus })
      break
    case 'title_changed':
      if (ev.title) patchTab(tabId, { chatTitle: ev.title })
      break
    // 终态错误（后端已映射事件，前端此前无 UI）：置 error banner + toast
    case 'context_overflow':
    case 'rate_limit_exceeded':
    case 'auth_expired': {
      const msg = ev.message || '会话失败'
      patchTab(tabId, { error: msg, status: 'idle' })
      pushToast(
        ev.type === 'context_overflow'
          ? '上下文超限，建议新建会话或压缩上下文'
          : ev.type === 'rate_limit_exceeded'
            ? '限流重试已耗尽，请稍后再试'
            : '认证已失效，请到设置检查 API Key',
        'error',
      )
      break
    }
    // 非终态：仅 toast 提示重试进度（不置 error banner，避免干扰流式输出）
    case 'retry_in_progress': {
      if (ev.attempt === 1) {
        pushToast(
          `自动重试中（${ev.attempt}/${ev.max_retries ?? '?'}）${ev.reason ? '：' + ev.reason : ''}`
        )
      }
      break
    }
    // 官方 git HEAD 变化（分支切换 / 提交）：右栏「工作区改动」自动刷新
    case 'git_head_changed':
      bumpGitHeadRevision()
      break
    // bash 命令转入后台执行：登记后台任务（工具卡显示徽标 + 终止入口）
    case 'task_backgrounded':
      if (ev.tool_call_id && ev.task_id) {
        setBackgroundTask(tabId, ev.tool_call_id, {
          taskId: ev.task_id,
          command: ev.command || '',
          outputFile: ev.output_file || undefined,
          monitorDescription: ev.monitor_description ?? null,
          description: ev.description ?? null,
        })
      }
      break
    // 后端 Phase 2：tab 崩溃自动重建 / 连续崩溃标记 Failed。
    // 重建（含手动重试）→ 按 map 里该 tab 的状态重放会话身份 + 模型。
    case 'tab_recovering':
      console.log(`[tab] ${ev.tab_id} 已重建为空壳（第 ${ev.attempt ?? '?'} 次），开始重放`)
      if (ev.tab_id) void replayTabAfterCrash(ev.tab_id)
      break
    case 'tab_failed':
      console.warn(`[tab] ${ev.tab_id} 连续崩溃 ${ev.attempts ?? '?'} 次，标记 Failed，等待手动重启`)
      patchTab(tabId, { phase: 'failed' })
      break
    case 'sandbox_activated':
      patchTab(tabId, {
        sandboxCwd: ev.sandbox_cwd || '',
        sandboxOrigin: ev.origin_cwd || '',
      })
      break
    case 'sandbox_deactivated':
      patchTab(tabId, { sandboxCwd: '', sandboxOrigin: '' })
      break
    case 'session_id_changed':
      // 只更新引擎 sessionId；chatId 保留侧栏历史 id，避免 findTabBySessionId 对不上、重复开 Tab
      if (ev.session_id) {
        const prev = getTabState(tabId)
        patchTab(tabId, {
          sessionId: ev.session_id,
          chatId: prev?.chatId?.trim() ? prev.chatId : ev.session_id,
        })
      }
      break
    case 'goal_updated': {
      if (ev.goal) {
        // status=cleared 表示官方要求清空目标态。
        patchTab(tabId, { goal: ev.goal.status === 'cleared' ? null : ev.goal })
      }
      break
    }
    case 'workflow_updated': {
      if (ev.workflow?.runId) {
        const prev = getTabState(tabId)?.workflows ?? {}
        patchTab(tabId, {
          workflows: { ...prev, [ev.workflow.runId]: ev.workflow },
        })
      }
      break
    }
    case 'terminal_opened': {
      if (ev.terminal_id) {
        const ownSid = (getTabState(tabId)?.sessionId || '').trim()
        const evSid = (ev.session_id || '').trim()
        if (ownSid && evSid && ownSid !== evSid) break
        const prev = getTabState(tabId)?.terminals ?? {}
        patchTab(tabId, {
          terminals: {
            ...prev,
            [ev.terminal_id]: {
              terminalId: ev.terminal_id,
              command: ev.command ?? '',
              text: '',
              truncated: false,
              exited: false,
              killed: false,
              openedAt: Date.now(),
              expanded: true,
            },
          },
        })
      }
      break
    }
    case 'terminal_update': {
      if (ev.terminal_id) {
        const prev = getTabState(tabId)?.terminals ?? {}
        const cur = prev[ev.terminal_id]
        if (!cur) break
        const kept = keepTail(ev.text ?? cur.text)
        patchTab(tabId, {
          terminals: {
            ...prev,
            [ev.terminal_id]: {
              ...cur,
              text: kept.text,
              truncated: cur.truncated || Boolean(ev.truncated) || kept.truncated,
            },
          },
        })
      }
      break
    }
    case 'terminal_released': {
      // 跑完不删卡，只把仍在跑、却被 release 的标成已终止。
      if (ev.terminal_id) {
        const prev = getTabState(tabId)?.terminals ?? {}
        const cur = prev[ev.terminal_id]
        if (!cur || cur.exited) break
        patchTab(tabId, {
          terminals: {
            ...prev,
            [ev.terminal_id]: {
              ...cur,
              exited: true,
              killed: true,
              expanded: false,
            },
          },
        })
      }
      break
    }
    case 'terminal_exited': {
      if (ev.terminal_id) {
        const prev = getTabState(tabId)?.terminals ?? {}
        const cur = prev[ev.terminal_id]
        if (!cur) break
        patchTab(tabId, {
          terminals: {
            ...prev,
            [ev.terminal_id]: {
              ...cur,
              exited: true,
              killed: Boolean(ev.killed) || Boolean(cur.killed),
              exitCode: ev.exit_code ?? null,
              signal: ev.signal ?? null,
              expanded: false,
            },
          },
        })
      }
      break
    }
    case 'other':
      break
    default:
      break
  }
}

async function replayTabAfterCrash(tabId: string) {
  const st = getTabState(tabId)
  if (!st) return
  // 清挂起的 UI 状态（旧 actor 的权限 / 问卷 oneshot 已随 panic 失效）
  patchTab(tabId, { permission: null, userQuestion: null, error: '', subagents: [] })
  const cwd = st.cwd || $workspaceCwd.get()
  try {
    if (st.sessionId) {
      // 走标准 attach 流程：历史回放期间吞 transcript 类事件
      beginAttachRuntime(tabId)
      await loadSession(tabId, st.sessionId, cwd)
      finishAttachRuntime(tabId)
    } else {
      await startSession(tabId, cwd)
      patchTab(tabId, { phase: 'ready', status: 'idle' })
    }
    // 重放该 tab 自己记住的模型 / 推理档（不是全局默认）
    const modelId = st.modelId || $settingsDefaultModelId.get()
    if (modelId) {
      const entry = $models.get().find((m) => m.id === modelId)
      const effort = entry?.supports_reasoning_effort
        ? st.reasoningEffort || entry.reasoning_effort || 'medium'
        : undefined
      await setCurrentModel(tabId, modelId, effort)
      patchTab(tabId, {
        modelId,
        ...(effort ? { reasoningEffort: effort } : {}),
      })
    }
    pushToast('会话已自动恢复', 'success')
  } catch (e) {
    patchTab(tabId, { error: String(e) })
    pushToast('会话恢复失败，可重试', 'error')
  }
}
