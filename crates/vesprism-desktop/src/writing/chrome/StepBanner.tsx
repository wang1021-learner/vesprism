import { stepJob } from '../framework/copy'
import type { ParsedNode } from '../model/nodes'

export function StepBanner({ kind }: { kind: ParsedNode['kind'] }) {
  const job = stepJob(kind)
  return (
    <div className="wd-step">
      <h2>{job.title}</h2>
      <p>{job.does}</p>
      <p className="wd-step-you">{job.you}</p>
    </div>
  )
}
