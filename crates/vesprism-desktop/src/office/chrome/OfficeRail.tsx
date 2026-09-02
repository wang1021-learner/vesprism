import { useCallback, useLayoutEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $rightPanelOpen, $rightPanelWidth } from '../../store'
import { OFFICE_FOLDERS } from '../catalog'
import { DEMO_FOLDERS, type MaterialFile } from '../model'
import { $officeFolderId } from '../store'

function fileIcon(kind: MaterialFile['kind']): string {
  if (kind === 'xlsx') return 'XLS'
  if (kind === 'docx') return 'DOC'
  if (kind === 'pdf') return 'PDF'
  return kind.toUpperCase()
}

const MIN_W = 260
const MAX_RATIO = 0.55

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

/** 办公右侧栏：材料夹名单。复用编码右栏壳，不读 Git。 */
export function OfficeRail() {
  const open = useStore($rightPanelOpen)
  const width = useStore($rightPanelWidth)
  const folderId = useStore($officeFolderId)
  const [openFileId, setOpenFileId] = useState<string | null>(null)
  const currentFolder =
    folderId === 'none' ? null : (DEMO_FOLDERS.find((f) => f.id === folderId) ?? DEMO_FOLDERS[0])

  useLayoutEffect(() => {
    $rightPanelOpen.set(true)
  }, [])

  if (!open) return null

  return (
    <div
      className="right-panel-shell is-open"
      style={{
        width,
        ['--rp-width' as string]: `${width}px`,
      }}
    >
      <ResizeHandle />
      <aside className="right-panel" aria-label="材料夹">
        <div className="right-panel-tabs">
          <span className="od-rail-title">材料夹</span>
          <label className="od-rail-folder">
            <select
              value={folderId}
              aria-label="材料夹"
              onChange={(e) => $officeFolderId.set(e.target.value)}
            >
              {OFFICE_FOLDERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="od-rail-scroll">
          {currentFolder ? (
            currentFolder.files.map((file) => {
              const expanded = openFileId === file.id
              return (
                <button
                  key={file.id}
                  type="button"
                  className={`od-file-row${expanded ? ' is-open' : ''}`}
                  aria-expanded={expanded}
                  onClick={() => setOpenFileId(expanded ? null : file.id)}
                >
                  <span className="od-file-info">
                    <span className="od-file-icon">{fileIcon(file.kind)}</span>
                    <strong className="od-file-name">{file.name}</strong>
                  </span>
                  <span className="od-file-meta">
                    <span className="od-file-size">{file.size}</span>
                  </span>
                  {expanded ? <span className="od-file-desc">{file.description}</span> : null}
                </button>
              )
            })
          ) : (
            <p className="od-home-files-empty">还没有关联材料夹。上面选一个演示夹。</p>
          )}
        </div>
      </aside>
    </div>
  )
}
