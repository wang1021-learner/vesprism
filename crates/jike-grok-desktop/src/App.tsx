import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef } from 'react'
import { Composer } from './components/Composer'
import { MessageList } from './components/Chat/MessageList'
import { PermissionModal } from './components/Permission'
import { SettingsModal } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import {
  $activeChatId, $activeSessionId, $chats, $composerInput, $contextUsedTokens,
  $defaultModelId, $engineStatus, $error, $generating, $messages, $models,
  $permission, $reasoningEffort, $sessionPhase,
  $sidebarCollapsed, $shellReady, $workspaceCwd, $workspaceOptions,
} from './store'
import {
  cancelTurn, getModelSettings, listSessions,
  listenSessionEvents, sendPrompt, setCurrentModel, startSession,
  workspaceCwd,
} from './bridge'
import { pushTranscriptEvent } from './lib/sessionOpen'

export default function App() {
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
      <AppSidebar />
      <div className="main-viewport">
        <AppHeader />
        <AppError />
        <AppMessages />
        <AppComposer />
        <AppPermission />
        <SettingsModal />
      </div>
    </div>
  )
}

async function bootstrap() {
  try {
    const cwd = await workspaceCwd()
    $workspaceCwd.set(cwd)
    const settings = await getModelSettings()
    $models.set(settings.models)
    $defaultModelId.set(settings.default_id || settings.models[0]?.id || '')
    const chats = await listSessions(cwd)
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
        $permission.set({
          id: String(ev.request_id),
          tool: ev.description || 'unknown',
          args: {},
          message: ev.options.map((o) => o.name).join(' / '),
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
  const messages = useStore($messages)
  const firstUser = messages.find((m) => m.role === 'user' && m.text.trim())
  const title = firstUser
    ? firstUser.text.trim().replace(/\s+/g, ' ')
    : '新对话'

  return (
    <header className="main-header">
      <div className="header-left">
        {collapsed && (
          <button
            type="button"
            className="sidebar-toggle-btn"
            title="展开会话边栏"
            onClick={() => $sidebarCollapsed.set(false)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
        )}
        <h1 className="chat-title" title={title}>
          {title}
        </h1>
      </div>
      <div className="header-right" />
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
    const msg = text ?? input.trim()
    if (!msg) return
    $composerInput.set('')
    try {
      $engineStatus.set('generating')
      $error.set('')
      await sendPrompt(msg)
    } catch (e) {
      $error.set(String(e))
      $engineStatus.set('idle')
    }
  }, [input])

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
  }, [])

  const onSwitchReasoningEffort = useCallback((e: string) => {
    $reasoningEffort.set(e)
    const id = $defaultModelId.get()
    if (id) void setCurrentModel(id, e)
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
