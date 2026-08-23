import { useStore } from '@nanostores/react'
import { $lastRecap } from '../store'
import { dismissRecap } from '../lib/engineSlash'

export function RecapBanner() {
  const recap = useStore($lastRecap)
  if (!recap?.summary) return null
  return (
    <div className="plan-banner recap-banner" role="status">
      <span className="plan-banner-mark" aria-hidden>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M8 15V9h4l2 3-2 3H8Z" />
        </svg>
      </span>
      <div className="plan-banner-text">
        <strong>{recap.auto ? '回来之后' : '回顾'}</strong>
        <span className="plan-banner-hint">{recap.summary}</span>
      </div>
      <button type="button" className="plan-banner-btn" onClick={() => dismissRecap()}>
        关掉
      </button>
    </div>
  )
}
