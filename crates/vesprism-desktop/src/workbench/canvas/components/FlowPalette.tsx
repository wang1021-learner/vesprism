import { memo } from 'react'
import { IconSparkles } from '@tabler/icons-react'
import { NODE_LIBRARY, type FlowNodeType } from '../../flow'
import { AGENT_CAPABILITY_LABEL, type AgentListItem } from '../../types'
import { PALETTE_META } from '../palette'

export const FlowPalette = memo(function FlowPalette({
  agents,
  onAdd,
}: {
  agents: AgentListItem[]
  onAdd: (type: FlowNodeType, agent?: AgentListItem | null) => void
}) {
  return (
    <aside className="flow-palette" aria-label="节点库">
      <div className="flow-palette-header">
        <span className="flow-palette-title">节点库</span>
      </div>
      <div className="flow-palette-list">
        {agents.length > 0 ? (
          <>
            <div className="flow-palette-section">编制员工</div>
            {agents.map((agent) => {
              const label = agent.name || agent.id
              const capability = agent.capability ? AGENT_CAPABILITY_LABEL[agent.capability] : '继承权限'
              const hint = [capability, agent.model].filter(Boolean).join(' · ')
              return (
                <button
                  key={agent.id}
                  type="button"
                  className="flow-palette-item flow-palette-agent"
                  draggable
                  title={`点击或拖拽添加：${label} (${agent.id})`}
                  data-label={label}
                  onClick={() => onAdd('agent', agent)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/vesprism-agent', agent.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                >
                  <div className="flow-palette-item-head">
                    <span className="flow-palette-item-icon">
                      <IconSparkles size={18} stroke={2} />
                    </span>
                    <strong className="flow-palette-item-label">{label}</strong>
                  </div>
                  <span className="flow-palette-item-hint">{hint}</span>
                </button>
              )
            })}
            <div className="flow-palette-section flow-palette-section-muted">通用节点</div>
          </>
        ) : null}
        {NODE_LIBRARY.map((item) => {
          const meta = PALETTE_META[item.type]
          return (
            <button
              key={item.type}
              type="button"
              className="flow-palette-item"
              draggable
              title={`点击或拖拽添加：${item.label} — ${item.hint}`}
              data-label={item.label}
              onClick={() => onAdd(item.type)}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/vesprism-node', item.type)
                e.dataTransfer.effectAllowed = 'move'
              }}
            >
              <div className="flow-palette-item-head">
                <span className="flow-palette-item-icon">{meta.icon}</span>
                <strong className="flow-palette-item-label">{item.label}</strong>
              </div>
              <span className="flow-palette-item-hint">{item.hint}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
})
