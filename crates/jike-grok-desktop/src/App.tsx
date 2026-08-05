import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Composer } from './components/Composer'
import { MessageList } from './components/Chat/MessageList'
import { TabBar } from './components/TabBar'
import { CommandPalette } from './components/CommandPalette'
import {
  ErrorBoundary,
  MainViewportErrorFallback,
  MessagesErrorFallback,
} from './components/ErrorBoundary'
import { PermissionModal } from './components/Permission'
import { UserQuestionPanel } from './components/UserQuestion'
import { SubagentStrip } from './components/SubagentStrip'
import { RightPanel } from './components/RightPanel'
import { SettingsModal } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { ToastHost } from './components/Toast'
import {
  $activeTabId,
  $activeChatId, $chats, $composerInput,
  $defaultModelId, $error, $generating, $messages, $models,
  $permission, $userQuestion, $reasoningEffort, $sessionPhase,
  $settingsDefaultModelId, $utilityKind,
  $sidebarCollapsed, $shellReady, $workspaceCwd, $workspaceOptions,
  createTab, getTabState, hasTab, patchActiveTab, patchTab, resolveNewTabModel,
  switchTab, pushToast, upsertSubagent,
} from './store'
import { McpPanel } from './components/McpPanel'
import { ToolsPanel } from './components/ToolsPanel'
import { SkillsPanel } from './components/SkillsPanel'
import {
  cancelTurn, getModelSettings, isTauriRuntime, listSessions,
  listenSessionEvents, loadSession, openTab, sendPrompt, setCurrentModel,
  startSession, workspaceCwd,
} from './bridge'
import { beginAttachRuntime, finishAttachRuntime, pushTranscriptEvent } from './lib/sessionOpen'
import { generateId } from './lib/generateId'
import { removeUserMessageByPromptId } from './lib/sessionTranscript'
import { parsePermissionDescription } from './types'

export default function App() {
  // 浏览器直接打开 Vite 地址时没有 Tauri IPC，整页拦截并提示正确启动方式
  if (!isTauriRuntime()) {
    return <BrowserNotDesktopGate />
  }
  return <DesktopApp />
}

function DesktopApp() {
  const ready = useRef(false)
  useEffect(() => {
    if (ready.current) return
    ready.current = true
    void bootstrap()
  }, [])

  // Ctrl/Cmd+N 新建会话
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || (e.key !== 'n' && e.key !== 'N')) return
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('jike:new-chat'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app-container">
      <ToastHost />
      <CommandPalette />
      <ErrorBoundary name="侧栏">
        <AppSidebar />
      </ErrorBoundary>
      <ErrorBoundary
        name="主界面"
        fallback={(error, reset) => (
          <MainViewportErrorFallback error={error} onReset={reset} />
        )}
      >
        <div className="main-viewport">
          <TabBar />
          <SubagentStrip />
          <AppError />
          <AppMainBody />
          <SettingsModal />
        </div>
      </ErrorBoundary>
      <RightPanel />
    </div>
  )
}

/** 网页打开时的全屏拦截页（本产品是 Tauri 桌面端，不是 Web 应用） */
function BrowserNotDesktopGate() {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:9527'
  const href =
    typeof window !== 'undefined' ? window.location.href : origin

  return (
    <div className="browser-gate" role="alert">
      <div className="browser-gate-card">
        <div className="browser-gate-badge">桌面端专用</div>
        <h1 className="browser-gate-title">请不要用浏览器打开</h1>
        <p className="browser-gate-lead">
          这是 <strong>Tauri 桌面客户端</strong>，不是网页应用。
          你现在打开的是 Vite 开发服务器地址（
          <code className="browser-gate-code">{href}</code>
          ），页面能显示是因为前端静态资源挂在上面，但
          <strong>没有桌面壳与后端 IPC</strong>，会话、模型、工作区、权限等都不可用。
        </p>

        <div className="browser-gate-section">
          <div className="browser-gate-section-title">正确启动方式（带热更新）</div>
          <ol className="browser-gate-steps">
            <li>
              在终端进入项目目录：
              <pre className="browser-gate-pre">{`cd crates/jike-grok-desktop`}</pre>
            </li>
            <li>
              启动桌面开发模式：
              <pre className="browser-gate-pre">{`npm run desktop`}</pre>
              <span className="browser-gate-hint">
                等价命令：<code>cargo tauri dev</code>
              </span>
            </li>
            <li>
              使用弹出的 <strong>桌面窗口</strong> 操作，不要再访问浏览器里的{' '}
              <code>127.0.0.1:9527</code>。
            </li>
          </ol>
        </div>

        <div className="browser-gate-section browser-gate-section-muted">
          <div className="browser-gate-section-title">为什么浏览器也能打开页面？</div>
          <p className="browser-gate-note">
            <code>npm run desktop</code> 会先启动 Vite（默认 {origin}
            ）给桌面 WebView 加载 UI；该地址若被浏览器访问，只能看到前端壳，
            调用 <code>invoke</code> 会失败。这是开发脚手架的副产品，
            <strong>不是</strong>官方支持的网页版入口。
          </p>
        </div>
      </div>
    </div>
  )
}

async function bootstrap() {
  if (!isTauriRuntime()) {
    $error.set(
      '当前为浏览器环境，不是桌面端。请关闭此页，在 crates/jike-grok-desktop 下执行 npm run desktop。',
    )
    $sessionPhase.set('failed')
    return
  }
  try {
    const cwd = await workspaceCwd()
    const settings = await getModelSettings()
    $models.set(settings.models)
    const configDefault =
      settings.default_id || settings.models[0]?.id || ''
    $settingsDefaultModelId.set(configDefault)
    const chats = await listSessions(cwd, 80)
    $chats.set(chats.map(c => ({ id: c.id, title: c.title, cwd: c.cwd, updatedAt: c.updated_at })))
    const wsSet = new Set(chats.map(c => c.cwd))
    if (cwd) wsSet.add(cwd)
    $workspaceOptions.set([...wsSet])
    listenSessionEvents(handleSessionEvent)
    const tabId = await openTab()
    const { modelId, reasoningEffort } = resolveNewTabModel()
    // 注册 tab 分片并投影为当前 tab（cwd / 模型随 createTab 写入 map）
    createTab(tabId, { cwd, modelId, reasoningEffort })
    switchTab(tabId)
    await startSession(tabId, cwd)
    if (modelId) {
      try {
        await setCurrentModel(tabId, modelId, reasoningEffort)
      } catch {
        /* 会话尚未就绪时可忽略，Composer 切换会再试 */
      }
    }
    patchActiveTab({ phase: 'ready', status: 'idle' })
  } catch (e) {
    patchActiveTab({ error: String(e) })
  }
}

function handleSessionEvent(ev: import('./bridge').SessionEventPayload) {
  // 事件路由：先按 ev.tab_id 写对应 tab 的 map（非活跃 tab 也照常更新——
  // 后台 tab 崩溃、收消息、Plan F 恢复重放都依赖它）；仅活跃 tab 由
  // patchTab 内部额外投影到全局 atom。单 tab 时代的「非活跃即丢弃」闸门已移除。
  const tabId = ev.tab_id || $activeTabId.get()
  if (tabId && !hasTab(tabId)) return // 已关闭 tab 的迟到事件
  if (pushTranscriptEvent(ev, tabId)) return

  switch (ev.type) {
    case 'turn_ended':
      patchTab(tabId, { status: 'idle' })
      break
    case 'error':
      patchTab(tabId, { error: ev.message || 'Unknown error', status: 'idle' })
      break
    case 'permission_request':
      if (getTabState(tabId)?.phase === 'loading') break
      if (ev.request_id != null && ev.options?.length) {
        const raw = ev.description || '工具权限请求'
        const parsed = parsePermissionDescription(raw)
        patchTab(tabId, {
          permission: {
            id: String(ev.request_id),
            tool: raw,
            options: ev.options.map((o) => ({ id: o.id, name: o.name, kind: o.kind })),
            kindLabel: parsed.kindLabel,
            title: parsed.title,
            command: parsed.command,
            summary: parsed.summary,
          },
        })
      }
      break
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
      }
      break
    case 'status_changed':
      if (getTabState(tabId)?.phase === 'loading') break
      if (ev.status) patchTab(tabId, { status: ev.status as import('./types').SessionStatus })
      break
    case 'title_changed':
      if (ev.title) patchTab(tabId, { chatTitle: ev.title })
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
    case 'session_id_changed':
      if (ev.session_id) {
        patchTab(tabId, { sessionId: ev.session_id, chatId: ev.session_id })
      }
      break
    case 'other':
      break
    default:
      break
  }
}

function AppSidebar() {
  const collapsed = useStore($sidebarCollapsed)
  const activeId = useStore($activeChatId)
  return <Sidebar collapsed={collapsed} activeChatId={activeId} />
}

/**
 * Plan F 恢复：TabActor 重建为空壳（panic 自动 / 手动重试）后，
 * 用 map 里该 tab 的状态快照重放会话身份（load_session / start_session）+ 模型。
 */
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

function AppError() {
  const err = useStore($error)
  if (!err) return null
  return <div className="banner error">{err}</div>
}

/** 普通对话 vs MCP / 工具等专用面板 */
function AppMainBody() {
  const kind = useStore($utilityKind)
  if (kind === 'mcp') {
    return <McpPanel />
  }
  if (kind === 'tools') {
    return <ToolsPanel />
  }
  if (kind === 'skills') {
    return <SkillsPanel />
  }
  return (
    <>
      <ErrorBoundary
        name="消息区"
        fallback={(error, reset) => (
          <MessagesErrorFallback error={error} onReset={reset} />
        )}
      >
        <AppMessages />
      </ErrorBoundary>
      <AppUserQuestion />
      <AppPermission />
      <AppComposer />
    </>
  )
}

function AppMessages() {
  const msgs = useStore($messages)
  const streaming = useStore($generating)
  const perm = useStore($permission)
  const onFocusUserQuestion = useCallback((toolCallId: string) => {
    window.dispatchEvent(
      new CustomEvent('jike:focus-user-question', { detail: { toolCallId } }),
    )
  }, [])
  return (
    <MessageList
      messages={msgs}
      streaming={streaming}
      permission={perm}
      onFocusUserQuestion={onFocusUserQuestion}
    />
  )
}

function AppComposer() {
  const input = useStore($composerInput)
  const generating = useStore($generating)
  const ready = useStore($shellReady)
  const phase = useStore($sessionPhase)
  const models = useStore($models)
  const modelId = useStore($defaultModelId)
  const effort = useStore($reasoningEffort)
  const cwd = useStore($workspaceCwd)
  const wsOptions = useStore($workspaceOptions)
  const messages = useStore($messages)
  const canSend = ready && !generating && input.trim().length > 0
  const canSwitchWs = ready && !generating && !messages.some((m) => m.role === 'user')

  const onSend = useCallback(async (text?: string) => {
    // 读 atom 最新值，避免 useCallback 闭包捕获旧 input
    const msg = (text ?? $composerInput.get()).trim()
    if (!msg) return
    // 与 bridge / 引擎 meta.promptId 对齐；generateId 兼容无 randomUUID 的 WebView
    const promptId = generateId('p_')
    patchActiveTab({ composerInput: '' })
    // 乐观 UI：立刻插入用户气泡，不依赖 user_text_chunk 回显时机
    patchActiveTab({
      messages: [
        ...$messages.get(),
        {
          id: generateId('msg_'),
          role: 'user' as const,
          text: msg,
          promptId,
        },
      ],
    })
    try {
      patchActiveTab({ status: 'generating', error: '' })
      await sendPrompt($activeTabId.get(), msg, promptId)
    } catch (e) {
      // invoke 失败：撤回乐观气泡并还原输入，避免「空列表 / 幽灵消息」
      patchActiveTab({
        messages: removeUserMessageByPromptId($messages.get(), promptId),
        composerInput: msg,
        error: String(e),
        status: 'idle',
      })
    }
  }, [])

  const onCancel = useCallback(async () => {
    try {
      await cancelTurn($activeTabId.get())
      patchActiveTab({ status: 'idle' })
    } catch (e) {
      patchActiveTab({ error: String(e) })
    }
  }, [])

  const onSwitchModel = useCallback((id: string) => {
    const tabId = $activeTabId.get()
    const entry = $models.get().find((m) => m.id === id)
    const nextEffort = entry?.supports_reasoning_effort
      ? entry.reasoning_effort || $reasoningEffort.get() || 'medium'
      : $reasoningEffort.get() || 'medium'
    $defaultModelId.set(id)
    if (nextEffort) $reasoningEffort.set(nextEffort)
    // 每 Tab 独立记忆模型 / 推理档
    if (tabId) {
      patchTab(tabId, { modelId: id, reasoningEffort: nextEffort || 'medium' })
    }
    void setCurrentModel(tabId, id, nextEffort)
      .then(() => {
        const label = entry?.model?.trim() || entry?.name?.trim() || id
        pushToast(`已切换模型 · ${label}`, 'success')
      })
      .catch((e) => {
        patchActiveTab({ error: String(e) })
        pushToast(`切换模型失败 · ${String(e)}`, 'error')
      })
  }, [])

  const onSwitchReasoningEffort = useCallback((e: string) => {
    const tabId = $activeTabId.get()
    const id = $defaultModelId.get()
    $reasoningEffort.set(e)
    if (tabId) {
      patchTab(tabId, { reasoningEffort: e, ...(id ? { modelId: id } : {}) })
    }
    if (!id || !tabId) return
    void setCurrentModel(tabId, id, e)
      .then(() => {
        pushToast(`已切换思考强度 · ${e}`, 'success')
      })
      .catch((err) => {
        patchActiveTab({ error: String(err) })
        pushToast(`切换思考强度失败`, 'error')
      })
  }, [])

  const onSelectWorkspace = useCallback(async (newCwd: string) => {
    if (newCwd === cwd) return
    try {
      const { setWorkspaceCwd, restartSession } = await import('./bridge')
      const applied = await setWorkspaceCwd(newCwd)
      patchActiveTab({ cwd: applied, phase: 'restarting' })
      $workspaceOptions.set([...new Set([...$workspaceOptions.get(), applied])])
      await restartSession($activeTabId.get(), applied)
      patchActiveTab({ phase: 'ready', status: 'idle' })
    } catch (e) {
      patchActiveTab({ error: String(e), phase: 'ready' })
    }
  }, [cwd])

  const onBrowseWorkspace = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ directory: true, defaultPath: cwd || undefined })
      if (typeof selected === 'string' && selected.trim()) {
        await onSelectWorkspace(selected.trim())
      }
    } catch (e) {
      patchActiveTab({ error: String(e) })
    }
  }, [cwd, onSelectWorkspace])

  return (
    <Composer
      input={input}
      setInput={(v) => patchActiveTab({ composerInput: v })}
      canSend={canSend}
      engineGenerating={generating}
      shellReady={ready}
      sessionPhase={phase}
      models={models}
      selectedModelId={modelId}
      reasoningEffort={effort}
      workspaceCwd={cwd}
      workspaceOptions={wsOptions}
      canSwitchWorkspace={canSwitchWs}
      onSwitchModel={onSwitchModel}
      onSwitchReasoningEffort={onSwitchReasoningEffort}
      onSelectWorkspace={(c) => void onSelectWorkspace(c)}
      onBrowseWorkspace={() => void onBrowseWorkspace()}
      onSend={(t) => void onSend(t)}
      onCancel={() => void onCancel()}
    />
  )
}

function AppPermission() {
  const perm = useStore($permission)
  return <PermissionModal permission={perm} />
}

function AppUserQuestion() {
  const req = useStore($userQuestion)
  const [focusKey, setFocusKey] = useState(0)
  useEffect(() => {
    const onFocus = () => setFocusKey((k) => k + 1)
    window.addEventListener('jike:focus-user-question', onFocus)
    return () => window.removeEventListener('jike:focus-user-question', onFocus)
  }, [])
  return <UserQuestionPanel request={req} focusKey={focusKey} />
}
