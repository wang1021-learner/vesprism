import { useStore } from '@nanostores/react'
import { useState } from 'react'
import {
  $activeTabId,
  $rightPanelOpen,
  $tabs,
  patchActiveTab,
  removeTab,
  switchTab,
} from '../store'
import { closeTab, restartTab } from '../bridge'
import { openChatTab } from '../lib/openChatTab'

/** Tab 标签展示最多 5 个字（按 Unicode 码点，中英一致）；完整标题放 title 悬停 */
const TAB_TITLE_MAX_CHARS = 5

function formatTabTitle(raw: string | undefined | null): string {
  const full = (raw || '').trim() || '新对话'
  const chars = Array.from(full)
  if (chars.length <= TAB_TITLE_MAX_CHARS) return full
  return chars.slice(0, TAB_TITLE_MAX_CHARS).join('') + '…'
}

/**
 * 多会话标签栏：新建 / 切换 / 关闭 tab，failed 状态展示 + 手动重试。
 * 状态层（$tabs + TabState map）已由 store 分片提供，本组件只做展示与命令编排。
 */
export function TabBar() {
  const tabs = useStore($tabs)
  const activeId = useStore($activeTabId)
  const panelOpen = useStore($rightPanelOpen)
  const [busy, setBusy] = useState(false)

  const onNewTab = async () => {
    if (busy) return
    setBusy(true)
    try {
      await openChatTab()
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
        {tabs.map((t) => (
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
      {/* 右侧面板开关：与左侧收纳图标同族（右分栏） */}
      <button
        type="button"
        className={`tabbar-panel-btn${panelOpen ? ' is-active' : ''}`}
        title={panelOpen ? '关闭右侧面板' : '打开右侧面板'}
        aria-pressed={panelOpen}
        onClick={() => $rightPanelOpen.set(!panelOpen)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2.5" />
          <path d="M15 3v18" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
