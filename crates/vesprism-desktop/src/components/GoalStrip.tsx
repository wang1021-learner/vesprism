import { useStore } from '@nanostores/react'
import { $goalInfo, $sessionPhase, pushToast } from '../store'
import type { GoalInfoDto } from '../lib/composition'
import { sendEngineSlash } from '../lib/engineSlash'

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

/** 会话区顶部 Goal 条（官方 GoalUpdated 投影）。 */
export function GoalStrip() {
  const goal = useStore($goalInfo)
  if (!goal) return null
  return <GoalStripInner goal={goal} />
}

function GoalStripInner({ goal }: { goal: GoalInfoDto }) {
  const ready = useStore($sessionPhase) === 'ready'
  const act = async (cmd: string, ok: string) => {
    try {
      await sendEngineSlash(cmd)
      pushToast(ok, 'success')
    } catch (e) {
      pushToast(String(e), 'error')
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
      {goal.status !== 'cleared' && goal.status !== 'complete' ? (
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
