// 漫剧左侧一列：项目、节点、任务同时在。节点用 div，按钮在 WebView 里拖不起来。
import { useEffect, useRef, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useStore } from '@nanostores/react'
import { ProjectList } from './ProjectList'
import { JobsPanel } from './JobsPanel'
import { LIBRARY, portColor, type LibItem } from './palette'
import { placeNode } from './actions'
import { $dramaView, initDrama, openProject } from './shell'
import type { NodeKind } from '../../../drama-core/bindings/drama'

export const LIB_MIME = 'application/x-drama-kind'

function startKindDrag(e: DragEvent, key: string) {
  e.dataTransfer.setData(LIB_MIME, key)
  e.dataTransfer.setData('text/plain', key)
  e.dataTransfer.effectAllowed = 'move'
}

function KindDrag({ item, className, title, onPlace, children }: {
  item: LibItem
  className: string
  title: string
  onPlace: (kind: NodeKind) => void
  children: ReactNode
}) {
  const dragged = useRef(false)
  const kind = item.kind
  const place = () => { if (kind) onPlace(kind) }
  const onKeyDown = (e: KeyboardEvent) => {
    if (!kind || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    place()
  }
  return (
    <div role="button" tabIndex={kind ? 0 : -1} aria-disabled={!kind} draggable={!!kind}
      title={title} className={className} data-kind={kind ?? 'edit'}
      onDragStart={e => { if (!kind) { e.preventDefault(); return } dragged.current = true; startKindDrag(e, item.key) }}
      onDragEnd={() => { window.setTimeout(() => { dragged.current = false }, 0) }}
      onClick={() => { if (dragged.current || !kind) return; place() }}
      onKeyDown={onKeyDown}>
      {children}
    </div>
  )
}

function Library() {
  return (
    <div className="drama-pad">
      <div className="drama-muted">按住拖到画布上，或点一下添加</div>
      {LIBRARY.map(i => (
        <KindDrag key={i.key} item={i} onPlace={kind => void placeNode(kind)}
          title={i.kind ? `拖到画布，或点一下添加${i.label}` : '即将支持，还不能添加'}
          className={`drama-lib-item${i.kind ? '' : ' is-soon'}`}>
          <span>{i.label}{!i.kind && '（即将支持）'}</span>
          <span className="drama-lib-dots">{i.outputs.map(p => <i key={p} aria-hidden style={{ background: portColor(p) }} />)}</span>
        </KindDrag>
      ))}
    </div>
  )
}

export function DramaNodeDock({ onPlace }: { onPlace: (kind: NodeKind) => void }) {
  return (
    <div className="drama-dock" role="toolbar" aria-label="添加节点">
      {LIBRARY.map(i => (
        <KindDrag key={i.key} item={i} onPlace={onPlace}
          title={i.kind ? `拖到画布，或点一下添加${i.label}` : '即将支持'}
          className="drama-dock-item">
          {i.label}{!i.kind && '（即将支持）'}
        </KindDrag>
      ))}
    </div>
  )
}

export default function DramaRail() {
  const view = useStore($dramaView)
  useEffect(() => { initDrama() }, [])
  return (
    <aside className="drama-rail" data-testid="drama-rail">
      <header className="drama-rail-head">
        <span className="drama-rail-title">漫剧</span>
        <span className="drama-muted">分镜</span>
      </header>
      {view === 'off' ? <div className="drama-pad drama-muted">漫剧未启用</div> : (
        <>
          <section className="drama-rail-block is-projects" aria-label="项目">
            <h2>项目</h2>
            <ProjectList compact onOpen={id => void openProject(id)} />
          </section>
          <section className="drama-rail-block is-lib" aria-label="节点">
            <h2>节点</h2>
            <Library />
          </section>
          <section className="drama-rail-block is-jobs" aria-label="任务">
            <h2>任务</h2>
            <JobsPanel docked />
          </section>
        </>
      )}
    </aside>
  )
}
