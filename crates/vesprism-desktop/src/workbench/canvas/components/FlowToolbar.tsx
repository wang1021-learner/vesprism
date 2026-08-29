import React, { useState, useRef, useEffect } from 'react'
import type { FlowDraft } from '../../flow'

export type ExportFormat = 'zip' | 'yaml' | 'json' | 'rhai'

export interface FlowToolbarProps {
  draft: FlowDraft
  setDraft: React.Dispatch<React.SetStateAction<FlowDraft>>
  dockOpen: boolean
  setDockOpen: React.Dispatch<React.SetStateAction<boolean>>
  mounted: boolean
  onMountToSession: () => void
  onOpenPublish: () => void
  onAutoLayout: () => void
  onExport: (format: ExportFormat) => void
  onImport: () => void
  onNew: () => void
  onCopy: () => void
  onDelete: () => void
  onRun: () => void
  minimapOn: boolean
  onToggleMinimap: () => void
}

export const FlowToolbar = React.memo(function FlowToolbar({
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
  onNew,
  onCopy,
  onDelete,
  onRun,
  minimapOn,
  onToggleMinimap,
}: FlowToolbarProps) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    if (exportMenuOpen) {
      document.addEventListener('mousedown', handleOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside)
    }
  }, [exportMenuOpen])

  const handleSelectExport = (fmt: ExportFormat) => {
    setExportMenuOpen(false)
    onExport(fmt)
  }

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
        {draft.dirty && draft.id !== 'demo-linear' && (
          <span className="flow-badge dirty" title="有未保存改动">
            未保存
          </span>
        )}
        {draft.dirty && draft.id === 'demo-linear' && (
          <span className="flow-badge dirty" title="示例不会写入本地，请先复制再保存">
            示例不保存
          </span>
        )}
      </div>

      <div className="flow-toolbar-actions">
        <div className="flow-action-group primary-group">
          <button
            type="button"
            className={`flow-btn ${mounted ? 'is-active' : ''}`}
            onClick={onMountToSession}
            title={mounted ? '已挂到编码对话，可用 /流程id 调用' : '挂到编码对话，之后可用 /流程id 调用'}
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
          <button
            type="button"
            className={`flow-btn icon-btn map-btn${minimapOn ? ' is-active' : ''}`}
            title={minimapOn ? '隐藏小地图' : '显示小地图'}
            aria-pressed={minimapOn}
            onClick={onToggleMinimap}
          >
            <span className="map-btn-swatch" aria-hidden />
            地图
          </button>

          {/* 多格式导出菜单 */}
          <div className="flow-dropdown-wrap" ref={exportRef}>
            <button
              type="button"
              className={`flow-btn icon-btn${exportMenuOpen ? ' is-active' : ''}`}
              title="导出流程（支持 .zip / .yaml / .json / .rhai）"
              onClick={() => setExportMenuOpen((v) => !v)}
            >
              <span>↓</span> 导出 ▾
            </button>
            {exportMenuOpen && (
              <div className="flow-toolbar-menu">
                <button
                  type="button"
                  className="flow-toolbar-menu-item"
                  onClick={() => handleSelectExport('zip')}
                >
                  <div className="menu-item-text">
                    <span className="menu-item-title">流程包 (.zip)</span>
                    <span className="menu-item-desc">完整分发包（YAML 契约 + Rhai 脚本 + 依赖）</span>
                  </div>
                </button>
                <button
                  type="button"
                  className="flow-toolbar-menu-item"
                  onClick={() => handleSelectExport('yaml')}
                >
                  <div className="menu-item-text">
                    <span className="menu-item-title">DSL 契约 (.flow.yaml)</span>
                    <span className="menu-item-desc">单文件纯文本，适合 Git 版本审查与协作</span>
                  </div>
                </button>
                <button
                  type="button"
                  className="flow-toolbar-menu-item"
                  onClick={() => handleSelectExport('json')}
                >
                  <div className="menu-item-text">
                    <span className="menu-item-title">流程图谱 (.flow.json)</span>
                    <span className="menu-item-desc">全量节点与前端画布坐标图谱</span>
                  </div>
                </button>
                <button
                  type="button"
                  className="flow-toolbar-menu-item"
                  onClick={() => handleSelectExport('rhai')}
                >
                  <div className="menu-item-text">
                    <span className="menu-item-title">执行脚本 (.rhai)</span>
                    <span className="menu-item-desc">纯脚本代码，可脱离 UI 独立运行</span>
                  </div>
                </button>
              </div>
            )}
          </div>

          <button type="button" className="flow-btn icon-btn" title="导入流程（支持 .zip / .yaml / .json）" onClick={onImport}>
            <span>↑</span> 导入
          </button>
          <button
            type="button"
            className="flow-btn icon-btn"
            title="新开一张空白画布 Tab（起点和终点）"
            onClick={onNew}
          >
            <span>＋</span> 新建
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
          title={dockOpen ? '收起试跑状态' : '打开试跑状态'}
        >
          试跑状态
        </button>
      </div>
    </header>
  )
})
