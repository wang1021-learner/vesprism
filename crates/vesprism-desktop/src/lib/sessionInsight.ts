/** 官方 x.ai/session/info + session/usage 的展示整形。 */

export type ContextCategory = {
  label: string
  tokens: number
  detail?: string
}

export type SessionContextInfo = {
  used: number
  total: number
  systemPromptTokens: number
  messageTokens: number
  freeTokens: number
  usagePct: number
  autoCompactAt: number
  turnCount: number
  toolCallCount: number
  compactionCount: number
  toolDefinitionsCount: number
  toolDefinitionsTokens: number
  categories: ContextCategory[]
}

export type SessionInfoView = {
  sessionId: string
  cwd: string
  model: string
  modelDisplay: string
  agentName: string
  turns: number
  turnIndex: number
  apiBackend: string
  context: SessionContextInfo
}

export type UsageModelRow = {
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedReadTokens: number
  reasoningTokens: number
  modelCalls: number
  apiDurationMs: number
  costUsdTicks: number | null
  costIsPartial: boolean
}

export type SessionUsageView = {
  totals: UsageModelRow
  byModel: UsageModelRow[]
  numTurns: number
  incomplete: boolean
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function parseSessionInfo(raw: unknown): SessionInfoView | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const ctxRaw =
    o.context && typeof o.context === 'object'
      ? (o.context as Record<string, unknown>)
      : o
  const catsRaw = ctxRaw.usageCategories ?? ctxRaw.usage_categories
  const categories: ContextCategory[] = Array.isArray(catsRaw)
    ? catsRaw.map((c) => {
        const x = (c || {}) as Record<string, unknown>
        return {
          label: str(x.label) || '其他',
          tokens: num(x.tokens),
          detail: str(x.detail) || undefined,
        }
      })
    : []
  const used = num(ctxRaw.used)
  const total = num(ctxRaw.total)
  return {
    sessionId: str(o.sessionId || o.session_id),
    cwd: str(o.cwd),
    model: str(o.model),
    modelDisplay: str(o.modelDisplayName || o.model_display_name || o.model),
    agentName: str(o.agentName || o.agent_name),
    turns: num(o.turns),
    turnIndex: num(o.turnIndex ?? o.turn_index),
    apiBackend: str(o.apiBackend || o.api_backend),
    context: {
      used,
      total,
      systemPromptTokens: num(ctxRaw.systemPromptTokens ?? ctxRaw.system_prompt_tokens),
      messageTokens: num(ctxRaw.messageTokens ?? ctxRaw.message_tokens),
      freeTokens: num(ctxRaw.freeTokens ?? ctxRaw.free_tokens),
      usagePct: num(ctxRaw.usagePct ?? ctxRaw.usage_pct),
      autoCompactAt: num(
        ctxRaw.autoCompactThresholdPercent ?? ctxRaw.auto_compact_threshold_percent,
        85,
      ),
      turnCount: num(ctxRaw.turnCount ?? ctxRaw.turn_count ?? o.turns),
      toolCallCount: num(ctxRaw.toolCallCount ?? ctxRaw.tool_call_count),
      compactionCount: num(ctxRaw.compactionCount ?? ctxRaw.compaction_count),
      toolDefinitionsCount: num(
        ctxRaw.toolDefinitionsCount ?? ctxRaw.tool_definitions_count,
      ),
      toolDefinitionsTokens: num(
        ctxRaw.toolDefinitionsTokens ?? ctxRaw.tool_definitions_tokens,
      ),
      categories,
    },
  }
}

function parseUsageRow(raw: unknown, model = ''): UsageModelRow {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ticks = o.costUsdTicks ?? o.cost_usd_ticks
  return {
    model,
    inputTokens: num(o.inputTokens ?? o.input_tokens),
    outputTokens: num(o.outputTokens ?? o.output_tokens),
    totalTokens: num(o.totalTokens ?? o.total_tokens),
    cachedReadTokens: num(o.cachedReadTokens ?? o.cached_read_tokens),
    reasoningTokens: num(o.reasoningTokens ?? o.reasoning_tokens),
    modelCalls: num(o.modelCalls ?? o.model_calls),
    apiDurationMs: num(o.apiDurationMs ?? o.api_duration_ms),
    costUsdTicks: ticks == null || ticks === '' ? null : num(ticks),
    costIsPartial: Boolean(o.costIsPartial ?? o.cost_is_partial),
  }
}

export function parseSessionUsage(raw: unknown): SessionUsageView | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const usage = (o.usage && typeof o.usage === 'object' ? o.usage : o) as Record<
    string,
    unknown
  >
  const totals = parseUsageRow(usage)
  const map = usage.modelUsage ?? usage.model_usage
  const byModel: UsageModelRow[] = []
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
      byModel.push(parseUsageRow(v, k))
    }
  }
  return {
    totals,
    byModel,
    numTurns: num(usage.numTurns ?? usage.num_turns),
    incomplete: Boolean(usage.usageIsIncomplete ?? usage.usage_is_incomplete),
  }
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  const k = n / 1000
  if (k < 10) return `${k.toFixed(1)}K`
  if (k < 1000) return `${Math.round(k)}K`
  return `${(k / 1000).toFixed(1)}M`
}

export function formatUsdTicks(ticks: number | null, partial = false): string {
  if (ticks == null) return partial ? '费用不完整' : '—'
  const usd = ticks / 1e10
  const text = usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
  return partial ? `${text}（部分）` : text
}

export function formatDurationMs(ms: number): string {
  if (!ms || ms < 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m${rem}s`
}

export function contextBarParts(ctx: SessionContextInfo): {
  system: number
  messages: number
  free: number
} {
  const total = Math.max(ctx.total, ctx.used + ctx.freeTokens, 1)
  const system = Math.max(0, ctx.systemPromptTokens)
  const messages = Math.max(0, ctx.messageTokens)
  const accounted = system + messages
  const free = Math.max(0, total - accounted)
  const sum = system + messages + free || 1
  return {
    system: (system / sum) * 100,
    messages: (messages / sum) * 100,
    free: (free / sum) * 100,
  }
}

export function exportTranscriptMarkdown(
  messages: Array<{ role: string; text?: string; toolCall?: { title?: string; detail?: string; preview?: string } }>,
): string {
  const lines: string[] = ['# 会话导出', '']
  for (const m of messages) {
    if (m.role === 'user' && m.text?.trim()) {
      lines.push('## 你', '', m.text.trim(), '')
    } else if (m.role === 'assistant' && m.text?.trim()) {
      lines.push('## 助手', '', m.text.trim(), '')
    } else if (m.role === 'tool' && m.toolCall) {
      const t = m.toolCall
      const body = (t.preview || t.detail || '').trim()
      lines.push(`## 工具 · ${t.title || 'tool'}`, '')
      if (body) lines.push('```', body.slice(0, 8000), '```', '')
    }
  }
  return lines.join('\n').trim() + '\n'
}
