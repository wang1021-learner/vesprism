import { useState } from 'react'
import { useStore } from '@nanostores/react'
import { $projectList, lastProject, newProject } from './projects'
import { ERROR_TEXT } from './api'
import { sortProjects } from './palette'
import { $dramaProjectId } from './store'

const fmt = (s: number) => new Date(s * 1000).toLocaleString('zh-CN', { hour12: false })

export function ProjectList({ onOpen, compact }: { onOpen: (id: string) => void; compact?: boolean }) {
  const raw = useStore($projectList)
  const current = useStore($dramaProjectId)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const last = current ?? lastProject()
  if (!raw) return <div className="drama-pad drama-muted">加载中…</div>
  const list = sortProjects(raw)
  const create = async () => {
    const r = await newProject(name)
    if (r.ok) { setName(''); setErr(null); onOpen(r.value.projectId) } else setErr(ERROR_TEXT[r.error.code] ?? r.error.message)
  }
  return (
    <div className={`drama-pad ${compact ? '' : 'mx-auto max-w-xl'}`}>
      <div className="drama-row">
        <input className="drama-field" placeholder="项目名（可留空）" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void create() }} />
        <button type="button" className="btn-primary" onClick={() => void create()}>新建一集</button>
      </div>
      {err && <div role="alert" className="drama-error">{err}</div>}
      {list.projects.length === 0 && list.broken.length === 0 && <div className="drama-empty" style={{ position: 'relative', padding: '28px 0' }}><strong>还没有漫剧项目</strong></div>}
      <ul className="drama-list">
        {list.projects.map(p => (
          <li key={p.projectId}>
            <button className={p.projectId === last ? 'is-on' : ''} onClick={() => onOpen(p.projectId)}>
              <span className="truncate">{p.name}</span><span className="drama-muted shrink-0">{fmt(p.updatedAt)}</span>
            </button>
          </li>
        ))}
        {list.broken.map(b => (
          <li key={b.projectId} title={b.message} aria-disabled className="drama-lib-item is-soon">
            <span className="truncate">{b.projectId}</span><span>无法打开</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
