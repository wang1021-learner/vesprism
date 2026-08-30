import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { IconAdjustmentsHorizontal } from '@tabler/icons-react'
import { getProduct, navLabelForKind } from '../products/catalog'
import {
  $activeTabId,
  $appShell,
  $compositionOpen,
  $rightPanelOpen,
  $tabs,
  getTabState,
  isBlankNewChat,
  switchTab,
  tabsForShell,
} from '../store'
import { closeChatTab } from '../lib/closeChatTab'
import { retryTabSession } from '../lib/retryTab'
import { openChatTab } from '../lib/openChatTab'

function formatTabTitle(raw: string | undefined | null): string {
  return (raw || '').trim() || '新对话'
}

/**
 * 多会话标签栏：新建 / 切换 / 关闭 tab，failed 状态展示 + 手动重试。
 * 状态层（$tabs + TabState map）已由 store 分片提供，本组件只做展示与命令编排。
 */
export function TabBar() {
  const allTabs = useStore($tabs)
  const shell = useStore($appShell)
  const tabs = tabsForShell(shell, allTabs)
  const activeId = useStore($activeTabId)
  const compOpen = useStore($compositionOpen)
  const [busy, setBusy] = useState(false)
  const showTabPlus = getProduct(shell).showTabPlus

  const onNewTab = async () => {
    if (busy) return
    setBusy(true)
    try {
      const product = getProduct(shell)
      if (product.emptyView === 'panel') {
        const kind = product.utilityKinds.find((k) => k !== 'schedule')
        if (kind && kind !== 'schedule') {
          await openChatTab({
            title: navLabelForKind(kind),
            utilityKind: kind,
            forceNew: true,
          })
          return
        }
      }
      await openChatTab()
    } finally {
      setBusy(false)
    }
  }

  const onCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    closeChatTab(id)
  }

  const onRetry = async (id: string) => {
    await retryTabSession(id)
  }

  return (
    <div className="tabbar">
      <div className="tabbar-list">
        {tabs.map((t) => {
          const st = getTabState(t.id)
          const closeDisabled = tabs.length <= 1 && (!st || isBlankNewChat(st))
          return (
            <div
              key={t.id}
              className={`tabbar-item${t.id === activeId ? ' is-active' : ''}${t.failed ? ' is-failed' : ''}`}
              onClick={() => switchTab(t.id)}
              title={t.title?.trim() || '新对话'}
            >
              <span
                className={`tabbar-activity is-${t.activity || 'idle'}`}
                aria-hidden
                title={
                  t.activity === 'working'
                    ? '进行中'
                    : t.activity === 'permission'
                      ? '等待确认'
                      : t.activity === 'error'
                        ? '错误'
                        : '空闲'
                }
              />
              <span className="tabbar-title">{formatTabTitle(t.title)}</span>
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
              {!st?.utilityKind && (
                <button
                  type="button"
                  className={`tabbar-comp-btn${compOpen && t.id === activeId ? ' is-active' : ''}`}
                  title="会话配置（工具/权限/流程）"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (t.id !== activeId) {
                      switchTab(t.id)
                      $compositionOpen.set(true)
                    } else {
                      $compositionOpen.set(!compOpen)
                    }
                  }}
                >
                  <IconAdjustmentsHorizontal size={13} stroke={1.75} aria-hidden />
                </button>
              )}
              <button
                type="button"
                className="tabbar-close"
                title={closeDisabled ? '已是空白对话' : '关闭'}
                disabled={closeDisabled}
                aria-hidden={closeDisabled}
                tabIndex={closeDisabled ? -1 : undefined}
                onClick={(e) => onCloseTab(t.id, e)}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                </svg>
              </button>
            </div>
          )
        })}
        {showTabPlus && (
        <button type="button" className="tabbar-new" title="新建会话" disabled={busy} onClick={() => void onNewTab()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        )}
      </div>
    </div>
  )
}

export function RightPanelToggle() {
  const panelOpen = useStore($rightPanelOpen)
  return (
    <button
      type="button"
      className={`tabbar-panel-btn${panelOpen ? ' is-active' : ''}`}
      title={panelOpen ? '关闭改动面板' : '打开改动面板'}
      aria-pressed={panelOpen}
      onClick={() => $rightPanelOpen.set(!panelOpen)}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <path d="M15 3v18" strokeLinecap="round" />
      </svg>
    </button>
  )
}

/** 会话组装单入口（半插件化 P0）。 */
export function CompositionToggle() {
  const open = useStore($compositionOpen)
  return (
    <button
      type="button"
      className={`tabbar-panel-btn${open ? ' is-active' : ''}`}
      title={open ? '关闭组装面板' : '打开组装面板'}
      aria-pressed={open}
      onClick={() => $compositionOpen.set(!open)}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
        <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <path d="M6.6 12h3.8M13.8 12h3.6" strokeLinecap="round" />
      </svg>
    </button>
  )
}
