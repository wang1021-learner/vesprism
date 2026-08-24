/**
 * 画布底部浮动对话卡片：近期几条 + 输入；「记录」展开全文。不占画布高度。
 */
import { useStore } from '@nanostores/react'
import { useCallback, useMemo, useState, type PointerEvent, type WheelEvent } from 'react'
import { $messages } from '../../store'
import { CanvasComposer } from './CanvasComposer'
import { visibleCanvasMessages } from './visibleMessages'
import { CanvasTalkLog } from './workbench-dock'

const EXPAND_KEY = 'vesprism.flow-talk.expanded'
const RECENT = 3

function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPAND_KEY) === '1'
  } catch {
    return false
  }
}

function stopWheel(e: WheelEvent) {
  e.stopPropagation()
}

function stopPointer(e: PointerEvent) {
  e.stopPropagation()
}

export function FlowTalkPanel({
  flowName,
  flowId,
  nodeIds,
  error,
  onRetryStrict,
}: {
  flowName: string
  flowId: string
  nodeIds?: string[]
  error?: string
  onRetryStrict?: () => void
}) {
  const messages = useStore($messages)
  const visibleCount = useMemo(() => visibleCanvasMessages(messages).length, [messages])
  const hasChat = visibleCount > 0
  const [expanded, setExpanded] = useState(readExpanded)
  const clipped = hasChat && !expanded && visibleCount > RECENT

  const toggle = useCallback(() => {
    setExpanded((v) => {
      const next = !v
      try {
        localStorage.setItem(EXPAND_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  return (
    <div className="flow-talk">
      <section
        className={`flow-talk-card nowheel nopan nodrag${expanded ? ' is-open' : ''}${hasChat ? ' has-chat' : ''}`}
        aria-label="流程对话"
        onWheel={stopWheel}
        onPointerDown={stopPointer}
      >
        {hasChat ? (
          <div className="flow-talk-head">
            <span className="flow-talk-kicker">对话</span>
            <button
              type="button"
              className="flow-talk-expand"
              onClick={toggle}
              aria-expanded={expanded}
              aria-label={expanded ? '收起对话记录' : '展开对话记录'}
            >
              {expanded ? '收起' : '记录'}
            </button>
          </div>
        ) : null}
        {hasChat ? (
          <CanvasTalkLog limit={expanded ? undefined : RECENT} fadedTop={clipped} />
        ) : null}
        <div className="flow-talk-input">
          <CanvasComposer
            flowName={flowName}
            flowId={flowId}
            nodeIds={nodeIds}
            error={error}
            onRetryStrict={onRetryStrict}
          />
        </div>
      </section>
    </div>
  )
}
