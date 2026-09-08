/**
 * 官方 session/new · session/set_config_option 的 configOptions。
 * 模型列表与推理档以这份为准（企业策略钉死的允许集、effort 对应不同 model id）。
 */

export type SessionConfigValue = {
  value: string
  name: string
  description?: string
}

export type SessionConfigOption = {
  id: string
  name: string
  category?: string
  currentValue?: string
  description?: string
  values: SessionConfigValue[]
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function parseValues(raw: unknown): SessionConfigValue[] {
  if (!raw) return []
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { options?: unknown }).options)
      ? ((raw as { options: unknown[] }).options)
      : []
  const out: SessionConfigValue[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const value = str(o.value ?? o.id)
    if (!value) continue
    const name = str(o.name ?? o.label) || value
    const description = str(o.description) || undefined
    out.push(description ? { value, name, description } : { value, name })
  }
  return out
}

/** 把 ACP SessionConfigOption JSON（select flatten）收成桌面用的扁列表。 */
export function parseSessionConfigOptions(raw: unknown): SessionConfigOption[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { options?: unknown })?.options)
      ? ((raw as { options: unknown[] }).options)
      : []
  const out: SessionConfigOption[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = str(o.id)
    if (!id) continue
    const kind = o.kind && typeof o.kind === 'object' ? (o.kind as Record<string, unknown>) : o
    const currentValue =
      str(o.currentValue ?? o.current_value ?? kind.currentValue ?? kind.current_value) ||
      undefined
    const values = parseValues(
      o.options ?? kind.options ?? (Array.isArray(kind.select) ? kind.select : undefined),
    )
    const category = str(o.category).toLowerCase() || undefined
    const name = str(o.name ?? o.label) || id
    const description = str(o.description) || undefined
    out.push({
      id,
      name,
      ...(category ? { category } : {}),
      ...(currentValue ? { currentValue } : {}),
      ...(description ? { description } : {}),
      values,
    })
  }
  return out
}

export function configOptionById(
  opts: SessionConfigOption[],
  id: string,
): SessionConfigOption | undefined {
  const want = id.trim().toLowerCase()
  return opts.find((o) => o.id.toLowerCase() === want)
}

/** 官方模型选择器的允许 id。没有 model 选项 = 不做策略过滤。 */
export function allowedModelIds(opts: SessionConfigOption[]): Set<string> | null {
  const model = configOptionById(opts, 'model')
  if (!model || model.values.length === 0) return null
  return new Set(model.values.map((v) => v.value))
}

export function filterModelsByPolicy<T extends { id: string; model?: string; name?: string }>(
  models: T[],
  opts: SessionConfigOption[],
): T[] {
  const allowed = allowedModelIds(opts)
  if (!allowed) return models
  return models.filter((m) => {
    if (allowed.has(m.id)) return true
    const model = (m.model || '').trim()
    if (model && allowed.has(model)) return true
    const name = (m.name || '').trim()
    return Boolean(name && allowed.has(name))
  })
}

export function effortOption(opts: SessionConfigOption[]): SessionConfigOption | undefined {
  return (
    configOptionById(opts, 'reasoning_effort') ||
    opts.find((o) => (o.category || '').toLowerCase() === 'thoughtlevel' || o.category === 'mode')
  )
}

/** 官方推理档（value 可能是 effort 名，也可能是按档路由的 model id）。 */
export function effortValuesFromConfig(
  opts: SessionConfigOption[],
): SessionConfigValue[] | null {
  const effort = effortOption(opts)
  if (!effort || effort.values.length === 0) return null
  return effort.values
}
