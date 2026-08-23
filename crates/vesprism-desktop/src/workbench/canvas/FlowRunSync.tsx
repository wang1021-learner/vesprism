/**
 * 单独订阅 $workflows，避免试跑 phase 拖垮整棵 React Flow。
 */
import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useStore } from '@nanostores/react'
import { $workflows } from '../../store'
import type { FlowRunStep } from '../flow'
import { applyRunToSteps, pickNewRuns, runFingerprint, type SubmittedRun } from './runSync'

export function FlowRunSync({
  submittedRef,
  runSteps,
  setRunSteps,
  setStepOutputs,
}: {
  submittedRef: MutableRefObject<SubmittedRun | null>
  runSteps: FlowRunStep[]
  setRunSteps: Dispatch<SetStateAction<FlowRunStep[]>>
  setStepOutputs: Dispatch<
    SetStateAction<Record<string, { output: unknown; status: string; timestamp: number }>>
  >
}) {
  const workflows = useStore($workflows)
  const fpRef = useRef('')

  useEffect(() => {
    const submitted = submittedRef.current
    if (!submitted || runSteps.length === 0) return
    const items = pickNewRuns(workflows, submitted)
    if (items.length === 0) return
    const latest = items[items.length - 1]
    const fp = runFingerprint(latest)
    if (fp === fpRef.current) return
    fpRef.current = fp
    const applied = applyRunToSteps(runSteps, latest)
    setRunSteps(applied.steps)
    if (applied.outputs.length) {
      setStepOutputs((cur) => {
        const next = { ...cur }
        for (const o of applied.outputs) {
          next[o.nodeId] = { output: o.output, status: 'completed', timestamp: Date.now() }
        }
        return next
      })
    }
  }, [workflows, runSteps, setRunSteps, setStepOutputs, submittedRef])

  return null
}
