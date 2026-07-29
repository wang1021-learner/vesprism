import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useSidePanel,
  type SidePanelPayload,
  type SidePanelTab,
} from '../../context/SidePanelContext'
import { ArtifactView } from './ArtifactView'
import { DiffView } from './DiffView'
import { ToolOutputView } from './ToolOutputView'

function tabTypeLabel(payload: SidePanelPayload): string {
  switch (payload.type) {
    case 'artifact':
      return '预览'
    case 'diff':
      return 'Diff'
    case 'tool-output':
      return '输出'
  }
}

/** 取路径最后一段；命令则取首词 */
function baseName(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  // Windows / Unix 路径
  if (/[/\\]/.test(s) || /^[A-Za-z]:/.test(s)) {
    const parts = s.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts[parts.length - 1] || s
  }
  // 命令行：只留命令名
  const first = s.split(/\s+/)[0] || s
  if (first.includes('/') || first.includes('\\')) {
    const parts = first.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts[parts.length - 1] || first
  }
  return first
}

/** 标签展示用极短名（避免路径撑出横向滚动条） */
function ellipsize(name: string, max = 12): string {
  const t = name.trim()
  if (!t) return '未命名'
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(1, max - 1))}…`
}

function tabShortTitle(payload: SidePanelPayload): string {
  switch (payload.type) {
    case 'artifact':
      return ellipsize(baseName(payload.title || payload.language.toUpperCase()))
    case 'diff': {
      const raw = payload.diffs[0]?.path || payload.title || '变更'
      return ellipsize(baseName(raw))
    }
    case 'tool-output':
      return ellipsize(baseName(payload.title || payload.kind || '输出'))
  }
}

/** hover 用完整信息 */
function tabFullTitle(payload: SidePanelPayload): string {
  switch (payload.type) {
    case 'artifact':
      return payload.title || payload.language.toUpperCase()
    case 'diff':
      return payload.diffs[0]?.path || payload.title || '变更'
    case 'tool-output':
      return payload.title || payload.kind || '输出'
  }
}

function EmptyPanelHint() {
  return (
    <div className="side-panel-empty-hint">
      <div className="side-panel-empty-icon" aria-hidden>
        ⧉
      </div>
      <h3 className="side-panel-empty-title">还没有预览内容</h3>
      <p className="side-panel-empty-desc">
        标签不会凭空出现。请先在<strong>对话里的工具卡片</strong>上点按钮：
      </p>
      <div className="side-panel-empty-demo" aria-hidden>
        <span className="side-panel-empty-demo-chip">
          <em>Diff</em> App.tsx
        </span>
        <span className="side-panel-empty-demo-chip">
          <em>输出</em> 终端
        </span>
        <span className="side-panel-empty-demo-chip">
          <em>预览</em> index.html
        </span>
      </div>
      <ul className="side-panel-empty-list">
        <li>
          <strong>预览 Diff</strong> — 编辑类工具（绿色按钮）
        </li>
        <li>
          <strong>预览输出</strong> — 终端 / 读取结果
        </li>
        <li>
          <strong>预览 HTML/SVG</strong> — 页面预览
        </li>
      </ul>
      <p className="side-panel-empty-foot">
        点过之后，标签会出现在本栏上方，可切换、可关闭。
      </p>
    </div>
  )
}

function PanelContent({ payload }: { payload: SidePanelPayload }) {
  switch (payload.type) {
    case 'artifact':
      return (
        <ArtifactView
          language={payload.language}
          code={payload.code}
          title={payload.title}
        />
      )
    case 'diff':
      return (
        <DiffView
          diffs={payload.diffs}
          fallbackText={payload.fallbackText}
          title={payload.title}
        />
      )
    case 'tool-output':
      return (
        <ToolOutputView
          text={payload.text}
          title={payload.title}
          kind={payload.kind}
        />
      )
  }
}

/**
 * 主界面右侧统一侧栏：多标签 + 可拉伸 + 切换渐入渐出。
 */
export function SidePanel() {
  const {
    open,
    tabs,
    activeTabId,
    payload,
    width,
    setWidth,
    closePanel,
    selectTab,
    closeTab,
  } = useSidePanel()
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  /**
   * 切换动画：用 contentKey 触发 CSS 渐入（不再用 setTimeout，
   * 避免 effect cleanup 取消 timer 导致内容不更新）。
   */
  const contentKey = activeTabId ?? (payload ? 'payload' : 'empty')

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startWidth: width }
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - e.clientX
      setWidth(dragRef.current.startWidth + delta)
    },
    [setWidth],
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closePanel])

  const headerTitle = payload ? tabFullTitle(payload) : '右侧栏'
  const headerShort = payload ? tabShortTitle(payload) : '右侧栏'
  const typeLabel = payload ? tabTypeLabel(payload) : null

  return (
    <aside
      className={`side-panel${open ? ' open' : ''}${dragging ? ' is-resizing' : ''}`}
      style={open ? { width, flexBasis: width } : { width: 0, flexBasis: 0 }}
      aria-hidden={!open}
    >
      {open && (
        <>
          <div
            className="side-panel-resizer"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            role="separator"
            aria-orientation="vertical"
            aria-label="拖拽调整侧栏宽度"
            title="拖拽调整宽度"
          />
          <div className="side-panel-header">
            <div className="side-panel-header-text">
              {typeLabel && (
                <span className="side-panel-type-badge">{typeLabel}</span>
              )}
              <span className="side-panel-title" title={headerTitle}>
                {headerShort}
              </span>
            </div>
            <button
              type="button"
              className="side-panel-close"
              onClick={closePanel}
              aria-label="关闭侧栏"
            >
              ×
            </button>
          </div>

          {/* 标签条：有内容时显示；空时显示占位提示条 */}
          <div className="side-panel-tabs" role="tablist" aria-label="预览标签">
            {tabs.length === 0 ? (
              <div className="side-panel-tabs-placeholder">
                从对话工具卡点「预览 Diff / 输出」后，标签会出现在这里
              </div>
            ) : (
              tabs.map((tab) => (
                <TabChip
                  key={tab.id}
                  tab={tab}
                  active={tab.id === activeTabId}
                  onSelect={() => selectTab(tab.id)}
                  onClose={() => closeTab(tab.id)}
                />
              ))
            )}
          </div>

          <div className="side-panel-body">
            <div
              className="side-panel-content side-panel-content-in"
              key={contentKey}
            >
              {payload ? <PanelContent payload={payload} /> : <EmptyPanelHint />}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}

function TabChip({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: SidePanelTab
  active: boolean
  onSelect: () => void
  onClose: () => void
}) {
  const label = tabTypeLabel(tab.payload)
  const short = tabShortTitle(tab.payload)
  const full = tabFullTitle(tab.payload)
  return (
    <div
      className={`side-panel-tab-chip${active ? ' active' : ''}`}
      role="tab"
      aria-selected={active}
    >
      <button
        type="button"
        className="side-panel-tab-chip-main"
        onClick={onSelect}
        title={`${label} · ${full}`}
      >
        <span className="side-panel-tab-chip-type">{label}</span>
        <span className="side-panel-tab-chip-title">{short}</span>
      </button>
      <button
        type="button"
        className="side-panel-tab-chip-close"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label={`关闭 ${short}`}
        title="关闭此标签"
      >
        ×
      </button>
    </div>
  )
}
