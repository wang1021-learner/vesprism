import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '@nanostores/react'
import {
  $activeTabId,
  $chatFindIndex,
  $chatFindOpen,
  $chatFindQuery,
  $messages,
} from '../store'
import { closeChatFind, openChatFind } from '../lib/engineSlash'
import { findMessageHits, nextHit } from '../lib/chatFind'

export function ChatFindBar() {
  const open = useStore($chatFindOpen)
  const query = useStore($chatFindQuery)
  const index = useStore($chatFindIndex)
  const messages = useStore($messages)
  const tabId = useStore($activeTabId)
  const inputRef = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => findMessageHits(messages, query), [messages, query])

  useEffect(() => {
    $chatFindOpen.set(false)
    $chatFindQuery.set('')
    $chatFindIndex.set(-1)
  }, [tabId])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !open) {
          /* 输入框里 Ctrl+F 仍打开对话搜索 */
        }
        e.preventDefault()
        openChatFind(query)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, query])

  if (!open) return null

  const go = (dir: 1 | -1) => {
    const next = nextHit(hits, index, dir)
    $chatFindIndex.set(next)
  }

  const pos = hits.indexOf(index)

  return (
    <div className="chat-find-bar" role="search">
      <input
        ref={inputRef}
        value={query}
        placeholder="在对话里找…"
        aria-label="在对话里搜索"
        onChange={(e) => {
          $chatFindQuery.set(e.target.value)
          $chatFindIndex.set(-1)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            go(e.shiftKey ? -1 : 1)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            closeChatFind()
          }
        }}
      />
      <span className="chat-find-count">
        {query.trim() ? (hits.length ? `${pos < 0 ? 0 : pos + 1}/${hits.length}` : '无结果') : ''}
      </span>
      <button type="button" className="insight-btn" disabled={!hits.length} onClick={() => go(-1)}>
        上一个
      </button>
      <button type="button" className="insight-btn" disabled={!hits.length} onClick={() => go(1)}>
        下一个
      </button>
      <button type="button" className="insight-close" aria-label="关闭搜索" onClick={() => closeChatFind()}>
        ×
      </button>
    </div>
  )
}
