import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatMessage, ToolCallData } from '../../types'
import { AssistantMarkdown } from './AssistantMarkdown'

const USER_BUBBLE_FOLD_THRESHOLD = 600

/**
 * 对齐官方 TUI（xai-grok-pager-render::glyphs::braille_spinner_frames）：
 * 正常：⠋⠙⠹⠸⠼⠴⠦⠧；WebView 无字形时回退 | / - \（同 CLI ConHost fallback）
 * 帧率约 7.5fps（每帧 133ms ≈ SPINNER_DIVISOR=4 @ 30fps）
 */
const BRAILLE_SPINNER_FRAMES = [
  '\u{280b}', // ⠋
  '\u{2819}', // ⠙
  '\u{2839}', // ⠹
  '\u{2838}', // ⠸
  '\u{283c}', // ⠼
  '\u{2834}', // ⠴
  '\u{2826}', // ⠦
  '\u{2827}', // ⠧
] as const

const ASCII_SPINNER_FRAMES = ['|', '/', '-', '\\'] as const

const BRAILLE_FRAME_MS = 133

/** 测一次：当前字体画不出 Braille 时用 ASCII，避免「有节点但看不见」 */
function canRenderBraille(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    // 与 .activity-braille-spinner 主字体一致
    ctx.font =
      '14px "Segoe UI Symbol", "Cascadia Mono", "Segoe UI", ui-monospace, monospace'
    const braille = ctx.measureText(BRAILLE_SPINNER_FRAMES[0]).width
    const ascii = ctx.measureText('|').width
    // 缺失字形时宽度常接近 0，或与 tofu/空格差不多
    return braille >= ascii * 0.5 && braille > 2
  } catch {
    return false
  }
}

let _brailleOk: boolean | null = null
function preferBrailleFrames(): boolean {
  if (_brailleOk == null) {
    _brailleOk = typeof document !== 'undefined' ? canRenderBraille() : true
  }
  return _brailleOk
}

const BrailleSpinner = memo(function BrailleSpinner() {
  const frames = preferBrailleFrames()
    ? BRAILLE_SPINNER_FRAMES
    : ASCII_SPINNER_FRAMES
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      setFrame((i) => (i + 1) % frames.length)
    }, BRAILLE_FRAME_MS)
    return () => window.clearInterval(id)
  }, [frames])
  return (
    <span
      className="activity-braille-spinner"
      aria-hidden
      title="进行中"
      data-spinner={preferBrailleFrames() ? 'braille' : 'ascii'}
    >
      {frames[frame % frames.length]}
    </span>
  )
})

interface MessageItemProps {
  message: ChatMessage
  streaming?: boolean
}

function messageItemEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  if (prev.streaming !== next.streaming) return false
  if (!next.streaming && !prev.streaming) {
    return prev.message === next.message
  }
  const a = prev.message
  const b = next.message
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.text === b.text &&
    a.isStreaming === b.isStreaming &&
    (a.role !== 'tool' ||
      (a.toolCall?.status === b.toolCall?.status &&
        a.toolCall?.preview === b.toolCall?.preview &&
        a.toolCall?.detail === b.toolCall?.detail &&
        a.toolCall?.title === b.toolCall?.title))
  )
}

export const MessageItem = memo(function MessageItem({
  message,
  streaming = false,
}: MessageItemProps) {
  switch (message.role) {
    case 'system':
      return (
        <div className="message-row system-row">
          <div className="system-pill">{message.text}</div>
        </div>
      )

    case 'user':
      return <UserBubble text={message.text} />

    case 'thought':
      return (
        <ThoughtLine
          text={message.text}
          streaming={streaming || Boolean(message.isStreaming)}
          timing={message.thoughtTiming}
        />
      )

    case 'tool':
      return (
        <ToolLine
          tool={
            message.toolCall ??
            legacyToolFromMessage(message)
          }
          streaming={streaming || Boolean(message.isStreaming)}
        />
      )

    case 'assistant':
      return (
        <div className="message-row assistant-row">
          <div className="assistant-badge">
            <span className="badge-icon">✦</span>
            <span className="badge-text">Assistant</span>
          </div>
          <div className="assistant-content md-body">
            <AssistantMarkdown text={message.text} />
          </div>
        </div>
      )

    default:
      return null
  }
}, messageItemEqual)

function legacyToolFromMessage(message: ChatMessage): ToolCallData {
  return {
    toolCallId: message.toolCallId || message.id,
    kind: 'other',
    status: 'completed',
    title: message.tool || 'tool',
    detail: message.tool || '',
    preview: message.text || '',
  }
}

function formatDuration(timing?: { start: number; end?: number }): string | null {
  if (!timing?.start) return null
  const end = timing.end ?? Date.now()
  if (end < timing.start) return null
  const sec = (end - timing.start) / 1000
  if (sec < 0.05) return null
  if (sec < 10) return `${sec.toFixed(1).replace(/\.0$/, '')}s`
  return `${Math.round(sec)}s`
}

/** 截图风格：思考了 3s › — 默认折叠，点击展开正文 */
const ThoughtLine = memo(function ThoughtLine({
  text,
  streaming,
  timing,
}: {
  text: string
  streaming: boolean
  timing?: { start: number; end?: number }
}) {
  const [expanded, setExpanded] = useState(false)
  const duration = formatDuration(
    streaming
      ? timing?.start
        ? { start: timing.start, end: Date.now() }
        : undefined
      : timing,
  )
  const title = streaming
    ? duration
      ? `思考中… ${duration}`
      : '思考中…'
    : duration
      ? `思考了 ${duration}`
      : '思考过程'
  const bodyRef = useRef<HTMLPreElement>(null)
  const canExpand = text.trim().length > 0

  useLayoutEffect(() => {
    if (!expanded || !streaming) return
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [expanded, streaming, text])

  return (
    <div className="message-row activity-row thought-row">
      <div className={`activity-line thought-line${streaming ? ' is-live' : ''}`}>
        <button
          type="button"
          className="activity-toggle"
          onClick={() => canExpand && setExpanded((v) => !v)}
          aria-expanded={expanded}
          disabled={!canExpand}
          title={expanded ? '收起思考' : '展开思考'}
        >
          {/* CLI 布局：spinner 在左 — `⠋ 思考中… 1.4s` */}
          {streaming ? <BrailleSpinner /> : null}
          <span className="activity-label">{title}</span>
          {canExpand ? (
            <span className={`activity-chevron${expanded ? ' open' : ''}`} aria-hidden>
              ›
            </span>
          ) : null}
        </button>
        {expanded && canExpand ? (
          <pre ref={bodyRef} className="activity-body thought-body">
            {text}
          </pre>
        ) : null}
      </div>
    </div>
  )
})

function kindIcon(kind: string): string {
  switch (kind) {
    case 'read':
      return '📄'
    case 'edit':
      return '✎'
    case 'execute':
      return '▶'
    case 'search':
      return '⌕'
    case 'fetch':
      return '↗'
    case 'delete':
      return '⌫'
    case 'think':
      return '💭'
    default:
      return '·'
  }
}

function toolHeadline(tool: ToolCallData): string {
  const detail = tool.detail?.trim() || ''
  const short =
    detail.length > 72 ? `${detail.slice(0, 70)}…` : detail
  const running =
    tool.status === 'pending' || tool.status === 'in_progress'

  switch (tool.kind) {
    case 'execute':
      return running
        ? `正在运行 ${short || tool.title}`
        : `已运行 ${short || tool.title}`
    case 'read':
      return running
        ? `正在读取 ${short || tool.title}`
        : `已读取 ${short || tool.title}`
    case 'edit':
      return running
        ? `正在编辑 ${short || tool.title}`
        : `已编辑 ${short || tool.title}`
    case 'search':
      return running
        ? `正在搜索 ${short || tool.title}`
        : `已搜索 ${short || tool.title}`
    case 'fetch':
      return running
        ? `正在抓取 ${short || tool.title}`
        : `已抓取 ${short || tool.title}`
    case 'delete':
      return running ? `正在删除 ${short}` : `已删除 ${short || tool.title}`
    default: {
      // 官方 title 常为 "Execute `…`" / "Explored N files"
      const t = tool.title?.trim() || '工具'
      if (running && !/中|ing/i.test(t)) return `进行中 · ${t}`
      return t
    }
  }
}

/** 截图风格：▶ 已运行 cmd 2.7s — 默认折叠，可展开输出 */
const ToolLine = memo(function ToolLine({
  tool,
  streaming,
}: {
  tool: ToolCallData
  streaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const duration = formatDuration(tool.timing)
  const live =
    streaming || tool.status === 'pending' || tool.status === 'in_progress'
  const preview = tool.preview?.trim() || ''
  const hasBody = preview.length > 0 || (tool.diffs?.length ?? 0) > 0
  const headline = toolHeadline(tool)

  return (
    <div className="message-row activity-row tool-row">
      <div
        className={`activity-line tool-line status-${tool.status}${live ? ' is-live' : ''}`}
      >
        <button
          type="button"
          className="activity-toggle"
          onClick={() => hasBody && setExpanded((v) => !v)}
          aria-expanded={expanded}
          disabled={!hasBody}
          title={hasBody ? (expanded ? '收起输出' : '展开输出') : undefined}
        >
          {/* 进行中：CLI 同款 braille spinner；结束后显示 kind 图标 */}
          {live ? (
            <BrailleSpinner />
          ) : (
            <span className="activity-icon" aria-hidden data-kind={tool.kind}>
              {kindIcon(tool.kind)}
            </span>
          )}
          <span className="activity-label" title={tool.detail || tool.title}>
            {headline}
          </span>
          {duration ? <span className="activity-meta">{duration}</span> : null}
          {hasBody ? (
            <span className={`activity-chevron${expanded ? ' open' : ''}`} aria-hidden>
              ›
            </span>
          ) : null}
        </button>
        {expanded && hasBody ? (
          <div className="activity-body tool-body">
            {preview ? <pre className="tool-output-pre">{preview}</pre> : null}
            {tool.diffs?.map((d, i) => (
              <div key={`${d.path}-${i}`} className="tool-diff-block">
                <div className="tool-diff-path">{d.path || 'diff'}</div>
                <pre className="tool-output-pre">
                  {(d.oldText
                    ? d.oldText
                        .split('\n')
                        .slice(0, 30)
                        .map((l) => `-${l}`)
                        .join('\n') + '\n'
                    : '') +
                    d.newText
                      .split('\n')
                      .slice(0, 40)
                      .map((l) => `+${l}`)
                      .join('\n')}
                </pre>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
})

const UserBubble = memo(function UserBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > USER_BUBBLE_FOLD_THRESHOLD
  const displayText =
    isLong && !expanded ? text.split('\n').slice(0, 3).join('\n') : text

  return (
    <div className="message-row user-row">
      <div className="bubble bubble-user">
        <pre className="bubble-text">{displayText}</pre>
        {isLong ? (
          <button
            type="button"
            className="bubble-expand-toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? '收起'
              : `展开全部（${text.length.toLocaleString()} 字符）`}
          </button>
        ) : null}
      </div>
    </div>
  )
})
