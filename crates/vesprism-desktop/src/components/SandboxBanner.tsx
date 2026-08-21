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
      <span className="sandbox-banner-mark" aria-hidden title="文件改动写入 git worktree 副本">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      </span>
      <div className="sandbox-banner-text">
        <strong>工作区副本</strong>
        <span className="sandbox-banner-path" title={sandboxCwd}>
          {formatSandboxDisplayPath(sandboxCwd)}
        </span>
        <span className="sandbox-banner-hint" title="改动写入 git worktree 副本，不影响原仓库；命令仍以当前系统权限执行，没有进程或网络隔离">
          文件写在副本目录；命令仍用你的系统权限，不是进程/网络沙箱
        </span>
      </div>
      <button
        type="button"
        className="sandbox-banner-sync"
        disabled={busy || dirty <= 0}
        onClick={() => void onSync()}
        title={dirty > 0 ? `把 ${dirty} 个文件合并回主工作区` : '副本里还没有改动'}
      >
        {busy ? '同步中…' : dirty > 0 ? `同步回主仓库 (${dirty})` : '同步回主仓库'}
      </button>
    </div>
  )
}
