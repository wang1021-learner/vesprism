import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { FlowNodeType } from '../../lib/flow'

export type FlowRfData = { nodeType: FlowNodeType } & Record<string, unknown>
export type FlowRfNode = Node<FlowRfData, FlowNodeType>

const TYPE_META: Record<FlowNodeType, { tag: string; cls: string }> = {
  start: { tag: '起点', cls: 'is-start' },
  agent: { tag: 'Agent', cls: 'is-agent' },
  tool: { tag: '工具', cls: 'is-tool' },
  flow: { tag: '子流程', cls: 'is-flow' },
  branch: { tag: '分支', cls: 'is-branch' },
  end: { tag: '终点', cls: 'is-end' },
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
      return fields?.length ? fields.map((f) => f.name).join(', ') : '输入'
    }
    case 'agent': {
      const p = data as { role?: string; presetId?: string; model?: string; agentType?: string }
      return p.model || p.agentType || p.presetId || p.role || '继承会话模型'
    }
    case 'tool': {
      const p = data as { command?: string; toolName?: string }
      return p.command || p.toolName || '未配置'
    }
    case 'flow': {
      const p = data as { flowId?: string }
      return p.flowId ? `/${p.flowId}` : '未选择流程'
    }
    case 'branch': {
      const p = data as { condition?: string; expression?: string }
      if (p.condition === 'expression') return p.expression || '表达式'
      return p.condition === 'failure' ? '失败时' : '成功时'
    }
    case 'end':
      return '输出'
  }
}

function FlowNodeView({ data, selected }: NodeProps<FlowRfNode>) {
  const meta = TYPE_META[data.nodeType]
  const showIn = data.nodeType !== 'start'
  const showOut = data.nodeType !== 'end'
  const branch = data.nodeType === 'branch'
  return (
    <div className={`flow-node ${meta.cls}${selected ? ' is-selected' : ''}`}>
      {showIn && <Handle type="target" position={Position.Left} className="flow-handle" />}
      <div className="flow-node-tag">{meta.tag}</div>
      <div className="flow-node-title">{titleOf(data)}</div>
      <div className="flow-node-sub" title={subtitleOf(data)}>
        {subtitleOf(data)}
      </div>
      {branch ? (
        <>
          <Handle type="source" id="success" position={Position.Right} className="flow-handle is-yes" style={{ top: '38%' }} />
          <Handle type="source" id="failure" position={Position.Right} className="flow-handle is-no" style={{ top: '72%' }} />
        </>
      ) : (
        showOut && <Handle type="source" position={Position.Right} className="flow-handle" />
      )}
    </div>
  )
}

const MemoNode = memo(FlowNodeView)

export const flowNodeTypes = {
  start: MemoNode,
  agent: MemoNode,
  tool: MemoNode,
  flow: MemoNode,
  branch: MemoNode,
  end: MemoNode,
}
