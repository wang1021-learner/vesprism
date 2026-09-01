import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { $runningByParent, type ChatSummary } from '../store'
import type { WorkbenchBinding } from '../workbench/bindings'

export function ChatRow({
  chat,
  binding,
  isActive,
  menuOpen,
  onSelect,
  onOpenMenu,
  onRename,
  onRestoreCode,
  onDelete,
}: {
  chat: ChatSummary
  binding?: WorkbenchBinding
  isActive: boolean
  menuOpen: boolean
  onSelect: () => void
  onOpenMenu: () => void
  onRename: () => void
  onRestoreCode: () => void
  onDelete: () => void
}) {
  const runningByParent = useStore($runningByParent)
  const runningCount = runningByParent[chat.id] ?? 0
  const artifacts = binding?.artifacts ?? []
  const flowCount = artifacts.filter((item) => item.kind === 'flow').length
  const agentCount = artifacts.filter((item) => item.kind === 'agent').length
  const hasWorkbenchArtifacts = flowCount > 0 || agentCount > 0
  const [confirmRestore, setConfirmRestore] = useState(false)
  useEffect(() => {
    if (!menuOpen) setConfirmRestore(false)
  }, [menuOpen])
  return (
    <div className={`recent-item-container${isActive ? ' active' : ''}`}>
      <button type="button" className="recent-item" onClick={onSelect}>
        <span className="recent-title" title={chat.title}>
          {chat.title}
        </span>
        {hasWorkbenchArtifacts && (
          <span className="recent-artifacts" aria-label="工作台产物">
            {flowCount > 0 && <span className="recent-artifact-pill" title={`${flowCount} 个流程`}>⑂ {flowCount}</span>}
            {agentCount > 0 && <span className="recent-artifact-pill" title={`${agentCount} 个员工`}>✦ {agentCount}</span>}
          </span>
        )}
        {runningCount > 0 && (
          <span className="recent-running-badge" title={`${runningCount} 个子代理运行中`}>
            ● {runningCount}
          </span>
        )}
      </button>
      <button
        type="button"
        className={`recent-more-btn${menuOpen ? ' open' : ''}`}
        title="更多操作"
        onClick={(e) => {
          e.stopPropagation()
          onOpenMenu()
        }}
      >
        ⋮
      </button>
      {menuOpen && (
        <div className="recent-menu place-bottom" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="recent-menu-item" onClick={onRename}>
            ✎ 重命名
          </button>
          <button
            type="button"
            className="recent-menu-item"
            title="打开这场对话，并把工作区文件恢复成当时的快照。未提交改动可能被盖掉。"
            onClick={() => {
              if (!confirmRestore) {
                setConfirmRestore(true)
                return
              }
              setConfirmRestore(false)
              onRestoreCode()
            }}
          >
            {confirmRestore ? '再点确认：会改工作区文件' : '还原代码快照'}
          </button>
          <button type="button" className="recent-menu-item danger" onClick={onDelete}>
            🗑 删除对话
          </button>
        </div>
      )}
    </div>
  )
}
