import { useStore } from '@nanostores/react'
import { $dramaJobs } from './jobs'
import { $dramaEditor, $dramaNodes, $dramaSource } from './store'
import { JobCard } from './editors'
import { retryJob, startJob } from './actions'

export function JobsPanel({ docked }: { docked?: boolean }) {
  const jobs = Object.values(useStore($dramaJobs))
  const editor = useStore($dramaEditor)
  const source = useStore($dramaSource)
  const nodes = useStore($dramaNodes)
  const canGen = !!editor && nodes.find(n => n.id === editor.nodeId)?.kind !== 'shot_group'
  if (source !== 'backend') return docked ? <div className="drama-pad drama-muted">打开项目后显示任务</div> : null
  return (
    <div className={docked ? 'drama-pad' : 'drama-pad drama-float'}>
      {(!docked || canGen) && (
        <div className="drama-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          {!docked && <span>任务</span>}
          {canGen && editor && <button type="button" className="btn-inline" onClick={() => void startJob(editor.nodeId)}>生成当前节点</button>}
        </div>
      )}
      {jobs.length === 0 && <div className="drama-muted" style={{ padding: '12px 0', textAlign: 'center' }}>暂无任务</div>}
      {jobs.map(j => (
        <div key={j.jobId} data-job-id={j.jobId}>
          <div className="drama-muted">{j.nodeId} · {Math.round(j.progress * 100)}%</div>
          <JobCard status={j.status} errorCode={j.errorCode} onRetry={() => void retryJob(j.jobId)} />
        </div>
      ))}
    </div>
  )
}
