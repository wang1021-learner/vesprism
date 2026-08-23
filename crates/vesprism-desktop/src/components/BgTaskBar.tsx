import { useState } from 'react'
import { useStore } from '@nanostores/react'
import { $activeTabId, $backgroundTasks, pushToast, removeBackgroundTask } from '../store'
import { killTask } from '../bridge'

export function BgTaskBar() {
  const tasks = useStore($backgroundTasks)
  const tabId = useStore($activeTabId)
  const [busy, setBusy] = useState('')
  const list = Object.entries(tasks)
  if (!list.length) return null

  const kill = async (toolCallId: string, taskId: string) => {
    if (!tabId || busy) return
    setBusy(taskId)
    try {
      await killTask(tabId, taskId)
      removeBackgroundTask(tabId, toolCallId)
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="bg-task-bar" aria-label="后台命令">
      {list.map(([toolCallId, t]) => (
        <div key={toolCallId} className="bg-task-pill">
          <span title={t.command}>{t.description || t.command || t.taskId}</span>
          <button
            type="button"
            disabled={busy === t.taskId}
            onClick={() => void kill(toolCallId, t.taskId)}
          >
            {busy === t.taskId ? '…' : '终止'}
          </button>
        </div>
      ))}
    </div>
  )
}
