import { useCallback, useEffect } from 'react'
import { useStore } from '@nanostores/react'
import { $rightPanelOpen, $rightPanelWidth } from '../../store'
import { ArtifactPanel } from '../ArtifactPanel'
import {
  $officeActiveId,
  $officeRailTab,
  $officeTasks,
} from '../store'

const MIN_W = 340
const MAX_RATIO = 0.65

function ResizeHandle() {
  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = $rightPanelWidth.get()
    const onMove = (ev: MouseEvent) => {
      const next = startW + (startX - ev.clientX)
      const maxW = Math.floor(window.innerWidth * MAX_RATIO)
      $rightPanelWidth.set(Math.max(MIN_W, Math.min(maxW, next)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div
      className="right-panel-resize-handle"
      onMouseDown={onDown}
      title="拖动调整宽度"
      role="separator"
      aria-orientation="vertical"
    />
  )
}

/** 右栏仅产物：空态 / 加载 / 流式 / 完成。 */
function ArtifactPane() {
  const tasks = useStore($officeTasks)
  const activeId = useStore($officeActiveId)
  const task = tasks.find((t) => t.id === activeId) ?? null

  if (!task) {
    return (
      <div className="od-rail-empty" role="status">
        <p>提交任务后，交付预览会出现在这里</p>
        <span>在底栏输入需求并可挂载材料，提交后可在此查看与导出。</span>
      </div>
    )
  }

  return (
    <div className="od-rail-artifact-workbench">
      <ArtifactPanel task={task} />
    </div>
  )
}

/** 办公右侧面板：仅「产物」（材料 / 历史 Tab 已移除）。 */
export function OfficeRail() {
  const open = useStore($rightPanelOpen)
  const width = useStore($rightPanelWidth)
  // 订阅以保持遗留态可被纠正；UI 固定产物
  const railTab = useStore($officeRailTab)
  useEffect(() => {
    if (railTab !== 'artifact') $officeRailTab.set('artifact')
  }, [railTab])

  if (!open) return null

  return (
    <div
      className="right-panel-shell is-open od-feature-rail-shell"
      style={{
        width,
        ['--rp-width' as string]: `${width}px`,
      }}
    >
      <ResizeHandle />
      <aside className="right-panel od-feature-rail" aria-label="产物面板">
        <div className="od-fr-tabs od-fr-hd" role="presentation">
          <div className="od-fr-title" aria-hidden={false}>
            产物
          </div>
          <button
            type="button"
            className="od-fr-close"
            onClick={() => $rightPanelOpen.set(false)}
            title="关闭面板"
            aria-label="关闭面板"
          >
            ×
          </button>
        </div>

        <div className="od-fr-body" role="region" aria-label="产物">
          <ArtifactPane />
        </div>
      </aside>
    </div>
  )
}
