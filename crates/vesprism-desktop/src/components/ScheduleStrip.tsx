import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $scheduledTasks, $sessionScheduleOpen } from '../store'
import { openSessionSchedule } from '../lib/engineSlash'
import { nextFireLabel, promptPreview, zhHumanSchedule } from '../lib/scheduleLoop'

/** 对话里的定时摘要；点开完整面板。 */
export function ScheduleStrip() {
  const tasks = useStore($scheduledTasks)
  const panelOpen = useStore($sessionScheduleOpen)
  const [now, setNow] = useState(() => Date.now())
  const live = tasks

  useEffect(() => {
    if (panelOpen || live.length === 0) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [panelOpen, live.length])

  if (panelOpen || live.length === 0) return null
  const first = live[0]
  const next = nextFireLabel(first.nextFireAt, now)
  return (
    <button
      type="button"
      className="schedule-strip"
      aria-label={`定时任务 ${live.length} 个`}
      onClick={() => openSessionSchedule()}
    >
      <span className="schedule-strip-kicker">定时 {live.length}</span>
      <span className="schedule-strip-body">
        {zhHumanSchedule(first.humanSchedule)}
        {first.prompt ? ` · ${promptPreview(first.prompt, 42)}` : ''}
        {next ? (next === '到期' ? ' · 即将再跑' : ` · ${next}后`) : ''}
      </span>
      <span className="schedule-strip-more">打开</span>
    </button>
  )
}
