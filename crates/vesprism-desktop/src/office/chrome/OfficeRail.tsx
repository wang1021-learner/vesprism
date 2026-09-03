import { useCallback, useLayoutEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $rightPanelOpen, $rightPanelWidth, pushToast } from '../../store'
import {
  OFFICE_AGENTS,
  OFFICE_CONNECTORS,
  OFFICE_FOLDERS,
  OFFICE_KNOWLEDGE,
  OFFICE_SCHEDULES,
  OFFICE_SKILLS,
  type OfficePanel,
} from '../catalog'
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
  startOfficeTask,
  toggleOfficeStar,
} from '../store'

function fileIcon(kind: MaterialFile['kind']): string {
  if (kind === 'xlsx') return 'XLS'
  if (kind === 'docx') return 'DOC'
  if (kind === 'pdf') return 'PDF'
  return kind.toUpperCase()
}

const MIN_W = 280
const MAX_RATIO = 0.46

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

/* ── 文件列表 Tab ── */
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
          <p className="od-rt-empty">在右上角选择材料夹</p>
        )}
      </div>
    </div>
  )
}

/* ── 技能 Tab ── */
function SkillsTab() {
  const folderId = useStore($officeFolderId)
  const [search, setSearch] = useState('')
  const filtered = OFFICE_SKILLS.filter((s) =>
    !search || s.name.includes(search) || s.description.includes(search)
  )

  return (
    <div className="od-rt-section">
      <div className="od-rt-search">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8.5 8.5L11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          placeholder="搜索技能…"
          value={search}
          aria-label="搜索技能"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="od-rt-list">
        {filtered.length === 0 && <p className="od-rt-empty">没有匹配的技能</p>}
        {filtered.map((s) => (
          <div key={s.id} className="od-rt-card">
            <div className="od-rt-card-top">
              <span className="od-rt-cat-tag">{s.category}</span>
              <span className="od-rt-out-tag">{s.outputType}</span>
            </div>
            <div className="od-rt-card-title">{s.name}</div>
            <div className="od-rt-card-desc">{s.description}</div>
            <div className="od-rt-card-foot">
              <span className="od-rt-card-meta">输入: {s.inputs}</span>
              <button
                type="button"
                className="od-rt-run-btn"
                onClick={() => startOfficeTask(s.id, s.prompt, folderId, s.format)}
              >
                运行
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Agent Tab ── */
function AgentsTab() {
  const folderId = useStore($officeFolderId)
  const callAgent = (a: (typeof OFFICE_AGENTS)[number]) => {
    startOfficeTask(
      'custom',
      `作为「${a.name}（${a.role}）」，请按你的风格（${a.style}）基于当前材料夹产出一份演示交付预览。背景：${a.blurb}`,
      folderId,
      'doc',
    )
    pushToast(`已用「${a.name}」发起演示任务`, 'info')
  }

  return (
    <div className="od-rt-section">
      <div className="od-rt-list">
        {OFFICE_AGENTS.map((a) => (
          <div key={a.id} className="od-rt-card od-rt-agent-card">
            <div className="od-rt-agent-head">
              <div className="od-rt-agent-avatar">{a.avatar}</div>
              <div className="od-rt-agent-info">
                <div className="od-rt-card-title">{a.name}</div>
                <div className="od-rt-cat-tag">{a.role}</div>
              </div>
            </div>
            <div className="od-rt-card-desc">{a.blurb}</div>
            <div className="od-rt-card-foot">
              <div className="od-rt-tags">
                {a.skills.slice(0, 2).map((t) => (
                  <span key={t} className="od-rt-out-tag">{t}</span>
                ))}
              </div>
              <button type="button" className="od-rt-run-btn" onClick={() => callAgent(a)}>
                演示调用
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── 知识库 Tab ── */
function KnowledgeTab() {
  const [openId, setOpenId] = useState<string | null>(null)
  const seedFromKnowledge = (k: (typeof OFFICE_KNOWLEDGE)[number]) => {
    seedOfficeDraft(
      `依据企业知识库「${k.name}」（${k.category}）的口径${k.excerpt ? `：${k.excerpt}` : ''}，起草/校稿一份符合上述规范的文稿（演示）。`,
    )
    pushToast(`已把知识「${k.name}」放入起草框`, 'info')
  }

  return (
    <div className="od-rt-section">
      <div className="od-rt-list">
        {OFFICE_KNOWLEDGE.map((k) => {
          const open = openId === k.id
          return (
            <div key={k.id} className={`od-rt-card${open ? ' is-open' : ''}`}>
              <button
                type="button"
                className="od-rt-card-hit"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : k.id)}
              >
                <span className="od-rt-card-top">
                  <span className="od-rt-cat-tag">{k.category}</span>
                  <span className="od-rt-card-date">{k.updatedAt}</span>
                </span>
                <span className="od-rt-card-title">{k.name}</span>
                <span className="od-rt-card-desc">{k.excerpt}</span>
                <span className="od-rt-card-meta">来源：{k.source}</span>
              </button>
              {open && (
                <div className="od-rt-card-extra">
                  {k.tags.map((t) => (
                    <span key={t} className="od-rt-out-tag">{t}</span>
                  ))}
                  <button type="button" className="od-rt-mini-btn" onClick={() => seedFromKnowledge(k)}>
                    以此为准起草/校稿
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── 连接器 Tab（诚实演示，不假装已授权） ── */
function ConnectorsTab() {
  return (
    <div className="od-rt-section">
      <div className="od-rt-list">
        {OFFICE_CONNECTORS.map((c) => (
          <div key={c.id} className="od-rt-card">
            <div className="od-rt-card-top">
              <span className="od-rt-conn-icon">{c.icon}</span>
              <span className="od-rt-cat-tag">{c.category}</span>
              <span className="od-rt-conn-pill">未接</span>
            </div>
            <div className="od-rt-card-title">{c.name}</div>
            <div className="od-rt-card-desc">{c.description}</div>
            <div className="od-rt-card-foot">
              <div className="od-rt-tags">
                {c.features.map((f) => (
                  <span key={f} className="od-rt-out-tag">{f}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
        <p className="od-rt-hint">演示暂不接入真实服务；将来接引擎后按需打开授权。</p>
      </div>
    </div>
  )
}

/* ── 历史 Tab ── */
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

/* ── 排程 Tab ── */
function ScheduleTab() {
  const folderId = useStore($officeFolderId)
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(OFFICE_SCHEDULES.map((s) => [s.id, s.status === 'active']))
  )
  const [lastRun, setLastRun] = useState<Record<string, string>>({})

  const runOnce = (id: string, action: string) => {
    setLastRun((m) => ({ ...m, [id]: '刚刚（演示）' }))
    startOfficeTask('custom', `${action}（演示跑一次，不会真的发送/写盘）`, folderId, 'doc')
    pushToast('已触发一次演示运行', 'info')
  }

  return (
    <div className="od-rt-section">
      <div className="od-rt-list">
        {OFFICE_SCHEDULES.map((s) => {
          const on = enabled[s.id] ?? true
          return (
            <div key={s.id} className="od-rt-card">
              <div className="od-rt-card-top">
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={on ? '暂停' : '启用'}
                  className={`od-switch${on ? ' is-on' : ''}`}
                  onClick={() => setEnabled((m) => ({ ...m, [s.id]: !on }))}
                >
                  <span className="od-switch-knob" aria-hidden="true" />
                </button>
                <span className="od-rt-cat-tag">{on ? '运行中' : '已停用'}</span>
                <span className="od-rt-card-meta">{s.when}</span>
              </div>
              <div className="od-rt-card-title">{s.name}</div>
              <div className="od-rt-card-desc">{s.action}</div>
              <div className="od-rt-card-foot">
                <span className="od-rt-card-meta">上次: {lastRun[s.id] ?? s.lastRun}</span>
                <button
                  type="button"
                  className="od-rt-run-btn"
                  disabled={!on}
                  onClick={() => runOnce(s.id, s.action)}
                >
                  跑一次（演示）
                </button>
              </div>
            </div>
          )
        })}
        <p className="od-rt-hint">排程仅演示，不会真的发送或写盘。</p>
      </div>
    </div>
  )
}

/* ── Tab 配置 ── */
const TABS: { id: OfficePanel; label: string }[] = [
  { id: 'home', label: '文件' },
  { id: 'skills', label: '技能' },
  { id: 'agents', label: 'Agent' },
  { id: 'knowledge', label: '知识库' },
  { id: 'schedule', label: '排程' },
  { id: 'connectors', label: '连接器' },
  { id: 'history', label: '历史' },
]

/** 办公右侧功能栏：文件 · 技能 · Agent · 知识库 · 排程 · 连接器 · 历史 */
export function OfficeRail() {
  const open = useStore($rightPanelOpen)
  const width = useStore($rightPanelWidth)
  const panel = useStore($officePanel)

  useLayoutEffect(() => {
    $rightPanelOpen.set(true)
  }, [])

  if (!open) return null

  const activeTab: OfficePanel = panel

  return (
    <div
      className="right-panel-shell is-open od-feature-rail-shell"
      style={{
        width,
        ['--rp-width' as string]: `${width}px`,
      }}
    >
      <ResizeHandle />
      <aside className="right-panel od-feature-rail" aria-label="功能面板">
        {/* Tab 导航条 */}
        <div className="od-fr-tabs" role="tablist" aria-label="功能分区">
          {TABS.map((t) => {
            const isActive = t.id === 'home' ? activeTab === 'home' : activeTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`od-fr-tab${isActive ? ' is-active' : ''}`}
                onClick={() => openOfficePanel(t.id as OfficePanel)}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Tab 内容区 */}
        <div className="od-fr-body" role="tabpanel">
          {activeTab === 'home' && <FilesTab />}
          {activeTab === 'skills' && <SkillsTab />}
          {activeTab === 'agents' && <AgentsTab />}
          {activeTab === 'knowledge' && <KnowledgeTab />}
          {activeTab === 'schedule' && <ScheduleTab />}
          {activeTab === 'connectors' && <ConnectorsTab />}
          {activeTab === 'history' && <HistoryTab />}
        </div>
      </aside>
    </div>
  )
}
