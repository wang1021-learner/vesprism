import { useEffect, type ComponentType } from 'react'
import { useStore } from '@nanostores/react'
import { AgentsIcon, PlusIcon, ScheduleIcon } from '../../components/sidebarIcons'
import { openChatTab } from '../../lib/openChatTab'
import { OFFICE_NAV, type OfficePanel } from '../catalog'
import { bootOfficePersist } from '../persist'
import {
  $officeActiveId,
  $officePanel,
  $officeTasks,
  openOfficeHome,
  openOfficePanel,
  selectOfficeTask,
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

export function OfficeTaskNav() {
  const panel = useStore($officePanel)
  const tasks = useStore($officeTasks)
  const active = useStore($officeActiveId)

  useEffect(() => {
    bootOfficePersist()
  }, [])

  const homeOn = !active && panel === 'home'
  const catalog = OFFICE_NAV.filter((item) => item.id !== 'home')

  return (
    <div className="od-nav" aria-label="办公入口">
      <div className="sidebar-compose">
        <button
          type="button"
          className={`sidebar-compose-new${homeOn ? ' is-active' : ''}`}
          aria-current={homeOn ? 'page' : undefined}
          onClick={() => {
            openOfficeHome()
            void ensureDesk()
          }}
        >
          <PlusIcon />
          <span>新任务</span>
        </button>
        <nav className="sidebar-compose-nav" aria-label="办公目录">
          {catalog.map((item) => {
            const Icon = NAV_ICON[item.id]
            const isActive = panel === item.id && !active
            return (
              <button
                key={item.id}
                type="button"
                className={`sidebar-compose-link${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  openOfficePanel(item.id)
                  void ensureDesk()
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

      {tasks.length > 0 ? (
        <div className="od-nav-history-section">
          <div className="sidebar-section-label">
            <span>近期任务</span>
            <span className="od-nav-badge">{tasks.length}</span>
          </div>
          <div className="od-nav-list">
            {tasks.slice(0, 10).map((t) => (
              <button
                key={t.id}
                type="button"
                className={`od-nav-task${t.id === active ? ' is-active' : ''}`}
                onClick={() => {
                  selectOfficeTask(t.id)
                  void ensureDesk()
                }}
              >
                <span className={`od-nav-dot is-${t.status}`} />
                <span className="od-nav-task-title">{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
