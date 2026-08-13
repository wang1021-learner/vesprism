import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $activeTabId, $engineStatus, $sandboxCwd, pushToast } from '../store'
import { getSandboxStatus, syncSandboxToOrigin } from '../bridge'
import { formatSandboxDisplayPath } from '../lib/sandboxPath'

export function SandboxBanner() {
  const sandboxCwd = useStore($sandboxCwd)
  const tabId = useStore($activeTabId)
  const status = useStore($engineStatus)
  const [dirty, setDirty] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!sandboxCwd || !tabId) {
      setDirty(0)
      return
    }
    let alive = true
    const refresh = () => {
      void getSandboxStatus(tabId)
        .then((s) => {
          if (alive) setDirty(s.dirty_count)
        })
        .catch(() => {
          if (alive) setDirty(0)
        })
    }
    refresh()
    const t = window.setInterval(refresh, 4000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [sandboxCwd, tabId, status])

  if (!sandboxCwd) return null

  const onSync = async () => {
    if (!tabId || busy) return
    setBusy(true)
    try {
      const r = await syncSandboxToOrigin(tabId)
      pushToast(r.message, r.files > 0 ? 'success' : 'info')
      const s = await getSandboxStatus(tabId)
      setDirty(s.dirty_count)
    } catch (e) {
      pushToast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sandbox-banner" role="status">
      <span className="sandbox-banner-lock" aria-hidden>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
      <div className="sandbox-banner-text">
        <strong>沙箱隔离中</strong>
        <span className="sandbox-banner-path" title={sandboxCwd}>
          {formatSandboxDisplayPath(sandboxCwd)}
        </span>
        <span className="sandbox-banner-hint">改动是临时的，不会写进你原来的仓库</span>
      </div>
      <button
        type="button"
        className="sandbox-banner-sync"
        disabled={busy || dirty <= 0}
        onClick={() => void onSync()}
        title={dirty > 0 ? `把 ${dirty} 个文件合并回主工作区` : '沙箱里还没有改动'}
      >
        {busy ? '同步中…' : dirty > 0 ? `同步回主仓库 (${dirty})` : '同步回主仓库'}
      </button>
    </div>
  )
}
