import { useStore } from '@nanostores/react'
import {
  $engineStatus,
  $planApproval,
  $planPhase,
} from '../store'
import { openPlanPreview, togglePlanMode } from '../lib/planMode'

export function PlanBanner() {
  const phase = useStore($planPhase)
  const approval = useStore($planApproval)
  const generating = useStore($engineStatus) === 'generating'
  if (phase === 'off' && !approval) return null

  const awaiting = Boolean(approval)
  const hint =
    phase === 'pending'
      ? '下一条消息进入计划模式，只写计划稿'
      : phase === 'exit_pending'
        ? '本轮生成结束后关掉计划模式'
        : awaiting
          ? '计划稿等你审批'
          : '只写本会话 plan.md，项目文件不能改'

  return (
    <div className="plan-banner" role="status">
      <span className="plan-banner-mark" aria-hidden>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M8 13h8M8 17h5" />
        </svg>
      </span>
      <div className="plan-banner-text">
        <strong>计划模式 · 只改计划稿</strong>
        <span className="plan-banner-hint">{hint}</span>
      </div>
      <button
        type="button"
        className="plan-banner-btn"
        onClick={() => openPlanPreview()}
        title="打开计划稿预览"
      >
        看计划稿
      </button>
      {awaiting ? null : (
        <button
          type="button"
          className="plan-banner-btn plan-banner-btn-ghost"
          onClick={() => void togglePlanMode()}
          title={generating ? '本轮结束后关掉计划模式' : '退出计划模式'}
        >
          {phase === 'exit_pending' ? '将退出' : '退出计划'}
        </button>
      )}
    </div>
  )
}
