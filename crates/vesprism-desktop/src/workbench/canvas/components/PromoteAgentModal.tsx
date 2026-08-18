import React from 'react'
import { slugifyAgentId } from '../../types'

export interface PromoteAgentModalProps {
  open: boolean
  onClose: () => void
  promoteName: string
  setPromoteName: (v: string) => void
  promoteId: string
  setPromoteId: (v: string) => void
  promoteDesc: string
  setPromoteDesc: (v: string) => void
  promoteBusy: boolean
  onPromote: () => void
}

export function PromoteAgentModal({
  open,
  onClose,
  promoteName,
  setPromoteName,
  promoteId,
  setPromoteId,
  promoteDesc,
  setPromoteDesc,
  promoteBusy,
  onPromote,
}: PromoteAgentModalProps) {
  if (!open) return null

  return (
    <div className="flow-modal-back" role="dialog" aria-modal="true" aria-label="升格为 Agent">
      <div className="flow-modal">
        <h2>✦ 升格为 Agent</h2>
        <p className="flow-field-hint">
          将这个试岗节点的角色、提示词与模型固化为「编制员工」，可在 Agent 编制中复用并配置独立权限。
        </p>
        <label className="flow-field">
          <span>Agent 名称</span>
          <input
            placeholder="如：代码审计师"
            value={promoteName}
            onChange={(e) => {
              const name = e.target.value
              setPromoteName(name)
              if (!promoteId || promoteId.startsWith('agent-')) {
                setPromoteId(slugifyAgentId(name) || `agent-${Date.now().toString(36).slice(2, 6)}`)
              }
            }}
          />
        </label>
        <label className="flow-field">
          <span>Agent ID</span>
          <input
            placeholder="如：code-auditor"
            value={promoteId}
            onChange={(e) => setPromoteId(slugifyAgentId(e.target.value))}
          />
        </label>
        <label className="flow-field">
          <span>说明（给谁看/何时用）</span>
          <textarea
            rows={2}
            placeholder="说明这个 Agent 的专长领域"
            value={promoteDesc}
            onChange={(e) => setPromoteDesc(e.target.value)}
          />
        </label>
        <div className="flow-modal-actions">
          <button type="button" className="flow-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="flow-btn primary"
            disabled={!promoteId || !promoteName.trim() || promoteBusy}
            onClick={onPromote}
          >
            {promoteBusy ? '升格中...' : '确认升格'}
          </button>
        </div>
      </div>
    </div>
  )
}
