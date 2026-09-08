/** 任务失败降级条：重试 / 换模型重试 / 手动处理。 */
export function FailureBar({
  reason,
  onRetry,
  onRetryFresh,
  onDismiss,
}: {
  reason: string
  onRetry: () => void
  onRetryFresh: () => void
  onDismiss: () => void
}) {
  return (
    <div className="wd-failbar" role="status">
      <span className="wd-failbar-t">⚠ {reason}</span>
      <button type="button" className="wd-btn wd-btn-ghost" onClick={onRetry}>
        重试
      </button>
      <button type="button" className="wd-btn wd-btn-ghost" onClick={onRetryFresh}>
        换模型重试
      </button>
      <button type="button" className="wd-btn wd-btn-ghost" onClick={onDismiss}>
        手动处理
      </button>
    </div>
  )
}
