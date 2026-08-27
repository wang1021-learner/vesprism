import { useEffect, useState, type FormEvent } from 'react'
import { useStore } from '@nanostores/react'
import {
  $goalInfo,
  $sessionIntent,
  $sessionPhase,
  closeSessionIntent,
  openSessionIntent,
  pushToast,
} from '../store'
import type { GoalInfoDto } from '../lib/composition'
import { sendEngineSlash } from '../lib/engineSlash'
import { formatEngineError } from '../lib/errorMessage'

const STATUS_LABEL: Record<string, string> = {
  active: '进行中',
  user_paused: '已暂停',
  back_off_paused: '自动退避',
  no_progress_paused: '无进展暂停',
  infra_paused: '基础设施暂停',
  blocked: '受阻',
  budget_limited: '预算用尽',
  complete: '已完成',
  cleared: '已清空',
}

const PHASE_LABEL: Record<string, string> = {
  idle: '空闲',
  planning: '规划中',
  executing: '执行中',
}

function fmtElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}

function badgeClass(status: string): string {
  if (status === 'complete') return 'goal-badge-done'
  if (status.endsWith('_paused') || status === 'blocked' || status === 'budget_limited') {
    return 'goal-badge-paused'
  }
  return 'goal-badge-active'
}

/** 会话区顶部 Goal 条。进行中显示进度；设目标 / 深度研究从输入栏「+」打开。 */
export function GoalStrip() {
  const goal = useStore($goalInfo)
  const intent = useStore($sessionIntent)
  const ready = useStore($sessionPhase) === 'ready'
  if (goal && goal.status !== 'cleared') return <GoalStripInner goal={goal} />
  if (!ready || !intent) return null
  return <GoalCreateStrip />
}

function GoalCreateStrip() {
  const intent = useStore($sessionIntent)
  const [mode, setMode] = useState<'goal' | 'research'>(intent || 'goal')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (intent) setMode(intent)
  }, [intent])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) closeSessionIntent()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    try {
      const cmd = mode === 'goal' ? `/goal ${q}` : `/deep-research ${q}`
      await sendEngineSlash(cmd)
      pushToast(mode === 'goal' ? '已设定目标' : '已开始深度研究', 'success')
      setText('')
      closeSessionIntent()
    } catch (err) {
      pushToast(formatEngineError(err), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="goal-strip" onSubmit={(e) => void submit(e)}>
      <div className="goal-create-head">
        <strong>{mode === 'goal' ? '设一个目标' : '深度研究'}</strong>
        <span className="goal-create-hint">
          {mode === 'goal'
            ? '模型会规划并执行，直到完成或你停掉'
            : '多路检索并交叉核对，写出带引用的报告'}
        </span>
        <button
          type="button"
          className="rewind-close"
          aria-label="关闭"
          onClick={() => closeSessionIntent()}
        >
          ✕
        </button>
      </div>
      <div className="goal-create-row">
        <div className="goal-create-modes" role="tablist" aria-label="入口">
          <button
            type="button"
            className={`skills-btn${mode === 'goal' ? ' is-on' : ''}`}
            onClick={() => setMode('goal')}
          >
            设目标
          </button>
          <button
            type="button"
            className={`skills-btn${mode === 'research' ? ' is-on' : ''}`}
            onClick={() => setMode('research')}
          >
            深度研究
          </button>
        </div>
        <input
          className="goal-create-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === 'goal' ? '要持续推进的目标…' : '要调研的问题…'}
          disabled={busy}
          autoFocus
          aria-label={mode === 'goal' ? '目标' : '研究问题'}
        />
        <button type="submit" className="skills-btn primary" disabled={busy || !text.trim()}>
          开始
        </button>
      </div>
    </form>
  )
}

function GoalStripInner({ goal }: { goal: GoalInfoDto }) {
  const ready = useStore($sessionPhase) === 'ready'
  const act = async (cmd: string, ok: string) => {
    try {
      await sendEngineSlash(cmd)
      pushToast(ok, 'success')
    } catch (e) {
      pushToast(formatEngineError(e), 'error')
    }
  }
  const pct =
    goal.tokenBudget != null && goal.tokenBudget > 0
      ? Math.min(100, Math.round((goal.tokensUsed / goal.tokenBudget) * 100))
      : null
  return (
    <div className="goal-strip" role="status">
      <div className="goal-strip-head">
        <span className={`goal-badge ${badgeClass(goal.status)}`}>
          {STATUS_LABEL[goal.status] ?? goal.status}
        </span>
        <span className="goal-badge-phase">{PHASE_LABEL[goal.phase] ?? goal.phase}</span>
        {goal.planning && <span className="goal-badge-minor">规划</span>}
        {goal.verifyingCompletion && <span className="goal-badge-minor">验证中</span>}
        <span className="goal-strip-objective" title={goal.objective}>
          {goal.objective}
        </span>
        <span className="goal-strip-meta">
          {fmtElapsed(goal.elapsedMs)}
          {goal.totalWorkerRounds > 0 && ` · ${goal.totalWorkerRounds} 轮执行`}
          {goal.totalVerifyRounds > 0 && ` · ${goal.totalVerifyRounds} 轮验证`}
          {goal.currentSubagentRole && ` · ${goal.currentSubagentRole}`}
        </span>
      </div>
      {(pct != null || goal.lastEvent || goal.pauseMessage) && (
        <div className="goal-strip-foot">
          {pct != null && (
            <span className="goal-budget">
              token {goal.tokensUsed.toLocaleString()}
              {goal.tokenBudget ? ` / ${goal.tokenBudget.toLocaleString()}` : ''}（{pct}%）
            </span>
          )}
          {goal.lastEvent && (
            <span className="goal-last-event">
              {goal.lastEvent}
              {goal.lastEventDetail ? `：${goal.lastEventDetail}` : ''}
            </span>
          )}
          {goal.pauseMessage && <span className="goal-pause">{goal.pauseMessage}</span>}
        </div>
      )}
      {goal.status === 'complete' ? (
        <div className="work-panel-actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="skills-btn"
            disabled={!ready}
            onClick={() => {
              void act('/goal clear', '已清除目标')
              openSessionIntent('goal')
            }}
          >
            新目标
          </button>
        </div>
      ) : goal.status !== 'cleared' ? (
        <div className="work-panel-actions" style={{ marginTop: 8 }}>
          {goal.status === 'user_paused' || goal.status.endsWith('_paused') ? (
            <button
              type="button"
              className="skills-btn"
              disabled={!ready}
              onClick={() => void act('/goal resume', '已继续目标')}
            >
              继续
            </button>
          ) : (
            <button
              type="button"
              className="skills-btn"
              disabled={!ready}
              onClick={() => void act('/goal pause', '已暂停目标')}
            >
              暂停
            </button>
          )}
          <button
            type="button"
            className="skills-btn"
            disabled={!ready}
            onClick={() => void act('/goal clear', '已清除目标')}
          >
            清除
          </button>
        </div>
      ) : null}
    </div>
  )
}
