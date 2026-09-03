import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from '@nanostores/react'
import { pushToast } from '../store'
import { HomeDesk } from './HomeDesk'
import type { OfficeFormat } from './catalog'
import { bootOfficePersist, saveOfficePersistNow } from './persist'
import { parseOfficeSlash } from './slash'
import {
  $officeActiveId,
  $officeFolderId,
  $officeTasks,
  openOfficeHome,
  refineOfficeTask,
  startOfficeTask,
  tickOfficeTask,
} from './store'
import { TaskExecutionView } from './TaskView'

const STEP_MS = 650

export function OfficeDesk() {
  const tasks = useStore($officeTasks)
  const activeId = useStore($officeActiveId)
  const folderId = useStore($officeFolderId)
  const task = tasks.find((t) => t.id === activeId) ?? null

  const [draft, setDraft] = useState('')
  const timer = useRef<number | null>(null)

  useEffect(() => {
    bootOfficePersist()
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
      const next = tickOfficeTask(t.id)
      if (!next || next.status === 'done') return
      timer.current = window.setTimeout(step, STEP_MS)
    }
    timer.current = window.setTimeout(step, 240)
  }

  const begin = (starterId: string | 'custom', text: string, format?: OfficeFormat) => {
    const t = startOfficeTask(starterId, text, folderId, format)
    setDraft('')
    run(t)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const { prompt, format } = parseOfficeSlash(draft)
    if (!prompt) return
    begin('custom', prompt, format)
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
          onSubmit={onSubmit}
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
    <HomeDesk
      draft={draft}
      setDraft={setDraft}
      onKey={onKey}
      onSubmit={onSubmit}
    />
  )
}
