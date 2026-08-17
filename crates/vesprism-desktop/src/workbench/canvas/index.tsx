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
import { $activeTabId, $generating, $messages, $workflows, getTabState, patchTab, pushToast } from '../../store'
import { sendPrompt } from '../../bridge'
import { openChatTab } from '../../lib/openChatTab'
import {
  deleteFlow,
  exportFlow,
  getFlow,
  importFlow,
  listAgents,
  listFlows,
  saveAgent,
  saveFlow,
} from '../bridge'
import {
  AI_GRAPH_FAIL_MESSAGE,
  NODE_LIBRARY,
  buildGeneratePrompt,
  bumpVersion,
  collectPromptsMarkdown,
  compileInlinedRhai,
  compileToRhai,
  createDemoDraft,
  graphJsonFromDraft,
  createNodeId,
  defaultParams,
  draftFromGraph,
  draftHasAbsolutePath,
  fieldsToSchema,
  isValidFlowId,
  layoutGraph,
  parseGeneratedGraph,
  validateFlowGraph,
  slugifyFlowId,
  subgraphFrom,
  summarizeInputSchema,
  summarizeOutputSchema,
  type FlowDraft,
  type FlowGraphNode,
  type FlowListItem,
  type FlowNodeType,
  type FlowRequirements,
  type FlowRunStep,
  type ImportFlowResult,
  type SchemaField,
  type PresetResolve,
} from '../flow'
import {
  AGENT_CAPABILITY_LABEL,
  AGENT_CAPABILITY_OFFICIAL,
  emptyAgent,
  isValidAgentId,
  slugifyAgentId,
  type AgentListItem,
  type AgentRecord,
} from '../types'
import { requestAgentsFocus } from '../agents/focus'
import { noteGenerateProgress, type GenerateWait } from '../generateWait'
import { SubagentRunTree } from '../../components/SubagentRunTree'
import { TerminalList } from '../../components/TerminalList'
import { FlowNode, type FlowRfData } from './nodes'

const flowNodeTypes = {
  start: FlowNode,
  agent: FlowNode,
  tool: FlowNode,
  flow: FlowNode,
  branch: FlowNode,
  end: FlowNode,
}

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

function agentNodeData(agent: AgentListItem): FlowRfData {
  return {
    ...defaultParams('agent'),
    nodeType: 'agent',
    label: (agent.name || agent.id).trim(),
    presetId: agent.id,
  }
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
  const [agents, setAgents] = useState<AgentListItem[]>([])
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
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [promoteId, setPromoteId] = useState('')
  const [promoteName, setPromoteName] = useState('')
  const [promoteDesc, setPromoteDesc] = useState('')
  const [promoteBusy, setPromoteBusy] = useState(false)
  const [review, setReview] = useState<{
    id: string
    requirements: FlowRequirements
    missingTools: string[]
  } | null>(null)
  const saveTimer = useRef<number>(0)
  const aiWait = useRef<GenerateWait | null>(null)

  useEffect(() => {
    if (!tabId) return
    const st = getTabState(tabId)
    if (st?.utilityKind === 'flow-canvas' && st.chatTitle !== '流程画布') {
      patchTab(tabId, { chatTitle: '流程画布' })
    }
  }, [tabId])

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
    try {
      setAgents(await listAgents())
    } catch {
      /* 工作台 Agent 目录为空或不在桌面壳 */
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
        const graph = validateFlowGraph(graphJsonFromDraft(d))
        if (!graph.ok) {
          throw new Error('流程图不合法：非分支只能有 1 条出边，分支必须恰好 2 条')
        }
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
        const presets: Record<string, PresetResolve> = {}
        try {
          for (const a of await listAgents()) {
            presets[a.id] = {
              model: a.model || undefined,
              agentType: (a.agentType || a.agent_type) || undefined,
              capability: a.capability ? AGENT_CAPABILITY_OFFICIAL[a.capability] : undefined,
              isolation: a.isolation,
              outputSchema: (a.outputSchema ?? a.output_schema) ?? undefined,
              disabledTools: (a.disabledTools ?? a.disabled_tools) ?? [],
              permissionRules: (a.permissionRules ?? a.permission_rules) ?? [],
            }
          }
        } catch {
          /* 非桌面壳时按无 Agent 处理，缺 id 会在编译时报 */
        }
        const compiled = compileInlinedRhai(d, catalog, (next) => compileToRhai(next, { presets }))
        if (!compiled.ok) throw new Error(compiled.error)
        rhai = compiled.rhai
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
      const agentId = e.dataTransfer.getData('application/vesprism-agent').trim()
      const type = e.dataTransfer.getData('application/vesprism-node') as FlowNodeType
      const agent = agentId ? agents.find((a) => a.id === agentId) : null
      if (!type && !agent) return
      const nodeType: FlowNodeType = agent ? 'agent' : type
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const id = createNodeId(nodeType)
      const node: RfNode = {
        id,
        type: nodeType,
        position: pos,
        data: agent ? agentNodeData(agent) : { ...defaultParams(nodeType), nodeType },
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
    [agents, commitGraph, screenToFlowPosition, setEdges, setNodes],
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
    try {
      await persist({ ...current, description: pubDesc.trim(), version: pubVersion }, { publish: true })
      setDraft((d) => ({ ...d, description: pubDesc.trim(), version: pubVersion, published: true, dirty: false }))
      setPublishOpen(false)
      pushToast('已发布', 'success')
    } catch (e) {
      pushToast(String(e), 'error')
    }
  }

  const startRun = async (fromNodeId?: string) => {
    let current = fromRf(nodes, edges, draft)
    if (fromNodeId) {
      const sub = subgraphFrom(current.nodes, current.edges, fromNodeId)
      current = { ...current, id: `${current.id}-rerun`, nodes: sub.nodes, edges: sub.edges }
      if (!current.nodes.some((n) => n.type === 'start')) {
        current.nodes = [{ id: 'start-rerun', type: 'start', params: { label: '起点' } }, ...current.nodes]
        current.edges = [{ from: 'start-rerun', to: fromNodeId }, ...current.edges]
      }
      if (!current.nodes.some((n) => n.type === 'end')) {
        const hasOut = new Set(current.edges.map((e) => e.from))
        const leaves = current.nodes.filter((n) => n.type !== 'end' && !hasOut.has(n.id))
        current.nodes = [...current.nodes, { id: 'end-rerun', type: 'end', params: {} }]
        for (const leaf of leaves) {
          current.edges.push({ from: leaf.id, to: 'end-rerun' })
        }
      }
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
      await persist(current, { stage: true })
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
      const missingTools = (r.missingTools ?? r.missing_tools ?? []).map(String)
      const requirements = r.requirements ?? { models: [], tools: [] }
      if (missingTools.length > 0 || requirements.models.length > 0) {
        setReview({ id: r.id, requirements, missingTools })
      }
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

  const openPromote = () => {
    if (!selected || selected.data.nodeType !== 'agent') return
    const data = selected.data as { label?: string; role?: string; prompt?: string }
    const label = String(data.label ?? '').trim()
    const role = String(data.role ?? '').trim()
    setPromoteId(slugifyAgentId(label || role || 'trial-agent'))
    setPromoteName(label || role || '新 Agent')
    setPromoteDesc([role, data.prompt].filter((s) => s && String(s).trim()).join('\n'))
    setPromoteOpen(true)
  }

  const doPromote = async () => {
    const id = promoteId.trim()
    const name = promoteName.trim()
    if (!isValidAgentId(id)) {
      pushToast('Agent id 不合法（1-64 位小写字母、数字、单连字符）', 'error')
      return
    }
    if (!name) {
      pushToast('Agent 显示名不能为空', 'error')
      return
    }
    if (agents.some((a) => a.id === id)) {
      pushToast(`工号「${id}」已存在，请换一个或去编制面板改源`, 'error')
      return
    }
    const data = selected?.data as { role?: string; prompt?: string } | undefined
    const sections = [data?.role, data?.prompt, promoteDesc.trim()]
      .filter((s): s is string => Boolean(s && s.trim()))
      .map((s) => s.trim())
    const agent: AgentRecord = {
      ...emptyAgent(id, name),
      description: promoteDesc.trim(),
      persona: { label: name, sections },
    }
    setPromoteBusy(true)
    try {
      await saveAgent(agent, sections.join('\n\n'))
      setPromoteOpen(false)
      if (selected) patchSelected({ presetId: id })
      await reloadList()
      pushToast(`已升格为 Agent「${id}」，本节点已冻结引用`, 'success')
    } catch (e) {
      pushToast(`升格失败：${String(e)}`, 'error')
    } finally {
      setPromoteBusy(false)
    }
  }

  const demoteToTrial = () => {
    if (!selected) return
    patchSelected({ presetId: '' })
    pushToast('已卸任：人设留在节点上，不再引用编制', 'success')
  }

  const openBoundAgent = (id: string) => {
    requestAgentsFocus(id)
    void openChatTab({ title: 'Agent 编制', utilityKind: 'agents' })
  }

  const onGenerate = async () => {
    const text = aiText.trim()
    if (!text || !tabId) return
    setAiBusy(true)
    setAiError('')
    const before = getTabState(tabId)?.messages.length ?? messages.length
    aiWait.current = { before, started: false }
    try {
      await sendPrompt(tabId, buildGeneratePrompt(text))
    } catch (e) {
      aiWait.current = null
      setAiBusy(false)
      setAiError(String(e))
      pushToast(AI_GRAPH_FAIL_MESSAGE, 'error')
    }
  }

  useEffect(() => {
    const wait = aiWait.current
    const step = noteGenerateProgress(wait, aiBusy, generating)
    if (step === 'started' && wait) wait.started = true
    if (step !== 'finish' || !wait) return
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
      <h3>{selected.data.nodeType} 属性配置</h3>
      <label className="flow-field">
        <span>显示名称</span>
        <input
          placeholder="如：代码分析、生成测试、提交审核"
          value={String(selected.data.label ?? '')}
          onChange={(e) => patchSelected({ label: e.target.value })}
        />
      </label>
      {selected.data.nodeType === 'start' && (
        <label className="flow-field">
          <span>输入字段声明（格式：name:type，多个用逗号隔开）</span>
          <input
            placeholder="如：input:string, file_path:string"
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
      {selected.data.nodeType === 'agent' && (() => {
        const presetId = String((selected.data as { presetId?: string }).presetId ?? '').trim()
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
                value={String((selected.data as { role?: string }).role ?? '')}
                onChange={(e) => patchSelected({ role: e.target.value } as Partial<FlowRfData>)}
              />
            </label>
            <label className="flow-field">
              <span>任务提示词（Prompt / 指令要求）</span>
              <textarea
                rows={4}
                placeholder="如：请仔细分析上一步传入的需求与代码，提炼核心变更逻辑与待办事项，给出清晰结构化的技术摘要。"
                value={String((selected.data as { prompt?: string }).prompt ?? '')}
                onChange={(e) => patchSelected({ prompt: e.target.value } as Partial<FlowRfData>)}
              />
            </label>
            <label className="flow-field">
              <span>执行模型（留空继承主会话模型）</span>
              <input
                placeholder="如：claude-3-7-sonnet, gpt-4o, deepseek-r1"
                value={String((selected.data as { model?: string }).model ?? '')}
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
      {selected.data.nodeType === 'tool' && (
        <>
          <label className="flow-field">
            <span>工具名称</span>
            <input
              placeholder="如：run_command, read_file, grep_search"
              value={String((selected.data as { toolName?: string }).toolName ?? '')}
              onChange={(e) => patchSelected({ toolName: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
          <label className="flow-field">
            <span>执行命令</span>
            <input
              placeholder="如：cargo test --no-fail-fast, npm run build"
              value={String((selected.data as { command?: string }).command ?? '')}
              onChange={(e) => patchSelected({ command: e.target.value } as Partial<FlowRfData>)}
            />
          </label>
        </>
      )}
      {selected.data.nodeType === 'flow' && (
        <label className="flow-field">
          <span>引用已发布流程 ID</span>
          <input
            placeholder="输入或下拉选择子流程 ID"
            value={String((selected.data as { flowId?: string }).flowId ?? '')}
            onChange={(e) => patchSelected({ flowId: e.target.value } as Partial<FlowRfData>)}
            list="flow-id-options"
          />
        </label>
      )}
      {selected.data.nodeType === 'branch' && (
        <>
          <label className="flow-field">
            <span>分支判定条件</span>
            <select
              value={String((selected.data as { condition?: string }).condition ?? 'success')}
              onChange={(e) => patchSelected({ condition: e.target.value } as Partial<FlowRfData>)}
            >
              <option value="success">按成功 (Exit 0 / success)</option>
              <option value="failure">按失败 (Error / failure)</option>
              <option value="expression">自定义表达式</option>
            </select>
          </label>
          <label className="flow-field">
            <span>条件表达式</span>
            <input
              placeholder="如：prev.success 或 prev.output.status == 'ok'"
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

  const PALETTE_META: Record<
    FlowNodeType,
    { icon: string }
  > = {
    start: { icon: '▶' },
    agent: { icon: '✦' },
    tool: { icon: '⚙' },
    flow: { icon: '⑂' },
    branch: { icon: '⌥' },
    end: { icon: '◼' },
  }

  return (
    <div className="flow-canvas" role="region" aria-label="流程画布">
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
          {draft.dirty ? (
            <span className="flow-dirty">
              <span className="flow-dirty-dot" /> 未保存
            </span>
          ) : (
            <span className="flow-clean">已保存</span>
          )}
          <span className="flow-ver">v{draft.version}</span>
          <div className="flow-select-wrapper">
            <select
              className="flow-select"
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
              <option value={draft.id}>{draft.name} ({draft.id})</option>
              {list
                .filter((x) => x.id !== draft.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.id})
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="flow-toolbar-actions">
          <div className="flow-action-group primary-group">
            <button type="button" className="flow-btn primary run-btn" onClick={() => void startRun()}>
              <span>▶</span> 试跑
            </button>
            <button type="button" className="flow-btn publish-btn" onClick={openPublish}>
              <span>✦</span> 发布
            </button>
          </div>

          <div className="flow-action-divider" />

          <div className="flow-action-group tool-group">
            <button type="button" className="flow-btn icon-btn" title="导出流程" onClick={() => void doExport()}>
              <span>↓</span> 导出
            </button>
            <button type="button" className="flow-btn icon-btn" title="导入流程" onClick={() => void doImport()}>
              <span>↑</span> 导入
            </button>
            <button type="button" className="flow-btn icon-btn" title="复制副本" onClick={doCopy}>
              <span>⎘</span> 复制
            </button>
            <button type="button" className="flow-btn danger icon-btn" title="删除流程" onClick={() => void doDelete()}>
              <span>🗑</span>
            </button>
          </div>

          <div className="flow-action-divider" />

          <button
            type="button"
            className={`flow-btn dock-btn${dockOpen ? ' is-active' : ''}`}
            onClick={() => setDockOpen((v) => !v)}
            title={dockOpen ? '关闭试跑台' : '打开试跑台'}
          >
            <span className="flow-btn-icon">⚡</span> 试跑台
          </button>
        </div>
      </header>

      <div className="flow-body">
        <aside className="flow-palette" aria-label="节点库">
          <div className="flow-palette-header">
            <span className="flow-palette-title">节点库</span>
            <span className="flow-palette-sub">拖拽添加节点</span>
          </div>
          <div className="flow-palette-list">
            {agents.length > 0 && (
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
                      title={`${label} (${agent.id})`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/vesprism-agent', agent.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                    >
                      <div className="flow-palette-item-head">
                        <span className="flow-palette-item-icon">
                          ✦
                        </span>
                        <strong className="flow-palette-item-label">{label}</strong>
                      </div>
                      <span className="flow-palette-item-hint">{hint}</span>
                    </button>
                  )
                })}
                <div className="flow-palette-section flow-palette-section-muted">通用节点</div>
              </>
            )}
            {NODE_LIBRARY.map((item) => {
              const meta = PALETTE_META[item.type]
              return (
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
                  <div className="flow-palette-item-head">
                    <span className="flow-palette-item-icon">
                      {meta.icon}
                    </span>
                    <strong className="flow-palette-item-label">{item.label}</strong>
                  </div>
                  <span className="flow-palette-item-hint">{item.hint}</span>
                </button>
              )
            })}
          </div>
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
              <Background gap={20} size={1.2} color="var(--border-solid, #e5e7eb)" />
              <MiniMap pannable zoomable />
              <Controls />
            </ReactFlow>
          </div>
          {inspector}
          <div className="flow-ai-floating">
            <div className="flow-ai-card">
              <span className="flow-ai-sparkle" aria-hidden>✦</span>
              <input
                type="text"
                className="flow-ai-input"
                value={aiText}
                disabled={aiBusy || generating}
                placeholder="描述流程目标或分支逻辑，AI 自动生成拓扑连线..."
                onChange={(e) => setAiText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void onGenerate()
                  }
                }}
              />
              <button
                type="button"
                className="flow-ai-submit-btn"
                disabled={aiBusy || generating || !aiText.trim()}
                onClick={() => void onGenerate()}
              >
                {aiBusy || generating ? (
                  <span className="flow-ai-spin">↻ 生成中…</span>
                ) : (
                  <span>一键生成 ↵</span>
                )}
              </button>
            </div>
            {aiError ? <div className="flow-err">{aiError}</div> : null}
          </div>
        </div>

        <aside className={`flow-dock${dockOpen ? '' : ' is-collapsed'}`} aria-label="试跑台">
          {dockOpen && (
            <div className="flow-dock-body scrollbar-dt">
              <div className="flow-dock-section">
                <div className="flow-dock-section-head">
                  <span>测试输入 (JSON)</span>
                  <button type="button" className="flow-dock-text-btn" onClick={saveTestCase} title="保存为当前流程默认测试输入">
                    保存用例
                  </button>
                </div>
                <textarea
                  className="flow-json-textarea"
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  rows={6}
                  spellCheck={false}
                />
              </div>

              <div className="flow-dock-actions">
                <button type="button" className="flow-btn primary flow-dock-run-btn" onClick={() => void startRun()}>
                  <span>▶</span> 立即运行
                </button>
                <button
                  type="button"
                  className={`flow-btn flow-dock-replay-toggle${replayOpen ? ' is-active' : ''}`}
                  onClick={() => setReplayOpen((v) => !v)}
                >
                  <span>↻</span> {replayOpen ? '收起回放' : '回放记录'}
                </button>
              </div>

              <SubagentRunTree />
              <TerminalList />

              {replayOpen && (
                <div className="flow-replay" aria-label="回放时间线">
                  <div className="flow-replay-header">
                    <span>执行历史与回放</span>
                  </div>
                  {runSteps.length === 0 ? (
                    <div className="flow-replay-meta">尚无试跑记录</div>
                  ) : (
                    runSteps.map((s) => (
                      <div key={s.nodeId} className={`flow-replay-item is-${s.status}`}>
                        <div className="flow-replay-item-top">
                          <span className="flow-replay-status-dot" />
                          <strong className="flow-replay-label">{s.label}</strong>
                          <span className="flow-replay-type">{s.type}</span>
                          <span className="flow-replay-badge">{s.status}</span>
                          <button
                            type="button"
                            className="flow-btn flow-replay-rerun"
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

      {promoteOpen && (
        <div className="flow-modal-back" role="dialog" aria-modal="true" aria-label="升格为 Agent">
          <div className="flow-modal">
            <h2>✦ 升格为 Agent</h2>
            <p className="flow-modal-hint">把当前试岗节点固化成编制员工。升格后节点冻结引用该 Agent，能力/隔离/停用工具从 Agent 资产来。</p>
            <label className="flow-field">
              <span>id（小写字母/数字/单连字符）</span>
              <input value={promoteId} onChange={(e) => setPromoteId(slugifyAgentId(e.target.value))} />
            </label>
            <label className="flow-field">
              <span>显示名</span>
              <input value={promoteName} onChange={(e) => setPromoteName(e.target.value)} />
            </label>
            <label className="flow-field">
              <span>说明（编进人设段落）</span>
              <textarea value={promoteDesc} onChange={(e) => setPromoteDesc(e.target.value)} rows={4} />
            </label>
            <div className="flow-modal-actions">
              <button type="button" className="flow-btn" onClick={() => setPromoteOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="flow-btn primary"
                disabled={promoteBusy || !promoteId.trim() || !promoteName.trim()}
                onClick={() => void doPromote()}
              >
                {promoteBusy ? '创建中…' : '升格'}
              </button>
            </div>
          </div>
        </div>
      )}

      {review && (
        <div className="flow-modal-back" role="dialog" aria-modal="true" aria-label="导入依赖检查">
          <div className="flow-modal">
            <h2>已导入 {review.id} — 依赖检查</h2>
            {review.missingTools.length > 0 ? (
              <div className="flow-req-block is-missing">
                <strong>缺命令（硬约束，缺了可能跑不动）：</strong>
                <p>{review.missingTools.join('、')}</p>
                <p className="flow-req-hint">请在本机安装后再跑该流程。</p>
              </div>
            ) : null}
            {review.requirements.tools.length > 0 ? (
              <div className="flow-req-block">
                <strong>依赖命令：</strong>
                <p>{review.requirements.tools.join('、')}</p>
              </div>
            ) : null}
            {review.requirements.models.length > 0 ? (
              <div className="flow-req-block">
                <strong>推荐模型（软约束，可映射到本机模型）：</strong>
                <p>{review.requirements.models.join('、')}</p>
                <p className="flow-req-hint">模型不匹配可忽略，会继承主会话模型。</p>
              </div>
            ) : null}
            <div className="flow-modal-actions">
              <button type="button" className="flow-btn primary" onClick={() => setReview(null)}>
                知道了
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
