/**
 * Hermes 对齐的工具审批条（floating fallback）：
 * - 一行：⚠ 需要审批 + 短描述（可截断）
 * - 一行：紧凑 [运行 Ctrl⏎]  拒绝 Esc  命令▾
 * - 命令默认隐藏，展开才见 mono 块
 * - 绝不展示「类型：…工具：Execute…」原文墙
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PermissionOption, PermissionRequest } from '../types'
import { $permission } from '../store'
import { respondPermission } from '../bridge'

interface Props {
  permission: PermissionRequest | null
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

function isAllowOption(opt: PermissionOption): boolean {
  const kind = (opt.kind || '').toLowerCase()
  const name = opt.name || ''
  const lower = name.toLowerCase()
  if (kind === 'allow') return true
  if (kind === 'deny') return false
  return (
    /yes|proceed|allow|approve|accept|run|once/i.test(lower) ||
    name.includes('允许') ||
    name.includes('同意') ||
    name.includes('继续')
  )
}

function isDenyOption(opt: PermissionOption): boolean {
  const kind = (opt.kind || '').toLowerCase()
  const name = opt.name || ''
  const lower = name.toLowerCase()
  if (kind === 'deny') return true
  if (kind === 'allow') return false
  return (
    /no|deny|reject|cancel|differently|refuse/i.test(lower) ||
    name.includes('拒绝') ||
    name.includes('取消') ||
    name.includes('不允许')
  )
}

function pickAllow(options: PermissionOption[]): PermissionOption | undefined {
  return options.find(isAllowOption) || options[0]
}

function pickDeny(options: PermissionOption[]): PermissionOption | undefined {
  return options.find(isDenyOption) || options[options.length - 1]
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`perm-chevron${open ? ' is-open' : ''}`}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 8v5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="12" cy="16.2" r="1" fill="currentColor" />
    </svg>
  )
}

export function PermissionModal({ permission }: Props) {
  const [busy, setBusy] = useState(false)
  const [showCommand, setShowCommand] = useState(false)
  const runRef = useRef<HTMLButtonElement>(null)
  const mac = useMemo(() => isMacPlatform(), [])

  const allow = permission ? pickAllow(permission.options) : undefined
  const deny = permission ? pickDeny(permission.options) : undefined

  // Hermes：标题固定「需要审批」；旁注用类型（运行终端命令），再跟短命令摘要
  const kindLabel =
    permission?.kindLabel && permission.kindLabel !== '需要审批'
      ? permission.kindLabel
      : ''
  const command = (permission?.command || '').trim()
  const summary = (permission?.summary || '').trim()
  const hasCommand = command.length > 0
  // 旁注优先：类型 · 短命令；绝不显示 raw tool dump
  const sideNote = [kindLabel, summary].filter(Boolean).join(' · ')

  useEffect(() => {
    setBusy(false)
    setShowCommand(false)
    if (!permission) return
    runRef.current?.focus()
  }, [permission?.id])

  useEffect(() => {
    if (!permission || busy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (deny) void respond(deny.id)
        return
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        if (allow) void respond(allow.id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission, busy, allow?.id, deny?.id])

  if (!permission) return null

  const respond = async (optionId: string) => {
    if (busy) return
    setBusy(true)
    try {
      const requestId = Number(permission.id)
      if (!Number.isNaN(requestId)) {
        await respondPermission(requestId, optionId)
      }
      $permission.set(null)
      window.dispatchEvent(new CustomEvent('jike:focus-composer'))
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="perm-dock" role="alertdialog" aria-label="需要审批">
      <div className="perm-card">
        {/* Hermes fallback 首行：图标 + 标题 + 截断描述 */}
        <div className="perm-row-head">
          <span className="perm-ico" aria-hidden>
            <AlertIcon />
          </span>
          <span className="perm-title">需要审批</span>
          {sideNote ? (
            <span className="perm-note" title={command || sideNote}>
              {sideNote}
            </span>
          ) : null}
        </div>

        {/* Hermes ApprovalBar：h-6 紧凑操作条 */}
        <div className="perm-row-actions">
          {allow ? (
            <div className="perm-run-split">
              <button
                ref={runRef}
                type="button"
                className="perm-act perm-act-run"
                disabled={busy}
                onClick={() => void respond(allow.id)}
              >
                运行
                <span className="perm-kbd">{mac ? '⌘⏎' : 'Ctrl⏎'}</span>
              </button>
            </div>
          ) : null}

          {deny && deny.id !== allow?.id ? (
            <button
              type="button"
              className="perm-act perm-act-deny"
              disabled={busy}
              onClick={() => void respond(deny.id)}
            >
              拒绝
              <span className="perm-kbd">Esc</span>
            </button>
          ) : null}

          {hasCommand ? (
            <button
              type="button"
              className="perm-act perm-act-cmd"
              aria-expanded={showCommand}
              onClick={() => setShowCommand((v) => !v)}
            >
              命令
              <ChevronIcon open={showCommand} />
            </button>
          ) : null}
        </div>

        {showCommand && hasCommand ? (
          <pre className="perm-command">{command}</pre>
        ) : null}
      </div>
    </div>
  )
}
