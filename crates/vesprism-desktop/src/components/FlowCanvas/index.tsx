/**
 * 流程画布（懒加载入口）。@xyflow/react 只在进入本 Tab 时下载。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '@nanostores/react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { $activeTabId, $generating, $messages, $workflows, getTabState, pushToast } from '../../store'
import {
  deleteFlow,
  exportFlow,
  getFlow,
  importFlow,
  listFlows,
  saveFlow,
  sendPrompt,
} from '../../bridge'
import {
  AI_GRAPH_FAIL_MESSAGE,
  NODE_LIBRARY,
  buildGeneratePrompt,
  bumpVersion,
  collectDependencies,
  collectPromptsMarkdown,
  compileInlinedRhai,
  compileToRhai,
  createDemoDraft,
  createNodeId,
  defaultParams,
  draftFromGraph,
  draftHasAbsolutePath,
  fieldsToSchema,
  isValidFlowId,
  layoutGraph,
  parseGeneratedGraph,
  slugifyFlowId,
  subgraphFrom,
  summarizeInputSchema,
  summarizeOutputSchema,
  type FlowDraft,
  type FlowGraphNode,
  type FlowListItem,
  type FlowNodeType,
  type FlowRunStep,
  type ImportFlowResult,
  type SchemaField,
} from '../../lib/flow'
import { WorkflowProgressList } from '../WorkflowProgressList'
import { TerminalList } from '../TerminalList'
import { flowNodeTypes, type FlowRfData } from './nodes'

type RfNode = Node<FlowRfData>
type RfEdge = Edge

function ensurePositions(nodes: FlowDraft['nodes'], edges: FlowDraft['edges']): FlowDraft['nodes'] {
  if (nodes.every((n) => n.position)) return nodes
  return layoutGraph({
    nodes: nodes.map(({ id, type, params }) => ({ id, type, params })),
    edges: edges.map(({ from, to, label }) => ({ from, to, label })),
  })
}

function toRfNodes(draft: FlowDraft): RfNode[] {
  return ensurePositions(draft.nodes, draft.edges).map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position ?? { x: 80, y: 80 },
    data: { ...n.params, nodeType: n.type },
  }))
}

function toRfEdges(draft: FlowDraft): RfEdge[] {
  return draft.edges.map((e, i) => ({
    id: e.id || `e-${e.from}-${e.to}-${i}`,
    source: e.from,
    target: e.to,
    label: e.label,
    sourceHandle: /fail/i.test(e.label || '') ? 'failure' : /success|ok|yes/i.test(e.label || '') ? 'success' : undefined,
  }))
}

function fromRf(nodes: RfNode[], edges: RfEdge[], base: FlowDraft): FlowDraft {
  const nextNodes: FlowGraphNode[] = nodes.map((n) => {
    const { nodeType, ...rest } = n.data
    return {
      id: n.id,
      type: (n.type as FlowNodeType) || nodeType,
      position: n.position,
      params: rest as FlowGraphNode['params'],
    }
  })
  return {
    ...base,
    nodes: nextNodes,
    edges: edges.map((e) => ({
      id: e.id,
      from: e.source,
      to: e.target,
      label: typeof e.label === 'string' ? e.label : undefined,
    })),
    input_schema: summarizeInputSchema(nextNodes),
    output_schema: summarizeOutputSchema(nextNodes),
    dirty: true,
  }
}

function testKey(id: string): string {
  return `vesprism.flow-test.${id}`
}

function FlowCanvasInner() {
  const tabId = useStore($activeTabId)
  const generating = useStore($generating)
  const messages = useStore($messages)
  const workflows = useStore($workflows)
  const { screenToFlowPosition } = useReactFlow()

  const [draft, setDraft] = useState<FlowDraft>(createDemoDraft)
  const [nodes, setNodes, onNodesChange] = useNodesState<RfNode>(toRfNodes(createDemoDraft()))
  const [edges, setEdges, onEdgesChange] = useEdgesState<RfEdge>(toRfEdges(createDemoDraft()))
  const [list, setList] = useState<FlowListItem[]>([])
  const [dockOpen, setDockOpen] = useState(true)
  const [publishOpen, setPublishOpen] = useState(false)
  const [pubDesc, setPubDesc] = useState('')
  const [pubVersion, setPubVersion] = useState('1')
  const [pubIn, setPubIn] = useState('')
  const [pubOut, setPubOut] = useState('')
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [testInput, setTestInput] = useState('{\n  "input": ""\n}')
  const [runSteps, setRunSteps] = useState<FlowRunStep[]>([])
  const [replayOpen, setReplayOpen] = useState(false)
  const [conflict, setConflict] = useState<Extract<ImportFlowResult, { status: 'conflict' }> | null>(null)
  const [pendingZip, setPendingZip] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const saveTimer = useRef<number>(0)
  const aiWait = useRef<{ before: number } | null>(null)

  const applyDraft = useCallback((next: FlowDraft, markDirty = true) => {
    const d = { ...next, dirty: markDirty ? true : next.dirty }
    setDraft(d)
    setNodes(toRfNodes(d))
    setEdges(toRfEdges(d))
  }, [setNodes, setEdges])

  const reloadList = useCallback(async () => {
    try {
      setList(await listFlows())
    } catch {
      /* 未进桌面壳时忽略 */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await reloadList()
      const last = localStorage.getItem('vesprism.flow-canvas.lastId') || 'demo-linear'
      try {
        const rec = await getFlow(last)
        if (cancelled) return
        const nodes = Array.isArray(rec.nodes) ? rec.nodes : []
        const edges = Array.isArray(rec.edges) ? rec.edges : []
        if (nodes.length === 0) {
          applyDraft(createDemoDraft(), false)
          return
        }
        applyDraft(
          {
            id: rec.id,
            name: rec.name,
            description: rec.description,
            version: rec.version,
            input_schema: rec.input_schema as FlowDraft['input_schema'],
            output_schema: rec.output_schema as FlowDraft['output_schema'],
            nodes: nodes as FlowDraft['nodes'],
            edges: edges as FlowDraft['edges'],
            published: rec.published,
            dirty: false,
          },
          false,
        )
      } catch {
        if (!cancelled) applyDraft(createDemoDraft(), false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applyDraft, reloadList])

  const persist = useCallback(
    async (d: FlowDraft, extra?: { publish?: boolean; stage?: boolean; rhai?: string }) => {
      let rhai = extra?.rhai
      if (!rhai && (extra?.publish || extra?.stage)) {
        const catalog: Record<string, { nodes: FlowDraft['nodes']; edges: FlowDraft['edges'] }> = {}
        for (const it of list) {
          if (it.id === d.id) continue
          try {
            const rec = await getFlow(it.id)
            if (Array.isArray(rec.nodes) && rec.nodes.length) {
              catalog[it.id] = {
                nodes: rec.nodes as FlowDraft['nodes'],
                edges: (rec.edges ?? []) as FlowDraft['edges'],
              }
            }
          } catch {
            /* 列表项可能已删 */
          }
        }
        const compiled = compileInlinedRhai(d, catalog, compileToRhai)
        if (!compiled.ok) throw new Error(compiled.error)
        rhai = compiled.rhai
      } else if (!rhai) {
        rhai = compileToRhai(d)
      }
      const saved = await saveFlow({
        id: d.id,
        name: d.name,
        description: d.description,
        version: d.version,
        input_schema: d.input_schema,
        output_schema: d.output_schema,
        nodes: d.nodes,
        edges: d.edges,
        publish: extra?.publish ?? false,
        stage: extra?.stage ?? false,
        rhai,
        prompts: collectPromptsMarkdown(d),
      })
      localStorage.setItem('vesprism.flow-canvas.lastId', saved.id)
      setDraft((prev) => ({ ...prev, dirty: false, published: saved.published, version: saved.version }))
      await reloadList()
      return saved
    },
    [list, reloadList],
  )

  useEffect(() => {
    if (!draft.dirty) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void persist(draft).catch((e) => pushToast(`保存草稿失败：${String(e)}`, 'error'))
    }, 700)
    return () => window.clearTimeout(saveTimer.current)
  }, [draft, persist])

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) => addEdge({ ...c, label: c.sourceHandle === 'failure' ? 'failure' : c.sourceHandle === 'success' ? 'success' : undefined }, eds))
      setDraft((d) => ({ ...d, dirty: true }))
    },
    [setEdges],
  )

  const commitGraph = useCallback(
    (ns: RfNode[], es: RfEdge[]) => {
      setDraft((d) => fromRf(ns, es, d))
    },
    [],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const type = e.dataTransfer.getData('application/vesprism-node') as FlowNodeType
      if (!type) return
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const id = createNodeId(type)
      const node: RfNode = {
        id,
        type,
        position: pos,
        data: { ...defaultParams(type), nodeType: type },
      }
      setNodes((ns) => {
        const next = [...ns, node]
        setEdges((es) => {
          commitGraph(next, es)
          return es
        })
        return next
      })
    },
    [commitGraph, screenToFlowPosition, setEdges, setNodes],
  )

  const selected = nodes.find((n) => n.id === selectedId) ?? null

  const patchSelected = (patch: Partial<FlowRfData>) => {
    if (!selected) return
    setNodes((ns) => {
      const next = ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n))
      setEdges((es) => {
        commitGraph(next, es)
        return es
      })
      return next
    })
  }

  const openPublish = () => {
    const current = fromRf(nodes, edges, draft)
    setPubDesc(current.description)
    setPubVersion(current.published ? bumpVersion(current.version) : current.version || '1')
    setPubIn(JSON.stringify(current.input_schema, null, 2))
    setPubOut(JSON.stringify(current.output_schema, null, 2))
    setPublishOpen(true)
  }

  const doPublish = async () => {
    if (!pubDesc.trim()) return
    const current = fromRf(nodes, edges, { ...draft, description: pubDesc.trim(), version: pubVersion })
    const abs = draftHasAbsolutePath(current)
    if (abs) {
      pushToast(abs, 'error')
      return
    }
    try {
      current.input_schema = JSON.parse(pubIn)
      current.output_schema = JSON.parse(pubOut)
    } catch {
      pushToast('输入/输出 Schema 不是合法 JSON', 'error')
      return
    }
    const missing = collectDependencies(current.nodes)
    try {
      await persist({ ...current, description: pubDesc.trim(), version: pubVersion }, { publish: true })
      setDraft((d) => ({ ...d, description: pubDesc.trim(), version: pubVersion, published: true, dirty: false }))
      setPublishOpen(false)
      pushToast(missing.length ? `已发布（依赖：${missing.join(', ')}）` : '已发布', 'success')
    } catch (e) {
      pushToast(String(e), 'error')
    }
  }

  const startRun = async (fromNodeId?: string) => {
    let current = fromRf(nodes, edges, draft)
    if (fromNodeId) {
      const sub = subgraphFrom(current.nodes, current.edges, fromNodeId)
      current = { ...current, id: `${current.id}-rerun`, nodes: sub.nodes, edges: sub.edges }
    }
    if (!isValidFlowId(current.id) && !fromNodeId) {
      pushToast('流程 id 不合法，请先在发布弹窗确认 id', 'error')
      return
    }
    let input: unknown = {}
    try {
      input = testInput.trim() ? JSON.parse(testInput) : {}
    } catch {
      pushToast('测试输入不是合法 JSON', 'error')
      return
    }
    const steps: FlowRunStep[] = current.nodes.map((n) => ({
      nodeId: n.id,
      label: String((n.params as { label?: string }).label || n.id),
      type: n.type,
      status: 'pending',
    }))
    setRunSteps(steps)
    setReplayOpen(true)
    setDockOpen(true)
    try {
      const rhai = compileToRhai(current)
      await persist(fromNodeId ? draft : current, { stage: true, rhai: fromNodeId ? rhai : undefined })
      if (fromNodeId) {
        await saveFlow({
          id: current.id,
          name: current.name,
          description: current.description || current.name,
          version: current.version,
          nodes: current.nodes,
          edges: current.edges,
          stage: true,
          rhai,
        })
      }
      const arg = Object.keys(input as object).length ? ` ${JSON.stringify(input)}` : ''
      await sendPrompt(tabId, `/${fromNodeId ? current.id : draft.id}${arg}`)
      setRunSteps((prev) => prev.map((s) => (s.type === 'start' ? { ...s, status: 'running', startedAt: Date.now() } : s)))
      pushToast('已提交试跑', 'success')
    } catch (e) {
      pushToast(`试跑失败：${String(e)}`, 'error')
    }
  }

  useEffect(() => {
    const items = Object.values(workflows)
    if (items.length === 0 || runSteps.length === 0) return
    const latest = items[items.length - 1]
    setRunSteps((prev) =>
      prev.map((s) => {
        const phase = latest.phases.find((p) => p.title === s.label || p.title.includes(s.nodeId))
        if (!phase) return s
        const status =
          phase.state === 'completed'
            ? 'completed'
            : phase.state === 'running'
              ? 'running'
              : phase.state === 'failed'
                ? 'failed'
                : s.status
        return { ...s, status, output: latest.lastEventDetail || s.output }
      }),
    )
  }, [workflows, runSteps.length])

  const doExport = async () => {
    const current = fromRf(nodes, edges, draft)
    if (!current.description.trim()) {
      pushToast('导出前请先填写「给 agent 看的说明」并发布', 'error')
      return
    }
    try {
      await persist(current, { publish: true })
      const dest = await save({
        defaultPath: `${current.id}.zip`,
        filters: [{ name: '流程包', extensions: ['zip'] }],
      })
      if (!dest) return
      const path = await exportFlow(current.id, dest)
      pushToast(`已导出 ${path}`, 'success')
    } catch (e) {
      pushToast(String(e), 'error')
    }
  }

  const finishImport = async (zip: string, mode?: string) => {
    try {
      const r = await importFlow(zip, mode)
      if (r.status === 'conflict') {
        setPendingZip(zip)
        setConflict(r)
        return
      }
      if (r.status === 'missing_deps') {
        pushToast(`缺少依赖流程：${r.missing.join(', ')}`, 'error')
        return
      }
      if (r.status === 'cancelled') return
      setConflict(null)
      setPendingZip('')
      const rec = await getFlow(r.id)
      applyDraft(
        {
          id: rec.id,
          name: rec.name,
          description: rec.description,
          version: rec.version,
          input_schema: rec.input_schema as FlowDraft['input_schema'],
          output_schema: rec.output_schema as FlowDraft['output_schema'],
          nodes: rec.nodes as FlowDraft['nodes'],
          edges: rec.edges as FlowDraft['edges'],
          published: true,
          dirty: false,
        },
        false,
      )
      pushToast(`已导入 ${r.id}`, 'success')
      await reloadList()
    } catch (e) {
      pushToast(String(e), 'error')
    }
  }

  const doImport = async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: '流程包', extensions: ['zip'] }],
    })
    if (!picked || Array.isArray(picked)) return
    await finishImport(picked)
  }

  const doCopy = () => {
    const current = fromRf(nodes, edges, draft)
    const id = `${slugifyFlowId(current.id)}-copy`
    applyDraft({ ...current, id, name: `${current.name} 副本`, published: false, dirty: true, version: '1' })
    pushToast(`已复制为 ${id}`, 'success')
  }

  const doDelete = async () => {
    if (!window.confirm(`删除流程 ${draft.id}？草稿与已发布包都会移除。`)) return
    try {
      await deleteFlow(draft.id)
      applyDraft(createDemoDraft(), false)
      pushToast('已删除', 'success')
      await reloadList()
    } catch (e) {
      pushToast(String(e), 'error')
    }
  }

  const onGenerate = async () => {
    const text = aiText.trim()
    if (!text || !tabId) return
    setAiBusy(true)
    setAiError('')
    const before = getTabState(tabId)?.messages.length ?? messages.length
    aiWait.current = { before }
    try {
      await sendPrompt(tabId, buildGeneratePrompt(text))
    } catch (e) {
      setAiBusy(false)
      setAiError(String(e))
      pushToast(AI_GRAPH_FAIL_MESSAGE, 'error')
    }
  }

  useEffect(() => {
    if (!aiBusy || generating) return
    const wait = aiWait.current
    if (!wait) return
    const added = messages.slice(wait.before).filter((m) => m.role === 'assistant').slice(-1)[0]
    aiWait.current = null
    setAiBusy(false)
    if (!added?.text) {
      setAiError(AI_GRAPH_FAIL_MESSAGE)
      pushToast(AI_GRAPH_FAIL_MESSAGE, 'error')
      return
    }
    const parsed = parseGeneratedGraph(added.text)
    if (!parsed.ok) {
      setAiError(parsed.error)
      pushToast(parsed.error, 'error')
      return
    }
    const next = draftFromGraph(parsed.graph, {
      id: draft.id,
      name: draft.name,
      description: draft.description,
      version: draft.version,
    })
    applyDraft(next, true)
    setAiText('')
    pushToast('已生成草稿（未发布）', 'success')
  }, [aiBusy, generating, messages, applyDraft, draft.id, draft.name, draft.description, draft.version])

  const saveTestCase = () => {
    localStorage.setItem(testKey(draft.id), testInput)
    pushToast('已保存测试用例', 'success')
  }

  useEffect(() => {
    const saved = localStorage.getItem(testKey(draft.id))
    if (saved) setTestInput(saved)
  }, [draft.id])

  const canPublish = pubDesc.trim().length > 0

  const inspector = selected ? (
    <aside className="flow-inspector" aria-label="节点属性">
      <h3>{selected.data.nodeType}</h3>
      <label className="flow-field">
        <span>显示名</span>
        <input value={String(selected.data.label ?? '')} onChange={(e) => patchSelected({ label: e.target.value })} />
      </label>
      {selected.data.nodeType === 'start' && (
        <label className="flow-field">
          <span>输入字段（name:type，逗号分隔）</span>
          <input
            value={((selected.data as { fields?: SchemaField[] }).fields ?? [])
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
      {selected.data.nodeType === 'agent' && (
        <>
          <label className="flow-field">
            <span>组装单 preset id</span>
            <input
              value={String((selected.data as { presetId?: string }).presetId ?? '')}
              onChange={(e) => patchSelected({ presetId: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <label className="flow-field">
            <span>角色说明</span>
            <textarea
              value={String((selected.data as { role?: string }).role ?? '')}
              onChange={(e) => patchSelected({ role: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <label className="flow-field">
            <span>模型（空=继承）</span>
            <input
              value={String((selected.data as { model?: string }).model ?? '')}
              onChange={(e) => patchSelected({ model: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <label className="flow-field">
            <span>提示词</span>
            <textarea
              value={String((selected.data as { prompt?: string }).prompt ?? '')}
              onChange={(e) => patchSelected({ prompt: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
        </>
      )}
      {selected.data.nodeType === 'tool' && (
        <>
          <label className="flow-field">
            <span>工具名</span>
            <input
              value={String((selected.data as { toolName?: string }).toolName ?? '')}
              onChange={(e) => patchSelected({ toolName: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <label className="flow-field">
            <span>命令</span>
            <input
              value={String((selected.data as { command?: string }).command ?? '')}
              onChange={(e) => patchSelected({ command: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
        </>
      )}
      {selected.data.nodeType === 'flow' && (
        <label className="flow-field">
          <span>已发布流程 id</span>
          <input
            value={String((selected.data as { flowId?: string }).flowId ?? '')}
            onChange={(e) => patchSelected({ flowId: e.target.value } as Partial<FlowRfData>)}
            list="flow-id-options"
          />
        </label>
      )}
      {selected.data.nodeType === 'branch' && (
        <>
          <label className="flow-field">
            <span>条件</span>
            <select
              value={String((selected.data as { condition?: string }).condition ?? 'success')}
              onChange={(e) => patchSelected({ condition: e.target.value } as Partial<FlowRfData>)}
            >
              <option value="success">成功</option>
              <option value="failure">失败</option>
              <option value="expression">表达式</option>
            </select>
          </label>
          <label className="flow-field">
            <span>表达式（prev.success 等）</span>
            <input
              value={String((selected.data as { expression?: string }).expression ?? '')}
              onChange={(e) => patchSelected({ expression: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
        </>
      )}
      {selected.data.nodeType !== 'start' && (
        <button type="button" className="flow-btn" onClick={() => void startRun(selected.id)}>
          从此节点重跑
        </button>
      )}
    </aside>
  ) : null

  const idOptions = useMemo(
    () => list.filter((x) => x.published).map((x) => x.id),
    [list],
  )

  return (
    <div className="flow-canvas" role="region" aria-label="流程画布">
      <header className="flow-toolbar">
        <div className="flow-toolbar-name">
          <input
            value={draft.name}
            aria-label="流程名"
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value, dirty: true }))}
          />
          {draft.dirty ? <span className="flow-dirty">未保存</span> : null}
          <span className="flow-ver">v{draft.version}</span>
          <select
            className="flow-btn"
            value={draft.id}
            aria-label="切换流程"
            onChange={(e) => {
              const id = e.target.value
              if (id === draft.id) return
              void getFlow(id)
                .then((rec) =>
                  applyDraft(
                    {
                      id: rec.id,
                      name: rec.name,
                      description: rec.description,
                      version: rec.version,
                      input_schema: rec.input_schema as FlowDraft['input_schema'],
                      output_schema: rec.output_schema as FlowDraft['output_schema'],
                      nodes: rec.nodes as FlowDraft['nodes'],
                      edges: rec.edges as FlowDraft['edges'],
                      published: rec.published,
                      dirty: false,
                    },
                    false,
                  ),
                )
                .catch(() => pushToast('打开失败', 'error'))
            }}
          >
            <option value={draft.id}>{draft.id}</option>
            {list
              .filter((x) => x.id !== draft.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.id})
                </option>
              ))}
          </select>
        </div>
        <div className="flow-toolbar-actions">
          <button type="button" className="flow-btn primary" onClick={() => void startRun()}>
            试跑
          </button>
          <button type="button" className="flow-btn primary" onClick={openPublish}>
            发布
          </button>
          <button type="button" className="flow-btn" onClick={() => void doExport()}>
            导出
          </button>
          <button type="button" className="flow-btn" onClick={() => void doImport()}>
            导入
          </button>
          <button type="button" className="flow-btn" onClick={doCopy}>
            复制
          </button>
          <button type="button" className="flow-btn danger" onClick={() => void doDelete()}>
            删除
          </button>
          <button type="button" className="flow-btn" onClick={() => setDockOpen((v) => !v)}>
            {dockOpen ? '收起试跑台' : '试跑台'}
          </button>
        </div>
      </header>

      <div className="flow-body">
        <aside className="flow-palette" aria-label="节点库">
          <div className="flow-palette-title">节点库</div>
          {NODE_LIBRARY.map((item) => (
            <button
              key={item.type}
              type="button"
              className="flow-palette-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/vesprism-node', item.type)
                e.dataTransfer.effectAllowed = 'move'
              }}
            >
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </aside>

        <div className="flow-stage">
          <div className="flow-stage-canvas">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStop={() => commitGraph(nodes, edges)}
              onSelectionChange={({ nodes: ns }) => setSelectedId(ns[0]?.id ?? null)}
              onDrop={onDrop}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              nodeTypes={flowNodeTypes}
              fitView
              deleteKeyCode={['Backspace', 'Delete']}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={18} size={1} />
              <MiniMap pannable zoomable />
              <Controls />
            </ReactFlow>
          </div>
          {inspector}
          <div className="flow-ai">
            <div className="composer-card">
              <div className="flow-ai-row">
                <textarea
                  rows={2}
                  value={aiText}
                  disabled={aiBusy || generating}
                  placeholder="用一句话描述流程，生成节点图（只改草稿，不会发布）"
                  onChange={(e) => setAiText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void onGenerate()
                    }
                  }}
                />
                <button
                  type="button"
                  className="flow-btn primary"
                  disabled={aiBusy || generating || !aiText.trim()}
                  onClick={() => void onGenerate()}
                >
                  {aiBusy || generating ? '生成中…' : '生成'}
                </button>
              </div>
              {aiError ? <div className="flow-err">{aiError}</div> : null}
            </div>
          </div>
        </div>

        <aside className={`flow-dock${dockOpen ? '' : ' is-collapsed'}`} aria-label="试跑台">
          <div className="flow-dock-head">
            <span>{dockOpen ? '试跑台' : ''}</span>
            <button type="button" className="flow-btn" onClick={() => setDockOpen((v) => !v)}>
              {dockOpen ? '收起' : '›'}
            </button>
          </div>
          {dockOpen && (
            <div className="flow-dock-body">
              <label className="flow-field">
                <span>测试输入（JSON）</span>
                <textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} rows={6} />
              </label>
              <div className="flow-toolbar-actions">
                <button type="button" className="flow-btn primary" onClick={() => void startRun()}>
                  试跑
                </button>
                <button type="button" className="flow-btn" onClick={saveTestCase}>
                  保存测试用例
                </button>
                <button type="button" className="flow-btn" onClick={() => setReplayOpen((v) => !v)}>
                  {replayOpen ? '隐藏回放' : '回放'}
                </button>
              </div>
              <WorkflowProgressList />
              <TerminalList />
              {replayOpen && (
                <div className="flow-replay" aria-label="回放时间线">
                  {runSteps.length === 0 ? (
                    <div className="flow-replay-meta">尚无试跑记录</div>
                  ) : (
                    runSteps.map((s) => (
                      <div key={s.nodeId} className={`flow-replay-item is-${s.status}`}>
                        <div>
                          {s.label} · {s.type} · {s.status}
                          <button
                            type="button"
                            className="flow-btn"
                            style={{ marginLeft: 8, height: 22 }}
                            onClick={() => void startRun(s.nodeId)}
                          >
                            重跑
                          </button>
                        </div>
                        {s.output ? <pre className="flow-replay-out">{s.output}</pre> : null}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      <datalist id="flow-id-options">
        {idOptions.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>

      {publishOpen && (
        <div className="flow-modal-back" role="dialog" aria-modal="true" aria-label="发布流程">
          <div className="flow-modal">
            <h2>发布流程包</h2>
            <label className="flow-field">
              <span>流程名</span>
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value, dirty: true }))} />
            </label>
            <label className="flow-field">
              <span>id</span>
              <input
                value={draft.id}
                onChange={(e) => setDraft((d) => ({ ...d, id: slugifyFlowId(e.target.value), dirty: true }))}
              />
            </label>
            <label className="flow-field">
              <span>给 agent 看的说明（必填）</span>
              <textarea value={pubDesc} onChange={(e) => setPubDesc(e.target.value)} rows={4} />
            </label>
            <label className="flow-field">
              <span>版本号</span>
              <input value={pubVersion} onChange={(e) => setPubVersion(e.target.value)} />
            </label>
            <label className="flow-field">
              <span>输入 Schema</span>
              <textarea value={pubIn} onChange={(e) => setPubIn(e.target.value)} rows={4} />
            </label>
            <label className="flow-field">
              <span>输出 Schema</span>
              <textarea value={pubOut} onChange={(e) => setPubOut(e.target.value)} rows={4} />
            </label>
            <div className="flow-modal-actions">
              <button type="button" className="flow-btn" onClick={() => setPublishOpen(false)}>
                取消
              </button>
              <button type="button" className="flow-btn primary" disabled={!canPublish} onClick={() => void doPublish()}>
                发布
              </button>
            </div>
          </div>
        </div>
      )}

      {conflict && (
        <div className="flow-modal-back" role="dialog" aria-modal="true" aria-label="导入撞名">
          <div className="flow-modal">
            <h2>已存在 {conflict.id} v{conflict.existing_version}</h2>
            <p>本次导入为 v{conflict.incoming_version}。覆盖 / 并存 / 取消？</p>
            <div className="flow-modal-actions">
              <button type="button" className="flow-btn" onClick={() => void finishImport(pendingZip, 'cancel')}>
                取消
              </button>
              <button type="button" className="flow-btn" onClick={() => void finishImport(pendingZip, 'keep-both')}>
                并存
              </button>
              <button type="button" className="flow-btn primary" onClick={() => void finishImport(pendingZip, 'overwrite')}>
                覆盖
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  )
}
