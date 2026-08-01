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

/** 左侧竖轨 + 菱形节点（对齐对话里 Run/Thought 时间线） */
type ActivityTone = 'thought' | 'tool' | 'tool-failed'

const ActivityRail = memo(function ActivityRail({
  tone,
  live,
}: {
  tone: ActivityTone
  live: boolean
}) {
  return (
    <div
      className={`activity-rail tone-${tone}${live ? ' is-live' : ''}`}
      aria-hidden
    >
      <span className="activity-rail-line" />
      <span className="activity-rail-marker">
        {live ? (
          <BrailleSpinner />
        ) : (
          <span className="activity-diamond">◆</span>
        )}
      </span>
    </div>
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

/** 菱形时间线：灰菱形 + 竖轨 — Thought for 1.4s › */
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
  // 对齐对话 UI 文案：Thought for Xs / 思考中…
  const title = streaming
    ? duration
      ? `思考中… ${duration}`
      : '思考中…'
    : duration
      ? `Thought for ${duration}`
      : 'Thought'
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
        <ActivityRail tone="thought" live={streaming} />
        <div className="activity-main">
          <button
            type="button"
            className="activity-toggle"
            onClick={() => canExpand && setExpanded((v) => !v)}
            aria-expanded={expanded}
            disabled={!canExpand}
            title={expanded ? '收起思考' : '展开思考'}
          >
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
    </div>
  )
})

function toolHeadline(tool: ToolCallData): string {
  const detail = tool.detail?.trim() || ''
  const short =
    detail.length > 72 ? `${detail.slice(0, 70)}…` : detail
  const label = short || tool.title?.trim() || 'tool'
  // 对齐对话 UI：Run <摘要>
  switch (tool.kind) {
    case 'execute':
    case 'read':
    case 'edit':
    case 'search':
    case 'fetch':
    case 'delete':
    default:
      return `Run ${label}`
  }
}

/** 菱形时间线：绿菱形 + 竖轨 — Run xxx › */
const ToolLine = memo(function ToolLine({
  tool,
  streaming,
}: {
  tool: ToolCallData
  streaming: boolean
}) {
  // 有 diff 默认展开（对齐 Hermes：completed edit 的 diff 直接可见）
  const [expanded, setExpanded] = useState(() => (tool.diffs?.length ?? 0) > 0)
  const duration = formatDuration(tool.timing)
  const live =
    streaming || tool.status === 'pending' || tool.status === 'in_progress'
  const failed = tool.status === 'failed'
  const preview = tool.preview?.trim() || ''
  const hasBody = preview.length > 0 || (tool.diffs?.length ?? 0) > 0
  const headline = toolHeadline(tool)
  const tone: ActivityTone = failed ? 'tool-failed' : 'tool'

  // diff 统计（+N -M）：非空行计数
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

  // 复制完整输出（不受显示截断影响）
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(preview || tool.detail || tool.title)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch { /* clipboard 不可用时静默 */ }
  }, [preview, tool.detail, tool.title])

  return (
    <div className="message-row activity-row tool-row">
      <div
        className={`activity-line tool-line status-${tool.status}${live ? ' is-live' : ''}`}
      >
        <ActivityRail tone={tone} live={live} />
        <div className="activity-main">
          <div className="activity-toggle-row">
            <button
              type="button"
              className="activity-toggle"
              onClick={() => hasBody && setExpanded((v) => !v)}
              aria-expanded={expanded}
              disabled={!hasBody}
              title={hasBody ? (expanded ? '收起输出' : '展开输出') : undefined}
            >
              <span className="activity-label" title={tool.detail || tool.title}>
                {headline}
              </span>
              {duration ? <span className="activity-meta">{duration}</span> : null}
              {showDiffStats && diffStats ? (
                <span className="tool-diff-stats" aria-label={`新增 ${diffStats.added} 行，删除 ${diffStats.removed} 行`}>
                  <span className="diff-stat-add">+{diffStats.added}</span>
                  <span className="diff-stat-remove">-{diffStats.removed}</span>
                </span>
              ) : null}
              {hasBody ? (
                <span className={`activity-chevron${expanded ? ' open' : ''}`} aria-hidden>
                  ›
                </span>
              ) : null}
            </button>
            {preview && !live ? (
              <button
                type="button"
                className={`tool-copy-btn${copied ? ' is-copied' : ''}`}
                onClick={onCopy}
                title="复制输出"
              >
                {copied ? '✓' : '⧉'}
              </button>
            ) : null}
          </div>
          {expanded && hasBody ? (
            <div className="activity-body tool-body">
              {preview ? <pre className="tool-output-pre">{preview}</pre> : null}
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
