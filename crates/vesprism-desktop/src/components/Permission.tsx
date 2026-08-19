/** 
 * 工具审批（内嵌位置 + choice 语义）：
 * - 主：内嵌在「发起审批的工具行」下方（positional：挂起时最后一个 in_progress 工具行）
 * - 兜底：输入框上方浮层，仅当内嵌条不可见时显示
 * - 主按钮：运行(once)；下拉：本次会话允许 / 总是允许（确认弹窗）/ 拒绝
 * - 键盘：Ctrl/⌘+Enter 运行 · Esc 拒绝
 * - 子 agent 的权限请求已在后端自动放行，不会到达这里
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import type { PermissionRequest } from '../types'
import { $activeTabId, $permissionInlineVisible, patchActiveTab, pushToast } from '../store'
import { respondPermission } from '../bridge'
import {
  addAlwaysAllowed,
  addSessionAllowed,
  permissionSignature,
  pickAllow,
  pickDeny,
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

/** 主审批条：组合按钮 + 拒绝 + 命令 + always 确认弹窗 */
function ApprovalBar({
  request,
  surface,
}: {
  request: PermissionRequest
  surface: 'inline' | 'floating'
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [showCommand, setShowCommand] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmAlways, setConfirmAlways] = useState(false)
  const runRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const mac = useMemo(() => isMacPlatform(), [])
  const sig = useMemo(() => permissionSignature(request), [request])

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
  const deny = useMemo(() => pickDeny(request.options), [request.options])
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
      pushToast(`审批未送达（请求可能已失效）：${String(e)}`, 'error')
    }
  }

  useEffect(() => {
    if (confirmAlways) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (deny && !busy) void respond(deny.id)
        return
      }
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
  }, [request, allow?.id, deny?.id, busy, confirmAlways])

  useEffect(() => {
    if (surface === 'inline') runRef.current?.focus()
  }, [surface])

  const runOnce = (optionId: string) => void respond(optionId)

  const onSessionAllow = () => {
    setMenuOpen(false)
    if (!allow) return
    console.log('[perm] 本次会话允许 ->', { tabId: $activeTabId.get(), sig })
    addSessionAllowed($activeTabId.get(), sig)
    runOnce(allow.id)
  }

  const onAlwaysAllow = () => {
    setMenuOpen(false)
    setConfirmAlways(true)
  }

  const confirmAlwaysAllow = () => {
    setConfirmAlways(false)
    if (!allow) return
    console.log('[perm] 总是允许 ->', { sig })
    addAlwaysAllowed(sig)
    runOnce(allow.id)
  }

  const onMenuDeny = () => {
    setMenuOpen(false)
    if (deny) runOnce(deny.id)
  }

  return (
    <>
      <div className={'perm-bar perm-bar-' + surface}>
        <div className="perm-bar-actions" ref={menuRef}>
          {allow ? (
            <div className="perm-run-split">
              <button
                ref={runRef}
                type="button"
                className="perm-act perm-act-run"
                disabled={busy != null}
                onClick={() => runOnce(allow.id)}
              >
                {busy === allow.id ? <LoaderIcon /> : '运行'}
                {busy !== allow.id && (
                  <span className="perm-kbd">{mac ? '⌘⏎' : 'Ctrl⏎'}</span>
                )}
              </button>
              <span className="perm-run-sep" aria-hidden />
              <button
                type="button"
                className="perm-act perm-act-more"
                aria-label="更多选项"
                aria-expanded={menuOpen}
                disabled={busy != null}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <ChevronIcon open={menuOpen} />
              </button>
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
              aria-expanded={showCommand}
              onClick={() => setShowCommand((v) => !v)}
            >
              命令
              <ChevronIcon open={showCommand} />
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

        {menuOpen ? (
          <div className="perm-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="perm-menu-item"
              onClick={onSessionAllow}
            >
              本次会话允许
              <span className="perm-menu-hint">同命令不再询问</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="perm-menu-item"
              onClick={onAlwaysAllow}
            >
              总是允许
              <span className="perm-menu-hint">写入本地配置</span>
            </button>
            {deny && deny.id !== allow?.id ? (
              <button
                type="button"
                role="menuitem"
                className="perm-menu-item perm-menu-item-danger"
                onClick={onMenuDeny}
              >
                拒绝
              </button>
            ) : null}
          </div>
        ) : null}

        {showCommand && hasCommand ? (
          <pre className="perm-command">{command}</pre>
        ) : null}
      </div>

      {confirmAlways ? (
        <div className="perm-dialog-backdrop" role="presentation">
          <div className="perm-dialog" role="alertdialog" aria-label="总是允许">
            <div className="perm-dialog-title">总是允许该命令？</div>
            <div className="perm-dialog-desc">
              之后同类命令将不再询问（写入本地配置）。
            </div>
            {hasCommand ? <pre className="perm-command perm-dialog-cmd">{command}</pre> : null}
            <div className="perm-dialog-actions">
              <button
                type="button"
                className="perm-act perm-act-deny"
                onClick={() => setConfirmAlways(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="perm-act perm-act-run"
                autoFocus
                onClick={confirmAlwaysAllow}
              >
                总是允许
              </button>
            </div>
          </div>
        </div>
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

  const kindLabel =
    permission.kindLabel && permission.kindLabel !== '需要审批'
      ? permission.kindLabel
      : ''
  const command = (permission.command || '').trim()
  const summary = (permission.summary || '').trim()
  const sideNote = [kindLabel, summary].filter(Boolean).join(' · ')
  return (
    <div className="perm-dock" role="alertdialog" aria-label="需要审批">
      <div className="perm-card">
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
        <ApprovalBar request={permission} surface="floating" />
      </div>
    </div>
  )
}
