import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef } from 'react'
import { Composer } from './components/Composer'
import { MessageList } from './components/Chat/MessageList'
import {
  ErrorBoundary,
  MainViewportErrorFallback,
  MessagesErrorFallback,
} from './components/ErrorBoundary'
import { PermissionModal } from './components/Permission'
import { RightPanel } from './components/RightPanel'
import { SettingsModal } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { ToastHost } from './components/Toast'
import {
  $activeChatId, $activeSessionId, $chats, $composerInput, $contextUsedTokens,
  $defaultModelId, $engineStatus, $error, $generating, $messages, $models,
  $permission, $reasoningEffort, $rightPanelOpen, $sessionPhase,
  $sidebarCollapsed, $shellReady, $workspaceCwd, $workspaceOptions,
  pushToast,
} from './store'
import {
  cancelTurn, getModelSettings, isTauriRuntime, listSessions,
  listenSessionEvents, sendPrompt, setCurrentModel, startSession,
  workspaceCwd,
} from './bridge'
import { pushTranscriptEvent } from './lib/sessionOpen'
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
          <AppHeader />
          <AppError />
          <ErrorBoundary
            name="消息区"
            fallback={(error, reset) => (
              <MessagesErrorFallback error={error} onReset={reset} />
            )}
          >
            <AppMessages />
          </ErrorBoundary>
          {/* Hermes 风格：审批条在输入框上方，非全屏 modal */}
          <AppPermission />
          <AppComposer />
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
    $workspaceCwd.set(cwd)
    const settings = await getModelSettings()
    $models.set(settings.models)
    $defaultModelId.set(settings.default_id || settings.models[0]?.id || '')
    const chats = await listSessions(cwd, 80)
    $chats.set(chats.map(c => ({ id: c.id, title: c.title, cwd: c.cwd, updatedAt: c.updated_at })))
    const wsSet = new Set(chats.map(c => c.cwd))
    if (cwd) wsSet.add(cwd)
    $workspaceOptions.set([...wsSet])
    listenSessionEvents(handleSessionEvent)
    await startSession(cwd)
    $sessionPhase.set('ready')
    $engineStatus.set('idle')
  } catch (e) {
    $error.set(String(e))
  }
}

function handleSessionEvent(ev: import('./bridge').SessionEventPayload) {
  if (pushTranscriptEvent(ev)) return

  switch (ev.type) {
    case 'turn_ended':
      $engineStatus.set('idle')
      break
    case 'error':
      $error.set(ev.message || 'Unknown error')
      $engineStatus.set('idle')
      break
    case 'permission_request':
      if ($sessionPhase.get() === 'loading') break
      if (ev.request_id != null && ev.options?.length) {
        const raw = ev.description || '工具权限请求'
        const parsed = parsePermissionDescription(raw)
        $permission.set({
          id: String(ev.request_id),
          tool: raw,
          options: ev.options.map((o) => ({ id: o.id, name: o.name, kind: o.kind })),
          kindLabel: parsed.kindLabel,
          title: parsed.title,
          command: parsed.command,
          summary: parsed.summary,
        })
      }
      break
    case 'status_changed':
      if ($sessionPhase.get() === 'loading') break
      if (ev.status) $engineStatus.set(ev.status as import('./types').SessionStatus)
      break
    case 'session_id_changed':
      if (ev.session_id) {
        $activeSessionId.set(ev.session_id)
        $activeChatId.set(ev.session_id)
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

function AppHeader() {
  const collapsed = useStore($sidebarCollapsed)
  const panelOpen = useStore($rightPanelOpen)
  const messages = useStore($messages)
  const firstUser = messages.find((m) => m.role === 'user' && m.text.trim())
  const title = firstUser ? firstUser.text.trim().replace(/\s+/g, ' ') : '新对话'

  return (
    <header className="main-header">
      <div className="header-left">
        {collapsed && (
          <button type="button" className="sidebar-toggle-btn" title="展开会话边栏"
            onClick={() => $sidebarCollapsed.set(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />
            </svg>
          </button>
        )}
        <h1 className="chat-title" title={title}>{title}</h1>
      </div>
      <div className="header-right">
        <button
          type="button"
          className={`header-panel-btn${panelOpen ? ' is-active' : ''}`}
          title={panelOpen ? '关闭右侧面板' : '打开右侧面板'}
          aria-pressed={panelOpen}
          onClick={() => $rightPanelOpen.set(!panelOpen)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>
      </div>
    </header>
  )
}

function AppError() {
  const err = useStore($error)
  if (!err) return null
  return <div className="banner error">{err}</div>
}

function AppMessages() {
  const msgs = useStore($messages)
  const streaming = useStore($generating)
  const perm = useStore($permission)
  return <MessageList messages={msgs} streaming={streaming} permission={perm} />
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
  const tokens = useStore($contextUsedTokens)
  const messages = useStore($messages)

  const canSend = ready && !generating && input.trim().length > 0
  const canSwitchWs = ready && !generating && !messages.some((m) => m.role === 'user')

  const onSend = useCallback(async (text?: string) => {
    // 读 atom 最新值，避免 useCallback 闭包捕获旧 input
    const msg = (text ?? $composerInput.get()).trim()
    if (!msg) return
    // 与 bridge / 引擎 meta.promptId 对齐；generateId 兼容无 randomUUID 的 WebView
    const promptId = generateId('p_')
    $composerInput.set('')
    // 乐观 UI：立刻插入用户气泡，不依赖 user_text_chunk 回显时机
    $messages.set([
      ...$messages.get(),
      {
        id: generateId('msg_'),
        role: 'user' as const,
        text: msg,
        promptId,
      },
    ])
    try {
      $engineStatus.set('generating')
      $error.set('')
      await sendPrompt(msg, promptId)
    } catch (e) {
      // invoke 失败：撤回乐观气泡并还原输入，避免「空列表 / 幽灵消息」
      $messages.set(removeUserMessageByPromptId($messages.get(), promptId))
      $composerInput.set(msg)
      $error.set(String(e))
      $engineStatus.set('idle')
    }
  }, [])

  const onCancel = useCallback(async () => {
    try { await cancelTurn(); $engineStatus.set('idle') } catch (e) { $error.set(String(e)) }
  }, [])

  const onSwitchModel = useCallback((id: string) => {
    const entry = $models.get().find((m) => m.id === id)
    const nextEffort = entry?.supports_reasoning_effort
      ? entry.reasoning_effort || $reasoningEffort.get() || 'medium'
      : undefined
    $defaultModelId.set(id)
    if (nextEffort) $reasoningEffort.set(nextEffort)
    void setCurrentModel(id, nextEffort)
      .then(() => {
        const label = entry?.model?.trim() || entry?.name?.trim() || id
        pushToast(`已切换模型 · ${label}`, 'success')
      })
      .catch((e) => {
        $error.set(String(e))
        pushToast(`切换模型失败 · ${String(e)}`, 'error')
      })
  }, [])

  const onSwitchReasoningEffort = useCallback((e: string) => {
    $reasoningEffort.set(e)
    const id = $defaultModelId.get()
    if (!id) return
    void setCurrentModel(id, e)
      .then(() => {
        pushToast(`已切换思考强度 · ${e}`, 'success')
      })
      .catch((err) => {
        $error.set(String(err))
        pushToast(`切换思考强度失败`, 'error')
      })
  }, [])

  const onSelectWorkspace = useCallback(async (newCwd: string) => {
    if (newCwd === cwd) return
    try {
      const { setWorkspaceCwd, restartSession } = await import('./bridge')
      const applied = await setWorkspaceCwd(newCwd)
      $workspaceCwd.set(applied)
      $workspaceOptions.set([...new Set([...$workspaceOptions.get(), applied])])
      $sessionPhase.set('restarting')
      await restartSession(applied)
      $sessionPhase.set('ready')
      $engineStatus.set('idle')
    } catch (e) {
      $error.set(String(e))
      $sessionPhase.set('ready')
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
      $error.set(String(e))
    }
  }, [cwd, onSelectWorkspace])

  return (
    <Composer
      input={input}
      setInput={(v) => $composerInput.set(v)}
      canSend={canSend}
      engineGenerating={generating}
      shellReady={ready}
      sessionPhase={phase}
      models={models}
      selectedModelId={modelId}
      reasoningEffort={effort}
      workspaceCwd={cwd}
      workspaceOptions={wsOptions}
      contextUsedTokens={tokens}
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
