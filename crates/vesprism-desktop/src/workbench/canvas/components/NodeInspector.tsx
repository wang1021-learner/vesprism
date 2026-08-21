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
  /** 当前节点的上游节点（点选式变量绑定用） */
  upstreamNodes: { id: string; label: string }[]
}

function FlowNumField({
  label,
  value,
  placeholder,
  onValue,
}: {
  label: string
  value: number
  placeholder?: string
  onValue: (v: number) => void
}) {
  return (
    <label className="flow-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        placeholder={placeholder}
        value={value > 0 ? String(value) : ''}
        onChange={(e) => {
          const raw = e.target.value.trim()
          onValue(raw === '' ? 0 : Number(raw))
        }}
      />
    </label>
  )
}

function VariableChips({
  onInsert,
  upstreamNodes,
}: {
  onInsert: (v: string) => void
  upstreamNodes: { id: string; label: string }[]
}) {
  const vars = [
    { label: '上游产物', val: '{{prev.output}}' },
    { label: '初始输入', val: '{{input}}' },
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
      {upstreamNodes.length > 0 && (
        <>
          <span
            style={{
              fontSize: '10.5px',
              color: 'var(--text-tertiary, #9ca3af)',
              alignSelf: 'center',
              marginLeft: '4px',
            }}
          >
            上游绑定:
          </span>
          {upstreamNodes.map((u) => (
            <button
              key={u.id}
              type="button"
              className="flow-var-chip"
              title={`插入 {{${u.id}.output}}（${u.label || u.id} 的输出）`}
              onClick={() => onInsert(`{{${u.id}.output}}`)}
              style={{
                padding: '2px 6px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono, monospace)',
                background: '#eef2ff',
                border: '1px solid #c7d2fe',
                borderRadius: '4px',
                color: '#4f46e5',
                cursor: 'pointer',
              }}
            >
              ↑ {u.label || u.id}
            </button>
          ))}
        </>
      )}
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
  upstreamNodes,
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
          <span>输入字段声明（格式：name:type，多个用逗号隔开；name 只允许字母数字下划线）</span>
          <input
            placeholder="如：phoneNumber:string, customerName:string, retryCount:number"
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
                  // 清洗：name 只保留标识符字符，防污染（如 `{"phoneNumber"`）
                  const clean = name.replace(/[^A-Za-z0-9_]/g, '')
                  const t = (['string', 'number', 'boolean', 'object', 'array'] as const).includes(type as never)
                    ? (type as SchemaField['type'])
                    : 'string'
                  return { name: clean, type: t, required: true }
                })
                .filter((f) => Boolean(f.name))
              patchSelected({ fields, inputSchema: fieldsToSchema(fields) } as Partial<FlowRfData>)
            }}
          />
          <p className="flow-field-hint">
            试跑参数按这些字段生成模板（工作栏「试跑参数」里填值）；节点内用{' '}
            <code>{'{{input.字段名}}'}</code> 引用，如 <code>{'{{input.phoneNumber}}'}</code>。
          </p>
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
              <VariableChips upstreamNodes={upstreamNodes}
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
            <FlowNumField
              label="最大输出 Token（空 = 不限制）"
              placeholder="如：4096"
              value={Number((data as { maxOutputTokens?: number }).maxOutputTokens) || 0}
              onValue={(v) => patchSelected({ maxOutputTokens: v } as Partial<FlowRfData>)}
            />
            <FlowNumField
              label="失败重试次数（0 = 不重试）"
              placeholder="如：2"
              value={Number((data as { retry?: number }).retry) || 0}
              onValue={(v) => patchSelected({ retry: v } as Partial<FlowRfData>)}
            />
            <FlowNumField
              label="超时秒数（0 = 不设，真超时）"
              placeholder="如：120"
              value={Number((data as { timeoutSecs?: number }).timeoutSecs) || 0}
              onValue={(v) => patchSelected({ timeoutSecs: v } as Partial<FlowRfData>)}
            />
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
            <VariableChips upstreamNodes={upstreamNodes}
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
          <FlowNumField
            label="失败重试次数（0 = 不重试）"
            placeholder="如：2"
            value={Number((data as { retry?: number }).retry) || 0}
            onValue={(v) => patchSelected({ retry: v } as Partial<FlowRfData>)}
          />
          <FlowNumField
            label="执行超时秒数（0 = 不设）"
            placeholder="如：60"
            value={Number((data as { timeoutSecs?: number }).timeoutSecs) || 0}
            onValue={(v) => patchSelected({ timeoutSecs: v } as Partial<FlowRfData>)}
          />
          <label className="flow-field">
            <span>输出 JSON Schema（可选，官方按它结构化输出）</span>
            <textarea
              rows={3}
              placeholder={'如：\n{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}'}
              value={(data as { outputSchema?: unknown }).outputSchema ? JSON.stringify((data as { outputSchema?: unknown }).outputSchema) : ''}
              onChange={(e) => {
                const raw = e.target.value.trim()
                if (!raw) {
                  patchSelected({ outputSchema: undefined } as Partial<FlowRfData>)
                  return
                }
                try {
                  patchSelected({ outputSchema: JSON.parse(raw) } as Partial<FlowRfData>)
                } catch {
                  // 非法 JSON：暂不写入，避免脏数据
                }
              }}
            />
          </label>
        </>
      )}

      {data.nodeType === 'http' && (
        <>
          <label className="flow-field">
            <span>请求 URL</span>
            <VariableChips upstreamNodes={upstreamNodes}
              onInsert={(v) => {
                const cur = String((data as { url?: string }).url ?? '')
                patchSelected({ url: cur ? `${cur}${v}` : v } as Partial<FlowRfData>)
              }}
            />
            <input
              placeholder="如：https://api.example.com/v1/items"
              value={String((data as { url?: string }).url ?? '')}
              onChange={(e) => patchSelected({ url: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <label className="flow-field">
            <span>请求方法</span>
            <select
              value={String((data as { method?: string }).method ?? 'GET')}
              onChange={(e) => patchSelected({ method: e.target.value } as Partial<FlowRfData>)}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
              <option value="HEAD">HEAD</option>
            </select>
          </label>
          <label className="flow-field">
            <span>请求头（每行一个 Name: value）</span>
            <VariableChips upstreamNodes={upstreamNodes}
              onInsert={(v) => {
                const cur = String((data as { headers?: string }).headers ?? '')
                patchSelected({ headers: cur ? `${cur}\n${v}` : v } as Partial<FlowRfData>)
              }}
            />
            <textarea
              rows={2}
              placeholder={'如：\nContent-Type: application/json\nAuthorization: Bearer {{start.input.token}}'}
              value={String((data as { headers?: string }).headers ?? '')}
              onChange={(e) => patchSelected({ headers: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <label className="flow-field">
            <span>请求体（JSON 文本）</span>
            <textarea
              rows={3}
              placeholder={'如：\n{"name": "{{prev.output.title}}", "done": false}'}
              value={String((data as { body?: string }).body ?? '')}
              onChange={(e) => patchSelected({ body: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <FlowNumField
            label="失败重试次数（0 = 不重试）"
            placeholder="如：2"
            value={Number((data as { retry?: number }).retry) || 0}
            onValue={(v) => patchSelected({ retry: v } as Partial<FlowRfData>)}
          />
          <FlowNumField
            label="请求超时秒数（0 = 不设）"
            placeholder="如：30"
            value={Number((data as { timeoutSecs?: number }).timeoutSecs) || 0}
            onValue={(v) => patchSelected({ timeoutSecs: v } as Partial<FlowRfData>)}
          />
          <label className="flow-field">
            <span>输出 JSON Schema（可选，官方按它结构化输出）</span>
            <textarea
              rows={3}
              placeholder={'如：\n{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}'}
              value={(data as { outputSchema?: unknown }).outputSchema ? JSON.stringify((data as { outputSchema?: unknown }).outputSchema) : ''}
              onChange={(e) => {
                const raw = e.target.value.trim()
                if (!raw) {
                  patchSelected({ outputSchema: undefined } as Partial<FlowRfData>)
                  return
                }
                try {
                  patchSelected({ outputSchema: JSON.parse(raw) } as Partial<FlowRfData>)
                } catch {
                  // 非法 JSON：暂不写入，避免脏数据
                }
              }}
            />
          </label>
        </>
      )}

      {data.nodeType === 'database' && (
        <>
          <label className="flow-field">
            <span>{'SQL 语句（支持 {{prev.output}} / {{input}} 引用）'}</span>
            <VariableChips upstreamNodes={upstreamNodes}
              onInsert={(v) => {
                const cur = String((data as { sql?: string }).sql ?? '')
                patchSelected({ sql: cur ? `${cur} ${v}` : v } as Partial<FlowRfData>)
              }}
            />
            <textarea
              rows={4}
              placeholder={'如：\nSELECT * FROM tasks WHERE owner = {{prev.output.id}}'}
              value={String((data as { sql?: string }).sql ?? '')}
              onChange={(e) => patchSelected({ sql: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <label className="flow-field">
            <span>SQLite 文件路径（空 = 默认库）</span>
            <input
              placeholder="如：C:\data\app.sqlite（默认 ~/.vesprism/mcp/db.sqlite）"
              value={String((data as { dbPath?: string }).dbPath ?? '')}
              onChange={(e) => patchSelected({ dbPath: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <FlowNumField
            label="失败重试次数（0 = 不重试）"
            placeholder="如：1"
            value={Number((data as { retry?: number }).retry) || 0}
            onValue={(v) => patchSelected({ retry: v } as Partial<FlowRfData>)}
          />
        </>
      )}

      {data.nodeType === 'knowledge' && (
        <>
          <label className="flow-field">
            <span>知识库名（~/.vesprism/knowledge/&lt;名&gt;/ 目录）</span>
            <input
              placeholder="如：project-docs"
              value={String((data as { knowledgeBase?: string }).knowledgeBase ?? '')}
              onChange={(e) => patchSelected({ knowledgeBase: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <label className="flow-field">
            <span>{'检索词（FTS5 语法，支持 {{}} 引用）'}</span>
            <VariableChips upstreamNodes={upstreamNodes}
              onInsert={(v) => {
                const cur = String((data as { query?: string }).query ?? '')
                patchSelected({ query: cur ? `${cur} ${v}` : v } as Partial<FlowRfData>)
              }}
            />
            <input
              placeholder="如：重试 OR 超时"
              value={String((data as { query?: string }).query ?? '')}
              onChange={(e) => patchSelected({ query: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <FlowNumField
            label="最多返回片段数"
            placeholder="如：5"
            value={Number((data as { limit?: number }).limit) || 0}
            onValue={(v) => patchSelected({ limit: v } as Partial<FlowRfData>)}
          />
          <FlowNumField
            label="失败重试次数（0 = 不重试）"
            placeholder="如：1"
            value={Number((data as { retry?: number }).retry) || 0}
            onValue={(v) => patchSelected({ retry: v } as Partial<FlowRfData>)}
          />
        </>
      )}

      {data.nodeType === 'variable' && (
        <>
          <label className="flow-field">
            <span>值类型</span>
            <select
              value={String((data as { valueType?: string }).valueType ?? 'string')}
              onChange={(e) => patchSelected({ valueType: e.target.value } as Partial<FlowRfData>)}
            >
              <option value="string">字符串</option>
              <option value="number">数字</option>
              <option value="boolean">布尔</option>
              <option value="json">JSON</option>
            </select>
          </label>
          <label className="flow-field">
            <span>{'值（支持 {{prev.output}} / {{input}} 引用）'}</span>
            <VariableChips upstreamNodes={upstreamNodes}
              onInsert={(v) => {
                const cur = String((data as { value?: string }).value ?? '')
                patchSelected({ value: cur ? `${cur}${v}` : v } as Partial<FlowRfData>)
              }}
            />
            <textarea
              rows={3}
              placeholder={'如：https://api.example.com/{{prev.output.id}}  或  {"key": "{{input.token}}"}'}
              value={String((data as { value?: string }).value ?? '')}
              onChange={(e) => patchSelected({ value: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
        </>
      )}

      {data.nodeType === 'transform' && (
        <>
          <label className="flow-field">
            <span>Rhai 表达式（input = 上一步输出）</span>
            <VariableChips upstreamNodes={upstreamNodes}
              onInsert={(v) => {
                const cur = String((data as { code?: string }).code ?? '')
                patchSelected({ code: cur ? `${cur} ${v}` : v } as Partial<FlowRfData>)
              }}
            />
            <textarea
              rows={5}
              placeholder={'如：\ninput.items.map(|x| #{ name: x.name, score: x.score * 2 })'}
              value={String((data as { code?: string }).code ?? '')}
              onChange={(e) => patchSelected({ code: e.target.value } as Partial<FlowRfData>)}
            />
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
            💡 表达式在本机官方引擎里真实执行；异常会立即终止流程并报错。不要在此写 agent()/parallel() 调用。
          </div>
        </>
      )}

      {data.nodeType === 'loop' && (
        <div
          className="flow-field-hint"
          style={{
            padding: '8px 10px',
            borderRadius: '6px',
            background: 'var(--surface-muted, #f3f4f6)',
            color: 'var(--text-secondary, #4b5563)',
            border: '1px solid var(--border-solid, #e5e7eb)',
            lineHeight: 1.5,
          }}
        >
          💡 遍历上游输出的数组，对每个元素执行一次循环体；循环体必须是单个可执行节点（Agent/工具/HTTP/变量/代码），并直连「迭代汇聚」。循环体内用 <strong>{'{{prev.output}}'}</strong> 引用当前元素。
        </div>
      )}

      {data.nodeType === 'loop_end' && (
        <div
          className="flow-field-hint"
          style={{
            padding: '8px 10px',
            borderRadius: '6px',
            background: 'var(--surface-muted, #f3f4f6)',
            color: 'var(--text-secondary, #4b5563)',
            border: '1px solid var(--border-solid, #e5e7eb)',
            lineHeight: 1.5,
          }}
        >
          💡 迭代汇聚输出循环收集的结果数组（顺序与输入数组一致）。循环体失败会立即终止整个流程并报错。
        </div>
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
            <VariableChips upstreamNodes={upstreamNodes}
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
  prev.onRerunFromNode === next.onRerunFromNode &&
  prev.upstreamNodes === next.upstreamNodes
))
