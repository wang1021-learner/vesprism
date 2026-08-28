/**
 * 流程画布（v2.0 架构升级）。
 * 模块化解耦：FlowToolbar / NodeInspector / PublishFlowModal / PromoteAgentModal / WorkbenchDock。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '@nanostores/react'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  IconChevronDown,
  IconChevronUp,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { $activeTabId, $generating, $workflows, getTabState, patchTab, pushToast } from '../../store'
import { sendPrompt } from '../../bridge'
import { buildNamedWorkflowSlash } from '../flow/namedWorkflowSlash'
import { sendSessionPrompt } from '../../lib/sendSessionPrompt'
import { expectCanvasGraph, resetCanvasGraphWait } from '../generateWait'
import { CanvasGraphApplier } from './CanvasGraphApplier'
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
  updateSessionFlows,
  purgeRerunSidecars,
} from '../bridge'
import {
  FLOW_RETRY_STRICT,
  bumpVersion,
  collectPromptsMarkdown,
  createDemoDraft,
  createNodeId,
  defaultParams,
  draftHasAbsolutePath,
  isValidFlowId,
  layoutDraft,
  subgraphFrom,
  defaultTestInput,
  parseTestInputForRun,
  resolveTestInput,
  shouldPersistTestInput,
  startFieldsFromNodes,
  type FlowDraft,
  type FlowListItem,
  type FlowNodeType,
  type FlowRunStep,
  type GraphSnap,
  type SchemaField,
  applySnap,
  historyCap,
  pushCapped,
  saveHash,
  takeSnap,
} from '../flow'
import {
  emptyAgent,
  isValidAgentId,
  slugifyAgentId,
  type AgentListItem,
  type AgentRecord,
} from '../types'
import { requestAgentsFocus } from '../agents/focus'
import { $flowStaleEpoch, clearFlowStale, staleForFlow } from '../agents/stale'
import { bindWorkbenchArtifact } from '../bindings'
import { $flowFocusId, clearFlowFocus, requestFlowFocus } from '../flow/focus'
import { WorkbenchDock } from './workbench-dock'
import { FlowTalkPanel } from './FlowTalkPanel'
import { FlowCanvasContext } from './context'
import { FlowNode, type FlowRfData } from './nodes'
import { FlowToolbar } from './components/FlowToolbar'
import { FlowPalette } from './components/FlowPalette'
import { NodeInspector } from './components/NodeInspector'
import { PublishFlowModal } from './components/PublishFlowModal'
import { PromoteAgentModal } from './components/PromoteAgentModal'
import { FlowRunSync } from './FlowRunSync'
import { type SubmittedRun } from './runSync'
import {
  agentNodeData,
  fromRf,
  getAncestors,
  patchExecStatuses,
  testKey,
  toRfEdges,
  toRfNodes,
  type RfEdge,
  type RfNode,
} from './rfGraph'
import {
  compileDraftRhai,
  draftAfterPersist,
  enqueueFlowWrite,
  pendingFlowWrites,
  shouldSkipDraftPersist,
} from './persistFlow'

const flowNodeTypes = {
  start: FlowNode,
  agent: FlowNode,
  tool: FlowNode,
  http: FlowNode,
  database: FlowNode,
  knowledge: FlowNode,
  variable: FlowNode,
  transform: FlowNode,
  loop: FlowNode,
  loop_end: FlowNode,
  flow: FlowNode,
  branch: FlowNode,
  parallel: FlowNode,
  join: FlowNode,
  end: FlowNode,
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  )
}

function FlowCanvasInner() {
  const tabId = useStore($activeTabId)
  const focusFlowId = useStore($flowFocusId)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [rfBusy, setRfBusy] = useState(false)
  const [minimapOn, setMinimapOn] = useState(() => {
    try {
      const v = localStorage.getItem('vesprism.flow-canvas.minimap')
      if (v === '0') return false
      if (v === '1') return true
    } catch {
      /* ignore */
    }
    return true
  })

  const [draft, setDraft] = useState<FlowDraft>(createDemoDraft)
  const [nodes, setNodes, onNodesChange] = useNodesState<RfNode>(toRfNodes(createDemoDraft()))
  const [edges, setEdges, onEdgesChange] = useEdgesState<RfEdge>(toRfEdges(createDemoDraft()))
  const [list, setList] = useState<FlowListItem[]>([])
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [dockOpen, setDockOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [pubDesc, setPubDesc] = useState('')
  const [pubVersion, setPubVersion] = useState('1')
  const [pubIn, setPubIn] = useState('')
  const [pubOut, setPubOut] = useState('')
  const [aiError, setAiError] = useState('')
  const [diffGlow, setDiffGlow] = useState<Record<string, 'add' | 'update'>>({})
  const glowTimerRef = useRef(0)
  const [testInput, setTestInput] = useState('{\n}')
  const [runSteps, setRunSteps] = useState<FlowRunStep[]>([])
  const [stepOutputs, setStepOutputs] = useState<Record<string, { output: unknown; status: string; timestamp: number }>>({})
  const [replayOpen, setReplayOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /** 双击节点弹出的属性 Modal 当前目标节点 id（null = 未打开） */
  const [dblNodeId, setDblNodeId] = useState<string | null>(null)
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [promoteId, setPromoteId] = useState('')
  const [promoteName, setPromoteName] = useState('')
  const [promoteDesc, setPromoteDesc] = useState('')
  const [promoteBusy, setPromoteBusy] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchIdx, setSearchIdx] = useState(0)
  const saveTimer = useRef<number>(0)
  const ephemeralRunId = useRef<string | null>(null)
  /** 本次试跑提交基线：按流程 id / runId 认，不靠显示名撞车。 */
  const submittedRunRef = useRef<SubmittedRun | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  nodesRef.current = nodes
  edgesRef.current = edges
  const lastSaveHash = useRef('')
  const rhaiCache = useRef<{ key: string; rhai: string } | null>(null)
  /** 试跑参数：水合当帧跳过落盘，避免用上一份流程的 JSON 盖住新流程。 */
  const skipTestInputPersist = useRef(true)
  const lastAutoTestInput = useRef('{\n}')
  const persistRef = useRef<(
    d: FlowDraft,
    extra?: { publish?: boolean; stage?: boolean; bind?: boolean; ephemeral?: boolean },
  ) => Promise<unknown>>(async () => {})

  const hydrateTestInput = useCallback((flowId: string, fields?: SchemaField[] | null) => {
    const auto = defaultTestInput(fields)
    lastAutoTestInput.current = auto
    const next = resolveTestInput(localStorage.getItem(testKey(flowId)), fields)
    skipTestInputPersist.current = true
    setTestInput(next)
    if (!shouldPersistTestInput(next, auto)) {
      localStorage.removeItem(testKey(flowId))
    }
  }, [])

  const matchedNodes = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (!q) return []
    return nodes.filter((n) => {
      const label = String(n.data.label || '').toLowerCase()
      const id = n.id.toLowerCase()
      const role = String(n.data.role || '').toLowerCase()
      const prompt = String(n.data.prompt || '').toLowerCase()
      const cmd = String(n.data.command || '').toLowerCase()
      const tool = String(n.data.toolName || '').toLowerCase()
      return (
        label.includes(q) ||
        id.includes(q) ||
        role.includes(q) ||
        prompt.includes(q) ||
        cmd.includes(q) ||
        tool.includes(q)
      )
    })
  }, [nodes, searchText])

  /** 当前节点的上游节点列表（点选式变量绑定）。 */
  const upstreamNodesOf = useCallback(
    (id?: string | null): { id: string; label: string }[] => {
      if (!id) return []
      const simpleEdges = edges.map((e) => ({ from: e.source, to: e.target }))
      return Array.from(getAncestors(id, simpleEdges))
        .map((nid) => nodes.find((n) => n.id === nid))
        .filter((n): n is RfNode => Boolean(n))
        .filter((n) => (n.data as { nodeType?: string }).nodeType !== 'start')
        .map((n) => ({ id: n.id, label: String((n.data as { label?: string }).label ?? n.id) }))
    },
    [nodes, edges],
  )

  const focusNode = useCallback(
    (targetNode: RfNode) => {
      setSelectedId(targetNode.id)
      fitView({
        nodes: [{ id: targetNode.id }],
        duration: 350,
        padding: 0.8,
      })
    },
    [fitView],
  )

  const nextSearchResult = useCallback(() => {
    if (matchedNodes.length === 0) return
    const next = (searchIdx + 1) % matchedNodes.length
    setSearchIdx(next)
    focusNode(matchedNodes[next])
  }, [focusNode, matchedNodes, searchIdx])

  const prevSearchResult = useCallback(() => {
    if (matchedNodes.length === 0) return
    const prev = (searchIdx - 1 + matchedNodes.length) % matchedNodes.length
    setSearchIdx(prev)
    focusNode(matchedNodes[prev])
  }, [focusNode, matchedNodes, searchIdx])

  useEffect(() => {
    if (!tabId) return
    const st = getTabState(tabId)
    if (st?.utilityKind === 'flow-canvas') {
      const flowTitle = draft.name.trim() || '流程画布'
      if ((st.chatTitle || '').trim() !== flowTitle) {
        patchTab(tabId, { chatTitle: flowTitle })
      }
    }
  }, [tabId, draft.name, draft.id])

  useEffect(() => () => resetCanvasGraphWait(), [])

  // 画布 tab 打开时把内置 MCP server 挂载进会话 cwd（.mcp.json，官方热加载），
  // 这样数据库/知识库节点的 agent 才能拿到 database_query / knowledge_search 工具。
  useEffect(() => {
    if (!tabId) return
    const st = getTabState(tabId)
    const cwd = st?.cwd
    if (!cwd) return
    void import('../../workbench/bridge').then((m) => m.mountMcp(cwd).catch(() => {}))
  }, [tabId])

  const startRunRef = useRef<(nodeId?: string) => Promise<void>>(async () => {})
  const historyRef = useRef<GraphSnap[]>([])
  const futureRef = useRef<GraphSnap[]>([])
  const editKeyRef = useRef<string | null>(null)

  const pushHistory = useCallback((prev: FlowDraft) => {
    pushCapped(historyRef.current, takeSnap(prev), historyCap(prev.nodes.length))
    futureRef.current = []
    editKeyRef.current = null
  }, [])

  const beginEdit = useCallback((key: string) => {
    if (editKeyRef.current === key) return
    const cur = fromRf(nodesRef.current, edgesRef.current, draftRef.current)
    pushCapped(historyRef.current, takeSnap(cur), historyCap(cur.nodes.length))
    futureRef.current = []
    editKeyRef.current = key
  }, [])

  const onRunFromHere = useCallback((nodeId: string) => {
    void startRunRef.current(nodeId)
  }, [])

  const onDeleteNodes = useCallback((ids: string[]) => {
    const drop = new Set(ids.filter(Boolean))
    if (drop.size === 0) return
    setDraft((cur) => {
      pushHistory(cur)
      return cur
    })
    setNodes((ns) => {
      const next = ns.filter((n) => !drop.has(n.id))
      setEdges((es) => {
        const nextEs = es.filter((e) => !drop.has(e.source) && !drop.has(e.target))
        setDraft((d) => fromRf(next, nextEs, d))
        return nextEs
      })
      return next
    })
    setSelectedId((cur) => (cur && drop.has(cur) ? null : cur))
    setSelectedIds((cur) => cur.filter((id) => !drop.has(id)))
    pushToast(drop.size > 1 ? `已删除 ${drop.size} 个节点` : '已删除节点', 'info')
  }, [pushHistory, setEdges, setNodes])

  const onDeleteNode = useCallback((nodeId: string) => {
    onDeleteNodes([nodeId])
  }, [onDeleteNodes])

  const onDuplicate = useCallback(
    (nodeId: string) => {
      setDraft((cur) => {
        pushHistory(cur)
        return cur
      })
      setNodes((ns) => {
        const target = ns.find((n) => n.id === nodeId)
        if (!target) return ns
        const id = createNodeId(target.data.nodeType)
        const clone: RfNode = {
          ...target,
          id,
          selected: true,
          position: { x: target.position.x + 30, y: target.position.y + 30 },
          data: {
            ...target.data,
            label: `${target.data.label || target.data.nodeType} 副本`,
          },
        }
        const next = [...ns, clone]
        setEdges((es) => {
          setDraft((d) => fromRf(next, es, d))
          return es
        })
        setSelectedId(id)
        return next
      })
      pushToast('已创建节点副本', 'info')
    },
    [pushHistory, setEdges, setNodes],
  )

  const canvasCtx = useMemo(
    () => ({ onRunFromHere, onDuplicate, onDeleteNode }),
    [onRunFromHere, onDuplicate, onDeleteNode],
  )
  const dockNodeIds = useMemo(() => draft.nodes.map((n) => n.id), [draft.nodes])

  const onDuplicateSelected = useCallback(() => {
    const ids = selectedIds.length ? selectedIds : selectedId ? [selectedId] : []
    for (const id of ids) onDuplicate(id)
  }, [onDuplicate, selectedId, selectedIds])

  const onAutoLayout = useCallback(() => {
    setDraft((curDraft) => {
      const current = fromRf(nodesRef.current, edgesRef.current, curDraft)
      pushHistory(current)
      const laid = layoutDraft(current)
      setNodes(toRfNodes(laid))
      setEdges(toRfEdges(laid))
      pushToast('已自动整理拓扑布局', 'success')
      return laid
    })
  }, [pushHistory, setEdges, setNodes])

  const applyDraft = useCallback(
    (next: FlowDraft, markDirty = true) => {
      editKeyRef.current = null
      const d = { ...next, dirty: markDirty ? true : next.dirty }
      setDraft(d)
      setNodes(toRfNodes(d))
      setEdges(toRfEdges(d))
    },
    [setEdges, setNodes],
  )

  const flashDiff = useCallback((next: Record<string, 'add' | 'update'>) => {
    setDiffGlow(next)
    window.clearTimeout(glowTimerRef.current)
    glowTimerRef.current = window.setTimeout(() => setDiffGlow({}), 2500)
  }, [])

  useEffect(() => () => window.clearTimeout(glowTimerRef.current), [])

  useEffect(() => {
    setNodes((ns) => {
      let changed = false
      const next = ns.map((n) => {
        const g = diffGlow[n.id]
        if (n.data.diffGlow === g) return n
        changed = true
        return { ...n, data: { ...n.data, diffGlow: g } }
      })
      return changed ? next : ns
    })
  }, [diffGlow, setNodes])

  useEffect(() => {
    setNodes((ns) => patchExecStatuses(ns, stepOutputs))
  }, [setNodes, stepOutputs])

  const applyFlowRecord = useCallback(
    (rec: Awaited<ReturnType<typeof getFlow>>, markDirty = false) => {
      historyRef.current = []
      futureRef.current = []
      // 记录"画布当前流程"：tab state（本次 tab 精确）+ localStorage（跨会话兜底）。
      // 重挂载恢复靠它，避免切走再切回时画布回落 demo 或旧流程。
      if (tabId) patchTab(tabId, { flowId: rec.id })
      localStorage.setItem('vesprism.flow-canvas.lastId', rec.id)
      hydrateTestInput(rec.id, startFieldsFromNodes(Array.isArray(rec.nodes) ? rec.nodes : []))
      applyDraft(
        {
          id: rec.id,
          name: rec.name,
          description: rec.description,
          version: rec.version,
          published: rec.published,
          dirty: markDirty,
          input_schema: (rec.input_schema as FlowDraft['input_schema']) || {},
          output_schema: (rec.output_schema as FlowDraft['output_schema']) || {},
          nodes: Array.isArray(rec.nodes) ? (rec.nodes as FlowDraft['nodes']) : [],
          edges: Array.isArray(rec.edges) ? (rec.edges as FlowDraft['edges']) : [],
        },
        markDirty,
      )
    },
    [applyDraft, tabId, hydrateTestInput],
  )

  const reloadList = useCallback(async () => {
    try {
      const items = await listFlows()
      setList(items)
    } catch {
      /* 非桌面壳时降级 */
    }
  }, [])

  const reloadAgents = useCallback(async () => {
    try {
      const items = await listAgents()
      setAgents(items)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void reloadList()
    void reloadAgents()
  }, [reloadList, reloadAgents])

  useEffect(() => {
    if (!focusFlowId) return
    void (async () => {
      const cur = fromRf(nodesRef.current, edgesRef.current, draftRef.current)
      if (cur.id !== focusFlowId && cur.dirty && !shouldSkipDraftPersist(cur.id)) {
        try {
          await persistRef.current(cur)
        } catch {
          /* 切走仍加载目标 */
        }
      }
      try {
        const rec = await getFlow(focusFlowId)
        applyFlowRecord(rec, false)
        clearFlowFocus(focusFlowId)
      } catch (e) {
        pushToast(`加载流程失败：${String(e)}`, 'error')
      }
    })()
  }, [focusFlowId, applyFlowRecord])

  // 重挂载恢复：画布组件在 tab 切换（如打开「试跑详情」flow-run）时会卸载，
  // 经 TabBar 直接切回时没有外部 focus 信号（requestFlowFocus 只走侧栏绑定路径），
  // 这里恢复「画布当前流程」——优先 tab state 的 flowId（applyFlowRecord/persist 同步写入，
  // 本次 tab 内精确），其次 localStorage lastId（跨 tab 会话兜底），避免画布回落 demo 草稿。
  useEffect(() => {
    if (focusFlowId) return
    const tabFlowId = tabId ? getTabState(tabId)?.flowId : undefined
    const flowId = tabFlowId || localStorage.getItem('vesprism.flow-canvas.lastId')
    if (!flowId) return
    let cancelled = false
    void (async () => {
      try {
        await pendingFlowWrites()
        if (cancelled) return
        const rec = await getFlow(flowId)
        if (cancelled) return
        if (rec && Array.isArray(rec.nodes) && rec.nodes.length) {
          applyFlowRecord(rec, false)
        }
      } catch {
        /* 流程可能已被删除，保持 demo 草稿 */
      }
    })()
    return () => {
      cancelled = true
    }
    // 仅挂载时执行：后续流程切换走 focusFlowId / applyFlowRecord 显式路径。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = useCallback(
    async (d: FlowDraft, extra?: { publish?: boolean; stage?: boolean; bind?: boolean; ephemeral?: boolean }) => {
      if (shouldSkipDraftPersist(d.id, extra)) {
        lastSaveHash.current = saveHash(d)
        return d
      }
      return enqueueFlowWrite(async () => {
        let rhai: string | null = null
        if (extra?.publish || extra?.stage) {
          rhai = await compileDraftRhai(d, getFlow, listAgents, rhaiCache)
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
          ephemeral: extra?.ephemeral ?? false,
          rhai,
          prompts: collectPromptsMarkdown(d),
        })
        if (!extra?.ephemeral) {
          localStorage.setItem('vesprism.flow-canvas.lastId', saved.id)
          if (tabId) patchTab(tabId, { flowId: saved.id })
        }
        const shouldBind = extra?.bind !== false && !extra?.ephemeral
        const st = tabId ? getTabState(tabId) : undefined
        const sessionId = st?.sessionId || st?.chatId
        if (shouldBind && sessionId) {
          void bindWorkbenchArtifact(sessionId, { kind: 'flow', id: saved.id }, 'flow-canvas').catch(() => {})
        }
        if (!extra?.ephemeral) {
          lastSaveHash.current = saveHash(d)
          const live = fromRf(nodesRef.current, edgesRef.current, draftRef.current)
          setDraft((prev) => draftAfterPersist(prev, d, saved, saveHash(live)))
        }
        await reloadList()
        return saved
      })
    },
    [reloadList, tabId],
  )
  persistRef.current = persist

  useEffect(() => {
    if (shouldSkipDraftPersist(draft.id)) return
    if (!draft.dirty) return
    if (saveHash(draft) === lastSaveHash.current) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const latest = fromRf(nodesRef.current, edgesRef.current, draftRef.current)
      if (shouldSkipDraftPersist(latest.id)) return
      if (!latest.dirty || saveHash(latest) === lastSaveHash.current) return
      void persistRef.current(latest).catch((e) => pushToast(`保存草稿失败：${String(e)}`, 'error'))
    }, 900)
    return () => window.clearTimeout(saveTimer.current)
  }, [draft])

  useEffect(() => () => {
    window.clearTimeout(saveTimer.current)
    const latest = fromRf(nodesRef.current, edgesRef.current, draftRef.current)
    if (shouldSkipDraftPersist(latest.id)) return
    if (!latest.dirty || saveHash(latest) === lastSaveHash.current) return
    void persistRef.current(latest).catch((e) => pushToast(`保存草稿失败：${String(e)}`, 'error'))
  }, [])

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) => {
        const nextEds = addEdge(
          {
            id: `e-${c.source}-${c.target}-${Date.now()}`,
            source: c.source,
            target: c.target,
            label: c.sourceHandle === 'failure' ? 'failure' : c.sourceHandle === 'success' ? 'success' : undefined,
            sourceHandle: c.sourceHandle ?? undefined,
            targetHandle: c.targetHandle ?? undefined,
            animated: false,
          },
          eds,
        )
        setNodes((curNodes) => {
          setDraft((curDraft) => {
            pushHistory(curDraft)
            return fromRf(curNodes, nextEds, curDraft)
          })
          return curNodes
        })
        return nextEds
      })
    },
    [pushHistory, setEdges, setNodes],
  )

  const commitGraph = useCallback((ns: RfNode[], es: RfEdge[], recordHistory = true) => {
    setDraft((d) => {
      const next = fromRf(ns, es, d)
      if (recordHistory && saveHash(next) !== saveHash(d)) {
        pushHistory(d)
      }
      return next
    })
  }, [pushHistory])

  const onNodeDragStart = useCallback(() => {
    setRfBusy(true)
    beginEdit('drag')
  }, [beginEdit])
  const onNodeDragStop = useCallback(() => {
    setRfBusy(false)
    commitGraph(nodesRef.current, edgesRef.current, false)
    editKeyRef.current = null
  }, [commitGraph])
  const onPaneMoveStart = useCallback(() => setRfBusy(true), [])
  const onPaneMoveEnd = useCallback(() => setRfBusy(false), [])

  const onRfSelectionChange = useCallback(({ nodes: ns }: { nodes: RfNode[] }) => {
    const ids = ns.map((n) => n.id)
    setSelectedIds((prev) =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids,
    )
    setSelectedId((cur) => {
      const next = ids[0] ?? null
      return cur === next ? cur : next
    })
  }, [])

  const onRfDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const addNode = useCallback(
    (type: FlowNodeType, agent?: AgentListItem | null) => {
      const nodeType: FlowNodeType = agent ? 'agent' : type
      const id = createNodeId(nodeType)
      const count = nodes.length
      const offset = (count % 8) * 30
      const pos = screenToFlowPosition
        ? screenToFlowPosition({
            x: window.innerWidth / 2 - 120 + offset,
            y: window.innerHeight / 2 - 100 + offset,
          })
        : { x: 250 + offset, y: 150 + offset }
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
      setSelectedId(id)
      pushToast(`已添加「${agent?.name || nodeType}」节点`, 'info')
    },
    [commitGraph, nodes.length, screenToFlowPosition, setEdges, setNodes],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const agentId = e.dataTransfer.getData('application/vesprism-agent').trim()
      const type = e.dataTransfer.getData('application/vesprism-node') as FlowNodeType
      const agent = agentId ? agents.find((a) => a.id === agentId) : null
      if (!type && !agent) return
      const nodeType: FlowNodeType = agent ? 'agent' : type
      const pos = screenToFlowPosition
        ? screenToFlowPosition({ x: e.clientX, y: e.clientY })
        : { x: e.clientX - 200, y: e.clientY - 100 }
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
      setSelectedId(id)
    },
    [agents, commitGraph, screenToFlowPosition, setEdges, setNodes],
  )

  const selected = nodes.find((n) => n.id === selectedId) ?? null

  const patchSelected = (patch: Partial<FlowRfData>) => {
    if (!selected) return
    beginEdit(`node:${selected.id}`)
    setNodes((ns) => {
      const next = ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n))
      setEdges((es) => {
        commitGraph(next, es, false)
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
      await persist(current, { publish: true })
      clearFlowStale(current.id)
      setDraft((d) => ({ ...d, description: pubDesc.trim(), version: pubVersion, published: true, dirty: false }))
      setPublishOpen(false)
      pushToast('已发布，运行时将使用当前编制权限', 'success')
    } catch (e) {
      pushToast(String(e), 'error')
    }
  }

  const onMountToSession = async () => {
    if (!tabId) {
      pushToast('未找到活动会话 Tab', 'error')
      return
    }
    try {
      const current = fromRf(nodes, edges, draft)
      await persist(current, { stage: true })
      await updateSessionFlows(tabId, [current.id])
      setMounted(true)
      pushToast(`已成功热挂载 /${current.id} 至当前会话`, 'success')
    } catch (e) {
      pushToast(`挂载失败: ${String(e)}`, 'error')
    }
  }

  const startRun = async (
    fromNodeId?: string,
    overrideOutputs?: Record<string, { output: unknown; status: string; timestamp: number }>,
  ) => {
    setDockOpen(true)
    if (!tabId) {
      pushToast('未找到活动会话 Tab', 'error')
      return
    }
    if ($generating.get()) {
      pushToast('当前回合还在进行，请结束后再试跑', 'error')
      return
    }
    // 试跑只走本 Tab 开会话时的 cwd，禁止用全局 workspace_cwd 把画布拽到主聊天项目。
    resetCanvasGraphWait()
    let current = fromRf(nodes, edges, draft)
    if (fromNodeId) {
      const sub = subgraphFrom(current.nodes, current.edges, fromNodeId)
      current = { ...current, id: `${current.id}-rerun`, nodes: sub.nodes, edges: sub.edges }
      if (!current.nodes.some((n) => n.type === 'start')) {
        // 起点连所有「无入边的可执行节点」：普通节点（fromNodeId）直接喂 input；
        // 从 join 重跑时 subgraphFrom 拉入的兄弟节点也一并接入，避免兄弟成孤岛
        // 导致「无法从 start 到达」校验失败。join 自身有兄弟入边，不直接连 start。
        const noIn = current.nodes.filter((n) => !current.edges.some((e) => e.to === n.id))
        let starts = noIn.filter((n) => n.type !== 'join' && n.type !== 'end' && n.type !== 'start')
        if (starts.length === 0) {
          starts = noIn.filter((n) => n.type !== 'end').slice(0, 1)
        }
        current.nodes = [{ id: 'start-rerun', type: 'start', params: { label: '起点' } }, ...current.nodes]
        for (const s of starts) {
          current.edges.push({ from: 'start-rerun', to: s.id })
        }
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
    const parsedInput = parseTestInputForRun(testInput)
    if (!parsedInput.ok) {
      pushToast('测试输入不是合法 JSON', 'error')
      return
    }
    let input: unknown = parsedInput.value

    const effectiveOutputs = overrideOutputs ?? stepOutputs
    if (fromNodeId) {
      const ancestors = getAncestors(fromNodeId, draft.edges)
      const ancestorContext: Record<string, unknown> = {}
      for (const ancId of ancestors) {
        if (effectiveOutputs[ancId]?.output !== undefined) {
          ancestorContext[ancId] = effectiveOutputs[ancId].output
        }
      }
      if (typeof input === 'object' && input !== null) {
        input = {
          ...ancestorContext,
          ...(input as Record<string, unknown>),
          _rerun_node: fromNodeId,
        }
      }
    }

    const steps: FlowRunStep[] = current.nodes.map((n) => ({
      nodeId: n.id,
      label: String((n.params as { label?: string }).label || n.id),
      type: n.type,
      status: 'pending',
    }))
    // 全新试跑（非 Mock 续跑）清掉上一轮 stepOutputs，避免旧 run 的节点输出
    // 混入 ancestorContext / Mock 合并（旧 run 迟到 phase 也会被 label 匹配污染）。
    if (!fromNodeId) setStepOutputs({})
    setRunSteps(steps)
    setReplayOpen(true)
    setDockOpen(true)
    // 试跑前确保内置 MCP 挂载在会话 cwd（切换项目后 .mcp.json 也要跟着走）。
    const st0 = getTabState(tabId)
    const cwd0 = st0?.cwd
    if (cwd0) {
      void import('../../workbench/bridge').then((m) => m.mountMcp(cwd0).catch(() => {}))
    }
    try {
      await persist(current, {
        stage: true,
        bind: !fromNodeId,
        ephemeral: Boolean(fromNodeId),
      })
      if (fromNodeId) ephemeralRunId.current = current.id
      const effort = getTabState(tabId)?.reasoningEffort
      await sendPrompt(
        tabId,
        buildNamedWorkflowSlash({
          id: fromNodeId ? current.id : draft.id,
          input,
          effort,
        }),
      )
      submittedRunRef.current = {
        keys: new Set(Object.keys($workflows.get())),
        id: current.id,
        baseId: draft.id,
        name: draft.name,
      }
      setRunSteps((prev) => prev.map((s) => (s.type === 'start' ? { ...s, status: 'running', startedAt: Date.now() } : s)))
      pushToast('已提交试跑', 'success')
    } catch (e) {
      pushToast(`试跑失败：${String(e)}`, 'error')
    }
  }
  startRunRef.current = startRun

  const onRerunFromMock = async (nodeId: string, mockOutput: unknown) => {
    const updatedOutputs: Record<string, { output: unknown; status: string; timestamp: number }> = {
      ...stepOutputs,
      [nodeId]: { output: mockOutput, status: 'completed', timestamp: Date.now() },
    }
    setStepOutputs(updatedOutputs)
    const current = fromRf(nodes, edges, draft)
    const outgoingEdges = current.edges.filter((e) => e.from === nodeId)
    if (outgoingEdges.length === 0) {
      pushToast('该节点没有下游节点可供继续执行', 'info')
      return
    }
    const nextNodeId = outgoingEdges[0].to
    if (outgoingEdges.length > 1) {
      pushToast(
        `该节点有 ${outgoingEdges.length} 条出边，Mock 续跑将沿「${nextNodeId}」这一条继续；需要全部分支请改用「从此处重跑」`,
        'info',
      )
    } else {
      pushToast(`已注入 Mock 值，正从下游节点「${nextNodeId}」继续执行`, 'success')
    }
    await startRun(nextNodeId, updatedOutputs)
  }

  useEffect(() => {
    const id = ephemeralRunId.current
    if (!id || runSteps.length === 0) return
    const done = runSteps.every((s) => s.status === 'completed' || s.status === 'failed')
    if (!done) return
    ephemeralRunId.current = null
    void purgeRerunSidecars().catch(() => {})
  }, [runSteps])

  const doExport = async (format: 'zip' | 'yaml' | 'json' | 'rhai' = 'zip') => {
    const current = fromRf(nodes, edges, draft)
    if (!current.description.trim()) {
      pushToast('导出前请先填写「给 agent 看的说明」并发布', 'error')
      return
    }
    try {
      await persist(current, { publish: true })
      let defaultPath = `${current.id}.zip`
      let filters = [{ name: '流程包 (*.zip)', extensions: ['zip'] }]

      if (format === 'yaml') {
        defaultPath = `${current.id}.flow.yaml`
        filters = [{ name: 'DSL 契约文件 (*.flow.yaml)', extensions: ['yaml', 'yml'] }]
      } else if (format === 'json') {
        defaultPath = `${current.id}.flow.json`
        filters = [{ name: '流程图谱数据 (*.json)', extensions: ['json'] }]
      } else if (format === 'rhai') {
        defaultPath = `${current.id}.rhai`
        filters = [{ name: '执行脚本 (*.rhai)', extensions: ['rhai'] }]
      }

      const dest = await save({
        defaultPath,
        filters,
      })
      if (!dest) return
      const path = await exportFlow(current.id, dest)
      pushToast(`已导出 ${path}`, 'success')
    } catch (e) {
      pushToast(`导出失败：${String(e)}`, 'error')
    }
  }

  const doImport = async (conflictMode?: string | null) => {
    try {
      let selectedPath = ''
      if (!conflictMode) {
        const selected = await open({
          filters: [
            {
              name: '流程文件 (*.zip, *.yaml, *.json)',
              extensions: ['zip', 'yaml', 'yml', 'json'],
            },
          ],
          multiple: false,
        })
        if (!selected || typeof selected !== 'string') return
        selectedPath = selected
      }
      const res = await importFlow(selectedPath, conflictMode)
      if (res.status === 'ok') {
        pushToast(`导入成功：${res.id} v${res.version}`, 'success')
        await reloadList()
        const rec = await getFlow(res.id)
        applyFlowRecord(rec, false)
        const missing = res.missing_tools || res.missingTools || []
        if (missing.length > 0) {
          pushToast(`导入提示：缺少依赖工具 ${missing.join(', ')}`, 'info')
        }
      } else if (res.status === 'conflict') {
        pushToast(`导入冲突：已有版本 v${res.existing_version}，包内版本 v${res.incoming_version}`, 'error')
      } else if (res.status === 'missing_deps') {
        pushToast(`导入失败：缺少依赖流程 ${res.missing.join(', ')}`, 'error')
      }
    } catch (e) {
      pushToast(`导入失败：${String(e)}`, 'error')
    }
  }

  const doCopy = () => {
    const current = fromRf(nodes, edges, draft)
    const base = current.id.replace(/-copy(-\d+)?$/, '')
    const rand = Math.random().toString(36).slice(2, 6)
    const newId = `${base}-copy-${rand}`
    const copy: FlowDraft = {
      ...current,
      id: newId,
      name: `${current.name} (副本)`,
      version: '1',
      published: false,
      dirty: true,
    }
    applyDraft(copy, true)
    pushToast(`已复制为 ${newId}`, 'success')
  }

  const doDelete = async () => {
    if (!draft.id) return
    const id = draft.id
    try {
      await deleteFlow(id)
      pushToast(`已删除流程 ${id}`, 'success')
      await reloadList()
      const demo = createDemoDraft()
      applyDraft(demo, true)
    } catch (e) {
      pushToast(`删除失败：${String(e)}`, 'error')
    }
  }

  const openPromote = () => {
    if (!selected) return
    const currentName = String(selected.data.label || '').trim() || '新 Agent'
    const genId = slugifyAgentId(currentName) || `agent-${Date.now().toString(36).slice(2, 6)}`
    setPromoteName(currentName)
    setPromoteId(genId)
    setPromoteDesc(String((selected.data as { role?: string }).role || '').trim())
    setPromoteOpen(true)
  }

  const doPromote = async () => {
    if (!selected || !promoteId.trim() || !promoteName.trim()) return
    const rawId = promoteId.trim()
    if (!isValidAgentId(rawId)) {
      pushToast('Agent ID 不合法：请用 1-64 位小写字母、数字、单连字符', 'error')
      return
    }
    const d = selected.data as {
      role?: string
      prompt?: string
      model?: string
      agentType?: string
    }
    const record: AgentRecord = {
      ...emptyAgent(rawId),
      name: promoteName.trim(),
      description: promoteDesc.trim() || d.role || '',
      model: d.model || '',
      agent_type: d.agentType || '',
      persona: {
        label: d.role || null,
        sections: d.prompt ? [d.prompt] : [],
      },
    }
    setPromoteBusy(true)
    try {
      const saved = await saveAgent(record, d.prompt || undefined)
      await reloadAgents()
      patchSelected({
        presetId: saved.id,
        label: saved.name || saved.id,
      })
      setPromoteOpen(false)
      pushToast(`已成功升格为 Agent「${saved.name}」(${saved.id})`, 'success')
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

  const onRetryStrict = async () => {
    if (!tabId || $generating.get()) return
    setAiError('')
    const promptId = await sendSessionPrompt({
      text: '强制纯 JSON 重试',
      wireText: FLOW_RETRY_STRICT,
    })
    if (promptId) expectCanvasGraph(promptId)
  }

  const startFieldsKey = useMemo(
    () => JSON.stringify(startFieldsFromNodes(draft.nodes) ?? null),
    [draft.nodes],
  )

  useEffect(() => {
    hydrateTestInput(draft.id, startFieldsFromNodes(draft.nodes))
  }, [draft.id, hydrateTestInput])

  useEffect(() => {
    const fields = JSON.parse(startFieldsKey) as SchemaField[] | null
    const auto = defaultTestInput(fields)
    if (auto === lastAutoTestInput.current) return
    setTestInput((prev) => {
      const keep =
        prev === lastAutoTestInput.current
          ? false
          : shouldPersistTestInput(prev, lastAutoTestInput.current)
      lastAutoTestInput.current = auto
      if (!keep) {
        skipTestInputPersist.current = true
        if (draft.id) localStorage.removeItem(testKey(draft.id))
      }
      return keep ? prev : auto
    })
  }, [startFieldsKey, draft.id])

  useEffect(() => {
    if (skipTestInputPersist.current) {
      skipTestInputPersist.current = false
      return
    }
    if (!draft.id) return
    const key = testKey(draft.id)
    if (shouldPersistTestInput(testInput, lastAutoTestInput.current)) {
      localStorage.setItem(key, testInput)
    } else {
      localStorage.removeItem(key)
    }
  }, [draft.id, testInput])

  const idOptions = useMemo(
    () => list.filter((x) => x.published).map((x) => x.id),
    [list],
  )

  const setDraftFromToolbar = useCallback<React.Dispatch<React.SetStateAction<FlowDraft>>>(
    (updater) => {
      beginEdit('name')
      setDraft(updater)
    },
    [beginEdit],
  )

  const onToggleMinimap = useCallback(() => {
    const next = !minimapOn
    setMinimapOn(next)
    try {
      localStorage.setItem('vesprism.flow-canvas.minimap', next ? '1' : '0')
    } catch {
      /* ignore */
    }
    pushToast(next ? '已打开小地图' : '已关闭小地图', 'info')
  }, [minimapOn])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const current = fromRf(nodes, edges, draft)
        if (shouldSkipDraftPersist(current.id)) {
          pushToast('示例流程不写入本地，请先复制再保存', 'info')
          return
        }
        void persist(current).then(() => {
          pushToast('已保存流程草稿', 'success')
        })
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const tag = document.activeElement?.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) {
          return
        }
        e.preventDefault()
        if (e.shiftKey) {
          const next = futureRef.current.pop()
          if (next) {
            const current = fromRf(nodesRef.current, edgesRef.current, draftRef.current)
            pushCapped(historyRef.current, takeSnap(current), historyCap(current.nodes.length))
            applyDraft(applySnap(current, next), true)
            pushToast('已重做', 'info')
          }
        } else {
          const prev = historyRef.current.pop()
          if (prev) {
            const current = fromRf(nodesRef.current, edgesRef.current, draftRef.current)
            pushCapped(futureRef.current, takeSnap(current), historyCap(current.nodes.length))
            applyDraft(applySnap(current, prev), true)
            pushToast('已撤销', 'info')
          }
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        const tag = document.activeElement?.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) {
          return
        }
        e.preventDefault()
        const next = futureRef.current.pop()
        if (next) {
          const current = fromRf(nodesRef.current, edgesRef.current, draftRef.current)
          pushCapped(historyRef.current, takeSnap(current), historyCap(current.nodes.length))
          applyDraft(applySnap(current, next), true)
          pushToast('已重做', 'info')
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false)
          setSearchText('')
          return
        }
        setSelectedId(null)
        return
      }
      const tag = document.activeElement?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) {
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedIds.length || selectedId)) {
        e.preventDefault()
        onDeleteNodes(selectedIds.length ? selectedIds : selectedId ? [selectedId] : [])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyDraft, draft, edges, nodes, onDeleteNodes, persist, searchOpen, selectedId, selectedIds])

  useStore($flowStaleEpoch)
  const stale = staleForFlow(draft.id)

  const doExportRef = useRef(doExport)
  doExportRef.current = doExport
  const doImportRef = useRef(doImport)
  doImportRef.current = doImport
  const doDeleteRef = useRef(doDelete)
  doDeleteRef.current = doDelete
  const onMountToSessionRef = useRef(onMountToSession)
  onMountToSessionRef.current = onMountToSession
  const onRetryStrictRef = useRef(onRetryStrict)
  onRetryStrictRef.current = onRetryStrict
  const onRerunFromMockRef = useRef(onRerunFromMock)
  onRerunFromMockRef.current = onRerunFromMock
  const openPublishRef = useRef(openPublish)
  openPublishRef.current = openPublish
  const doCopyRef = useRef(doCopy)
  doCopyRef.current = doCopy

  const onToolbarExport = useCallback((fmt: 'zip' | 'yaml' | 'json' | 'rhai') => {
    void doExportRef.current(fmt)
  }, [])
  const onToolbarImport = useCallback(() => {
    void doImportRef.current()
  }, [])
  const onToolbarDelete = useCallback(() => {
    void doDeleteRef.current()
  }, [])
  const onToolbarRun = useCallback(() => {
    void startRunRef.current()
  }, [])
  const onToolbarMount = useCallback(() => {
    void onMountToSessionRef.current()
  }, [])
  const onToolbarPublish = useCallback(() => {
    openPublishRef.current()
  }, [])
  const onToolbarCopy = useCallback(() => {
    doCopyRef.current()
  }, [])
  const onDockRetry = useCallback(() => {
    void onRetryStrictRef.current()
  }, [])
  const onDockRerunMock = useCallback((nodeId: string, mockOutput: unknown) => {
    void onRerunFromMockRef.current(nodeId, mockOutput)
  }, [])
  const onDockDetails = useCallback(() => {
    void openChatTab({ title: '试跑详情', utilityKind: 'flow-run', skipSession: true })
  }, [])
  const onDockClose = useCallback(() => setDockOpen(false), [])

  return (
    <div className="flow-canvas" role="region" aria-label="流程画布">
      {stale ? (
        <div className="flow-stale-banner" role="status">
          编制「{stale.agentId}」已更新，本流程已发布包仍是旧权限。请重新发布后再跑。
        </div>
      ) : null}
      <FlowRunSync
        submittedRef={submittedRunRef}
        runSteps={runSteps}
        setRunSteps={setRunSteps}
        setStepOutputs={setStepOutputs}
      />
      <FlowToolbar
        draft={draft}
        setDraft={setDraftFromToolbar}
        dockOpen={dockOpen}
        setDockOpen={setDockOpen}
        mounted={mounted}
        onMountToSession={onToolbarMount}
        onOpenPublish={onToolbarPublish}
        onAutoLayout={onAutoLayout}
        onExport={onToolbarExport}
        onImport={onToolbarImport}
        onCopy={onToolbarCopy}
        onDelete={onToolbarDelete}
        onRun={onToolbarRun}
        minimapOn={minimapOn}
        onToggleMinimap={onToggleMinimap}
      />

      <div className="flow-body">
        <FlowPalette agents={agents} onAdd={addNode} />

        <div className="flow-stage">
          <CanvasGraphApplier
            draft={draft}
            applyDraft={applyDraft}
            flashDiff={flashDiff}
            setAiError={setAiError}
          />
          <div className="flow-stage-canvas">
            <FlowCanvasContext.Provider value={canvasCtx}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                onNodeDoubleClick={(_, node) => setDblNodeId(node.id)}
                onMoveStart={onPaneMoveStart}
                onMoveEnd={onPaneMoveEnd}
                onSelectionChange={onRfSelectionChange}
                onDrop={onDrop}
                onDragOver={onRfDragOver}
                nodeTypes={flowNodeTypes}
                noWheelClassName="nowheel"
                fitView
                onlyRenderVisibleElements
                panOnDrag
                zoomOnScroll
                zoomOnPinch
                selectionOnDrag={false}
                multiSelectionKeyCode="Shift"
                selectionKeyCode="Shift"
                deleteKeyCode={null}
                proOptions={{ hideAttribution: true }}
                minZoom={0.08}
                elevateNodesOnSelect={false}
              >
                <Background
                  variant={BackgroundVariant.Lines}
                  gap={24}
                  lineWidth={1}
                  color="color-mix(in srgb, var(--border-solid, #e5e7eb) 75%, transparent)"
                />
                {minimapOn && !rfBusy ? (
                  <MiniMap position="top-right" pannable zoomable />
                ) : null}
                <Controls showFitView={false} showInteractive={false} />
              </ReactFlow>
            </FlowCanvasContext.Provider>
            {selectedIds.length > 1 && (
              <div className="flow-batch-bar" role="toolbar" aria-label="批量操作">
                <span>已选 {selectedIds.length} 个节点</span>
                <button type="button" className="flow-btn" onClick={onDuplicateSelected}>
                  复制
                </button>
                <button
                  type="button"
                  className="flow-btn danger"
                  onClick={() => onDeleteNodes(selectedIds)}
                >
                  删除
                </button>
              </div>
            )}
            {searchOpen && (
              <div className="flow-search-bar" role="search" aria-label="搜索节点">
                <IconSearch size={14} className="flow-search-icon" />
                <input
                  autoFocus
                  placeholder="搜索节点名称、角色、命令或 ID..."
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value)
                    setSearchIdx(0)
                    const q = e.target.value.trim().toLowerCase()
                    if (q) {
                      const first = nodes.find((n) => {
                        const label = String(n.data.label || '').toLowerCase()
                        const id = n.id.toLowerCase()
                        const role = String(n.data.role || '').toLowerCase()
                        const prompt = String(n.data.prompt || '').toLowerCase()
                        const cmd = String(n.data.command || '').toLowerCase()
                        const tool = String(n.data.toolName || '').toLowerCase()
                        return (
                          label.includes(q) ||
                          id.includes(q) ||
                          role.includes(q) ||
                          prompt.includes(q) ||
                          cmd.includes(q) ||
                          tool.includes(q)
                        )
                      })
                      if (first) focusNode(first)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (e.shiftKey) prevSearchResult()
                      else nextSearchResult()
                    }
                  }}
                />
                {searchText.trim() && (
                  <span className="flow-search-count">
                    {matchedNodes.length > 0 ? `${searchIdx + 1}/${matchedNodes.length}` : '0 匹配'}
                  </span>
                )}
                <button
                  type="button"
                  className="flow-search-btn"
                  title="上一个 (Shift+Enter)"
                  disabled={matchedNodes.length <= 1}
                  onClick={prevSearchResult}
                >
                  <IconChevronUp size={14} />
                </button>
                <button
                  type="button"
                  className="flow-search-btn"
                  title="下一个 (Enter)"
                  disabled={matchedNodes.length <= 1}
                  onClick={nextSearchResult}
                >
                  <IconChevronDown size={14} />
                </button>
                <button
                  type="button"
                  className="flow-search-btn"
                  title="关闭 (Esc)"
                  onClick={() => {
                    setSearchOpen(false)
                    setSearchText('')
                  }}
                >
                  <IconX size={14} />
                </button>
              </div>
            )}
            <NodeInspector
              selected={selected}
              patchSelected={patchSelected}
              agents={agents}
              openBoundAgent={openBoundAgent}
              demoteToTrial={demoteToTrial}
              openPromote={openPromote}
              onRerunFromNode={(nodeId) => void startRun(nodeId)}
              upstreamNodes={upstreamNodesOf(selected?.id)}
              openFlow={requestFlowFocus}
            />
            <WorkbenchDock
              dockOpen={dockOpen}
              flowId={draft.id}
              runSteps={runSteps}
              replayOpen={replayOpen}
              setReplayOpen={setReplayOpen}
              onToggleDock={onDockClose}
              onOpenDetails={onDockDetails}
              onRerunFromMock={onDockRerunMock}
              testInput={testInput}
              onTestInputChange={setTestInput}
            />
            <ErrorBoundary name="流程对话">
              <FlowTalkPanel
                flowName={draft.name}
                flowId={draft.id}
                nodeIds={dockNodeIds}
                error={aiError}
                onRetryStrict={onDockRetry}
              />
            </ErrorBoundary>
          </div>
        </div>

        {(() => {
          const dblSelected = dblNodeId ? (nodes.find((n) => n.id === dblNodeId) ?? null) : null
          if (!dblSelected) return null
          return (
            <div
              className="flow-modal-back"
              role="dialog"
              aria-modal="true"
              aria-label="节点属性"
              onMouseDown={() => setDblNodeId(null)}
            >
              <div
                className="flow-modal flow-modal-node"
                onMouseDown={(e) => e.stopPropagation()}
                style={{ maxWidth: 520, maxHeight: '86vh', overflowY: 'auto' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2>节点属性</h2>
                  <button
                    type="button"
                    className="flow-btn"
                    title="关闭"
                    onClick={() => setDblNodeId(null)}
                    style={{ padding: '2px 8px' }}
                  >
                    <IconX size={14} />
                  </button>
                </div>
                <NodeInspector
                  selected={dblSelected}
                  patchSelected={patchSelected}
                  agents={agents}
                  openBoundAgent={openBoundAgent}
                  demoteToTrial={demoteToTrial}
                  openPromote={openPromote}
                  onRerunFromNode={(nodeId) => void startRun(nodeId)}
                  upstreamNodes={upstreamNodesOf(dblSelected.id)}
                  openFlow={requestFlowFocus}
                />
              </div>
            </div>
          )
        })()}

      </div>

      <datalist id="flow-id-options">
        {idOptions.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>

      <PublishFlowModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        draft={draft}
        setDraft={setDraft}
        pubDesc={pubDesc}
        setPubDesc={setPubDesc}
        pubVersion={pubVersion}
        setPubVersion={setPubVersion}
        pubIn={pubIn}
        pubOut={pubOut}
        onPublish={() => void doPublish()}
      />

      <PromoteAgentModal
        open={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        promoteName={promoteName}
        setPromoteName={setPromoteName}
        promoteId={promoteId}
        setPromoteId={setPromoteId}
        promoteDesc={promoteDesc}
        setPromoteDesc={setPromoteDesc}
        promoteBusy={promoteBusy}
        onPromote={() => void doPromote()}
      />
    </div>
  )
}
export default FlowCanvas
