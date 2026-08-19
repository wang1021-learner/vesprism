import { memo } from 'react'
import type { Node } from '@xyflow/react'
import type { FlowRfData } from '../nodes'
import type { AgentListItem } from '../../types'
import { AGENT_CAPABILITY_LABEL } from '../../types'
import { fieldsToSchema, type SchemaField } from '../../flow'

export interface NodeInspectorProps {
  selected: Node<FlowRfData> | null
  patchSelected: (patch: Partial<FlowRfData>) => void
  agents: AgentListItem[]
  openBoundAgent: (id: string) => void
  demoteToTrial: () => void
  openPromote: () => void
  onRerunFromNode: (nodeId: string) => void
}

function VariableChips({ onInsert }: { onInsert: (v: string) => void }) {
  const vars = [
    { label: '上游产物', val: '{{prev.output}}' },
    { label: '初始输入', val: '{{start.input}}' },
    { label: '工作目录', val: '{{workspace.cwd}}' },
  ]
  return (
    <div className="flow-var-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '4px 0 6px' }}>
      <span style={{ fontSize: '10.5px', color: 'var(--text-tertiary, #9ca3af)', alignSelf: 'center' }}>快速插入:</span>
      {vars.map((item) => (
        <button
          key={item.val}
          type="button"
          className="flow-var-chip"
          title={`点击插入 ${item.val}`}
          onClick={() => onInsert(item.val)}
          style={{
            padding: '2px 6px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono, monospace)',
            background: 'var(--surface-muted, #f1f3f5)',
            border: '1px solid var(--border-solid, #e5e7eb)',
            borderRadius: '4px',
            color: 'var(--text-secondary, #4b5563)',
            cursor: 'pointer',
          }}
        >
          {item.val}
        </button>
      ))}
    </div>
  )
}

export const NodeInspector = memo(function NodeInspector({
  selected,
  patchSelected,
  agents,
  openBoundAgent,
  demoteToTrial,
  openPromote,
  onRerunFromNode,
}: NodeInspectorProps) {
  if (!selected) return null

  const data = selected.data

  return (
    <aside className="flow-inspector" aria-label="节点属性">
      <h3>{data.nodeType} 属性配置</h3>
      <label className="flow-field">
        <span>显示名称</span>
        <input
          placeholder="如：代码分析、生成测试、提交审核"
          value={String(data.label ?? '')}
          onChange={(e) => patchSelected({ label: e.target.value })}
        />
      </label>

      {data.nodeType === 'start' && (
        <label className="flow-field">
          <span>输入字段声明（格式：name:type，多个用逗号隔开）</span>
          <input
            placeholder="如：input:string, file_path:string"
            value={((data as { fields?: SchemaField[] }).fields ?? [])
              .map((f) => `${f.name}:${f.type}`)
              .join(', ')}
            onChange={(e) => {
              const fields: SchemaField[] = e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
                .map((x) => {
                  const [name, type] = x.split(':').map((s) => s.trim())
                  const t = (['string', 'number', 'boolean', 'object', 'array'] as const).includes(type as never)
                    ? (type as SchemaField['type'])
                    : 'string'
                  return { name, type: t, required: true }
                })
              patchSelected({ fields, inputSchema: fieldsToSchema(fields) } as Partial<FlowRfData>)
            }}
          />
        </label>
      )}

      {data.nodeType === 'agent' && (() => {
        const presetId = String((data as { presetId?: string }).presetId ?? '').trim()
        const bound = presetId ? agents.find((a) => a.id === presetId) : undefined
        if (presetId) {
          return (
            <>
              <p className="flow-field-hint">在编：节点只读引用编制，权限在「Agent 编制」改。</p>
              <div className="flow-field">
                <span>编制</span>
                <strong>{bound ? `${bound.name} (${bound.id})` : presetId}</strong>
                <span className="flow-field-hint">
                  {bound?.version ? `v${bound.version}` : ''}
                  {bound?.capability ? ` · ${AGENT_CAPABILITY_LABEL[bound.capability]}` : ' · 未设能力档'}
                  {bound?.isolation ? ' · 隔离' : ''}
                </span>
              </div>
              <button type="button" className="flow-btn" onClick={() => openBoundAgent(presetId)}>
                打开编制
              </button>
              <button type="button" className="flow-btn" onClick={demoteToTrial}>
                复制为试岗
              </button>
            </>
          )
        }
        return (
          <>
            <label className="flow-field">
              <span>角色说明（Role Definition）</span>
              <textarea
                rows={2}
                placeholder="如：资深前端架构师，专注于组件复用与性能优化"
                value={String((data as { role?: string }).role ?? '')}
                onChange={(e) => patchSelected({ role: e.target.value } as Partial<FlowRfData>)}
              />
            </label>
            <label className="flow-field">
              <span>任务提示词（Prompt / 指令要求）</span>
              <VariableChips
                onInsert={(v) => {
                  const cur = String((data as { prompt?: string }).prompt ?? '')
                  patchSelected({ prompt: cur ? `${cur} ${v}` : v } as Partial<FlowRfData>)
                }}
              />
              <textarea
                rows={4}
                placeholder="如：请仔细分析 {{prev.output}} 传入的需求与代码，提炼核心变更逻辑与待办事项，给出清晰结构化的技术摘要。"
                value={String((data as { prompt?: string }).prompt ?? '')}
                onChange={(e) => patchSelected({ prompt: e.target.value } as Partial<FlowRfData>)}
              />
            </label>
            <label className="flow-field">
              <span>执行模型（留空继承主会话模型）</span>
              <input
                placeholder="如：claude-3-7-sonnet, gpt-4o, deepseek-r1"
                value={String((data as { model?: string }).model ?? '')}
                onChange={(e) => patchSelected({ model: e.target.value } as Partial<FlowRfData>)}
              />
            </label>
            <label className="flow-field">
              <span>引用 Agent</span>
              <select
                value=""
                onChange={(e) => patchSelected({ presetId: e.target.value } as Partial<FlowRfData>)}
              >
                <option value="">试岗（不引用编制）</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ? `${a.name} (${a.id})` : a.id}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="flow-btn primary" onClick={openPromote}>
              ✦ 升格为 Agent
            </button>
          </>
        )
      })()}

      {data.nodeType === 'tool' && (
        <>
          <label className="flow-field">
            <span>工具名称</span>
            <input
              placeholder="如：run_command, read_file, grep_search"
              value={String((data as { toolName?: string }).toolName ?? '')}
              onChange={(e) => patchSelected({ toolName: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <label className="flow-field">
            <span>执行命令</span>
            <VariableChips
              onInsert={(v) => {
                const cur = String((data as { command?: string }).command ?? '')
                patchSelected({ command: cur ? `${cur} ${v}` : v } as Partial<FlowRfData>)
              }}
            />
            <input
              placeholder="如：cargo test --no-fail-fast, npm run build"
              value={String((data as { command?: string }).command ?? '')}
              onChange={(e) => patchSelected({ command: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
        </>
      )}

      {data.nodeType === 'flow' && (
        <label className="flow-field">
          <span>引用已发布流程 ID</span>
          <input
            placeholder="输入或下拉选择子流程 ID"
            value={String((data as { flowId?: string }).flowId ?? '')}
            onChange={(e) => patchSelected({ flowId: e.target.value } as Partial<FlowRfData>)}
            list="flow-id-options"
          />
        </label>
      )}

      {data.nodeType === 'branch' && (
        <>
          <label className="flow-field">
            <span>分支判定条件</span>
            <select
              value={String((data as { condition?: string }).condition ?? 'success')}
              onChange={(e) => patchSelected({ condition: e.target.value } as Partial<FlowRfData>)}
            >
              <option value="success">按成功 (Exit 0 / success)</option>
              <option value="failure">按失败 (Error / failure)</option>
              <option value="expression">自定义表达式</option>
            </select>
          </label>
          <label className="flow-field">
            <span>条件表达式</span>
            <VariableChips
              onInsert={(v) => {
                const cur = String((data as { expression?: string }).expression ?? '')
                patchSelected({ expression: cur ? `${cur} ${v}` : v } as Partial<FlowRfData>)
              }}
            />
            <input
              placeholder="如：prev.success 或 prev.output.status == 'ok'"
              value={String((data as { expression?: string }).expression ?? '')}
              onChange={(e) => patchSelected({ expression: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
        </>
      )}

      {data.nodeType === 'parallel' && (
        <>
          <label className="flow-field">
            <span>并发执行模式</span>
            <select
              value={String((data as { mode?: string }).mode ?? 'all')}
              onChange={(e) => patchSelected({ mode: e.target.value } as Partial<FlowRfData>)}
            >
              <option value="all">并发全部分支 (All Branches)</option>
              <option value="race">竞态分发 (First Completed)</option>
            </select>
          </label>
          <div
            className="flow-field-hint"
            style={{
              marginTop: '6px',
              padding: '6px 8px',
              borderRadius: '6px',
              background: 'var(--surface-muted, #f3f4f6)',
              color: 'var(--text-secondary, #4b5563)',
              border: '1px solid var(--border-solid, #e5e7eb)',
              lineHeight: 1.4,
            }}
          >
            💡 <strong>编排规则</strong>：并行扇出的各个直接子分支应为单一 Agent / 工具节点，并直接连入「结果汇聚 (join)」网关。如需多步流水线，请先封装为子流程。
          </div>
        </>
      )}

      {data.nodeType === 'join' && (
        <label className="flow-field">
          <span>聚合合并模式</span>
          <select
            value={String((data as { mergeMode?: string }).mergeMode ?? 'merge_json')}
            onChange={(e) => patchSelected({ mergeMode: e.target.value } as Partial<FlowRfData>)}
          >
            <option value="merge_json">对象键值合并 (Merge JSON Map)</option>
            <option value="list">保留分支结果列表 (Results Array)</option>
            <option value="all_success">全部成功门禁 (All Success Gate)</option>
          </select>
        </label>
      )}

      {data.nodeType !== 'start' && (
        <button type="button" className="flow-btn" onClick={() => void onRerunFromNode(selected.id)}>
          从此节点重跑
        </button>
      )}
    </aside>
  )
}, (prev, next) => (
  prev.selected?.id === next.selected?.id &&
  prev.selected?.data === next.selected?.data &&
  prev.agents === next.agents &&
  prev.patchSelected === next.patchSelected &&
  prev.openBoundAgent === next.openBoundAgent &&
  prev.demoteToTrial === next.demoteToTrial &&
  prev.openPromote === next.openPromote &&
  prev.onRerunFromNode === next.onRerunFromNode
))
