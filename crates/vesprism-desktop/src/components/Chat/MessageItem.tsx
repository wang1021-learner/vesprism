import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, MessageAttach, ToolCallData } from '../../types'
import { localFileUrl } from '../../lib/localFileUrl'
import {
  $activeTabId,
  $backgroundTasks,
  $subagents,
  openRewind,
  pushToast,
  removeBackgroundTask,
} from '../../store'
import { useStoreSelect } from '../../lib/useStoreSelect'
import { useActivePermission } from '../../lib/useActivePermission'
import { InlinePermissionBar } from '../Permission'
import { AssistantMarkdown } from './AssistantMarkdown'
import { DiffLines } from './DiffLines'
import { forkCurrentSession } from '../../lib/forkSession'
import { recallUserTurn } from '../../lib/recallUserTurn'
import { retryAssistantTurn } from '../../lib/retryAssistantTurn'
import { cancelSubagentChild } from '../../lib/cancelSubagentChild'
import {
  formatSubagentLiveMeta,
  parseSubagentIdFromToolCallId,
} from '../../lib/subagentMessage'
import { isHiddenUserMessage } from '../../lib/userMessage'
import { writingToolLabel } from '../../lib/writingToolLabel'
import { killTask } from '../../bridge'

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
 * 安静 scaffold 状态位：
 * - 进行中：spinner
 * - 失败：!
 * - 否则：类型图标（思考 / 终端 / 工具 / 网络…）
 */
type ActivityTone = 'thought' | 'tool' | 'tool-failed'

/** 行首图标语义（区分思考 / 终端 / 普通工具 / 网络等） */
type ScaffoldIconKind =
  | 'thought'
  | 'terminal'
  | 'tool'
  | 'web'
  | 'read'
  | 'edit'
  | 'search'
  | 'ask'
  | 'plan'
  | 'agent'

function toolIconKind(tool: ToolCallData): ScaffoldIconKind {
  const k = (tool.kind || '').toLowerCase()
  const blob = `${tool.title || ''} ${tool.detail || ''}`.toLowerCase()
  if (k === 'subagent') return 'agent'
  if (k === 'ask_user') return 'ask'
  if (k === 'plan_mode' || /exit_plan_mode|enter_plan_mode/.test(blob)) return 'plan'
  if (k === 'execute') return 'terminal'
  if (
    k === 'fetch' ||
    /web_search|web_fetch|open_page|browse|http|https:\/\//.test(blob)
  ) {
    return 'web'
  }
  if (k === 'search' || /\bgrep\b|\bsearch\b|ripgrep|rg\b/.test(blob)) {
    return 'search'
  }
  if (k === 'read') return 'read'
  if (k === 'edit' || k === 'write' || k === 'delete' || k === 'move') return 'edit'
  // 终端类：命令行工具名或 curl 等
  if (
    /terminal|bash|shell|cmd\.exe|powershell|pwsh|curl(\.exe)?|wget|npm |pnpm |yarn |cargo |git |python|node\.exe/.test(
      blob,
    )
  ) {
    return 'terminal'
  }
  return 'tool'
}

const ScaffoldTypeIcon = memo(function ScaffoldTypeIcon({
  kind,
}: {
  kind: ScaffoldIconKind
}) {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.85,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
  switch (kind) {
    case 'thought':
      // Thinking：灯泡
      return (
        <svg {...common}>
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
        </svg>
      )
    case 'terminal':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 9l3 3-3 3M12 15h5" />
        </svg>
      )
    case 'web':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      )
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      )
    case 'read':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h6" />
        </svg>
      )
    case 'edit':
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      )
    case 'ask':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4" />
          <path d="M12 17h.01" />
        </svg>
      )
    case 'plan':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M8 13h8M8 17h5" />
        </svg>
      )
    case 'agent':
      // 分支 / 子任务
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="12" cy="18" r="2.5" />
          <path d="M6 8.5v3a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4v-3M12 15.5V12" />
        </svg>
      )
    case 'tool':
    default:
      return (
        <svg {...common}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )
  }
})

const ICON_TITLE: Record<ScaffoldIconKind, string> = {
  thought: 'Thinking',
  terminal: '终端',
  tool: '工具',
  web: '网络',
  read: '读取',
  edit: '编辑',
  search: '搜索',
  ask: '提问',
  plan: '计划稿',
  agent: '子任务',
}

const ScaffoldGlyph = memo(function ScaffoldGlyph({
  tone,
  live,
  iconKind,
}: {
  tone: ActivityTone
  live: boolean
  iconKind: ScaffoldIconKind
}) {
  if (live) {
    return (
      <span
        className={`scaffold-glyph is-live tone-${tone} icon-${iconKind}`}
        aria-hidden
        title={`${ICON_TITLE[iconKind]} · 进行中`}
      >
        <BrailleSpinner />
      </span>
    )
  }
  if (tone === 'tool-failed') {
    return (
      <span
        className={`scaffold-glyph is-error icon-${iconKind}`}
        aria-hidden
        title={`${ICON_TITLE[iconKind]} · 失败`}
      >
        !
      </span>
    )
  }
  return (
    <span
      className={`scaffold-glyph is-idle icon-${iconKind}`}
      aria-hidden
      title={ICON_TITLE[iconKind]}
    >
      <ScaffoldTypeIcon kind={iconKind} />
    </span>
  )
})

interface MessageItemProps {
  message: ChatMessage
  streaming?: boolean
  /** 整轮仍在生成（不只是本行 live） */
  sessionBusy?: boolean
  /** 点击「Ask · 待回答」工具行时聚焦问卷面板 */
  onFocusUserQuestion?: (toolCallId: string) => void
  /** 点击计划稿工具行时打开预览 */
  onFocusPlan?: (toolCallId: string) => void
  /** 该行是当前权限审批的发起行：工具行下方渲染内嵌审批条 */
  isPermissionOrigin?: boolean
  /** 最新助手条：复制栏里的重试才可点，按钮始终占位避免高度跳 */
  canRetry?: boolean
  /** 最新用户条：撤回才可点，按钮始终占位避免高度跳 */
  canRecall?: boolean
}

/** 内嵌审批条包装：读当前 tab 投影，有审批才渲染 */
function InlinePermissionBarWrap() {
  const permission = useActivePermission()
  if (!permission) return null
  return <InlinePermissionBar permission={permission} />
}

function todoSnapshotEqual(
  a: MessageItemProps['message']['toolCall'],
  b: MessageItemProps['message']['toolCall'],
): boolean {
  const at = a?.todo?.todos
  const bt = b?.todo?.todos
  if (at === bt) return true
  if (!at || !bt || at.length !== bt.length) return false
  return at.every((t, i) => t.content === bt[i].content && t.status === bt[i].status)
}

function messageItemEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  if (prev.isPermissionOrigin !== next.isPermissionOrigin) return false
  if (prev.streaming !== next.streaming) return false
  if (prev.sessionBusy !== next.sessionBusy) return false
  if (prev.canRetry !== next.canRetry) return false
  if (prev.canRecall !== next.canRecall) return false
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
        a.toolCall?.title === b.toolCall?.title &&
        a.toolCall?.diffs === b.toolCall?.diffs &&
        todoSnapshotEqual(a.toolCall, b.toolCall)))
  )
}

/** 工具/子任务输出显示上限：避免超大单体文本节点阻塞排版引擎；复制按钮仍保留完整输出 */
const MAX_PREVIEW_CHARS = 20000

/** 解析结构化输出，提取真实文本或格式化 JSON，还原换行 */
function formatToolPreview(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed)
      if (typeof obj.output === 'string') {
        return obj.output
      }
      return JSON.stringify(obj, null, 2)
    } catch {
      /* not valid JSON */
    }
  }
  return raw
}

/** 进行中每秒刷新耗时；不写 scrollTop，只改这一行文字。 */
function useTickingMs(start: number | undefined, live: boolean): number | undefined {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live || !start) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [live, start])
  if (!start) return undefined
  return Math.max(0, (live ? now : Date.now()) - start)
}

/** 子任务行：对话内 scaffold（须在 MessageItem 前声明） */
const SubagentToolLine = memo(function SubagentToolLine({
  tool,
  streaming,
}: {
  tool: ToolCallData
  streaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [opening, setOpening] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | undefined>(undefined)
  const subId = parseSubagentIdFromToolCallId(tool.toolCallId)
  const runtime = useStoreSelect($subagents, (list) =>
    subId ? list.find((s) => s.subagentId === subId) : undefined,
  )

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const cancelled = runtime?.status === 'cancelled'
  const failed = tool.status === 'failed' && !cancelled
  const finished =
    tool.status === 'completed' ||
    tool.status === 'failed' ||
    cancelled
  const live =
    !finished &&
    (tool.status === 'pending' ||
      tool.status === 'in_progress' ||
      streaming)
  const rawPreview = tool.preview?.trim() || ''
  const formattedPreview = useMemo(() => formatToolPreview(rawPreview), [rawPreview])
  const childSid = tool.detail?.trim() || ''
  const elapsedMs = useTickingMs(tool.timing?.start, live)
  const duration = formatDuration(tool.timing)
  const liveMeta = formatSubagentLiveMeta(
    {
      durationMs: runtime?.durationMs,
      turnCount: runtime?.turnCount,
      toolCallCount: runtime?.toolCallCount,
      toolsUsed: runtime?.toolsUsed,
    },
    live
      ? elapsedMs != null && elapsedMs >= 1000
        ? elapsedMs
        : undefined
      : runtime?.durationMs,
  )
  const headline = toolHeadline(tool)

  const onCopy = useCallback(async () => {
    if (!formattedPreview) return
    try {
      await navigator.clipboard.writeText(formattedPreview)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }, [formattedPreview])

  const onOpen = useCallback(async () => {
    if (!childSid || opening) return
    setOpening(true)
    try {
      const { openSubagentTab, refreshSubagentTabMessages } = await import(
        '../../lib/openSubagentTab'
      )
      const id = await openSubagentTab(childSid, {
        title: tool.title,
        activate: true,
      })
      if (id) {
        await refreshSubagentTabMessages(childSid, {
          outputFallback: formattedPreview,
        })
      }
    } finally {
      setOpening(false)
    }
  }, [childSid, opening, tool.title, formattedPreview])

  const onCancel = useCallback(async () => {
    if (!subId || cancelling || !live) return
    setCancelling(true)
    try {
      await cancelSubagentChild(subId)
    } finally {
      setCancelling(false)
    }
  }, [cancelling, live, subId])

  return (
    <div
      className={[
        'message-row scaffold-row tool-row subagent-tool-row',
        `status-${tool.status}`,
        live ? 'is-live' : '',
        expanded ? 'is-open' : '',
        failed ? 'is-error' : '',
        cancelled ? 'is-cancelled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-tool-call-id={tool.toolCallId}
      data-tool-kind="subagent"
      data-conversation-scaffold=""
    >
      <div className="scaffold-line">
        <ScaffoldGlyph
          tone={failed ? 'tool-failed' : 'tool'}
          live={live}
          iconKind="agent"
        />
        <div className="scaffold-main">
          <div className="scaffold-toggle-row">
            <button
              type="button"
              className={`scaffold-toggle${failed ? ' is-error' : ''}${live ? ' is-live' : ''}`}
              onClick={() => (formattedPreview ? setExpanded((v) => !v) : void onOpen())}
              aria-expanded={expanded}
              title={formattedPreview ? (expanded ? '收起结果' : '展开结果') : '打开子任务'}
            >
              <span className="scaffold-label" title={headline}>
                {headline}
              </span>
              {!live && (liveMeta || duration) ? (
                <span className="scaffold-meta">{liveMeta || duration}</span>
              ) : null}
              {formattedPreview ? (
                <span className={`scaffold-caret${expanded ? ' is-open' : ''}`} aria-hidden>
                  ›
                </span>
              ) : null}
            </button>
            {live && subId ? (
              <button
                type="button"
                className="subagent-inline-open is-cancel"
                disabled={cancelling}
                onClick={(e) => {
                  e.stopPropagation()
                  void onCancel()
                }}
                title="只停这个帮手，主对话继续"
              >
                {cancelling ? '…' : '取消'}
              </button>
            ) : null}
            {childSid ? (
              <button
                type="button"
                className="subagent-inline-open"
                disabled={opening}
                onClick={(e) => {
                  e.stopPropagation()
                  void onOpen()
                }}
                title="在标签中打开子会话"
              >
                {opening ? '…' : '打开'}
              </button>
            ) : null}
          </div>
          {live && liveMeta ? (
            <div className="subagent-live-meta" title={liveMeta}>
              {liveMeta}
            </div>
          ) : null}
          {expanded && formattedPreview ? (
            <div className="scaffold-body tool-body">
              <button
                type="button"
                className={`tool-copy-btn${copied ? ' is-copied' : ''}`}
                onClick={onCopy}
                title="复制输出"
              >
                {copied ? '✓' : '⧉'}
              </button>
              <div className="scaffold-section-label">output</div>
              <pre className="scaffold-pre tool-output-pre">
                {formattedPreview.length > MAX_PREVIEW_CHARS
                  ? `${formattedPreview.slice(0, MAX_PREVIEW_CHARS)}\n…输出过长，已截断显示（复制可获取完整输出）`
                  : formattedPreview}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
})

export const MessageItem = memo(function MessageItem({
  message,
  streaming = false,
  sessionBusy = false,
  onFocusUserQuestion,
  onFocusPlan,
  isPermissionOrigin = false,
  canRetry = false,
  canRecall = false,
}: MessageItemProps) {
  switch (message.role) {
    case 'system':
      return (
        <div className="message-row system-row">
          <div className="system-pill">{message.text}</div>
        </div>
      )

    case 'user':
      // 子任务 instruction 不当作用户气泡展示
      if (isHiddenUserMessage(message.text || '')) return null
      return (
        <UserBubble
          text={message.text}
          messageId={message.id}
          canRecall={canRecall && !sessionBusy}
          attachments={message.attachments}
        />
      )

    case 'thought':
      // 空/纯空白思考不渲染（交错噪声）
      if (!(message.text || '').trim() && !streaming && !message.isStreaming) {
        return null
      }
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
      if (tool.kind === 'plan_mode') {
        return (
          <PlanToolLine
            tool={tool}
            onFocus={onFocusPlan}
          />
        )
      }
      if (tool.kind === 'subagent') {
        return (
          <SubagentToolLine
            tool={tool}
            streaming={streaming || Boolean(message.isStreaming)}
          />
        )
      }
      return (
        <div className="toolline-with-approval">
          <ToolLine
            tool={tool}
            streaming={streaming || Boolean(message.isStreaming)}
          />
          {isPermissionOrigin ? (
            <InlinePermissionBarWrap />
          ) : null}
        </div>
      )
    }

    case 'assistant': {
      const live = streaming || Boolean(message.isStreaming)
      // 不显示 Assistant 角标：左右气泡/活动行已能区分角色，角标冗余
      return (
        <AssistantReply
          messageId={message.id}
          text={message.text}
          live={live}
          canRetry={canRetry && !sessionBusy && !live}
        />
      )
    }

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
    ? '思考中…'
    : duration
      ? `想了 ${duration}`
      : timing?.end && timing.start && (timing.end - timing.start) / 1000 < 1
        ? '略想了一下'
        : '已思考'
  const expandRef = useRef<HTMLDivElement>(null)
  const canExpand = text.trim().length > 0
  /**
   * 折叠动画：open 从 true→false（turn_ended 定稿）时，思考区若直接卸载，
   * 几百 px 的高度骤减 + instant 贴底 = 内容被「猛地拽回底部」。
   * 改为：量高 → 180ms 过渡到 0 → 过渡结束才卸载，高度渐变让贴底平滑收拢。
   */
  const [collapsing, setCollapsing] = useState(false)
  const renderBody = open || collapsing

  useEffect(() => {
    const box = expandRef.current
    if (open) {
      if (collapsing) {
        setCollapsing(false)
        if (box) {
          box.classList.remove('is-collapsing')
          const currentHeight = getComputedStyle(box).maxHeight
          if (currentHeight !== 'none') box.style.maxHeight = currentHeight
          void box.scrollHeight // force reflow
          box.style.maxHeight = `${box.scrollHeight}px`
          const t = setTimeout(() => {
            if (expandRef.current) expandRef.current.style.maxHeight = ''
          }, 200) // matches 180ms CSS transition
          return () => clearTimeout(t)
        }
      } else if (box) {
        box.style.maxHeight = ''
        box.classList.remove('is-collapsing')
      }
      return
    }
    // open=false：有 body 才折叠（空思考没有可折叠的高度）
    if (!box) return
    setCollapsing(true)
    box.classList.add('is-collapsing')
    // 读取 scrollHeight 会强制 reflow，让浏览器记住起始高度，rAF 后再设 0 才触发过渡
    box.style.maxHeight = `${box.scrollHeight}px`
    const raf = requestAnimationFrame(() => {
      box.style.maxHeight = '0px'
    })
    return () => cancelAnimationFrame(raf)
  }, [open, collapsing])

  const onBodyTransitionEnd = useCallback(() => {
    if (collapsing) setCollapsing(false)
  }, [collapsing])

  // 流式时思考区随内容增长；若仍有内部滚动（收起态 max-height）则钉到底
  useLayoutEffect(() => {
    if (!open || !streaming) return
    const box = expandRef.current
    if (!box) return
    box.scrollTop = box.scrollHeight
  }, [open, streaming, text])

  return (
    <div
      className={`message-row scaffold-row thought-row${streaming ? ' is-live' : ''}${open ? ' is-open' : ''}`}
      data-conversation-scaffold=""
    >
      <div className="scaffold-line">
        <ScaffoldGlyph tone="thought" live={streaming} iconKind="thought" />
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
          {renderBody && canExpand ? (
            <div
              ref={expandRef}
              className={`thought-expanded${collapsing ? ' is-collapsing' : ''}`}
              onTransitionEnd={onBodyTransitionEnd}
            >
              <pre className="thought-body-pre">{text}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
})

function toolHeadline(tool: ToolCallData, live = false): string {
  // 子任务：title 已是完整「子任务 · 名 · 状态」
  if (tool.kind === 'subagent') {
    return tool.title?.trim() || '子任务'
  }
  const detail = tool.detail?.trim() || ''
  const preview = tool.preview?.trim() || ''
  if (live && !detail && !preview) {
    return writingToolLabel(tool.title, tool.kind) || '正在生成参数…'
  }
  const short =
    detail.length > 72 ? `${detail.slice(0, 70)}…` : detail
  const label = short || tool.title?.trim() || 'tool'
  // scaffold 风格工具行
  switch (tool.kind) {
    case 'ask_user':
      return `Ask · ${label}`
    case 'plan_mode':
      return `Plan · ${label}`
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

/** 计划稿工具卡：Plan · 待审批 / 已处理 */
const PlanToolLine = memo(function PlanToolLine({
  tool,
  onFocus,
}: {
  tool: ToolCallData
  onFocus?: (toolCallId: string) => void
}) {
  const pending =
    tool.status === 'pending' || tool.status === 'in_progress'
  const detail = tool.detail?.trim() || tool.title || '计划稿'
  const short =
    detail.length > 48 ? `${detail.slice(0, 46)}…` : detail
  const answer = tool.preview?.trim() || ''
  const statusText = pending ? '待审批' : answer || '已处理'

  return (
    <div
      className={`message-row scaffold-row tool-row kind-plan${pending ? ' is-awaiting is-live' : ''}`}
      data-tool-call-id={tool.toolCallId}
      data-tool-kind="plan_mode"
      data-conversation-scaffold=""
    >
      <div className="scaffold-line">
        <ScaffoldGlyph tone="thought" live={pending} iconKind="plan" />
        <div className="scaffold-main">
          <button
            type="button"
            className="scaffold-toggle"
            onClick={() => onFocus?.(tool.toolCallId)}
            title={pending ? '打开计划稿' : answer || detail}
            aria-label={pending ? `待审批计划稿：${detail}` : `计划稿：${detail}`}
          >
            <span className="scaffold-label" title={detail}>
              Plan · {short}
            </span>
            <span className={`ask-user-badge${pending ? ' is-pending' : ' is-done'}`}>
              {statusText}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
})

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
  const question = tool.detail?.trim() || tool.title || '向你提问'
  const shortQ =
    question.length > 48 ? `${question.slice(0, 46)}…` : question
  const answer = tool.preview?.trim() || ''
  const shortA =
    answer.length > 56 ? `${answer.slice(0, 54)}…` : answer
  const statusText = pending ? '待回答' : shortA || '已处理'

  return (
    <div
      className={`message-row scaffold-row tool-row ask-user-row kind-ask-user${pending ? ' is-awaiting is-live' : ''}${!pending && answer ? ' is-answered' : ''}`}
      data-tool-call-id={tool.toolCallId}
      data-tool-kind="ask_user"
      data-conversation-scaffold=""
    >
      <div className="scaffold-line">
        <ScaffoldGlyph tone="thought" live={pending} iconKind="ask" />
        <div className="scaffold-main">
          <button
            type="button"
            className="scaffold-toggle is-ask-user"
            onClick={() => {
              if (pending && onFocus) onFocus(tool.toolCallId)
            }}
            title={
              pending
                ? '打开问卷'
                : answer
                  ? `${question}\n${answer}`
                  : question
            }
            aria-label={
              pending
                ? `待回答问卷：${question}`
                : `问卷已答：${question} ${answer}`
            }
          >
            <span className="scaffold-label" title={question}>
              Ask · {shortQ}
            </span>
            <span
              className={`ask-user-badge${pending ? ' is-pending' : ' is-done'}`}
              title={pending ? undefined : answer || undefined}
            >
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
  // 默认折叠：展开才挂 diff/preview，流式时不把列表高度顶飞。
  // todo_write 例外：任务清单默认展开（实时勾选进度是它的核心价值）。
  const [expanded, setExpanded] = useState(() => Boolean(tool.todo?.todos?.length))
  const duration = formatDuration(tool.timing)
  // 终态以 tool.status 为准；勿因父级 streaming=true 把已完成工具继续转圈
  const failed = tool.status === 'failed'
  const finished =
    tool.status === 'completed' || tool.status === 'failed'
  const live =
    !finished &&
    (tool.status === 'pending' ||
      tool.status === 'in_progress' ||
      streaming)
  const rawPreview = tool.preview?.trim() || ''
  const formattedPreview = useMemo(() => formatToolPreview(rawPreview), [rawPreview])
  const diffs = tool.diffs?.length ? tool.diffs : null
  const hasBody = formattedPreview.length > 0 || Boolean(diffs)
  const headline = toolHeadline(tool, live)
  const tone: ActivityTone = failed ? 'tool-failed' : 'tool'
  const iconKind = useMemo(
    () => toolIconKind(tool),
    // toolIconKind 只读 kind/title/detail；引用级依赖更稳（字段级会触发 exhaustive-deps 警告）
    [tool],
  )

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
  const copyTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const onCopy = useCallback(async () => {
    const diffText = diffs
      ? diffs
          .map((d) => {
            const oldL = (d.oldText || '').split('\n').map((l) => `-${l}`).join('\n')
            const newL = (d.newText || '').split('\n').map((l) => `+${l}`).join('\n')
            return `${d.path}\n${oldL}\n${newL}`
          })
          .join('\n\n')
      : ''
    try {
      await navigator.clipboard.writeText(
        formattedPreview || diffText || tool.detail || tool.title,
      )
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard 不可用时静默 */
    }
  }, [diffs, formattedPreview, tool.detail, tool.title])

  // bash 后台任务（x.ai/task_backgrounded）：工具行显示徽标 + 终止入口
  const bgTask = useStoreSelect(
    $backgroundTasks,
    (tasks) => tasks[tool.toolCallId],
  )
  const [killing, setKilling] = useState(false)
  const onKillBg = useCallback(async () => {
    if (!bgTask || killing) return
    setKilling(true)
    try {
      await killTask($activeTabId.get(), bgTask.taskId)
      removeBackgroundTask($activeTabId.get(), tool.toolCallId)
      pushToast('已终止后台任务', 'success')
    } catch (e) {
      pushToast(`终止失败：${String(e)}`, 'error')
    } finally {
      setKilling(false)
    }
  }, [bgTask, killing, tool.toolCallId])

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
      data-scaffold-icon={iconKind}
      data-conversation-scaffold=""
    >
      <div className="scaffold-line">
        <ScaffoldGlyph tone={tone} live={live} iconKind={iconKind} />
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
              {tool.todo?.todos?.length ? (
                <span className="tool-todo-count">
                  {tool.todo.todos.filter((t) => t.status === 'completed').length}/
                  {tool.todo.todos.length}
                </span>
              ) : null}
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
            {bgTask ? (
              <span
                className="bg-task-badge"
                title={bgTask.command || `任务 ${bgTask.taskId}`}
              >
                后台运行中
                <button
                  type="button"
                  className="bg-task-kill"
                  disabled={killing}
                  onClick={() => void onKillBg()}
                  title="终止后台任务"
                  aria-label="终止后台任务"
                >
                  {killing ? '…' : '终止'}
                </button>
              </span>
            ) : null}
          </div>
          {expanded && tool.todo?.todos?.length ? (
            <div className="scaffold-body tool-body tool-todo-body">
              <ul className="tool-todo-list">
                {tool.todo.todos.map((t, i) => (
                  <li
                    key={`${t.content}-${i}`}
                    className={`tool-todo-item is-${t.status || 'pending'}`}
                  >
                    <span className="tool-todo-check" aria-hidden>
                      {t.status === 'completed'
                        ? '☑'
                        : t.status === 'in_progress'
                          ? '◐'
                          : t.status === 'cancelled'
                            ? '✕'
                            : '□'}
                    </span>
                    <span className="tool-todo-content">{t.content}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {expanded && hasBody ? (
            <div className="scaffold-body tool-body">
              {formattedPreview || diffs ? (
                <button
                  type="button"
                  className={`tool-copy-btn${copied ? ' is-copied' : ''}`}
                  onClick={onCopy}
                  title="复制输出"
                >
                  {copied ? '✓' : '⧉'}
                </button>
              ) : null}
              {diffs ? (
                <div className="tool-diff-stack">
                  {diffs.map((d) => (
                    <div className="tool-diff-block" key={d.path}>
                      <div className="tool-diff-path" title={d.path}>
                        {d.path}
                      </div>
                      <DiffLines oldText={d.oldText || ''} newText={d.newText} />
                    </div>
                  ))}
                </div>
              ) : formattedPreview ? (
                <>
                  <div className="scaffold-section-label">output</div>
                  <pre className="scaffold-pre tool-output-pre">
                    {formattedPreview.length > MAX_PREVIEW_CHARS
                      ? `${formattedPreview.slice(0, MAX_PREVIEW_CHARS)}\n…输出过长，已截断显示（复制可获取完整输出）`
                      : formattedPreview}
                  </pre>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
})

const AssistantReply = memo(function AssistantReply({
  messageId,
  text,
  live,
  canRetry,
}: {
  messageId: string
  text: string
  live: boolean
  canRetry: boolean
}) {
  const textRef = useRef(text)
  textRef.current = text
  const getText = useCallback(() => textRef.current, [])
  return (
    <div className={`message-row assistant-row${live ? ' is-streaming' : ''}`}>
      <div className="assistant-content md-body">
        <AssistantMarkdown text={text} />
      </div>
      <AssistantActions canRetry={canRetry} getText={getText} messageId={messageId} />
    </div>
  )
})

const AssistantActions = memo(function AssistantActions({
  messageId,
  getText,
  canRetry,
}: {
  messageId: string
  getText: () => string
  canRetry: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const copyTimerRef = useRef<number | undefined>(undefined)
  const retryingRef = useRef(false)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const onCopy = useCallback(async () => {
    const text = getText()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1200)
    } catch {
      pushToast('复制失败', 'error')
    }
  }, [getText])

  const onRetry = useCallback(async () => {
    if (!canRetry || retryingRef.current) return
    retryingRef.current = true
    setRetrying(true)
    try {
      await retryAssistantTurn(messageId)
    } finally {
      retryingRef.current = false
      setRetrying(false)
    }
  }, [canRetry, messageId])

  return (
    <div className="assistant-actions">
      <button
        type="button"
        title="复制回复"
        aria-label="复制回复"
        onClick={() => void onCopy()}
      >
        {copied ? '已复制' : '复制'}
      </button>
      <button
        type="button"
        title={canRetry ? '按原提问重新生成' : '仅最新回复可重试'}
        aria-label="重新生成"
        disabled={!canRetry || retrying}
        onClick={() => void onRetry()}
      >
        {retrying ? '重试中' : '重试'}
      </button>
    </div>
  )
})

function userVisibleText(text: string, attachments?: MessageAttach[]): string {
  const hasImage = (attachments ?? []).some((a) => a.kind === 'image')
  let t = (text || '').trim()
  if (hasImage) {
    t = t.replace(/(?:^|\n)\[附件\][^\n]*/g, '').trim()
  }
  return t
}

const UserBubble = memo(function UserBubble({
  text,
  messageId,
  canRecall,
  attachments,
}: {
  text: string
  messageId: string
  canRecall: boolean
  attachments?: MessageAttach[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [recalling, setRecalling] = useState(false)
  const copyTimerRef = useRef<number | undefined>(undefined)
  const recallingRef = useRef(false)
  const visible = userVisibleText(text, attachments)
  const images = (attachments ?? []).filter((a) => a.kind === 'image' && a.path)
  const files = (attachments ?? []).filter((a) => a.kind !== 'image' && a.path)
  const isLong = visible.length > USER_BUBBLE_FOLD_THRESHOLD
  const displayText =
    isLong && !expanded ? visible.split('\n').slice(0, 3).join('\n') : visible

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const onCopy = useCallback(async () => {
    if (!visible) return
    try {
      await navigator.clipboard.writeText(visible)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1200)
    } catch {
      pushToast('复制失败', 'error')
    }
  }, [visible])

  const onRecall = useCallback(async () => {
    if (!canRecall || recallingRef.current) return
    recallingRef.current = true
    setRecalling(true)
    try {
      await recallUserTurn(messageId)
    } finally {
      recallingRef.current = false
      setRecalling(false)
    }
  }, [canRecall, messageId])

  return (
    <div className="message-row user-row">
      <div className="user-stack">
        <div className="bubble bubble-user">
          {images.length > 0 ? (
            <div className="bubble-attach-images">
              {images.map((a) => (
                <img
                  key={a.path}
                  className="bubble-attach-img"
                  src={a.previewUrl || localFileUrl(a.path)}
                  alt=""
                />
              ))}
            </div>
          ) : null}
          {displayText ? <pre className="bubble-text">{displayText}</pre> : null}
          {files.length > 0 ? (
            <div className="bubble-attach-files">
              {files.map((a) => (
                <span key={a.path} className="bubble-attach-file">
                  {a.path.replace(/\\/g, '/').split('/').pop() || a.path}
                </span>
              ))}
            </div>
          ) : null}
          {isLong ? (
            <button
              type="button"
              className="bubble-expand-toggle"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? '收起'
                : `展开全部（${visible.length.toLocaleString()} 字符）`}
            </button>
          ) : null}
        </div>
        <div className="bubble-actions">
          <button
            type="button"
            className="bubble-copy-btn"
            title="复制提问"
            aria-label="复制提问"
            onClick={() => void onCopy()}
          >
            {copied ? '已复制' : '复制'}
          </button>
          <button
            type="button"
            className="bubble-recall-btn"
            title={
              canRecall
                ? '撤回本条提问（对话回到这条之前，原文填回输入框）'
                : '仅最新提问可撤回'
            }
            aria-label="撤回提问"
            disabled={!canRecall || recalling}
            onClick={() => void onRecall()}
          >
            {recalling ? '撤回中' : '撤回'}
          </button>
          <button
            type="button"
            className="bubble-fork-btn"
            title="派生新会话（复制当前会话到新标签继续）"
            aria-label="派生新会话"
            onClick={() => void forkCurrentSession()}
          >
            派生
          </button>
          <button
            type="button"
            className="bubble-rewind-btn"
            title="回滚会话（撤销到此提问之前，可恢复文件快照）"
            aria-label="回滚会话"
            onClick={() => openRewind($activeTabId.get())}
          >
            回滚
          </button>
        </div>
      </div>
    </div>
  )
})
