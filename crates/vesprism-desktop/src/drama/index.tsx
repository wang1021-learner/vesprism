import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { ReactFlowProvider } from '@xyflow/react'
import { DramaCanvas } from './DramaCanvas'
import { DramaEditorPanel } from './DramaEditorPanel'
import { ERROR_TEXT } from './api'
import { $projectList, newProject } from './projects'
import { $dramaView, initDrama, openProject } from './shell'

function DramaHome() {
  const list = useStore($projectList)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const count = (list?.projects.length ?? 0) + (list?.broken.length ?? 0)
  const start = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await newProject('')
      if (!r.ok) { setErr(ERROR_TEXT[r.error.code] ?? r.error.message); return }
      await openProject(r.value.projectId)
    } catch {
      setErr('后端不可用')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="drama-stage">
      <div className="drama-start">
        <div className="drama-empty-frame" aria-hidden />
        <strong>{count === 0 ? '先新建一集' : '还没有打开的项目'}</strong>
        <span>{count === 0 ? '打开后画布上会有剧本、角色、出图、配音和导出，线已经连好。' : '在左侧点一个项目，或新建一集。'}</span>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void start()}>新建一集</button>
        {err && <div role="alert" className="drama-error">{err}</div>}
      </div>
    </div>
  )
}

export default function DramaShell() {
  const view = useStore($dramaView)
  useEffect(() => { initDrama() }, [])
  if (view === 'probe') return <div className="drama-stage">加载中…</div>
  if (view === 'off') return (
    <div className="drama-stage">
      <div className="drama-empty">
        <strong>漫剧未启用</strong>
        <span>请用 <code>npm run desktop -- --features drama</code> 启动后再进入。</span>
      </div>
    </div>
  )
  if (view === 'list') return <DramaHome />
  return (
    <ReactFlowProvider>
      <div className="drama-board"><DramaCanvas /><DramaEditorPanel /></div>
    </ReactFlowProvider>
  )
}
