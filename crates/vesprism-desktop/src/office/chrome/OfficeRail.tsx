import { useCallback, useLayoutEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $rightPanelOpen, $rightPanelWidth, pushToast } from '../../store'
import { OFFICE_FOLDERS } from '../catalog'
import { DeliverableRenderer } from '../Deliverable'
import { kindIcon, kindLabel } from '../labels'
import { DEMO_FOLDERS, type MaterialFile } from '../model'
import { formatOfficeClock } from '../persist'
import {
  $officeActiveId,
  $officeArchivedIds,
  $officeFolderId,
  $officeRailTab,
  $officeStarredIds,
  $officeTasks,
  archiveOfficeTask,
  seedOfficeDraft,
  selectOfficeTask,
  toggleOfficeStar,
  type OfficeRailTab,
} from '../store'

function fileIcon(kind: MaterialFile['kind']): string {
  if (kind === 'xlsx') return 'XLS'
  if (kind === 'docx') return 'DOC'
  if (kind === 'pdf') return 'PDF'
  return kind.toUpperCase()
}

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

/* ── 交付物画板 Tab（核心 Artifacts 侧抽屉） ── */
function ArtifactTab() {
  const tasks = useStore($officeTasks)
  const activeId = useStore($officeActiveId)
  const task = tasks.find((t) => t.id === activeId) ?? null

  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted')
  const [activeSlide, setActiveSlide] = useState(1)

  const file = task?.file ?? null
  const isRunning = task?.status === 'running'
  const currentStep = task && task.stepIndex >= 0 ? task.plan[task.stepIndex] : null

  const copyToClipboard = () => {
    if (!file) return
    void navigator.clipboard.writeText(file.preview).then(() => {
      pushToast('已复制交付内容到剪贴板', 'info')
    })
  }

  const downloadFile = () => {
    if (!file) return
    const blob = new Blob([file.preview], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    URL.revokeObjectURL(url)
    pushToast(`已下载文件: ${file.name}`, 'info')
  }

  if (!task) {
    return (
      <div className="od-rail-empty">
        <p>暂无选定的交付任务。</p>
        <span>在工作台发起或选择一个任务后，产物会在此处自动展开。</span>
      </div>
    )
  }

  return (
    <div className="od-rail-artifact-workbench">
      {/* 画板顶部工具条 */}
      <header className="od-workbench-header">
        <div className="od-wb-file-meta">
          <span className="od-wb-icon">{file ? kindIcon(file.kind) : 'DOC'}</span>
          <div className="od-wb-titles">
            <strong className="od-wb-name">{file?.name ?? task.title}</strong>
            {file ? (
              <span className="od-wb-kind-badge">
                {kindLabel(file.kind)} {file.wordCount ? `· ${file.wordCount} 字` : ''}
              </span>
            ) : null}
          </div>
        </div>

        {file ? (
          <div className="od-wb-actions">
            <div className="od-view-switcher" role="group" aria-label="视图模式切换">
              <button
                type="button"
                className={viewMode === 'formatted' ? 'is-active' : ''}
                onClick={() => setViewMode('formatted')}
                title="格式化排版视图"
              >
                排版
              </button>
              <button
                type="button"
                className={viewMode === 'raw' ? 'is-active' : ''}
                onClick={() => setViewMode('raw')}
                title="Markdown 源码"
              >
                源码
              </button>
            </div>
            <button type="button" className="od-action-btn" onClick={copyToClipboard} title="复制全文">
              复制
            </button>
            <button
              type="button"
              className="od-action-btn is-primary"
              onClick={downloadFile}
              title="导出文稿"
            >
              导出
            </button>
          </div>
        ) : null}
      </header>

      {/* 画板正文渲染区 */}
      <div className="od-workbench-body">
        {!file && isRunning ? (
          <div className="od-loading-state">
            <div className="od-loading-mark" aria-hidden>
              {Math.max(task.stepIndex + 1, 0)}/{task.plan.length}
            </div>
            <p>正在执行规划步骤…</p>
            <span>{currentStep?.label ?? '初始化'}</span>
          </div>
        ) : !file ? (
          <div className="od-rail-empty">
            <p>尚未生成交付稿。</p>
            <span>等待规划执行完成即可在此预览成果。</span>
          </div>
        ) : viewMode === 'raw' ? (
          <pre className="od-raw-preview">{file.preview}</pre>
        ) : (
          <DeliverableRenderer
            file={file}
            activeSlide={activeSlide}
            setActiveSlide={setActiveSlide}
          />
        )}
      </div>
    </div>
  )
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

/* ── 右侧面板 Tab 配置：交付画板 · 材料文件 · 历史记录 ── */
const TABS: { id: OfficeRailTab; label: string }[] = [
  { id: 'artifact', label: '交付画板' },
  { id: 'files', label: '材料文件' },
  { id: 'history', label: '历史记录' },
]

/** 办公右侧面板：Artifact 交付物侧抽屉 · 材料夹文件 · 历史记录 */
export function OfficeRail() {
  const open = useStore($rightPanelOpen)
  const width = useStore($rightPanelWidth)
  const railTab = useStore($officeRailTab)

  useLayoutEffect(() => {
    // 默认开屏时预置开启右侧抽屉，但用户可自由点击 [|] 关闭
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
      <aside className="right-panel od-feature-rail" aria-label="办公交付与材料面板">
        <div className="od-fr-tabs" role="tablist" aria-label="侧边栏标签切换">
          {TABS.map((t) => {
            const isActive = railTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`od-fr-tab${isActive ? ' is-active' : ''}`}
                onClick={() => $officeRailTab.set(t.id)}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="od-fr-body" role="tabpanel">
          {railTab === 'artifact' && <ArtifactTab />}
          {railTab === 'files' && <FilesTab />}
          {railTab === 'history' && <HistoryTab />}
        </div>
      </aside>
    </div>
  )
}
