import { useStore } from '@nanostores/react'
import { $sessionMode } from '../store'
import { toggleAskMode } from '../lib/planMode'

export function AskBanner() {
  const mode = useStore($sessionMode)
  if (mode !== 'ask') return null
  return (
    <div className="plan-banner" role="status">
      <span className="plan-banner-mark" aria-hidden>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-.7.6-1.2 1.1-1.2 2.2" />
          <path d="M12 17h.01" />
        </svg>
      </span>
      <div className="plan-banner-text">
        <strong>问答模式</strong>
        <span className="plan-banner-hint">只回答，不改项目文件。工具仍可能读代码。</span>
      </div>
      <button type="button" className="plan-banner-btn" onClick={() => void toggleAskMode()}>
        退出
      </button>
    </div>
  )
}
