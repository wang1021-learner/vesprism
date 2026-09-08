import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from '@nanostores/react'
import { $rightPanelOpen, pushToast } from '../store'
import { HomeDesk } from './HomeDesk'
import type { OfficeFormat } from './catalog'
import { bootOfficePersist, saveOfficePersistNow } from './persist'
import { parseOfficeSlash } from './slash'
import {
  $officeActiveId,
  $officeDemoError,
  $officeTasks,
  ensureOfficeRailHome,
  openOfficeHome,
  refineOfficeTask,
  startOfficeTask,
  tickOfficeTask,
} from './store'
import { TaskExecutionView } from './TaskView'

const STEP_MS = 550
const STREAM_MS = 25

export function OfficeDesk() {
  const tasks = useStore($officeTasks)
  const activeId = useStore($officeActiveId)
  const task = tasks.find((t) => t.id === activeId) ?? null

  const [draft, setDraft] = useState('')
  const timer = useRef<number | null>(null)

  useEffect(() => {
    bootOfficePersist()
    // 进办公：右栏常驻开；无 active task 时默认产物空态
    $rightPanelOpen.set(true)
    if (!$officeActiveId.get()) ensureOfficeRailHome()
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
      saveOfficePersistNow()
    }
  }, [])

  // 自动启动 timer —— 支持从右侧栏点"运行"触发的新任务
  useEffect(() => {
    if (!task || task.status === 'done') return
    run(task)
    return () => {
      if (timer.current) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id])

  const run = (t: { id: string }) => {
    if (timer.current) window.clearTimeout(timer.current)
    const step = () => {
      try {
        const next = tickOfficeTask(t.id)
        if (!next || next.status === 'done') return
        // 如果进入了打字阶段（stepIndex >= plan.length），高频 tick
        const isStreaming = next.stepIndex >= next.plan.length && next.streamCursor !== undefined
        timer.current = window.setTimeout(step, isStreaming ? STREAM_MS : STEP_MS)
      } catch (err) {
        console.error('[office] stream tick failed', err)
        $officeDemoError.set('演示中断，可回工作台重试')
      }
    }
    timer.current = window.setTimeout(step, 180)
  }

  const begin = (starterId: string | 'custom', text: string, format?: OfficeFormat) => {
    // 材料上下文由 startOfficeTask 从 $officeMaterialContext 快照进 task
    const t = startOfficeTask(starterId, text, undefined, format)
    setDraft('')
    run(t)
  }

  const onHomeSubmit = (e: FormEvent) => {
    e.preventDefault()
    const { prompt, format } = parseOfficeSlash(draft)
    if (!prompt) return
    begin('custom', prompt, format)
  }

  const onTaskRefineSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!task) return
    const text = draft.trim()
    if (!text) return
    refineOfficeTask(task.id, text)
    pushToast(`已应用改稿意见：${text.slice(0, 20)}…`, 'info')
    setDraft('')
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }

  if (task) {
    return (
      <div className="od-desk is-task" role="main" aria-label="办公桌">
        <TaskExecutionView
          task={task}
          draft={draft}
          setDraft={setDraft}
          onKey={onKey}
          onSubmit={onTaskRefineSubmit}
          onRefine={(action) => {
            refineOfficeTask(task.id, action)
            pushToast(`已应用微调：${action}`, 'info')
          }}
          onBackHome={() => openOfficeHome()}
        />
      </div>
    )
  }

  return (
    <div className="od-desk is-home" role="main" aria-label="办公桌">
      <HomeDesk
        draft={draft}
        setDraft={setDraft}
        onKey={onKey}
        onSubmit={onHomeSubmit}
      />
    </div>
  )
}
