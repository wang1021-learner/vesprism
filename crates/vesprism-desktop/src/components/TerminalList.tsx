import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'
import { $activeTabId, $terminals, getTabState, patchTab } from '../store'
import { terminalOutcome, terminalStatusLabel } from '../lib/terminalCards'
import type { TerminalRuntime } from '../types'

/** 会话区命令输出卡：运行中展开；跑完折成一行；最多 5 张。 */
export function TerminalList() {
  const terminals = useStore($terminals)
  const items = Object.values(terminals).sort((a, b) => a.openedAt - b.openedAt)
  if (items.length === 0) return null
  return (
    <div className="term-list" role="region" aria-label="命令输出">
      {items.map((t) => (
        <TerminalCard key={t.terminalId} term={t} />
      ))}
    </div>
  )
}

function TerminalCard({ term }: { term: TerminalRuntime }) {
  const running = !term.exited
  const expanded = running || term.expanded
  const outcome = terminalOutcome(term)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!running || !expanded) return
    const el = preRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [term.text, running, expanded])

  const toggle = () => {
    if (running) return
    patchCard(term.terminalId, { expanded: !term.expanded })
  }

  const close = (e: React.MouseEvent) => {
    e.stopPropagation()
    const tabId = $activeTabId.get()
    const prev = { ...(getTabState(tabId)?.terminals ?? {}) }
    delete prev[term.terminalId]
    patchTab(tabId, { terminals: prev })
  }

  return (
    <div
      className={`term-card is-${outcome}${expanded ? ' is-expanded' : ' is-collapsed'}`}
    >
      <div
        className="term-head"
        role={running ? undefined : 'button'}
        tabIndex={running ? undefined : 0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (!running && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            toggle()
          }
        }}
      >
        <span className="term-dot" aria-hidden />
        <code className="term-command" title={term.command}>
          {term.command || '(命令)'}
        </code>
        <span className={`term-meta is-${outcome}`}>{terminalStatusLabel(term)}</span>
        {!running && (
          <button type="button" className="term-close" title="关闭" onClick={close}>
            ✕
          </button>
        )}
      </div>
      {expanded && (
        <>
          {term.truncated && (
            <div className="term-trim" role="note">
              输出过长，仅保留末尾
            </div>
          )}
          <pre ref={preRef} className="term-output">
            {term.text || ' '}
          </pre>
        </>
      )}
    </div>
  )
}

function patchCard(id: string, patch: Partial<TerminalRuntime>) {
  const tabId = $activeTabId.get()
  const prev = getTabState(tabId)?.terminals ?? {}
  const cur = prev[id]
  if (!cur) return
  patchTab(tabId, { terminals: { ...prev, [id]: { ...cur, ...patch } } })
}
