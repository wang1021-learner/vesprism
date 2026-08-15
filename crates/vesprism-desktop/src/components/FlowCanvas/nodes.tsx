import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { FlowNodeType } from '../../lib/flow'

export type FlowRfData = { nodeType: FlowNodeType } & Record<string, unknown>
export type FlowRfNode = Node<FlowRfData, FlowNodeType>

const TYPE_META: Record<
  FlowNodeType,
  { tag: string; cls: string; icon: string }
> = {
  start: { tag: '起点', cls: 'is-start', icon: '▶' },
  agent: { tag: 'Agent', cls: 'is-agent', icon: '✦' },
  tool: { tag: '工具', cls: 'is-tool', icon: '⚙' },
  flow: { tag: '子流程', cls: 'is-flow', icon: '⑂' },
  branch: { tag: '分支', cls: 'is-branch', icon: '⌥' },
  end: { tag: '终点', cls: 'is-end', icon: '◼' },
}

function titleOf(data: FlowRfData): string {
  const label = String(data.label ?? '').trim()
  if (label) return label
  return TYPE_META[data.nodeType].tag
}

function subtitleOf(data: FlowRfData): string {
  switch (data.nodeType) {
    case 'start': {
      const fields = (data as { fields?: { name: string }[] }).fields
      return fields?.length ? fields.map((f) => f.name).join(', ') : '流程输入'
    }
    case 'agent': {
      const p = data as { role?: string; presetId?: string; model?: string; agentType?: string; prompt?: string }
      return p.prompt || p.role || p.model || p.agentType || p.presetId || '继承会话模型'
    }
    case 'tool': {
      const p = data as { command?: string; toolName?: string }
      return p.command || p.toolName || '未配置命令'
    }
    case 'flow': {
      const p = data as { flowId?: string }
      return p.flowId ? `/${p.flowId}` : '未选择流程'
    }
    case 'branch': {
      const p = data as { condition?: string; expression?: string }
      if (p.condition === 'expression') return p.expression || '表达式'
      return p.condition === 'failure' ? '失败分支' : '成功分支'
    }
    case 'end':
      return '流程输出'
  }
}

function FlowNodeView({ data, selected }: NodeProps<FlowRfNode>) {
  const meta = TYPE_META[data.nodeType]
  const showIn = data.nodeType !== 'start'
  const showOut = data.nodeType !== 'end'
  const branch = data.nodeType === 'branch'
  const title = titleOf(data)
  const subtitle = subtitleOf(data)

  return (
    <div className={`flow-node ${meta.cls}${selected ? ' is-selected' : ''}`}>
      {showIn && (
        <Handle
          type="target"
          position={Position.Left}
          className="flow-handle"
          title="输入连接点"
        />
      )}
      <div className="flow-node-header">
        <span className="flow-node-icon">
          {meta.icon}
        </span>
        <span className="flow-node-tag">
          {meta.tag}
        </span>
      </div>
      <div className="flow-node-body">
        <div className="flow-node-title" title={title}>
          {title}
        </div>
        <div className="flow-node-sub" title={subtitle}>
          {subtitle}
        </div>
      </div>
      {branch ? (
        <div className="flow-branch-handles">
          <Handle
            type="source"
            id="success"
            position={Position.Right}
            className="flow-handle is-yes"
            style={{ top: '35%' }}
            title="成功分支"
          />
          <Handle
            type="source"
            id="failure"
            position={Position.Right}
            className="flow-handle is-no"
            style={{ top: '68%' }}
            title="失败/默认分支"
          />
        </div>
      ) : (
        showOut && (
          <Handle
            type="source"
            position={Position.Right}
            className="flow-handle"
            title="输出连接点"
          />
        )
      )}
    </div>
  )
}

export const FlowNode = memo(FlowNodeView)


