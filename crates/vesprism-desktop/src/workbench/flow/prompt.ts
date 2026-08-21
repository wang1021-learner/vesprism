/** 画布图契约：英文 TS 类型。每个会话只在首轮完整下发。 */

/** 度数/结构规则（validator 强制，违反即整图作废）。heal 自愈时也会附上。 */
export const FLOW_EDGE_RULES = `Edge-degree rules (STRICT, the validator enforces these — a violation invalidates the whole graph):
- start has exactly 1 outgoing edge.
- agent / tool / http / database / knowledge / variable / transform / loop / flow each have exactly 1 outgoing edge.
- loop_end has exactly 1 incoming edge (from the loop body) and exactly 1 outgoing edge.
- loop body: the single node right after a "loop" must be one executable node (agent/tool/http/variable/transform) connected directly into "loop_end"; no control nodes as loop body.
- branch has at least 2 outgoing edges (binary branch: label edges "success" / "failure"; N-way: use semantic labels).
- parallel has at least 2 outgoing edges; every direct branch target MUST be a single "agent" or "tool" node (no nested chains inside a parallel branch — if you need multiple steps, extract them into a subflow).
- every parallel branch node must connect DIRECTLY into one "join" node (or "end"); no chaining past the branch into other node types.
- join has at least 2 incoming edges and exactly 1 outgoing edge.
- end has 0 outgoing edges.`

export const FLOW_GENERATE_SYSTEM = `Prefer a single \`\`\`json fence. You may write at most 1–2 short sentences of design rationale, then the JSON. No long essays.

Write label/role/prompt and edge label in the SAME language as the user message.
Keep id/type in the machine vocabulary below.
Always use semantic kebab-case ids: {type}-{purpose}, e.g. start-main, agent-code-reviewer, tool-lint, branch-check, join-results, end-report.
Never use random suffixes (node-a8f, agent-x7k). Never rename existing ids in a patch.
No coordinates, no absolute paths, do not publish, do not write the agent library.
At least one start and one end. Edge from/to must exist. from !== to.
${FLOW_EDGE_RULES}
Constraints:
- All nodes must be connected (no orphans; every node reachable from start, and start can reach end).
- Graph must be a DAG (no cycles).
- Never reference undefined node IDs in edges.
- start.fields[].name MUST be a plain identifier: only letters/digits/underscore, no quotes, braces, or spaces (e.g. "phoneNumber", not "\"phoneNumber\"" or "{\"phoneNumber\"". The canvas sanitizes these, but clean names prevent data loss).

interface FlowGraph {
  nodes: Array<
    | { id: string; type: "start"; params: { label?: string; fields?: Array<{ name: string; type: "string"|"number"|"boolean"|"object"|"array"; required?: boolean }> } }    | { id: string; type: "agent"; params: { label?: string; role?: string; prompt?: string; presetId?: string; model?: string; maxOutputTokens?: number; retry?: number; timeoutSecs?: number } }
    | { id: string; type: "tool"; params: { label?: string; toolName?: string; command?: string; args?: Record<string, unknown>; retry?: number; timeoutSecs?: number; outputSchema?: Record<string, unknown> } }
    | { id: string; type: "http"; params: { label?: string; url?: string; method?: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"|"HEAD"; headers?: string; body?: string; retry?: number; timeoutSecs?: number; outputSchema?: Record<string, unknown> } }
    | { id: string; type: "database"; params: { label?: string; sql?: string; dbPath?: string; retry?: number } }
    | { id: string; type: "knowledge"; params: { label?: string; knowledgeBase?: string; query?: string; limit?: number; retry?: number } }
    | { id: string; type: "variable"; params: { label?: string; value?: string; valueType?: "string"|"number"|"boolean"|"json" } }
    | { id: string; type: "transform"; params: { label?: string; code?: string } }
    | { id: string; type: "loop"; params: { label?: string } }
    | { id: string; type: "loop_end"; params: { label?: string } }
    | { id: string; type: "flow"; params: { label?: string; flowId?: string; input?: Record<string, unknown> } }
    | { id: string; type: "branch"; params: { label?: string; condition: "success"|"failure"|"expression"; expression?: string } }
    | { id: string; type: "parallel"; params: { label?: string; mode?: "all"|"race" } }
    | { id: string; type: "join"; params: { label?: string; mergeMode?: "merge_json"|"list"|"all_success" } }
    | { id: string; type: "end"; params: { label?: string; outputSchema?: Record<string, unknown> } }
  >;
  edges: Array<{ from: string; to: string; label?: string }>;
}

interface FlowPatch {
  patch: {
    update_nodes?: Array<{ id: string; params: Record<string, unknown> }>;
    add_nodes?: FlowGraph["nodes"];
    remove_nodes?: string[];
    add_edges?: FlowGraph["edges"];
    remove_edges?: Array<{ from: string; to: string }>;
  };
}

If the canvas already has a graph and the user asks for a local change, emit FlowPatch.
If they ask to regenerate or the canvas is empty, emit FlowGraph.
params on update_nodes are shallow-merged; omitted keys stay.

Example parallel pattern (copy the shape, not the ids, unless they fit):
{"nodes":[{"id":"start-main","type":"start","params":{}},{"id":"parallel-scan","type":"parallel","params":{}},{"id":"agent-left","type":"agent","params":{}},{"id":"agent-right","type":"agent","params":{}},{"id":"join-results","type":"join","params":{}},{"id":"end-report","type":"end","params":{}}],"edges":[{"from":"start-main","to":"parallel-scan"},{"from":"parallel-scan","to":"agent-left"},{"from":"parallel-scan","to":"agent-right"},{"from":"agent-left","to":"join-results"},{"from":"agent-right","to":"join-results"},{"from":"join-results","to":"end-report"}]}`

export function summarizeTopology(nodeIds: string[]): string {
  return nodeIds.map((id) => id.trim()).filter(Boolean).join('  ')
}

export function canvasContextAnchor(
  meta: { name: string; id: string },
  nodeIds?: string[],
): string {
  const head = `[Canvas Context: Flow "${meta.name}" (id: ${meta.id})]`
  const topo = summarizeTopology(nodeIds ?? [])
  return topo ? `${head}\nCurrent Topology: ${topo}` : head
}

export const FLOW_RETRY_STRICT = `Emit only a closed JSON FlowGraph or FlowPatch. No other text.
${FLOW_GENERATE_SYSTEM}`

export const FLOW_HEAL_MARKER = 'Your previous graph had a validation error:'

export function buildHealPrompt(error: string): string {
  const reason = error.trim() || 'invalid graph'
  return `${FLOW_HEAL_MARKER} ${reason}

${FLOW_EDGE_RULES}

Fix the graph and re-emit only a valid FlowGraph or FlowPatch JSON object.`
}

export const FLOW_PARALLEL_SKELETON = {
  nodes: [
    { id: 'start-main', type: 'start', params: {} },
    { id: 'parallel-scan', type: 'parallel', params: {} },
    { id: 'agent-left', type: 'agent', params: {} },
    { id: 'agent-right', type: 'agent', params: {} },
    { id: 'join-results', type: 'join', params: {} },
    { id: 'end-report', type: 'end', params: {} },
  ],
  edges: [
    { from: 'start-main', to: 'parallel-scan' },
    { from: 'parallel-scan', to: 'agent-left' },
    { from: 'parallel-scan', to: 'agent-right' },
    { from: 'agent-left', to: 'join-results' },
    { from: 'agent-right', to: 'join-results' },
    { from: 'join-results', to: 'end-report' },
  ],
} as const

const primedSessions = new Set<string>()

export function isCanvasContractPrimed(sessionId?: string | null): boolean {
  const id = (sessionId ?? '').trim()
  return Boolean(id && primedSessions.has(id))
}

export function markCanvasContractPrimed(sessionId?: string | null): void {
  const id = (sessionId ?? '').trim()
  if (id) primedSessions.add(id)
}

export function buildGeneratePrompt(userText: string): string {
  const need = userText.trim()
  return `Generate a flow graph: ${need}

${FLOW_GENERATE_SYSTEM}

User:
${need}
`
}

export function buildDialoguePrompt(
  userText: string,
  meta: { name: string; id: string },
  opts?: { primed?: boolean; nodeIds?: string[] },
): string {
  const need = userText.trim()
  const graph = canvasContextAnchor(meta, opts?.nodeIds)
  const query = need || '(see attachments)'
  if (opts?.primed) {
    return `<current_graph>
${graph}
</current_graph>
<user_query>
${query}
</user_query>`
  }
  return `<instructions>
You are the Vesprism flow-canvas orchestrator for flow "${meta.name}" (${meta.id}).
Attachments and @paths are project source — read them via tools, do not expect them inlined here.
You may: chat; emit a FlowGraph to create/redraw; emit a FlowPatch for a local edit; draft agent node role/prompt/label (do not write the agent library).
Do not emit JSON unless the user wants a graph change.
A graph change may start with 1–2 short sentences, then one json fence.

${FLOW_GENERATE_SYSTEM}
</instructions>
<current_graph>
${graph}
</current_graph>
<user_query>
${query}
</user_query>`
}
