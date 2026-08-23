/**
 * 当前对话的定时任务：官方 /loop + x.ai/scheduler/delete。
 * 必须挂在本会话，不能另开专用 Tab（否则任务会建到空会话上）。
 */
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@nanostores/react'
import {
  $activeTabId,
  $scheduledTasks,
  $sessionPhase,
  $sessionScheduleOpen,
  patchActiveTab,
  pushToast,
} from '../store'
import { sessionExt } from '../bridge'
import { sendSessionPrompt } from '../lib/sendSessionPrompt'
import { closeSessionSchedule } from '../lib/engineSlash'
import {
  INTERVAL_PRESETS,
  LOOP_EXPIRE_HINT,
  buildLoopCommand,
  humanScheduleZh,
  intervalBelowMin,
  lastFiredLabel,
  makeIntervalToken,
  makePendingTask,
  nextFireLabel,
  promptPreview,
  zhHumanSchedule,
  type IntervalUnit,
} from '../lib/scheduleLoop'

export function SchedulePanel() {
  const open = useStore($sessionScheduleOpen)
  const tabId = useStore($activeTabId)
  const ready = useStore($sessionPhase) === 'ready'
  const tasks = useStore($scheduledTasks)
  const [interval, setIntervalToken] = useState('5m')
  const [customN, setCustomN] = useState('10')
  const [customUnit, setCustomUnit] = useState<IntervalUnit>('m')
  const [custom, setCustom] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmId, setConfirmId] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSessionSchedule()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const token = custom ? makeIntervalToken(Number(customN), customUnit) : interval
  const belowMin = token ? intervalBelowMin(token) : false

  const live = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.pending !== b.pending) return a.pending ? -1 : 1
        return (a.nextFireAt || '').localeCompare(b.nextFireAt || '')
      }),
    [tasks],
  )

  if (!open) return null

  const submit = async () => {
    if (!tabId || busy) return
    const p = prompt.trim()
    if (!token || !p) {
      pushToast('先选间隔并写清每次要做什么', 'info')
      return
    }
    const cmd = buildLoopCommand(token, p)
    if (!cmd) {
      pushToast('间隔格式不对，用 5m / 1h / 1d', 'error')
      return
    }
    setBusy('create')
    patchActiveTab({
      scheduledTasks: [
        ...tasks.filter((t) => !t.pending),
        makePendingTask(p, token, Date.now()),
      ],
    })
    try {
      const id = await sendSessionPrompt({ text: cmd })
      if (!id) {
        pushToast('没发出去，看当前对话是否就绪', 'error')
      } else {
        setPrompt('')
        if (belowMin) pushToast('短于 1 分钟会按 1 分钟跑', 'info')
      }
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusy('')
    }
  }

  const cancel = async (taskId: string, pending?: boolean) => {
    if (!tabId || busy) return
    if (pending) {
      patchActiveTab({ scheduledTasks: tasks.filter((t) => t.taskId !== taskId) })
      setConfirmId('')
      return
    }
    if (confirmId !== taskId) {
      setConfirmId(taskId)
      return
    }
    setBusy(taskId)
    try {
      await sessionExt(tabId, 'x.ai/scheduler/delete', { taskId })
      pushToast('已取消定时', 'success')
      setConfirmId('')
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="insight-dock schedule-dock" role="region" aria-label="定时任务">
      <div className="insight-card schedule-card">
        <div className="insight-head">
          <div>
            <h2 className="schedule-title">定时任务</h2>
            <p className="schedule-sub">
              本会话按间隔反复发同一条指令。最短 1 分钟，{LOOP_EXPIRE_HINT}
              。每次在后台新开一轮，看不到当前对话，把路径和判定写进提示词。
            </p>
          </div>
          <button
            type="button"
            className="insight-close"
            aria-label="关闭定时任务"
            onClick={() => closeSessionSchedule()}
          >
            ×
          </button>
        </div>

        <div className="schedule-form">
          <div className="schedule-label">间隔</div>
          <div className="schedule-chips" role="radiogroup" aria-label="间隔">
            {INTERVAL_PRESETS.map((p) => (
              <button
                key={p.token}
                type="button"
                className={`schedule-chip${
                  !custom && interval === p.token ? ' is-on' : ''
                }`}
                onClick={() => {
                  setCustom(false)
                  setIntervalToken(p.token)
                }}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={`schedule-chip${custom ? ' is-on' : ''}`}
              onClick={() => setCustom(true)}
            >
              自定义
            </button>
          </div>
          {custom ? (
            <div className="schedule-custom">
              <input
                type="number"
                min={1}
                step={1}
                value={customN}
                onChange={(e) => setCustomN(e.target.value)}
                aria-label="间隔数字"
              />
              <select
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value as IntervalUnit)}
                aria-label="间隔单位"
              >
                <option value="s">秒</option>
                <option value="m">分钟</option>
                <option value="h">小时</option>
                <option value="d">天</option>
              </select>
              <span className="schedule-custom-hint">
                {token ? humanScheduleZh(token) : '填大于 0 的数字'}
              </span>
            </div>
          ) : null}
          {belowMin ? (
            <p className="schedule-warn">最短 1 分钟，更短的间隔会按 1 分钟执行。</p>
          ) : null}

          <label className="schedule-label" htmlFor="schedule-prompt">
            每次要做什么
          </label>
          <textarea
            id="schedule-prompt"
            className="schedule-prompt"
            rows={3}
            value={prompt}
            placeholder="例如：看 D:\app 的部署是否还健康；若仍 pending 只回一行然后停，成功则 scheduler_delete"
            disabled={!ready}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <div className="schedule-form-foot">
            <span className="schedule-kbd">Ctrl+Enter 提交</span>
            <button
              type="button"
              className="insight-btn is-primary"
              disabled={!ready || Boolean(busy) || !prompt.trim() || !token}
              onClick={() => void submit()}
            >
              {busy === 'create' ? '提交中…' : '开始定时'}
            </button>
          </div>
        </div>

        <div className="schedule-list-head">
          <strong>本会话</strong>
          <span>{live.length} 个</span>
        </div>
        {live.length === 0 ? (
          <p className="schedule-empty">
            还没有定时。选间隔、写清提示词再开始。对话里也可以输入{' '}
            <code>/loop 5m 检查部署</code>。
          </p>
        ) : (
          <ul className="schedule-list">
            {live.map((t) => {
              const cadence = zhHumanSchedule(t.humanSchedule)
              const next = nextFireLabel(t.nextFireAt, now)
              const last = lastFiredLabel(t.lastFiredAt, now)
              return (
                <li
                  key={t.taskId}
                  className={`schedule-item${t.pending ? ' is-pending' : ''}`}
                >
                  <div className="schedule-item-main">
                    <div className="schedule-item-meta">
                      <span className="schedule-badge">{cadence}</span>
                      {t.pending ? <span className="schedule-badge is-wait">创建中</span> : null}
                      {next ? (
                        <span className="schedule-next">
                          {next === '到期' ? '到期，即将再跑' : `${next}后`}
                        </span>
                      ) : null}
                    </div>
                    <p className="schedule-item-prompt" title={t.prompt}>
                      {promptPreview(t.prompt, 120)}
                    </p>
                    <div className="schedule-item-sub">
                      {last ? <span>上次 {last}</span> : <span>还没跑过</span>}
                      {t.fireCount ? <span>已跑 {t.fireCount} 轮</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="insight-btn"
                    disabled={!ready || Boolean(busy)}
                    onClick={() => void cancel(t.taskId, t.pending)}
                  >
                    {t.pending
                      ? '去掉'
                      : confirmId === t.taskId
                        ? '再点确认取消'
                        : '取消'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

