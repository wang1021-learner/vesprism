import { useEffect, useState, type ComponentType } from 'react'
import { useStore } from '@nanostores/react'
import { pushToast } from '../../store'
import { AgentsIcon, PlusIcon, ScheduleIcon } from '../../components/sidebarIcons'
import { openChatTab } from '../../lib/openChatTab'
import { OFFICE_NAV, type OfficePanel } from '../catalog'
import { bootOfficePersist, formatOfficeClock } from '../persist'
import {
  $officeActiveId,
  $officeArchivedIds,
  $officePanel,
  $officeStarredIds,
  $officeTasks,
  openOfficeHome,
  selectOfficeTask,
  toggleOfficeStar,
} from '../store'
import { ArchiveIcon, BookIcon, BoltIcon, PlugIcon } from './navIcons'

async function ensureDesk() {
  await openChatTab({ title: '办公桌', utilityKind: 'office-desk' })
}

const NAV_ICON: Record<OfficePanel, ComponentType> = {
  home: PlusIcon,
  skills: BoltIcon,
  agents: AgentsIcon,
  knowledge: BookIcon,
  schedule: ScheduleIcon,
  connectors: PlugIcon,
  history: ArchiveIcon,
}

type RecFilter = 'all' | 'running' | 'done' | 'archived'
const REC_FILTERS: { id: RecFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '进行中' },
  { id: 'done', label: '已交付' },
  { id: 'archived', label: '已归档' },
]

function StarGlyph({ on }: { on: boolean }) {
  return (
    <svg
      width="12"
      height="12"
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

export function OfficeTaskNav() {
  const panel = useStore($officePanel)
  const tasks = useStore($officeTasks)
  const active = useStore($officeActiveId)
  const archivedIds = useStore($officeArchivedIds)
  const starredIds = useStore($officeStarredIds)
  const [filter, setFilter] = useState<RecFilter>('all')
  // 目录项当前为占位：右栏目录 Tab 已删、中央页未做，仅本地高亮提示去向
  const [catSel, setCatSel] = useState<OfficePanel | null>(null)

  useEffect(() => {
    bootOfficePersist()
  }, [])

  // 目录高亮只是占位：一旦打开某条记录，目录占位收起、高亮交给对应记录
  useEffect(() => {
    if (active) setCatSel(null)
  }, [active])

  // 新任务高亮：回到工作台首页，且没占着某个目录占位
  const homeOn = !active && panel === 'home' && catSel === null
  // 左栏目录 = 能力入口（占位高亮）；右栏目录 Tab 已删、中央目录页后续接入
  const catalog = OFFICE_NAV.filter((item) => item.id !== 'home' && item.id !== 'history')

  const isArchived = (id: string) => archivedIds.includes(id)
  const base = filter === 'archived' ? tasks.filter((t) => isArchived(t.id)) : tasks.filter((t) => !isArchived(t.id))
  const list = base.filter((t) => {
    if (filter === 'all' || filter === 'archived') return true
    if (filter === 'running') return t.status === 'running' || t.status === 'idle'
    return t.status === 'done'
  })
  const shown = list.slice(0, 10)

  return (
    <div className="od-nav" aria-label="办公入口">
      <div className="sidebar-compose">
        <button
          type="button"
          className={`sidebar-compose-new${homeOn ? ' is-active' : ''}`}
          aria-current={homeOn ? 'page' : undefined}
          onClick={() => {
            setCatSel(null)
            openOfficeHome()
            void ensureDesk()
          }}
        >
          <PlusIcon />
          <span>新任务</span>
        </button>
        <nav className="sidebar-compose-nav" aria-label="办公能力">
          {catalog.map((item) => {
            const Icon = NAV_ICON[item.id]
            const isActive = catSel === item.id
            return (
              <button
                key={item.id}
                type="button"
                className={`sidebar-compose-link${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  // 有稿件打开时不占目录高亮，只给去向提示，不打扰当前稿件
                  if (active) {
                    pushToast(`「${item.label}」目录页将在中央主区接入`, 'info')
                    return
                  }
                  const next = catSel === item.id ? null : item.id
                  setCatSel(next)
                  if (next) {
                    pushToast(
                      `「${item.label}」目录页将在中央主区接入，当前先新建任务或从右侧材料夹起草`,
                      'info',
                    )
                  }
                }}
              >
                <Icon />
                <span>{item.label}</span>
                {item.badge ? <span className="od-nav-badge">{item.badge}</span> : null}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="od-nav-history-section">
        <div className="sidebar-section-label">
          <span>记录</span>
          <span className="od-nav-badge">
            {filter === 'archived' ? archivedIds.length : tasks.length - archivedIds.length}
          </span>
        </div>
        <div className="od-rec-filters" role="group" aria-label="按状态过滤任务">
          {REC_FILTERS.map((seg) => (
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
        <div className="od-nav-list">
          {shown.length === 0 ? (
            <p className="od-rec-empty">
              {filter === 'archived'
                ? '还没有归档。交付后点「归档」会收在这里。'
                : filter === 'running'
                  ? '没有进行中的任务。'
                  : filter === 'done'
                    ? '还没有交付记录。'
                    : '还没有记录。发起第一个任务后会显示在这里。'}
            </p>
          ) : (
            shown.map((t) => {
              const isActive = t.id === active
              const starred = starredIds.includes(t.id)
              const arch = isArchived(t.id)
              return (
                <div
                  key={t.id}
                  className={`od-nav-task-row${isActive ? ' is-active' : ''}${arch ? ' is-archived' : ''}`}
                >
                  <button
                    type="button"
                    className="od-nav-task"
                    onClick={() => {
                      setCatSel(null)
                      selectOfficeTask(t.id)
                      void ensureDesk()
                    }}
                    title={t.title}
                  >
                    <span className={`od-nav-dot is-${t.status}`} />
                    <span className="od-nav-task-title">{t.title}</span>
                    <span className="od-nav-task-meta">
                      {starred ? <StarGlyph on /> : null}
                      <span className="od-nav-task-time">{formatOfficeClock(t.createdAt)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`od-nav-star-btn${starred ? ' is-on' : ''}`}
                    aria-pressed={starred}
                    aria-label={starred ? '取消星标' : '星标'}
                    title={starred ? '取消星标' : '星标'}
                    onClick={() => toggleOfficeStar(t.id)}
                  >
                    <StarGlyph on={starred} />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
