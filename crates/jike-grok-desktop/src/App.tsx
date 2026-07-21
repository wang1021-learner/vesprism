import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import './App.css'

type SessionStatus = 'initializing' | 'idle' | 'generating' | 'ended' | 'unknown'

type PermissionOption = { id: string; name: string }

type PermissionRequest = {
  request_id: number
  description: string
  options: PermissionOption[]
}

type SessionEvent =
  | { type: 'agent_text_chunk'; text: string }
  | { type: 'agent_thought_chunk'; text: string }
  | { type: 'user_text_chunk'; text: string }
  | { type: 'turn_ended'; stop_reason: string }
  | { type: 'error'; message: string }
  | { type: 'other'; debug: string }
  | {
      type: 'permission_request'
      request_id: number
      description: string
      options: PermissionOption[]
    }
  | { type: 'status_changed'; status: SessionStatus }

type ChatRole = 'user' | 'assistant' | 'thought' | 'system'

type ChatMessage = {
  id: number
  role: ChatRole
  text: string
}

/** 是否运行在 Tauri WebView（普通浏览器里没有桥接）。 */
function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown
    __TAURI__?: unknown
    isTauri?: boolean
  }
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__ || w.isTauri)
}

function statusLabel(s: SessionStatus): string {
  switch (s) {
    case 'initializing':
      return '初始化中…'
    case 'idle':
      return '就绪'
    case 'generating':
      return '生成中…'
    case 'ended':
      return '已结束'
    default:
      return '未知'
  }
}

/** AI 气泡：Markdown + GFM + 代码高亮。 */
function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

/** 用户 / 系统 / 思考：纯文本，保留换行。 */
function PlainText({ text }: { text: string }) {
  return <pre className="bubble-text">{text}</pre>
}

export default function App() {
  const inTauri = isTauriRuntime()
  const [status, setStatus] = useState<SessionStatus>('unknown')
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [permission, setPermission] = useState<PermissionRequest | null>(null)
  const nextId = useRef(1)
  const bottomRef = useRef<HTMLDivElement>(null)
  /** 当前正在流式拼接的气泡角色（同角色连续 chunk 追加到同一条消息）。 */
  const streamingRole = useRef<ChatRole | null>(null)
  /** 避免 React StrictMode 下重复自动启动会话。 */
  const autoStarted = useRef(false)

  /** 追加或新建一条聊天气泡。`append=true` 时尽量拼到最后一条同角色消息。 */
  const pushMessage = useCallback((role: ChatRole, text: string, append = false) => {
    setMessages((prev) => {
      if (
        append &&
        streamingRole.current === role &&
        prev.length > 0 &&
        prev[prev.length - 1].role === role
      ) {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        copy[copy.length - 1] = { ...last, text: last.text + text }
        return copy
      }
      streamingRole.current = role
      const id = nextId.current++
      return [...prev, { id, role, text }]
    })
  }, [])

  // 订阅后端 session-event（仅 Tauri 环境）。
  useEffect(() => {
    if (!inTauri) return

    let unlisten: UnlistenFn | undefined
    let cancelled = false

    ;(async () => {
      unlisten = await listen<SessionEvent>('session-event', (event) => {
        const payload = event.payload
        switch (payload.type) {
          case 'agent_text_chunk':
            pushMessage('assistant', payload.text, true)
            break
          case 'agent_thought_chunk':
            pushMessage('thought', payload.text, true)
            break
          case 'user_text_chunk':
            // 发送时已本地展示用户消息，忽略回显。
            break
          case 'turn_ended':
            streamingRole.current = null
            break
          case 'error':
            streamingRole.current = null
            setError(payload.message)
            pushMessage('system', `错误: ${payload.message}`)
            break
          case 'other':
            // 工具调用等其它更新，暂不展示。
            break
          case 'permission_request':
            setPermission({
              request_id: payload.request_id,
              description: payload.description,
              options: payload.options,
            })
            break
          case 'status_changed':
            setStatus(payload.status)
            break
        }
      })
      if (cancelled) unlisten()
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [inTauri, pushMessage])

  // 新消息时滚到底部。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, permission])

  /** 向后端请求启动进程内会话。 */
  const startSession = useCallback(async () => {
    if (!inTauri) return
    setStarting(true)
    setError(null)
    try {
      const cwd = await invoke<string>('workspace_cwd')
      await invoke('start_session', { cwd })
      setReady(true)
      pushMessage('system', `会话已启动 · ${cwd}`)
    } catch (e) {
      const msg = String(e)
      setError(msg)
      pushMessage('system', `启动失败: ${msg}`)
    } finally {
      setStarting(false)
    }
  }, [inTauri, pushMessage])

  // 首次挂载自动启动会话（仅桌面 WebView）。
  useEffect(() => {
    if (!inTauri) return
    if (autoStarted.current) return
    autoStarted.current = true
    void startSession()
  }, [inTauri, startSession])

  /** 发送当前输入框内容。 */
  const onSend = async () => {
    const text = input.trim()
    if (!text || !ready || status === 'generating') return
    setInput('')
    setError(null)
    streamingRole.current = null
    pushMessage('user', text)
    try {
      await invoke('send_prompt', { text })
    } catch (e) {
      const msg = String(e)
      setError(msg)
      pushMessage('system', `发送失败: ${msg}`)
    }
  }

  /** 取消正在生成的一轮。 */
  const onCancel = async () => {
    try {
      await invoke('cancel_turn')
    } catch (e) {
      setError(String(e))
    }
  }

  /** 用户在权限弹窗中选择某一项。 */
  const onPermission = async (optionId: string) => {
    if (!permission) return
    const { request_id } = permission
    setPermission(null)
    try {
      await invoke('respond_permission', {
        requestId: request_id,
        optionId,
      })
    } catch (e) {
      setError(String(e))
    }
  }

  const canSend = inTauri && ready && status !== 'generating' && status !== 'initializing'

  // 普通浏览器直接打开 Vite 端口时的引导页。
  if (!inTauri) {
    return (
      <div className="app browser-gate">
        <div className="browser-gate-card">
          <h1>请用桌面应用打开</h1>
          <p>
            当前页面是 Vite 开发服务器（例如 <code>http://127.0.0.1:1420</code>
            ），运行在普通浏览器中，没有 Tauri 桥接，因此无法调用{' '}
            <code>invoke</code>。
          </p>
          <p className="browser-gate-hint">请在终端执行：</p>
          <pre className="browser-gate-cmd">
            {`cd crates/jike-grok-desktop\ncargo tauri dev`}
          </pre>
          <p className="browser-gate-hint">
            使用弹出的 <strong>AIAcong Grok Desktop</strong> 窗口，不要在浏览器里访问该地址。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>AIAcong Grok Desktop</h1>
          <p className="subtitle">进程内 Agent · 非终端套壳</p>
        </div>
        <div className="status-bar">
          <span className={`dot status-${status}`} />
          <span>{statusLabel(status)}</span>
          {!ready && (
            <button type="button" disabled={starting} onClick={() => void startSession()}>
              {starting ? '启动中…' : '启动会话'}
            </button>
          )}
          {status === 'generating' && (
            <button type="button" className="danger" onClick={() => void onCancel()}>
              取消
            </button>
          )}
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <main className="chat">
        {messages.length === 0 && (
          <div className="empty">启动会话后开始对话。流式回复会显示在这里。</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble role-${m.role}`}>
            <div className="role-label">
              {m.role === 'user'
                ? '你'
                : m.role === 'assistant'
                  ? 'AI'
                  : m.role === 'thought'
                    ? '思考'
                    : '系统'}
            </div>
            {m.role === 'assistant' ? (
              <AssistantMarkdown text={m.text} />
            ) : (
              <PlainText text={m.text} />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      {permission && (
        <div className="permission-modal">
          <div className="permission-card">
            <h2>权限请求</h2>
            <pre className="permission-desc">{permission.description}</pre>
            <div className="permission-actions">
              {permission.options.map((o) => (
                <button key={o.id} type="button" onClick={() => void onPermission(o.id)}>
                  {o.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer className="composer">
        <textarea
          value={input}
          rows={2}
          placeholder={ready ? '输入消息，Enter 发送（Shift+Enter 换行）' : '请先启动会话…'}
          disabled={!canSend}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void onSend()
            }
          }}
        />
        <button
          type="button"
          className="send"
          disabled={!canSend || !input.trim()}
          onClick={() => void onSend()}
        >
          发送
        </button>
      </footer>
    </div>
  )
}
