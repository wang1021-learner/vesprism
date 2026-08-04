import { useStore } from '@nanostores/react'
import { useState } from 'react'
import {
  $activeTabId,
  $rightPanelOpen,
  $sidebarAutoCollapsed,
  $sidebarCollapsed,
  $tabs,
  $workspaceCwd,
  $workspaceOptions,
  createTab,
  patchActiveTab,
  removeTab,
  switchTab,
} from '../store'
import { closeTab, openTab, restartTab, startSession } from '../bridge'

/**
 * 多会话标签栏：新建 / 切换 / 关闭 tab，failed 状态展示 + 手动重试。
 * 状态层（$tabs + TabState map）已由 store 分片提供，本组件只做展示与命令编排。
 */
export function TabBar() {
  const tabs = useStore($tabs)
  const activeId = useStore($activeTabId)
  const panelOpen = useStore($rightPanelOpen)
  const sidebarCollapsed = useStore($sidebarCollapsed)
  const [busy, setBusy] = useState(false)

  const onNewTab = async () => {
    if (busy) return
    setBusy(true)
    try {
      const tabId = await openTab()
      createTab(tabId)
      switchTab(tabId)
      // 新 tab 默认用当前 tab 的工作区（空则用历史列表第一个）
      const cwd = $workspaceCwd.get() || $workspaceOptions.get()[0] || ''
      await startSession(tabId, cwd)
      patchActiveTab({ phase: 'ready', status: 'idle' })
    } catch (e) {
      patchActiveTab({ error: String(e) })
    } finally {
      setBusy(false)
    }
  }

  const onCloseTab = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (busy) return
    const list = $tabs.get()
    const idx = list.findIndex((t) => t.id === id)
    const wasActive = id === activeId
    try {
      await closeTab(id)
    } catch {
      /* 后端已退出也无妨，前端状态照常清理 */
    }
    removeTab(id)
    if (wasActive) {
      const remaining = $tabs.get()
      if (remaining.length > 0) {
        // 切到相邻 tab（关的是最后一个则往前一个）
        switchTab(remaining[Math.min(idx, remaining.length - 1)].id)
      } else {
        await onNewTab() // 最后一个 tab 被关：自动开一个新的
      }
    }
  }

  const onRetry = async (id: string) => {
    try {
      await restartTab(id)
      // 重建空壳后后端会发 tab_recovering，App.tsx 负责按 map 里的状态重放会话
    } catch (e) {
      patchActiveTab({ error: String(e) })
    }
  }

  return (
    <div className="tabbar">
      <div className="tabbar-list">
        {sidebarCollapsed && (
          <button
            type="button"
            className="tabbar-sidebar-toggle"
            title="展开会话边栏"
            onClick={() => {
              $sidebarCollapsed.set(false)
              $sidebarAutoCollapsed.set(false)
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
        )}
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tabbar-item${t.id === activeId ? ' is-active' : ''}${t.failed ? ' is-failed' : ''}`}
            onClick={() => switchTab(t.id)}
            title={t.title || '新对话'}
          >
            <span className="tabbar-title">{t.title || '新对话'}</span>
            {t.failed && (
              <button
                type="button"
                className="tabbar-retry"
                title="重试恢复会话"
                onClick={(e) => {
                  e.stopPropagation()
                  void onRetry(t.id)
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="tabbar-close"
              title="关闭"
              onClick={(e) => void onCloseTab(t.id, e)}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
              </svg>
            </button>
          </div>
        ))}
        <button type="button" className="tabbar-new" title="新建会话" disabled={busy} onClick={() => void onNewTab()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      {/* 右侧面板开关：与标签同排（原在 header，移到这里） */}
      <button
        type="button"
        className={`tabbar-panel-btn${panelOpen ? ' is-active' : ''}`}
        title={panelOpen ? '关闭右侧面板' : '打开右侧面板'}
        aria-pressed={panelOpen}
        onClick={() => $rightPanelOpen.set(!panelOpen)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>
    </div>
  )
}
