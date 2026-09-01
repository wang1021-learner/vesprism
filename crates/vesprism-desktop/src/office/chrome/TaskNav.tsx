import { useStore } from '@nanostores/react'
import { openChatTab } from '../../lib/openChatTab'
import { OFFICE_NAV } from '../catalog'
import {
  $officeActiveId,
  $officePanel,
  $officeTasks,
  openOfficeHome,
  openOfficePanel,
  selectOfficeTask,
} from '../store'

async function ensureDesk() {
  await openChatTab({ title: '办公桌', utilityKind: 'office-desk' })
}

export function OfficeTaskNav() {
  const panel = useStore($officePanel)
  const tasks = useStore($officeTasks)
  const active = useStore($officeActiveId)

  return (
    <div className="od-nav" aria-label="AI 办公导航">
      <div className="od-nav-section">
        {OFFICE_NAV.map((item) => {
          const isActive =
            item.id === 'home'
              ? !active && panel === 'home'
              : panel === item.id && !active

          return (
            <button
              key={item.id}
              type="button"
              className={`od-nav-link${isActive ? ' is-active' : ''}`}
              onClick={() => {
                if (item.id === 'home') openOfficeHome()
                else openOfficePanel(item.id)
                void ensureDesk()
              }}
            >
              <span className="od-nav-link-label">{item.label}</span>
              {item.badge ? <span className="od-nav-badge">{item.badge}</span> : null}
            </button>
          )
        })}
      </div>

      {tasks.length > 0 ? (
        <div className="od-nav-history-section">
          <div className="od-nav-label-row">
            <span className="od-nav-label">近期任务</span>
            <span className="od-nav-count">{tasks.length}</span>
          </div>
          <div className="od-nav-list">
            {tasks.slice(0, 10).map((t) => (
              <button
                key={t.id}
                type="button"
                className={`od-nav-item${t.id === active ? ' is-active' : ''}`}
                onClick={() => {
                  selectOfficeTask(t.id)
                  void ensureDesk()
                }}
              >
                <div className="od-nav-item-top">
                  <span className={`od-nav-dot is-${t.status}`} />
                  <span className="od-nav-item-title">{t.title}</span>
                </div>
                <span className="od-nav-item-meta">
                  {t.status === 'done' ? '已交付' : t.status === 'running' ? '执行中…' : '待处理'} · {t.createdAt}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
