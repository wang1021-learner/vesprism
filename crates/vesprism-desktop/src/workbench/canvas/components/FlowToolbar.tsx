import React from 'react'
import type { FlowDraft } from '../../flow'

export interface FlowToolbarProps {
  draft: FlowDraft
  setDraft: React.Dispatch<React.SetStateAction<FlowDraft>>
  dockOpen: boolean
  setDockOpen: React.Dispatch<React.SetStateAction<boolean>>
  mounted: boolean
  onMountToSession: () => void
  onOpenPublish: () => void
  onAutoLayout: () => void
  onExport: () => void
  onImport: () => void
  onCopy: () => void
  onDelete: () => void
  onRun: () => void
}

export function FlowToolbar({
  draft,
  setDraft,
  dockOpen,
  setDockOpen,
  mounted,
  onMountToSession,
  onOpenPublish,
  onAutoLayout,
  onExport,
  onImport,
  onCopy,
  onDelete,
  onRun,
}: FlowToolbarProps) {
  return (
    <header className="flow-toolbar">
      <div className="flow-toolbar-name">
        <div className="flow-title-wrapper">
          <span className="flow-title-icon" aria-hidden>✦</span>
          <input
            value={draft.name}
            aria-label="流程名"
            placeholder="未命名流程"
            className="flow-title-input"
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value, dirty: true }))}
          />
        </div>
        <span className="flow-id-badge" title={`流程 ID: ${draft.id}`}>
          /{draft.id}
        </span>
        {draft.published ? (
          <span className="flow-badge published" title={`已发布版本 v${draft.version}`}>
            v{draft.version}
          </span>
        ) : (
          <span className="flow-badge draft" title="本地草稿">
            草稿
          </span>
        )}
        {draft.dirty && (
          <span className="flow-badge dirty" title="有未保存改动">
            未保存
          </span>
        )}
      </div>

      <div className="flow-toolbar-actions">
        <div className="flow-action-group primary-group">
          <button
            type="button"
            className={`flow-btn ${mounted ? 'is-active' : ''}`}
            onClick={onMountToSession}
            title={mounted ? '已挂载至当前会话工具链' : '热挂载到当前会话，右侧输入框即可直接作为 /命令 调起'}
          >
            {mounted ? '已挂载' : '挂载至会话'}
          </button>
          <button type="button" className="flow-btn primary" onClick={onOpenPublish}>
            {draft.published ? '更新发布' : '发布流程'}
          </button>
          <button type="button" className="flow-btn run-btn" onClick={onRun} title="试跑当前流程">
            <span>▶</span> 试跑
          </button>
        </div>

        <div className="flow-action-divider" />

        <div className="flow-action-group tool-group">
          <button type="button" className="flow-btn icon-btn" title="一键拓扑分层整理布局" onClick={onAutoLayout}>
            <span>◫</span> 整理
          </button>
          <button type="button" className="flow-btn icon-btn" title="导出流程包 (.zip)" onClick={onExport}>
            <span>↓</span> 导出
          </button>
          <button type="button" className="flow-btn icon-btn" title="导入流程包 (.zip)" onClick={onImport}>
            <span>↑</span> 导入
          </button>
          <button type="button" className="flow-btn icon-btn" title="复制当前流程副本" onClick={onCopy}>
            <span>⎘</span> 复制
          </button>
          <button type="button" className="flow-btn danger icon-btn" title="删除当前流程" onClick={onDelete}>
            <span>🗑</span>
          </button>
        </div>

        <div className="flow-action-divider" />

        <button
          type="button"
          className={`flow-btn dock-btn${dockOpen ? ' is-active' : ''}`}
          onClick={() => setDockOpen((v) => !v)}
          title={dockOpen ? '收起工作栏' : '打开工作栏'}
        >
          <span className="flow-btn-icon">💬</span> 工作栏
        </button>
      </div>
    </header>
  )
}
