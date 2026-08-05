import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, ToolCallData } from '../../types'
import { AssistantMarkdown } from './AssistantMarkdown'
import { DiffLines } from './DiffLines'

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

/**
 * 安静 scaffold 状态位：进行中 spinner / 失败 ! / 成功留空（无菱形竖轨）
 */
type ActivityTone = 'thought' | 'tool' | 'tool-failed'

const ScaffoldGlyph = memo(function ScaffoldGlyph({
  tone,
  live,
}: {
  tone: ActivityTone
  live: boolean
}) {
  if (live) {
    return (
      <span className={`scaffold-glyph is-live tone-${tone}`} aria-hidden>
        <BrailleSpinner />
      </span>
    )
  }
  if (tone === 'tool-failed') {
    return (
      <span className="scaffold-glyph is-error" aria-hidden title="失败">
        !
      </span>
    )
  }
  return <span className="scaffold-glyph is-idle" aria-hidden />
})

interface MessageItemProps {
  message: ChatMessage
  streaming?: boolean
  /** 点击「Ask · 待回答」工具行时聚焦问卷面板 */
  onFocusUserQuestion?: (toolCallId: string) => void
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
  onFocusUserQuestion,
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

    case 'tool': {
      const tool = message.toolCall ?? legacyToolFromMessage(message)
      if (tool.kind === 'ask_user') {
        return (
          <AskUserToolLine
            tool={tool}
            onFocus={onFocusUserQuestion}
          />
        )
      }
      return (
        <ToolLine
          tool={tool}
          streaming={streaming || Boolean(message.isStreaming)}
        />
      )
    }

    case 'assistant':
      // 不显示 Assistant 角标：左右气泡/活动行已能区分角色，角标冗余
      return (
        <div className="message-row assistant-row">
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

/** 思考行：安静灰字 + 右侧 caret；进行中 shimmer；展开体无重框 */
const ThoughtLine = memo(function ThoughtLine({
  text,
  streaming,
  timing,
}: {
  text: string
  streaming: boolean
  timing?: { start: number; end?: number }
}) {
  /** null = 流式时默认展开预览 */
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? streaming
  const duration = formatDuration(streaming ? undefined : timing)
  const title = streaming
    ? 'Thinking…'
    : duration
      ? `Thought for ${duration}`
      : timing?.end && timing.start && (timing.end - timing.start) / 1000 < 1
        ? 'Thought briefly'
        : 'Thought'
  const bodyRef = useRef<HTMLPreElement>(null)
  const canExpand = text.trim().length > 0

  useLayoutEffect(() => {
    if (!open || !streaming) return
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [open, streaming, text])

  return (
    <div
      className={`message-row scaffold-row thought-row${streaming ? ' is-live' : ''}${open ? ' is-open' : ''}`}
      data-conversation-scaffold=""
    >
      <div className="scaffold-line">
        <ScaffoldGlyph tone="thought" live={streaming} />
        <div className="scaffold-main">
          <button
            type="button"
            className={`scaffold-toggle${streaming ? ' is-live' : ''}`}
            onClick={() => canExpand && setUserOpen(!open)}
            aria-expanded={open}
            disabled={!canExpand}
            title={open ? '收起思考' : '展开思考'}
          >
            <span className={`scaffold-label${streaming ? ' is-shimmer' : ''}`}>{title}</span>
            {canExpand ? (
              <span className={`scaffold-caret${open ? ' is-open' : ''}`} aria-hidden>
                ›
              </span>
            ) : null}
          </button>
          {open && canExpand ? (
            <div className="thought-expanded">
              <pre ref={bodyRef} className="thought-body-pre">
                {text}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
})

function toolHeadline(tool: ToolCallData): string {
  const detail = tool.detail?.trim() || ''
  const short =
    detail.length > 72 ? `${detail.slice(0, 70)}…` : detail
  const label = short || tool.title?.trim() || 'tool'
  // scaffold 风格工具行
  switch (tool.kind) {
    case 'ask_user':
      return `Ask · ${label}`
    case 'execute':
      return `Run ${label}`
    case 'read':
      return `Read ${label}`
    case 'edit':
      return `Edit ${label}`
    case 'search':
      return `Search ${label}`
    case 'fetch':
      return `Fetch ${label}`
    case 'delete':
      return `Delete ${label}`
    default:
      return `Run ${label}`
  }
}

/** AI 问卷工具卡：Ask · 摘要 · 待回答 / 已回答 */
const AskUserToolLine = memo(function AskUserToolLine({
  tool,
  onFocus,
}: {
  tool: ToolCallData
  onFocus?: (toolCallId: string) => void
}) {
  const pending =
    tool.status === 'pending' || tool.status === 'in_progress'
  const detail = tool.detail?.trim() || tool.title || '向你提问'
  const short = detail.length > 64 ? `${detail.slice(0, 62)}…` : detail
  const statusText = pending
    ? '待回答'
    : tool.preview?.trim() || '已处理'

  return (
    <div
      className={`message-row scaffold-row tool-row ask-user-row kind-ask-user${pending ? ' is-awaiting is-live' : ''}`}
      data-tool-call-id={tool.toolCallId}
      data-tool-kind="ask_user"
      data-conversation-scaffold=""
    >
      <div className="scaffold-line">
        <ScaffoldGlyph tone="thought" live={pending} />
        <div className="scaffold-main">
          <button
            type="button"
            className="scaffold-toggle is-ask-user"
            onClick={() => {
              if (pending && onFocus) onFocus(tool.toolCallId)
            }}
            title={pending ? '打开问卷' : undefined}
          >
            <span className="scaffold-label" title={detail}>
              Ask · {short}
            </span>
            <span className={`ask-user-badge${pending ? ' is-pending' : ''}`}>
              {statusText}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
})

/** 工具行：小字灰标签 + 展开壳；成功无勾 */
const ToolLine = memo(function ToolLine({
  tool,
  streaming,
}: {
  tool: ToolCallData
  streaming: boolean
}) {
  const [expanded, setExpanded] = useState(() => (tool.diffs?.length ?? 0) > 0)
  const duration = formatDuration(tool.timing)
  const live =
    streaming || tool.status === 'pending' || tool.status === 'in_progress'
  const failed = tool.status === 'failed'
  const preview = tool.preview?.trim() || ''
  const hasBody = preview.length > 0 || (tool.diffs?.length ?? 0) > 0
  const headline = toolHeadline(tool)
  const tone: ActivityTone = failed ? 'tool-failed' : 'tool'

  const diffStats = useMemo(() => {
    if (!tool.diffs?.length) return null
    let added = 0
    let removed = 0
    for (const d of tool.diffs) {
      added += (d.newText?.split('\n') ?? []).filter((l) => l.trim()).length
      removed += (d.oldText?.split('\n') ?? []).filter((l) => l.trim()).length
    }
    return { added, removed }
  }, [tool.diffs])
  const showDiffStats = !live && diffStats !== null && (diffStats.added > 0 || diffStats.removed > 0)

  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(preview || tool.detail || tool.title)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard 不可用时静默 */
    }
  }, [preview, tool.detail, tool.title])

  return (
    <div
      className={[
        'message-row scaffold-row tool-row',
        `status-${tool.status}`,
        live ? 'is-live' : '',
        expanded ? 'is-open' : '',
        failed ? 'is-error' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-tool-call-id={tool.toolCallId}
      data-tool-kind={tool.kind || 'other'}
      data-conversation-scaffold=""
    >
      <div className="scaffold-line">
        <ScaffoldGlyph tone={tone} live={live} />
        <div className="scaffold-main">
          <div className="scaffold-toggle-row">
            <button
              type="button"
              className={`scaffold-toggle${failed ? ' is-error' : ''}${live ? ' is-live' : ''}`}
              onClick={() => hasBody && setExpanded((v) => !v)}
              aria-expanded={expanded}
              disabled={!hasBody}
              title={hasBody ? (expanded ? '收起输出' : '展开输出') : undefined}
            >
              <span className="scaffold-label" title={tool.detail || tool.title}>
                {headline}
              </span>
              {!live && duration ? <span className="scaffold-meta">{duration}</span> : null}
              {showDiffStats && diffStats ? (
                <span className="tool-diff-stats" aria-label={`新增 ${diffStats.added} 行，删除 ${diffStats.removed} 行`}>
                  {diffStats.added > 0 ? (
                    <span className="diff-stat-add">+{diffStats.added}</span>
                  ) : null}
                  {diffStats.removed > 0 ? (
                    <span className="diff-stat-remove">−{diffStats.removed}</span>
                  ) : null}
                </span>
              ) : null}
              {hasBody ? (
                <span className={`scaffold-caret${expanded ? ' is-open' : ''}`} aria-hidden>
                  ›
                </span>
              ) : null}
            </button>
          </div>
          {expanded && hasBody ? (
            <div className="scaffold-body tool-body">
              {preview ? (
                <button
                  type="button"
                  className={`tool-copy-btn${copied ? ' is-copied' : ''}`}
                  onClick={onCopy}
                  title="复制输出"
                >
                  {copied ? '✓' : '⧉'}
                </button>
              ) : null}
              {preview ? (
                <>
                  <div className="scaffold-section-label">output</div>
                  <pre className="scaffold-pre tool-output-pre">{preview}</pre>
                </>
              ) : null}
              {tool.diffs?.map((d, i) => (
                <div key={`${d.path}-${i}`} className="tool-diff-block">
                  <div className="tool-diff-path">{d.path || 'diff'}</div>
                  <DiffLines oldText={d.oldText ?? ''} newText={d.newText} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
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
