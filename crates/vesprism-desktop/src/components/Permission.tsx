/**
 * 工具审批（内嵌位置 + choice 语义）：
 * - 主：内嵌在「发起审批的工具行」下方（positional：挂起时最后一个 in_progress 工具行）
 * - 兜底：输入框上方浮层，仅当内嵌条不可见时显示
 * - 主按钮：允许这次（once）；下拉：仅这场对话允许 / 总是允许 / 永不允许
 * - 键盘：Ctrl/⌘+Enter 允许这次 · Esc 拒绝（确认框打开时 Esc 取消确认）
 * - 子 agent 写操作也会到达这里（只读工具仍由后端自动放行）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import type { PermissionRequest } from '../types'
import { $activeTabId, $permissionInlineVisible, patchActiveTab, pushToast } from '../store'
import { respondPermission } from '../bridge'
import { formatEngineError } from '../lib/errorMessage'
import { permissionDetailLabel, permissionLead } from '../lib/permissionCopy'
import {
  addAlwaysAllowed,
  addSessionAllowed,
  permissionSignature,
  pickAllow,
  pickAllowAlways,
  pickDeny,
  pickRejectAlways,
} from '../lib/permissionMemory'

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={'perm-chevron' + (open ? ' is-open' : '')}
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

function LoaderIcon() {
  return (
    <svg className="perm-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2.5" strokeDasharray="30 20" />
    </svg>
  )
}

/** 安全预检发现 → 中文短文案（官方 ClassifierSecurityFinding token） */
const SECURITY_FINDING_LABELS: Record<string, string> = {
  fail_closed_policy: '策略自动拒绝',
  unparseable_shell: '命令无法解析',
  opaque_shell: '命令内容不透明',
  exec_or_ambient_git: '执行/环境 Git 操作',
  env_injection: '环境变量注入风险',
  unvetted_env: '未经验证的环境变量',
  file_write: '写文件操作',
  dangerous_command: '危险命令',
  special_exec_surface: '特殊执行面',
}

function ConfirmDialog({
  title,
  desc,
  command,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string
  desc: string
  command?: string
  confirmLabel: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="perm-dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="perm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="perm-confirm-title"
        aria-describedby="perm-confirm-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="perm-dialog-title" id="perm-confirm-title">
          {title}
        </div>
        <div className="perm-dialog-desc" id="perm-confirm-desc">
          {desc}
        </div>
        {command ? <pre className="perm-command perm-dialog-cmd">{command}</pre> : null}
        <div className="perm-dialog-actions">
          <button type="button" className="btn-secondary" autoFocus onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={danger ? 'perm-dialog-btn-danger' : 'btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 主审批条：组合按钮 + 拒绝 + 详情 + always/never 确认弹窗 */
function ApprovalBar({
  request,
  surface,
}: {
  request: PermissionRequest
  surface: 'inline' | 'floating'
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [showDetail, setShowDetail] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmAlways, setConfirmAlways] = useState(false)
  const [confirmNever, setConfirmNever] = useState(false)
  const runRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const mac = useMemo(() => isMacPlatform(), [])
  const sig = useMemo(() => permissionSignature(request), [request])
  const lead = useMemo(() => permissionLead(request), [request])
  const detailLabel = permissionDetailLabel(request.kindLabel)

  useEffect(() => {
    setShowDetail(true)
    setMenuOpen(false)
    setConfirmAlways(false)
    setConfirmNever(false)
    setBusy(null)
  }, [request.id])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const allow = useMemo(() => pickAllow(request.options), [request.options])
  const allowAlways = useMemo(() => pickAllowAlways(request.options), [request.options])
  const deny = useMemo(() => pickDeny(request.options), [request.options])
  const neverAllow = useMemo(() => pickRejectAlways(request.options), [request.options])
  const command = (request.command || '').trim()
  const hasCommand = command.length > 0
  const respond = async (optionId: string) => {
    if (busy) return
    setBusy(optionId)
    try {
      const requestId = Number(request.id)
      if (!Number.isNaN(requestId)) {
        await respondPermission($activeTabId.get(), requestId, optionId)
      }
      // 响应已送达即收摊；若引擎仍在等待（罕见），新请求会重新弹
      patchActiveTab({ permission: null })
      window.dispatchEvent(new CustomEvent('jike:focus-composer'))
    } catch (e) {
      // 请求已失效（如 turn 已结束、tab 已重建）：收起弹窗而不是无声卡住
      setBusy(null)
      patchActiveTab({ permission: null })
      pushToast(`审批没送出去：${formatEngineError(e)}`, 'error')
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (confirmAlways) {
          setConfirmAlways(false)
          return
        }
        if (confirmNever) {
          setConfirmNever(false)
          return
        }
        if (menuOpen) {
          setMenuOpen(false)
          return
        }
        if (deny && !busy) void respond(deny.id)
        return
      }
      if (confirmAlways || confirmNever) return
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        if (allow && !busy) void respond(allow.id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // respond 每次 render 重建，这里按选项 id 判断即可，无需整个函数入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, allow?.id, deny?.id, busy, confirmAlways, confirmNever, menuOpen])

  useEffect(() => {
    if (surface === 'inline') runRef.current?.focus()
  }, [surface])

  const runOnce = (optionId: string) => void respond(optionId)

  const onSessionAllow = () => {
    setMenuOpen(false)
    if (!allow) return
    addSessionAllowed($activeTabId.get(), sig)
    runOnce(allow.id)
  }

  const onAlwaysAllow = () => {
    setMenuOpen(false)
    setConfirmAlways(true)
  }

  const confirmAlwaysAllow = () => {
    setConfirmAlways(false)
    const opt = allowAlways || allow
    if (!opt) return
    addAlwaysAllowed(sig)
    runOnce(opt.id)
  }

  const onNeverAllow = () => {
    setMenuOpen(false)
    setConfirmNever(true)
  }

  const confirmNeverAllow = () => {
    setConfirmNever(false)
    if (!neverAllow) return
    runOnce(neverAllow.id)
  }

  return (
    <>
      <div className={'perm-bar perm-bar-' + surface}>
        {surface === 'inline' ? (
          <div className="perm-bar-lead">
            <span className="perm-bar-kind">{lead.title}</span>
            {lead.note ? (
              <span className="perm-bar-summary" title={command || lead.note}>
                {lead.note}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="perm-bar-actions" ref={menuRef}>
          {allow ? (
            <div className="perm-run-wrap">
              <div className="perm-run-split">
                <button
                  ref={runRef}
                  type="button"
                  className="perm-act perm-act-run"
                  disabled={busy != null}
                  onClick={() => runOnce(allow.id)}
                >
                  {busy === allow.id ? <LoaderIcon /> : '允许这次'}
                  {busy !== allow.id && (
                    <span className="perm-kbd">{mac ? '⌘⏎' : 'Ctrl⏎'}</span>
                  )}
                </button>
                <span className="perm-run-sep" aria-hidden />
                <button
                  type="button"
                  className="perm-act perm-act-more"
                  aria-label="更多允许方式"
                  aria-expanded={menuOpen}
                  disabled={busy != null}
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <ChevronIcon open={menuOpen} />
                </button>
              </div>
              {menuOpen ? (
                <div className="perm-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="perm-menu-item"
                    onClick={onSessionAllow}
                  >
                    <span className="perm-menu-label">仅这场对话允许</span>
                    <span className="perm-menu-hint">同样的请求，这场对话不再问</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="perm-menu-item"
                    onClick={onAlwaysAllow}
                  >
                    <span className="perm-menu-label">总是允许</span>
                    <span className="perm-menu-hint">这台电脑记住，以后不再问</span>
                  </button>
                  {neverAllow && neverAllow.id !== deny?.id ? (
                    <>
                      <div className="perm-menu-sep" role="separator" />
                      <button
                        type="button"
                        role="menuitem"
                        className="perm-menu-item perm-menu-item-danger"
                        onClick={onNeverAllow}
                      >
                        <span className="perm-menu-label">永不允许</span>
                        <span className="perm-menu-hint">以后同样的请求直接拒绝</span>
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {deny && deny.id !== allow?.id ? (
            <button
              type="button"
              className="perm-act perm-act-deny"
              disabled={busy != null}
              onClick={() => runOnce(deny.id)}
            >
              {busy === deny.id ? <LoaderIcon /> : '拒绝'}
              {busy !== deny.id && <span className="perm-kbd">Esc</span>}
            </button>
          ) : null}

          {hasCommand ? (
            <button
              type="button"
              className="perm-act perm-act-cmd"
              aria-expanded={showDetail}
              onClick={() => setShowDetail((v) => !v)}
            >
              {detailLabel}
              <ChevronIcon open={showDetail} />
            </button>
          ) : null}
        </div>

        {request.securityFindings && request.securityFindings.length > 0 ? (
          <div className="perm-findings" role="note">
            <span className="perm-findings-ico" aria-hidden>
              ⚠
            </span>
            <span className="perm-findings-text">
              预检发现：
              {request.securityFindings
                .map((f) => SECURITY_FINDING_LABELS[f] || f)
                .join('、')}
            </span>
          </div>
        ) : null}

        {showDetail && hasCommand ? (
          <pre className="perm-command">{command}</pre>
        ) : null}
      </div>

      {confirmAlways ? (
        <ConfirmDialog
          title="总是允许这项操作？"
          desc="这台电脑会记住。之后遇到同样的请求，不再询问。"
          command={hasCommand ? command : undefined}
          confirmLabel="总是允许"
          onCancel={() => setConfirmAlways(false)}
          onConfirm={confirmAlwaysAllow}
        />
      ) : null}

      {confirmNever ? (
        <ConfirmDialog
          title="永不允许这项操作？"
          desc="这次会拒绝。以后遇到同样的请求，也会直接拒绝。"
          command={hasCommand ? command : undefined}
          confirmLabel="永不允许"
          danger
          onCancel={() => setConfirmNever(false)}
          onConfirm={confirmNeverAllow}
        />
      ) : null}
    </>
  )
}

/** 内嵌审批条：渲染在发起工具行下方；IntersectionObserver 上报可见性 */
export function InlinePermissionBar({ permission }: { permission: PermissionRequest }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          $permissionInlineVisible.set(en.isIntersecting)
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [permission])

  return (
    <div ref={ref} className="perm-inline-wrap">
      <ApprovalBar request={permission} surface="inline" />
    </div>
  )
}

/** 兜底浮层：内嵌条不在视口内时，在输入框上方提示并给同一组操作 */
export function PendingApprovalFallback({
  permission,
  force,
}: {
  permission: PermissionRequest | null
  /** 画布工作栏没有工具行，必须自己弹出审批条 */
  force?: boolean
}) {
  const inlineVisible = useStore($permissionInlineVisible)
  if (!permission) return null
  if (!force && inlineVisible) return null

  const lead = permissionLead(permission)
  const command = (permission.command || '').trim()
  return (
    <div className="perm-dock" role="alertdialog" aria-label={lead.title}>
      <div className="perm-card">
        <div className="perm-row-head">
          <span className="perm-ico" aria-hidden>
            <AlertIcon />
          </span>
          <span className="perm-title">{lead.title}</span>
          {lead.note ? (
            <span className="perm-note" title={command || lead.note}>
              {lead.note}
            </span>
          ) : null}
        </div>
        <ApprovalBar request={permission} surface="floating" />
      </div>
    </div>
  )
}
