import { useEffect, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import {
  $checkSkipped, $lines, $looks, $scriptLocked, $shots, RETRY_UNCONFIRMED_TEXT,
  canGenerate, jobLabel, moveShot, shotFlags,
} from './editorData'
import { exportEpisode } from './actions'
import { $dramaLinks, $dramaNodes, exportHasStale, markDownstream, withStale } from './store'
import type { JobErrorCode, JobStatus } from '../../../drama-core/bindings/drama'

const btn = 'btn-inline'
const FLAG_TEXT = { too_long: '超 15 秒', dialogue_overflow: '台词比画面长' } as const

function NeedsUpdate({ nodeId }: { nodeId: string }) {
  const n = useStore($dramaNodes).find(x => x.id === nodeId)
  return n?.needsUpdate ? <span className="drama-badge">需更新</span> : null
}

export function ScriptEditor() {
  const lines = useStore($lines); const locked = useStore($scriptLocked)
  return (
    <div className="space-y-1" data-testid="script-editor">
      <div className="flex items-center gap-2 text-xs">
        {locked ? <span className="drama-muted">剧本已定稿，只读</span> : <button className={btn} onClick={() => $scriptLocked.set(true)}>定稿</button>}
      </div>
      {lines.map(l => (
        <label key={l.id} className="flex gap-2 text-xs">
          <span className="drama-muted w-10 shrink-0">{l.speaker}</span>
          <input className="drama-field" value={l.text} readOnly={locked}
            onChange={e => { $lines.set(lines.map(x => (x.id === l.id ? { ...x, text: e.target.value } : x))); markDownstream('script') }} />
        </label>
      ))}
    </div>
  )
}

export function StoryboardEditor() {
  const shots = [...useStore($shots)].sort((a, b) => a.order - b.order)
  const skipped = useStore($checkSkipped)
  const [confirmSkip, setConfirmSkip] = useState(false)
  const bad = shots.filter(s => shotFlags(s).length).length
  return (
    <div className="text-xs" data-testid="storyboard-editor">
      <div className="mb-2 flex items-center gap-2">
        <span>{bad ? `${bad} 个镜头未通过检查` : '检查全部通过'}</span>
        {bad > 0 && !skipped && <button className={btn} onClick={() => setConfirmSkip(true)}>跳过检查</button>}
        <button className={btn} disabled={!canGenerate()} data-testid="generate">生成</button>
        <NeedsUpdate nodeId="shots" />
      </div>
      {confirmSkip && (
        <div role="dialog" className="drama-dialog">
          跳过检查会被记录，分镜一改就作废。确定跳过吗？
          <button className={btn} onClick={() => { $checkSkipped.set(true); setConfirmSkip(false) }}>确定</button>
          <button className={btn} onClick={() => setConfirmSkip(false)}>取消</button>
        </div>
      )}
      <table className="drama-table"><tbody>
        {shots.map((s, i) => (
          <tr key={s.id}>
            <td className="py-1">{i + 1}</td>
            <td>{(s.durationMs / 1000).toFixed(1)}s</td>
            <td>{s.isStatic ? '静帧' : '视频'}</td>
            <td className="drama-error">{shotFlags(s).map(f => FLAG_TEXT[f]).join('、')}</td>
            <td className="text-right">
              <button className={btn} onClick={() => moveShot(s.id, -1)}>上移</button>
              <button className={btn} onClick={() => moveShot(s.id, 1)}>下移</button>
            </td>
          </tr>
        ))}
      </tbody></table>
    </div>
  )
}

export function CharacterEditor() {
  const looks = useStore($looks)
  return (
    <div className="space-y-2 text-xs" data-testid="character-editor">
      {looks.map(c => (
        <div key={c.id} className="drama-card">
          <div className="font-medium">{c.name}</div>
          <div>造型：{c.outfit}（v{c.version}）</div>
          <div>音色：{c.voice}</div>
          <button className={btn} onClick={() => { $looks.set(looks.map(x => (x.id === c.id ? { ...x, version: x.version + 1 } : x))); markDownstream('character') }}>新建造型版本</button>
        </div>
      ))}
    </div>
  )
}

/** 三轨时间轴：画面 / 配音 / BGM，自绘 canvas；缺镜头画占位块，底部画字幕安全区。 */
export function TimelineEditor() {
  const shots = [...useStore($shots)].sort((a, b) => a.order - b.order)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current; const g = cv?.getContext('2d'); if (!cv || !g) return
    const total = shots.reduce((t, s) => t + s.durationMs, 0) || 1
    const w = cv.width; const pxPerMs = w / total
    g.clearRect(0, 0, w, cv.height)
    let x = 0
    for (const s of shots) {
      const sw = s.durationMs * pxPerMs
      g.fillStyle = s.isStatic ? '#6b6456' : '#3d6b8c'; g.fillRect(x, 4, Math.max(sw - 1, 1), 24)
      g.fillStyle = '#2f6f53'; g.fillRect(x, 34, Math.max(Math.min(s.dialogueMs, s.durationMs) * pxPerMs - 1, 1), 16)
      x += sw
    }
    g.fillStyle = '#5c537855'; g.fillRect(0, 56, w, 12)
  }, [shots])
  const views = withStale(useStore($dramaNodes), useStore($dramaLinks))
  const stale = exportHasStale(views)
  const [askExport, setAskExport] = useState(false)
  return (
    <div data-testid="timeline-editor" className="text-xs">
      <div className="mb-2 flex items-center gap-2">
        <button className={btn} data-testid="export" onClick={() => (stale ? setAskExport(true) : void exportEpisode(false))}>导出</button>
        {stale && <span className="drama-muted">部分素材不是最新</span>}
      </div>
      {askExport && (
        <div role="dialog" className="drama-dialog">
          部分素材不是最新，导出会记下这一次。确定继续导出吗？
          <button className={btn} onClick={() => { setAskExport(false); void exportEpisode(true) }}>确定</button>
          <button className={btn} onClick={() => setAskExport(false)}>取消</button>
        </div>
      )}
      <canvas ref={ref} width={800} height={72} className="drama-timeline" />
      <div className="drama-muted" style={{ marginTop: 4 }}>画面 / 配音 / BGM。波形图等后端生成。</div>
    </div>
  )
}

export function JobCard({ status, errorCode, onRetry }: { status: JobStatus; errorCode: JobErrorCode | null; onRetry: () => void }) {
  const [ask, setAsk] = useState(false)
  const unconfirmed = status === 'failed' && errorCode === 'unconfirmed_submit'
  return (
    <div className="flex items-center gap-2 text-xs" data-testid="job-card">
      <span>{jobLabel(status, errorCode)}</span>
      {status === 'failed' && <button className={btn} onClick={() => (unconfirmed ? setAsk(true) : onRetry())}>重试</button>}
      {ask && (
        <div role="dialog">{RETRY_UNCONFIRMED_TEXT}
          <button className={btn} onClick={() => { setAsk(false); onRetry() }}>确定</button>
          <button className={btn} onClick={() => setAsk(false)}>取消</button>
        </div>
      )}
    </div>
  )
}
