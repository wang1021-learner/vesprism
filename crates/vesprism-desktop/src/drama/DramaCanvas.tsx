import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@nanostores/react'
import {
  ReactFlow, Background, Controls, Handle, Position, useReactFlow, BaseEdge, getBezierPath, type EdgeProps, type EdgeChange,
  type Connection, type Edge, type Node, type NodeProps, type NodeChange, type OnConnectEnd, applyNodeChanges,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { convertFileSrc } from '@tauri-apps/api/core'
import { ERROR_TEXT, addNodeCmd, linkNodes, removeNodeCmd } from './api'
import { persistLayout, placeNode, setNodeText, startJob, unlink } from './actions'
import type { DramaAsset, DramaGraphView, DramaNodeView, JobEvent, PortType } from '../../../drama-core/bindings/drama'
import {
  $dramaEditor, $dramaLayout, $dramaLinks, $dramaNodes, $dramaLinkError,
  $dramaError, $dramaFocusLinks, $dramaProjectId, $dramaSource, canConnect, editorFor, setLayout, withStale, type Pos,
} from './store'
import { $dramaJobs } from './jobs'
import { KIND_LABEL, LIBRARY, PORT_LABEL, assetKind, deleteSummary, errorText, filterByPort, makeNode, previewAsset, portColor, searchLibrary, edgeStyle, firstInvalid, focusPoint, linkKey, INVALID_EDGE_TIP, type LibItem } from './palette'
import { DramaNodeDock, LIB_MIME } from './DramaRail'

type Data = { node: DramaNodeView; expanded?: boolean; job?: JobEvent; shots?: number }

const TEXT_HINT: Record<string, string> = {
  script: '写这一场的台词或剧情',
  character: '写角色长什么样',
  shot_group: '这一组镜头在讲什么',
  shot: '写这个镜头的画面',
  voice: '配音备注',
  export: '导出备注',
}

function NodeText({ id, text, kind }: { id: string; text: string; kind: string }) {
  const [draft, setDraft] = useState(text)
  useEffect(() => { setDraft(text) }, [id, text])
  return (
    <textarea
      className="drama-text nodrag nowheel"
      rows={3}
      placeholder={TEXT_HINT[kind] ?? '写下内容'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== text) void setNodeText(id, draft) }}
    />
  )
}

function DramaNodeCard({ data }: NodeProps<Node<Data>>) {
  const n = data.node
  const job = data.job
  const busy = job?.status === 'queued' || job?.status === 'running'
  const needsLogin = job?.status === 'needs_login'
  const failed = job?.status === 'failed' || needsLogin
  return (
    <div className={`drama-node${busy ? ' is-busy' : ''}${failed ? ' is-failed' : ''}`} data-kind={n.kind}>
      {n.inputs.map((p, i) => <Handle key={`in-${p}`} id={p} type="target" position={Position.Left} title={`输入 ${PORT_LABEL[p]}`} style={{ top: 28 + i * 16, background: portColor(p) }} />)}
      <div className="drama-node-head">
        <span className="drama-kind">{KIND_LABEL[n.kind] ?? n.kind}</span>
        {n.needsUpdate && <span className="drama-badge">需更新</span>}
        {!n.needsUpdate && n.upstreamStale && <span className="drama-badge is-stale">上游有更新</span>}
        {busy && <span className="drama-badge is-run">生成中</span>}
        {failed && <span className="drama-badge is-fail">{needsLogin ? '需登录' : '失败'}</span>}
      </div>
      <div className="drama-ports">
        <span className="drama-port-col">
          {n.inputs.map(p => <span key={p} className="drama-port"><i aria-hidden style={{ background: portColor(p) }} />{PORT_LABEL[p]}</span>)}
        </span>
        <span className="drama-port-col is-out">
          {n.outputs.map(p => <span key={p} className="drama-port"><i aria-hidden style={{ background: portColor(p) }} />{PORT_LABEL[p]}</span>)}
        </span>
      </div>
      {n.locked && <div className="drama-note">已定稿</div>}
      {n.kind === 'shot_group' && <div className="drama-note">双击编辑这一组</div>}
      {n.kind === 'shot_group'
        ? <div className="drama-well">组内 {data.shots ?? 0} 个镜头</div>
        : <AssetPreview asset={previewAsset(n)} />}
      <NodeText id={n.id} text={n.text ?? ''} kind={n.kind} />
      {(n.kind === 'shot' || n.kind === 'character') && (
        <button type="button" className="btn-primary drama-gen nodrag" disabled={busy} onClick={() => void startJob(n.id)}>
          生成图片
        </button>
      )}
      {failed && job?.error && <div className="drama-error nodrag">{job.error}</div>}
      {busy && <div className="drama-progress"><span style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }} /></div>}
      {n.outputs.map((p, i) => <Handle key={`out-${p}`} id={p} type="source" position={Position.Right} title={`输出 ${PORT_LABEL[p]}`} style={{ top: 28 + i * 16, background: portColor(p) }} />)}
    </div>
  )
}

function AssetPreview({ asset }: { asset: DramaAsset | null }) {
  const k = assetKind(asset)
  const path = asset?.path ?? null
  const src = path ? (() => { try { return convertFileSrc(path) } catch { return path } })() : ''
  return (
    <div className="drama-well">
      {!k ? '还没有画面' : k === 'image' ? <img src={src} alt="" draggable={false} />
        : k === 'audio' ? <audio className="nodrag" src={src} controls />
        : k === 'video' ? <video className="nodrag" src={src} controls draggable={false} />
        : <span className="truncate px-2" title={path ?? ''}>{path}</span>}
    </div>
  )
}

function useColorMode(): 'light' | 'dark' {
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    const el = document.documentElement
    const sync = () => setMode(el.dataset.theme === 'dark' ? 'dark' : 'light')
    const obs = new MutationObserver(sync)
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return mode
}

const nodeTypes = { drama: DramaNodeCard }

type EdgeData = { port: PortType; invalid: boolean; highlight: boolean }
/** 连线：颜色跟端口类型走；失效的画红色虚线，悬停有提示（SVG title）。 */
function DramaEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<EdgeData>>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const invalid = !!data?.invalid
  return (
    <g data-invalid={invalid ? 'true' : undefined}>
      <BaseEdge id={id} path={path} interactionWidth={20} style={edgeStyle({ port: data?.port ?? 'line', invalid }, !!data?.highlight || !!selected)} />
      {invalid && <title>{INVALID_EDGE_TIP}</title>}
    </g>
  )
}
const edgeTypes = { drama: DramaEdge }
const applyGraph = (g: DramaGraphView) => { $dramaNodes.set(g.nodes); $dramaLinks.set(g.links) }
type Search = { screen: Pos; flow: Pos; port: PortType | null; from: 'source' | 'target' | null; nodeId: string | null }

export function DramaCanvas() {
  const nodes = useStore($dramaNodes)
  const links = useStore($dramaLinks)
  const layout = useStore($dramaLayout)
  const projectId = useStore($dramaProjectId)
  const linkError = useStore($dramaLinkError)
  const source = useStore($dramaSource)
  const error = useStore($dramaError)
  const jobs = useStore($dramaJobs)
  const { screenToFlowPosition, fitView, setCenter, getZoom } = useReactFlow()
  const colorMode = useColorMode()
  const wrap = useRef<HTMLDivElement>(null)
  const fitted = useRef<string | null>(null)
  const placeN = useRef(0)
  const focus = useStore($dramaFocusLinks)
  const seenFocus = useRef(focus?.seq)
  const [selEdges, setSelEdges] = useState<Set<string>>(() => new Set())
  const [selNodes, setSelNodes] = useState<Set<string>>(() => new Set())
  const [search, setSearch] = useState<Search | null>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)

  const jobByNode = useMemo(() => {
    const m: Record<string, JobEvent> = {}
    for (const j of Object.values(jobs)) m[j.nodeId] = j
    return m
  }, [jobs])

  const rfNodes = useMemo<Node<Data>[]>(() =>
    withStale(nodes, links)
      .map(n => ({ id: n.id, type: 'drama', selected: selNodes.has(n.id), position: layout[n.id] ?? { x: 0, y: 0 }, data: { node: n, job: jobByNode[n.id], shots: n.kind === 'shot_group' ? nodes.filter(x => x.kind === 'shot' && links.some(l => l.from === n.id && l.to === x.id)).length : undefined } })),
  [nodes, links, layout, jobByNode, selNodes])

  const hl = useMemo(() => new Set((focus?.links ?? []).map(linkKey)), [focus])
  const rfEdges = useMemo<Edge<EdgeData>[]>(() => {
    const byId = new Map(nodes.map(n => [n.id, n]))
    return links.map(l => {
      const key = linkKey(l)
      // 失效连线的端口可能已不在节点上：不指定 handle，让画布仍能画出来、能选中删除。
      const outOk = byId.get(l.from)?.outputs.includes(l.port) ?? false
      const inOk = byId.get(l.to)?.inputs.includes(l.port) ?? false
      return {
        id: key, type: 'drama', source: l.from, target: l.to, selected: selEdges.has(key),
        sourceHandle: l.invalid && !outOk ? undefined : l.port, targetHandle: l.invalid && !inOk ? undefined : l.port,
        data: { port: l.port, invalid: !!l.invalid, highlight: !!l.invalid && hl.has(key) },
      }
    })
  }, [links, nodes, selEdges, hl])

  const onEdgesChange = useCallback((changes: EdgeChange<Edge<EdgeData>>[]) => {
    for (const c of changes) if (c.type === 'select') setSelEdges(prev => { const s = new Set(prev); if (c.selected) s.add(c.id); else s.delete(c.id); return s })
  }, [])

  // 导出被 invalid_link 拒绝：选中第一条失效连线并把画布移过去。
  useEffect(() => {
    if (!focus || focus.seq === seenFocus.current) return
    seenFocus.current = focus.seq
    const first = firstInvalid(focus.links)
    if (!first) return
    setSelEdges(new Set([linkKey(first)]))
    const pt = focusPoint(layout[first.from], layout[first.to])
    if (pt) void setCenter(pt.x, pt.y, { zoom: Math.max(getZoom(), 0.8), duration: 200 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const onNodesChange = useCallback((changes: NodeChange<Node<Data>>[]) => {
    const next = applyNodeChanges(changes, rfNodes)
    for (const c of changes) {
      if (c.type === 'select') { setSelNodes(prev => { const s = new Set(prev); if (c.selected) s.add(c.id); else s.delete(c.id); return s }); continue }
      if (c.type !== 'position') continue
      const pos = c.position ?? (c.dragging === false ? next.find(n => n.id === c.id)?.position : undefined)
      if (!pos) continue
      setLayout(c.id, pos)
      if (c.dragging === false) void persistLayout(c.id, pos)
    }
  }, [rfNodes])

  const isValidConnection = useCallback((c: Connection | Edge) => {
    const from = nodes.find(n => n.id === c.source); const to = nodes.find(n => n.id === c.target)
    return !!from && !!to && c.sourceHandle === c.targetHandle && canConnect(from, to, c.sourceHandle as PortType)
  }, [nodes])

  const onConnect = useCallback((c: Connection) => {
    const link = { from: c.source, to: c.target, port: c.sourceHandle as PortType }
    $dramaError.set(null)
    const pid = $dramaProjectId.get()
    if ($dramaSource.get() === 'mock' || !pid) { $dramaLinks.set([...$dramaLinks.get(), { ...link, invalid: false }]); return }
    void linkNodes(pid, link).then(r => {
      if (r.ok) applyGraph(r.value); else $dramaError.set(errorText(r.error, ERROR_TEXT))
    })
  }, [])

  const openSearch = (clientX: number, clientY: number, port: PortType | null = null, from: Search['from'] = null, nodeId: string | null = null) => {
    const r = wrap.current?.getBoundingClientRect()
    setSearch({ screen: { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) }, flow: screenToFlowPosition({ x: clientX, y: clientY }), port, from, nodeId })
    setQ(''); setSel(0)
  }

  const addNode = (item: LibItem, at: Pos, conn?: { port: PortType; from: 'source' | 'target'; nodeId: string }) => {
    const pid = $dramaProjectId.get()
    if ($dramaSource.get() === 'backend' && pid) { if (item.kind) void addRemote(pid, item.kind, at, conn); return }
    const id = `${item.key}-${Date.now().toString(36)}`
    const n = makeNode(item, $dramaNodes.get(), id); if (!n) return
    $dramaNodes.set([...$dramaNodes.get(), n]); setLayout(id, at)
    if (conn) onConnect(conn.from === 'source'
      ? { source: conn.nodeId, target: id, sourceHandle: conn.port, targetHandle: conn.port }
      : { source: id, target: conn.nodeId, sourceHandle: conn.port, targetHandle: conn.port })
  }

  // 后端模式：用后端返回的真实 id；失败不改本地图（即回滚）并提示。
  const addRemote = async (pid: string, kind: NonNullable<LibItem['kind']>, at: Pos, conn?: { port: PortType; from: 'source' | 'target'; nodeId: string }) => {
    $dramaError.set(null)
    const r = await addNodeCmd({ projectId: pid, kind, position: { x: Math.round(at.x), y: Math.round(at.y) } })
    if (!r.ok) { $dramaError.set(errorText(r.error, ERROR_TEXT)); return }
    const id = r.value.nodeId
    applyGraph(r.value.graph)
    setLayout(id, at)
    if (!r.value.graph.layout?.[id]) void persistLayout(id, at)
    if (conn) onConnect(conn.from === 'source'
      ? { source: conn.nodeId, target: id, sourceHandle: conn.port, targetHandle: conn.port }
      : { source: id, target: conn.nodeId, sourceHandle: conn.port, targetHandle: conn.port })
  }

  // 后端模式下删节点走 drama_remove_node；返回 false 让画布先不删，以后端结果为准，失败时节点原样保留。
  const onBeforeDelete = useCallback(async ({ nodes: ns }: { nodes: Node<Data>[]; edges: Edge[] }) => {
    const pid = $dramaProjectId.get()
    if ($dramaSource.get() !== 'backend' || !pid || ns.length === 0) {
      if (ns.length) { const ids = new Set(ns.map(n => n.id)); $dramaNodes.set($dramaNodes.get().filter(n => !ids.has(n.id))); $dramaLinks.set($dramaLinks.get().filter(l => !ids.has(l.from) && !ids.has(l.to))); return false }
      return true
    }
    $dramaError.set(null)
    // 逐个删：成功的以后端结果为准，失败的留在画布上。
    const failed: { message: string }[] = []
    for (const n of ns) {
      const r = await removeNodeCmd({ projectId: pid, nodeId: n.id })
      if (r.ok) applyGraph(r.value); else failed.push({ message: errorText(r.error, ERROR_TEXT) })
    }
    $dramaError.set(deleteSummary(ns.length, failed))
    return false
  }, [])

  const onConnectEnd: OnConnectEnd = useCallback((ev, st) => {
    if (st.isValid || !st.fromHandle?.id || !st.fromNode) return
    if (!(ev.target as Element | null)?.closest?.('.react-flow__pane')) return
    const p = 'changedTouches' in ev ? ev.changedTouches[0] : ev
    openSearch(p.clientX, p.clientY, st.fromHandle.id as PortType, st.fromHandle.type, st.fromNode.id)
  }, [screenToFlowPosition])

  const candidates = search ? searchLibrary(filterByPort(LIBRARY, search.port, search.from), q).filter(i => i.kind) : []
  const pick = (item: LibItem | undefined) => {
    if (!search || !item) return
    addNode(item, search.flow, search.port && search.from && search.nodeId ? { port: search.port, from: search.from, nodeId: search.nodeId } : undefined)
    setSearch(null)
  }

  const onNodeDoubleClick = useCallback((_: unknown, n: Node<Data>) => {
    const kind = editorFor(n.data.node.kind); if (kind) $dramaEditor.set({ nodeId: n.id, kind, mode: 'side' })
  }, [])

  useEffect(() => {
    if (!projectId || nodes.length === 0 || fitted.current === projectId) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        fitted.current = projectId
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        void fitView({ padding: 0.18, duration: reduce ? 0 : 180 })
      })
    })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [projectId, nodes.length, fitView])

  const placeInView = (kind: NonNullable<LibItem['kind']>) => {
    const rect = wrap.current?.getBoundingClientRect()
    const n = placeN.current++
    const at = rect
      ? screenToFlowPosition({ x: rect.left + 56 + (n % 4) * 36, y: rect.top + 64 + (n % 3) * 28 })
      : { x: 80 + n * 24, y: 80 }
    void placeNode(kind, at)
  }

  return (
    <>
    <DramaNodeDock onPlace={placeInView} />
    <div ref={wrap} className="drama-canvas" data-testid="drama-canvas"
      onDoubleClick={e => { if ((e.target as Element).closest('.react-flow__pane')) openSearch(e.clientX, e.clientY) }}
      onDragOver={e => {
        const types = e.dataTransfer.types
        if (types.includes(LIB_MIME) || types.includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
      }}
      onDrop={e => {
        const key = e.dataTransfer.getData(LIB_MIME) || e.dataTransfer.getData('text/plain')
        const item = LIBRARY.find(i => i.key === key); if (!item?.kind) return
        e.preventDefault(); addNode(item, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
      }}>
      <ReactFlow
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onEdgesChange={onEdgesChange} deleteKeyCode={['Backspace', 'Delete']}
        onNodesChange={onNodesChange} onConnect={onConnect} onBeforeDelete={onBeforeDelete} onConnectEnd={onConnectEnd}
        onEdgesDelete={es => es.forEach(e => void unlink($dramaLinks.get().find(l => linkKey(l) === e.id) ?? { from: e.source, to: e.target, port: (e.data?.port ?? e.sourceHandle) as PortType }))} isValidConnection={isValidConnection}
        onNodeDoubleClick={onNodeDoubleClick} onPaneClick={() => setSearch(null)}
        nodesDraggable zoomOnDoubleClick={false} fitView colorMode={colorMode}
      >
        <Background gap={22} size={1.2} color="var(--text-muted)" />
        <Controls position="bottom-right" />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="drama-empty absolute inset-0">
          <div className="drama-empty-frame" />
          <strong>画布是空的</strong>
          <span>点上方或左侧的节点类型，也可以双击空白处</span>
        </div>
      )}
      {search && (
        <div className="drama-search" style={{ left: search.screen.x, top: search.screen.y }} data-testid="node-search">
          <input autoFocus placeholder={search.port ? `搜索可接「${PORT_LABEL[search.port]}」的节点` : '搜索节点'}
            value={q} onChange={e => { setQ(e.target.value); setSel(0) }}
            onKeyDown={e => {
              if (e.key === 'Escape') setSearch(null)
              else if (e.key === 'ArrowDown') setSel(s => Math.min(s + 1, candidates.length - 1))
              else if (e.key === 'ArrowUp') setSel(s => Math.max(s - 1, 0))
              else if (e.key === 'Enter') pick(candidates[sel])
            }} />
          {candidates.length === 0 && <div className="drama-muted px-2 py-1">没有匹配的节点</div>}
          {candidates.map((c, i) => (
            <button key={c.key} className={i === sel ? 'is-on' : ''} onMouseEnter={() => setSel(i)} onClick={() => pick(c)}>{c.label}</button>
          ))}
        </div>
      )}
      {linkError && <div className="drama-toast" style={{ top: 12 }}>连线被拒：{ERROR_TEXT[linkError.code] ?? linkError.code}</div>}
      {error && <div role="alert" className="drama-toast" style={{ top: linkError ? 52 : 12 }}>{error}</div>}
      {source === 'mock' && <div data-testid="mock-badge" className="drama-mock">模拟数据</div>}
    </div>
    </>
  )
}
