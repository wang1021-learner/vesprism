import React from 'react'
import type { FlowDraft } from '../../flow'
import { slugifyFlowId } from '../../flow'

export interface PublishFlowModalProps {
  open: boolean
  onClose: () => void
  draft: FlowDraft
  setDraft: React.Dispatch<React.SetStateAction<FlowDraft>>
  pubDesc: string
  setPubDesc: (v: string) => void
  pubVersion: string
  setPubVersion: (v: string) => void
  pubIn: string
  pubOut: string
  onPublish: () => void
}

export function PublishFlowModal({
  open,
  onClose,
  draft,
  setDraft,
  pubDesc,
  setPubDesc,
  pubVersion,
  setPubVersion,
  pubIn,
  pubOut,
  onPublish,
}: PublishFlowModalProps) {
  if (!open) return null

  const canPublish = pubDesc.trim().length > 0

  return (
    <div className="flow-modal-back" role="dialog" aria-modal="true" aria-label="发布流程">
      <div className="flow-modal">
        <h2>发布流程包</h2>
        <label className="flow-field">
          <span>流程名</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value, dirty: true }))}
          />
        </label>
        <label className="flow-field">
          <span>id</span>
          <input
            value={draft.id}
            onChange={(e) => setDraft((d) => ({ ...d, id: slugifyFlowId(e.target.value), dirty: true }))}
          />
        </label>
        <label className="flow-field">
          <span>给 agent 看的说明（必填，决定何时调用）</span>
          <textarea
            rows={3}
            placeholder="说明这个流程做什么、什么时候用"
            value={pubDesc}
            onChange={(e) => setPubDesc(e.target.value)}
          />
        </label>
        <label className="flow-field">
          <span>版本号</span>
          <input value={pubVersion} onChange={(e) => setPubVersion(e.target.value)} />
        </label>
        <div className="flow-schemas-preview">
          <div>
            <strong>input_schema</strong>
            <pre>{pubIn}</pre>
          </div>
          <div>
            <strong>output_schema</strong>
            <pre>{pubOut}</pre>
          </div>
        </div>
        <div className="flow-modal-actions">
          <button type="button" className="flow-btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="flow-btn primary" disabled={!canPublish} onClick={onPublish}>
            确认发布
          </button>
        </div>
      </div>
    </div>
  )
}
