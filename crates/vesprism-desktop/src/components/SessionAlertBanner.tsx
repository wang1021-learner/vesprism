import { useStore } from '@nanostores/react'
import { $activeTabId, $sessionAlert, patchTab } from '../store'

const TITLE: Record<string, string> = {
  overflow: '上下文超限',
  rate: '请求过于频繁',
  auth: '鉴权已过期',
}

export function SessionAlertBanner() {
  const alert = useStore($sessionAlert)
  const tabId = useStore($activeTabId)
  if (!alert) return null
  return (
    <div className="plan-banner recap-banner" role="alert">
      <div className="plan-banner-text">
        <strong>{TITLE[alert.kind] || '会话提示'}</strong>
        <span className="plan-banner-hint">{alert.message}</span>
      </div>
      <button
        type="button"
        className="plan-banner-btn"
        onClick={() => {
          if (tabId) patchTab(tabId, { sessionAlert: null })
        }}
      >
        关掉
      </button>
    </div>
  )
}
