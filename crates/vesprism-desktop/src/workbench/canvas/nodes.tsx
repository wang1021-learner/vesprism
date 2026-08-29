import { memo, type ReactNode } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import {
  IconBooks,
  IconCircleDot,
  IconCode,
  IconCopy,
  IconDatabase,
  IconGitBranch,
  IconGitFork,
  IconGitMerge,
  IconHierarchy2,
  IconHttpDelete,
  IconPlayerPlay,
  IconRepeat,
  IconSparkles,
  IconSquareRoundedCheck,
  IconTerminal2,
  IconTrash,
  IconVariable,
} from '@tabler/icons-react'
import type { FlowNodeType } from '../flow'
import { useFlowCanvas } from './context'

export type FlowRfData = { nodeType: FlowNodeType } & Record<string, unknown>
export type FlowRfNode = Node<FlowRfData, FlowNodeType>

const TYPE_META: Record<
  FlowNodeType,
  { tag: string; cls: string; icon: ReactNode }
> = {
  start: { tag: '起点', cls: 'is-start', icon: <IconPlayerPlay size={16} stroke={2} /> },
  agent: { tag: 'Agent', cls: 'is-agent', icon: <IconSparkles size={16} stroke={2} /> },
  tool: { tag: '代办', cls: 'is-tool', icon: <IconTerminal2 size={16} stroke={2} /> },
  http: { tag: 'HTTP', cls: 'is-http', icon: <IconHttpDelete size={16} stroke={2} /> },
  database: { tag: '数据库', cls: 'is-database', icon: <IconDatabase size={16} stroke={2} /> },
  knowledge: { tag: '知识库', cls: 'is-knowledge', icon: <IconBooks size={16} stroke={2} /> },
  variable: { tag: '变量', cls: 'is-variable', icon: <IconVariable size={16} stroke={2} /> },
  transform: { tag: '代码', cls: 'is-transform', icon: <IconCode size={16} stroke={2} /> },
  loop: { tag: '迭代', cls: 'is-loop', icon: <IconRepeat size={16} stroke={2} /> },
  loop_end: { tag: '迭代汇聚', cls: 'is-loop-end', icon: <IconCircleDot size={16} stroke={2} /> },
  flow: { tag: '子流程', cls: 'is-flow', icon: <IconHierarchy2 size={16} stroke={2} /> },
  branch: { tag: '分支', cls: 'is-branch', icon: <IconGitBranch size={16} stroke={2} /> },
  parallel: { tag: '并行', cls: 'is-parallel', icon: <IconGitFork size={16} stroke={2} /> },
  join: { tag: '汇聚', cls: 'is-join', icon: <IconGitMerge size={16} stroke={2} /> },
  end: { tag: '终点', cls: 'is-end', icon: <IconSquareRoundedCheck size={16} stroke={2} /> },
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
      const p = data as { toolName?: string; command?: string }
      return p.command || p.toolName || '执行工具/命令'
    }
    case 'http': {
      const p = data as { method?: string; url?: string }
      return p.url ? `${p.method || 'GET'} ${p.url}` : '未配置 URL'
    }
    case 'database': {
      const p = data as { sql?: string }
      return p.sql ? p.sql.slice(0, 48) : '未写 SQL'
    }
    case 'knowledge': {
      const p = data as { knowledgeBase?: string; query?: string }
      return p.query ? `「${p.knowledgeBase || '默认'}」${p.query}` : '未写检索词'
    }
    case 'variable': {
      const p = data as { value?: string; valueType?: string }
      return p.value ? `${p.valueType || 'string'}: ${p.value}` : '空值'
    }
    case 'transform': {
      const p = data as { code?: string }
      return p.code ? p.code.slice(0, 48) : '未写表达式'
    }
    case 'loop': {
      return '遍历上游数组（循环体内 {{prev.output}} = 当前元素）'
    }
    case 'loop_end': {
      return '收集循环结果数组'
    }
    case 'flow': {
      const p = data as { flowId?: string }
      return p.flowId ? `/${p.flowId}` : '未选择子流程'
    }
    case 'branch': {
      const p = data as { condition?: string; expression?: string }
      if (p.condition === 'expression' && p.expression) return p.expression
      if (p.condition === 'failure') return '按失败分支'
      return '按成功分支'
    }
    case 'parallel': {
      const p = data as { mode?: string }
      return p.mode === 'race' ? '竞态模式 (Race)' : '并发全部分支 (All)'
    }
    case 'join': {
      const p = data as { mergeMode?: string }
      if (p.mergeMode === 'list') return '合并为数组 (List)'
      if (p.mergeMode === 'all_success') return '全成功校验'
      return '字典合并 (Merge JSON)'
    }
    case 'end': {
      return '流程输出'
    }
  }
}

function FlowNodeView({ id, data, selected }: NodeProps<FlowRfNode>) {
  const ctx = useFlowCanvas()
  const meta = TYPE_META[data.nodeType]
  const showIn = data.nodeType !== 'start'
  const showOut = data.nodeType !== 'end'
  const branch = data.nodeType === 'branch'
  const title = titleOf(data)
  const subtitle = subtitleOf(data)
  const fields = (data as { fields?: { name: string; type: string }[] }).fields

  const execStatus = (data as { execStatus?: 'running' | 'done' | 'failed' }).execStatus
  const diffGlow = (data as { diffGlow?: 'add' | 'update' }).diffGlow
  const execDuration = (data as { execDuration?: number }).execDuration
  const durationStr = execDuration ? `${(execDuration / 1000).toFixed(1)}s` : ''

  const handleRun = () => ctx.onRunFromHere?.(id)
  const handleDuplicate = () => ctx.onDuplicate?.(id)
  const handleDelete = () => ctx.onDeleteNode?.(id)

  return (
    <div
      className={`flow-node ${meta.cls}${selected ? ' is-selected' : ''}${execStatus ? ` is-${execStatus}` : ''}${
        diffGlow === 'add' ? ' is-diff-add' : diffGlow === 'update' ? ' is-diff-update' : ''
      }`}
    >
      <div className="flow-node-actions nodrag" aria-hidden>
        {data.nodeType !== 'start' && (
          <button
            type="button"
            className="flow-node-act-btn is-play"
            title="从此处开始试跑"
            onClick={(e) => {
              e.stopPropagation()
              handleRun()
            }}
          >
            <IconPlayerPlay size={12} stroke={2.2} />
          </button>
        )}
        <button
          type="button"
          className="flow-node-act-btn is-copy"
          title="复制节点"
          onClick={(e) => {
            e.stopPropagation()
            handleDuplicate()
          }}
        >
          <IconCopy size={12} stroke={2} />
        </button>
        <button
          type="button"
          className="flow-node-act-btn is-del"
          title="删除节点"
          onClick={(e) => {
            e.stopPropagation()
            handleDelete()
          }}
        >
          <IconTrash size={12} stroke={2} />
        </button>
      </div>

      {showIn && (
        <Handle
          type="target"
          position={Position.Left}
          className="flow-handle"
          title="输入连接点 (Input Context)"
        />
      )}
      <div className="flow-node-header">
        <span className="flow-node-icon">{meta.icon}</span>
        <span className="flow-node-tag">{meta.tag}</span>
        {execStatus === 'running' && <span className="flow-node-status is-running">运行中</span>}
        {execStatus === 'done' && (
          <span className="flow-node-status is-done" title="执行成功">
            ✓{durationStr ? ` ${durationStr}` : ''}
          </span>
        )}
        {execStatus === 'failed' && <span className="flow-node-status is-failed">失败</span>}
      </div>
      <div className="flow-node-body">
        <div className="flow-node-title" title={title}>
          {title}
        </div>
        <div className="flow-node-sub" title={subtitle}>
          {subtitle}
        </div>
        {data.nodeType === 'start' && fields && fields.length > 0 && (
          <div className="flow-fields-preview">
            {fields.map((f) => (
              <span key={f.name} className="flow-field-badge" title={`${f.name}: ${f.type}`}>
                {f.name}
              </span>
            ))}
          </div>
        )}
      </div>
      {branch ? (
        <div className="flow-branch-handles">
          <Handle
            type="source"
            id="success"
            position={Position.Right}
            className="flow-handle is-yes"
            style={{ top: '35%' }}
            title="成功分支 (Success)"
          />
          <Handle
            type="source"
            id="failure"
            position={Position.Right}
            className="flow-handle is-no"
            style={{ top: '68%' }}
            title="失败/默认分支 (Failure / Fallback)"
          />
          <Handle
            type="source"
            id="case-2"
            position={Position.Right}
            className="flow-handle"
            style={{ top: '88%' }}
            title="其它分支 2"
          />
          <Handle
            type="source"
            id="case-3"
            position={Position.Bottom}
            className="flow-handle"
            title="其它分支 3"
          />
        </div>
      ) : (
        showOut && (
          <Handle
            type="source"
            position={Position.Right}
            className="flow-handle"
            title="输出连接点 (Output Result)"
          />
        )
      )}
    </div>
  )
}

export const FlowNode = memo(FlowNodeView)


