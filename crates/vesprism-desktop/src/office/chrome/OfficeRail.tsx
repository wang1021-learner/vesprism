import { useCallback, useLayoutEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $rightPanelOpen, $rightPanelWidth, pushToast } from '../../store'
import { OFFICE_FOLDERS } from '../catalog'
import { DEMO_FOLDERS, type MaterialFile } from '../model'
import { formatOfficeClock } from '../persist'
import {
  $officeArchivedIds,
  $officeFolderId,
  $officePanel,
  $officeStarredIds,
  $officeTasks,
  archiveOfficeTask,
  openOfficePanel,
  seedOfficeDraft,
  selectOfficeTask,
  toggleOfficeStar,
} from '../store'

function fileIcon(kind: MaterialFile['kind']): string {
  if (kind === 'xlsx') return 'XLS'
  if (kind === 'docx') return 'DOC'
  if (kind === 'pdf') return 'PDF'
  return kind.toUpperCase()
}

const MIN_W = 280
const MAX_RATIO = 0.42

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

function StarGlyph({ on }: { on: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill={on ? 'currentColor' : 'none'}
      aria-hidden="true"
    >
      <path
        d="M6 1.4l1.4 2.9 3.2.5-2.3 2.2.5 3.2L6 8.9 3.2 10.2l.5-3.2L1.4 4.8l3.2-.5L6 1.4z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function statusLabel(status: string): string {
  if (status === 'done') return '已交付'
  if (status === 'running') return '执行中'
  return '待规划'
}

/* ── 材料夹文件 Tab（起草上下文） ── */
function FilesTab() {
  const folderId = useStore($officeFolderId)
  const [openFileId, setOpenFileId] = useState<string | null>(null)
  const currentFolder =
    folderId === 'none' ? null : (DEMO_FOLDERS.find((f) => f.id === folderId) ?? DEMO_FOLDERS[0])
  const folderMeta = OFFICE_FOLDERS.find((f) => f.id === folderId)
  const fileCount = currentFolder?.files.length ?? folderMeta?.count ?? 0

  const seedFromFile = (file: MaterialFile) => {
    seedOfficeDraft(
      `根据材料《${file.name}》${file.description ? `（${file.description}）` : ''}起草一份可交付的成果（演示）。`,
    )
    pushToast(`已把《${file.name}》放入起草框，可编辑后提交`, 'info')
  }

  return (
    <div className="od-rt-files">
      <div className="od-rt-tab-hd">
        <label className="od-rt-folder-select">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path
              d="M1 4.8C1 3.8 1.8 3 2.8 3h2.1l1.1 1.4H11c.6 0 1 .4 1 1V10c0 1-.8 1.8-1.8 1.8H2.8A1.8 1.8 0 0 1 1 10V4.8z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
              strokeLinejoin="round"
            />
          </svg>
          <span className="sr-only">材料夹</span>
          <select
            value={folderId}
            aria-label="材料夹"
            onChange={(e) => $officeFolderId.set(e.target.value)}
          >
            {OFFICE_FOLDERS.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
        {fileCount > 0 && <span className="od-rt-badge">{fileCount} 份</span>}
      </div>

      <div className="od-rt-list">
        {currentFolder ? (
          currentFolder.files.map((file) => {
            const expanded = openFileId === file.id
            return (
              <div
                key={file.id}
                className={`od-file-cell${expanded ? ' is-open' : ''}`}
                data-kind={file.kind}
              >
                <button
                  type="button"
                  className="od-file-row"
                  data-kind={file.kind}
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
                </button>
                {expanded && (
                  <div className="od-file-detail">
                    <p className="od-file-desc">{file.description}</p>
                    <button
                      type="button"
                      className="od-rt-mini-btn"
                      onClick={() => seedFromFile(file)}
                    >
                      以此起草
                    </button>
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <p className="od-rt-empty">在材料夹里选一份文件</p>
        )}
      </div>
    </div>
  )
}

/* ── 历史 Tab（记录管理） ── */
type HistFilter = 'all' | 'running' | 'done' | 'archived'
const HIST_FILTERS: { id: HistFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '进行中' },
  { id: 'done', label: '已交付' },
  { id: 'archived', label: '已归档' },
]

function HistoryTab() {
  const tasks = useStore($officeTasks)
  const archivedIds = useStore($officeArchivedIds)
  const starredIds = useStore($officeStarredIds)
  const [filter, setFilter] = useState<HistFilter>('all')

  if (tasks.length === 0) {
    return <p className="od-rt-empty od-rt-empty-lg">还没有历史任务。发起第一个任务后会显示在这里。</p>
  }

  const isArchived = (id: string) => archivedIds.includes(id)
  const base =
    filter === 'archived' ? tasks.filter((t) => isArchived(t.id)) : tasks.filter((t) => !isArchived(t.id))
  const list = base.filter((t) => {
    if (filter === 'all' || filter === 'archived') return true
    if (filter === 'running') return t.status === 'running' || t.status === 'idle'
    return t.status === 'done'
  })

  return (
    <div className="od-rt-section">
      <div className="od-rec-filters od-rt-filters" role="group" aria-label="按状态过滤历史">
        {HIST_FILTERS.map((seg) => (
          <button
            key={seg.id}
            type="button"
            className={`od-rec-filter${filter === seg.id ? ' is-active' : ''}`}
            aria-pressed={filter === seg.id}
            onClick={() => setFilter(seg.id)}
          >
            {seg.label}
          </button>
        ))}
      </div>
      <div className="od-rt-list">
        {list.length === 0 && (
          <p className="od-rt-empty">
            {filter === 'archived' ? '还没有归档任务。' : '没有符合该状态的任务。'}
          </p>
        )}
        {list.map((t) => {
          const starred = starredIds.includes(t.id)
          const arch = isArchived(t.id)
          return (
            <div key={t.id} className="od-rt-history-row">
              <button
                type="button"
                className="od-rt-history-item"
                onClick={() => selectOfficeTask(t.id)}
              >
                <span className={`od-rt-hist-dot is-${t.status}`} aria-hidden="true" />
                <span className="od-rt-hist-body">
                  <span className="od-rt-hist-title">{t.title}</span>
                  <span className="od-rt-hist-sub">
                    {statusLabel(t.status)} · {formatOfficeClock(t.createdAt)}
                  </span>
                </span>
              </button>
              <span className="od-rt-hist-ops">
                <button
                  type="button"
                  className={`od-rt-op-btn${starred ? ' is-on' : ''}`}
                  aria-label={starred ? '取消星标' : '星标'}
                  title={starred ? '取消星标' : '星标'}
                  aria-pressed={starred}
                  onClick={() => toggleOfficeStar(t.id)}
                >
                  <StarGlyph on={starred} />
                </button>
                <button
                  type="button"
                  className={`od-rt-op-btn${arch ? ' is-on' : ''}`}
                  aria-label={arch ? '取消归档' : '归档'}
                  title={arch ? '取消归档' : '归档'}
                  aria-pressed={arch}
                  onClick={() => archiveOfficeTask(t.id)}
                >
                  {arch ? '已归档' : '归档'}
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Tab 配置：右栏只保留「文件 · 历史」上下文，目录（技能/Agent/…）收敛到左栏 ── */
const TABS: { id: 'home' | 'history'; label: string }[] = [
  { id: 'home', label: '文件' },
  { id: 'history', label: '历史' },
]

/** 办公右侧上下文栏：材料夹文件 · 历史记录。目录能力入口在左侧栏。 */
export function OfficeRail() {
  const open = useStore($rightPanelOpen)
  const width = useStore($rightPanelWidth)
  const panel = useStore($officePanel)
  // 目录占位（skills/agents/...）不切到右栏，右栏仍展示文件材料
  const activeTab = panel === 'history' ? 'history' : 'home'

  useLayoutEffect(() => {
    $rightPanelOpen.set(true)
  }, [])

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
      <aside className="right-panel od-feature-rail" aria-label="上下文面板">
        <div className="od-fr-tabs" role="tablist" aria-label="上下文分区">
          {TABS.map((t) => {
            const isActive = activeTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`od-fr-tab${isActive ? ' is-active' : ''}`}
                onClick={() => openOfficePanel(t.id)}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="od-fr-body" role="tabpanel">
          {activeTab === 'home' ? <FilesTab /> : <HistoryTab />}
        </div>
      </aside>
    </div>
  )
}
