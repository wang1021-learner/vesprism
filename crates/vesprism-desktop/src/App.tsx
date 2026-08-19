import { useStore } from '@nanostores/react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Composer } from './components/Composer'
import { SandboxBanner } from './components/SandboxBanner'
import { MessageList } from './components/Chat/MessageList'
import { WindowChrome } from './components/WindowChrome'
import { CommandPalette } from './components/CommandPalette'
import {
  ErrorBoundary,
  MainViewportErrorFallback,
  MessagesErrorFallback,
} from './components/ErrorBoundary'
import { PendingApprovalFallback } from './components/Permission'
import { UserQuestionPanel } from './components/UserQuestion'

import { RightPanel } from './components/RightPanel'
import { SettingsModal } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { ToastHost } from './components/Toast'
import { RewindPicker } from './components/RewindPicker'
import { CompositionPanel } from './components/CompositionPanel'
import { GoalStrip } from './components/GoalStrip'
import { SessionTermDock } from './components/SessionTermDock'
import { syncWindowTitle, titleForWindow } from './lib/windowTitle'
import {
  $activeTabId, $tabs,
  $activeChatId, $chats, $composerInput,
  $defaultModelId, $error, $generating, $messages, $models, $queuedPrompts,
  $permission, $userQuestion, $reasoningEffort, $sessionPhase,
  $settingsDefaultModelId, $utilityKind,
  $sidebarCollapsed, $shellReady, $workspaceCwd, $workspaceOptions,
  $preferredWorkspaceCwd, $scratchCwd, $securityPolicy,
  createTab, getTabState, patchActiveTab, patchTab, resolveNewTabModel,
  switchTab, pushToast,
} from './store'
import { McpPanel } from './components/McpPanel'
import { ToolsPanel } from './components/ToolsPanel'
import { SkillsPanel } from './components/SkillsPanel'
import { WorkflowsPanel } from './components/WorkflowsPanel'

const FlowCanvas = lazy(() => import('./workbench/canvas'))
const AgentsPanel = lazy(() => import('./workbench/agents/AgentsPanel'))
const RunDetailPanel = lazy(() => import('./workbench/run-detail/RunDetailPanel'))
import {
  getModelSettings, isTauriRuntime, listSessions,
  listenSessionEvents, openTab, removeQueuedPrompt, setCurrentModel,
  startSession, workspaceCwd, scratchCwd, getSecurityPolicy,
  type PromptAttach,
} from './bridge'
import { sendSessionPrompt } from './lib/sendSessionPrompt'
import { cancelActiveTurn } from './lib/cancelActiveTurn'
import { handleSessionEvent } from './lib/sessionEvents'
import { policyFromDto } from './lib/executionPolicy'

/** 独立订阅，避免顶栏切 Tab 时整棵 DesktopApp（侧栏+消息区）跟着重绘 */
function WindowTitleSync() {
  const activeId = useStore($activeTabId)
  const tabs = useStore($tabs)
  useEffect(() => {
    const t = tabs.find((tab) => tab.id === activeId)
    const kind = activeId ? getTabState(activeId)?.utilityKind : null
    syncWindowTitle(titleForWindow(t?.title || '', kind))
  }, [activeId, tabs])
  return null
}

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
      <WindowTitleSync />
      <ToastHost />
      <CommandPalette />
      <RewindPicker />
      <div className="app-body">
        <ErrorBoundary name="侧栏">
          <AppSidebar />
        </ErrorBoundary>
        <div className="app-main-area">
          <WindowChrome />
          <ErrorBoundary
            name="主界面"
            fallback={(error, reset) => (
              <MainViewportErrorFallback error={error} onReset={reset} />
            )}
          >
            <div className="main-viewport">
              <AppError />
              <AppMainBody />
              <SettingsModal />
              <CompositionPanel />
            </div>
          </ErrorBoundary>
        </div>
        <RightPanel />
      </div>
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
              <pre className="browser-gate-pre">{`cd crates/vesprism-desktop`}</pre>
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
      '当前为浏览器环境，不是桌面端。请关闭此页，在项目目录下执行 npm run desktop。',
    )
    $sessionPhase.set('failed')
    return
  }
  try {
    const [cwd, scratch] = await Promise.all([workspaceCwd(), scratchCwd()])
    $scratchCwd.set(scratch)
    const settings = await getModelSettings()
    $models.set(settings.models)
    const configDefault =
      settings.default_id || settings.models[0]?.id || ''
    $settingsDefaultModelId.set(configDefault)
    // 主工作区：侧栏置顶/展开用；与「打开历史会话后的 Tab cwd」解耦
    if (cwd) $preferredWorkspaceCwd.set(cwd)
    try {
      $securityPolicy.set(policyFromDto(await getSecurityPolicy(cwd)))
    } catch {
      /* 策略缺省为审批模式 */
    }
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
    await startSession(tabId, cwd, { modelId, reasoningEffort })
    patchActiveTab({ phase: 'ready', status: 'idle' })
  } catch (e) {
    patchActiveTab({ error: String(e) })
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


function AppError() {
  const err = useStore($error)
  if (!err) return null
  return (
    <div className="app-error-bar" role="alert">
      <svg
        className="app-error-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span className="app-error-text">{err}</span>
      <button
        type="button"
        className="app-error-dismiss"
        title="关闭提示"
        aria-label="关闭提示"
        onClick={() => patchActiveTab({ error: '' })}
      >
        ✕
      </button>
    </div>
  )
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
  if (kind === 'workflows') {
    return <WorkflowsPanel />
  }
  if (kind === 'flow-canvas') {
    return (
      <Suspense fallback={<div className="flow-canvas-loading">加载流程画布…</div>}>
        <FlowCanvas />
      </Suspense>
    )
  }
  if (kind === 'flow-run') {
    return (
      <Suspense fallback={<div className="run-detail-loading">加载试跑详情…</div>}>
        <RunDetailPanel />
      </Suspense>
    )
  }
  if (kind === 'agents') {
    return (
      <Suspense fallback={<div className="agents-panel-loading">加载 Agent 编制…</div>}>
        <AgentsPanel />
      </Suspense>
    )
  }
  return (
    <div className="session-workspace">
      <div className="session-chat">
        <ErrorBoundary
          name="消息区"
          fallback={(error, reset) => (
            <MessagesErrorFallback error={error} onReset={reset} />
          )}
        >
          <GoalStrip />
          <AppMessages />
        </ErrorBoundary>
        <AppUserQuestion />
        <AppPermission />
        <SandboxBanner />
        <AppComposer />
      </div>
      <SessionTermDock />
    </div>
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
  const queued = useStore($queuedPrompts)
  const canSend = ready
  const canSwitchWs = ready && !generating && !messages.some((m) => m.role === 'user')

  const onSend = useCallback(async (
    text?: string,
    attachments?: PromptAttach[],
    mode?: 'queue' | 'interject',
  ) => {
    await sendSessionPrompt({ text, attachments, mode })
  }, [])

  const onRemoveQueued = useCallback(async (id: string, version: number) => {
    const prev = $queuedPrompts.get()
    patchActiveTab({ queuedPrompts: prev.filter((q) => q.id !== id) })
    try {
      await removeQueuedPrompt($activeTabId.get(), id, version)
    } catch (e) {
      patchActiveTab({ queuedPrompts: prev, error: String(e) })
    }
  }, [])

  const onCancel = useCallback(() => {
    void cancelActiveTurn()
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
      $preferredWorkspaceCwd.set(applied)
      patchActiveTab({ cwd: applied, phase: 'restarting' })
      $workspaceOptions.set([...new Set([...$workspaceOptions.get(), applied])])
      try {
        $securityPolicy.set(policyFromDto(await getSecurityPolicy(applied)))
      } catch {
        /* 沿用当前策略 */
      }
      const tabId = $activeTabId.get()
      const st = getTabState(tabId)
      await restartSession(tabId, applied, {
        modelId: st?.modelId,
        reasoningEffort: st?.reasoningEffort,
      })
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

  const setComposerInput = useCallback((v: string) => {
    patchActiveTab({ composerInput: v })
  }, [])

  return (
    <Composer
      input={input}
      setInput={setComposerInput}
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
      queuedPrompts={queued}
      onSend={(t, a, mode) => void onSend(t, a, mode)}
      onRemoveQueued={(id, ver) => void onRemoveQueued(id, ver)}
      onCancel={() => void onCancel()}
    />
  )
}

function AppPermission() {
  const perm = useStore($permission)
  return <PendingApprovalFallback permission={perm} />
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
