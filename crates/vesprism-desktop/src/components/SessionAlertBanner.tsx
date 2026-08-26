import { useStore } from '@nanostores/react'
import { $activeTabId, $sessionAlert, openSettings, patchTab } from '../store'
import { Notice, type NoticeTone } from './Notice'

const META: Record<string, { title: string; tone: NoticeTone }> = {
  overflow: { title: '上下文超限', tone: 'warning' },
  rate: { title: '请求过于频繁', tone: 'warning' },
  auth: { title: '鉴权已过期', tone: 'error' },
}

export function SessionAlertBanner() {
  const alert = useStore($sessionAlert)
  const tabId = useStore($activeTabId)
  if (!alert) return null
  const meta = META[alert.kind] || { title: '会话提示', tone: 'info' as const }
  const dismiss = () => {
    if (tabId) patchTab(tabId, { sessionAlert: null })
  }
  return (
    <Notice
      tone={meta.tone}
      title={meta.title}
      className="notice-inline"
      action={
        alert.kind === 'auth' ? (
          <button
            type="button"
            className="notice-action"
            onClick={() => {
              dismiss()
              openSettings('models')
            }}
          >
            去设置
          </button>
        ) : null
      }
      onDismiss={dismiss}
    >
      {alert.message}
    </Notice>
  )
}
