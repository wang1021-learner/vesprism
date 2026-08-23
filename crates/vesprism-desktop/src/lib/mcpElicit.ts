/**
 * MCP elicitation：官方 requestedSchema → 表单字段；URL 只允许 http(s) 且无内嵌凭据。
 */
export type ElicitFieldKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'single'
  | 'multi'
  | 'unsupported'

export type ElicitField = {
  name: string
  title: string
  description?: string
  required: boolean
  kind: ElicitFieldKind
  format?: string
  options?: { value: string; label: string }[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  defaultText?: string
  defaultBool?: boolean
  defaultIndex?: number | null
  defaultIndexes?: number[]
  reason?: string
}

export type ElicitFieldValue =
  | { kind: 'text'; draft: string }
  | { kind: 'bool'; on: boolean }
  | { kind: 'choice'; index: number | null }
  | { kind: 'multi'; selected: boolean[] }
  | { kind: 'none' }

const MAX_FIELDS = 32

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function enumOptions(schema: Record<string, unknown>): { value: string; label: string }[] {
  const raw = schema.enum
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is string => typeof x === 'string')
      .map((value) => ({ value, label: value }))
  }
  const anyOf = schema.anyOf
  if (!Array.isArray(anyOf)) return []
  const out: { value: string; label: string }[] = []
  for (const item of anyOf) {
    const o = asObj(item)
    if (!o) continue
    const value =
      typeof o.const === 'string'
        ? o.const
        : Array.isArray(o.enum) && typeof o.enum[0] === 'string'
          ? o.enum[0]
          : undefined
    if (!value) continue
    out.push({ value, label: str(o.title) || value })
  }
  return out
}

function fieldFromProp(name: string, raw: unknown, required: Set<string>): ElicitField {
  const schema = asObj(raw) || {}
  const title = str(schema.title) || name
  const description = str(schema.description)
  const req = required.has(name)
  const type = str(schema.type) || 'string'
  const options = enumOptions(schema)
  const base = { name, title, description, required: req }

  if (type === 'boolean') {
    return { ...base, kind: 'boolean', defaultBool: schema.default === true }
  }
  if (type === 'integer') {
    return {
      ...base,
      kind: 'integer',
      minimum: num(schema.minimum),
      maximum: num(schema.maximum),
      defaultText: schema.default == null ? undefined : String(schema.default),
    }
  }
  if (type === 'number') {
    return {
      ...base,
      kind: 'number',
      minimum: num(schema.minimum),
      maximum: num(schema.maximum),
      defaultText: schema.default == null ? undefined : String(schema.default),
    }
  }
  if (type === 'array') {
    const items = asObj(schema.items) || {}
    const opts = enumOptions(items)
    if (opts.length) {
      const def = Array.isArray(schema.default) ? schema.default.filter((x): x is string => typeof x === 'string') : []
      const defaultIndexes = def
        .map((v) => opts.findIndex((o) => o.value === v))
        .filter((i) => i >= 0)
      return {
        ...base,
        kind: 'multi',
        options: opts,
        minItems: num(schema.minItems),
        maxItems: num(schema.maxItems),
        defaultIndexes,
      }
    }
    return { ...base, kind: 'unsupported', reason: 'array' }
  }
  if (options.length) {
    const def = typeof schema.default === 'string' ? schema.default : undefined
    const defaultIndex = def ? options.findIndex((o) => o.value === def) : -1
    return {
      ...base,
      kind: 'single',
      options,
      defaultIndex: defaultIndex >= 0 ? defaultIndex : null,
    }
  }
  if (type === 'string') {
    return {
      ...base,
      kind: 'string',
      format: str(schema.format),
      minLength: num(schema.minLength),
      maxLength: num(schema.maxLength),
      defaultText: typeof schema.default === 'string' ? schema.default : undefined,
    }
  }
  return { ...base, kind: 'unsupported', reason: type }
}

export function parseElicitSchema(schema: unknown): { fields: ElicitField[]; error?: string } {
  const obj = asObj(schema)
  if (!obj) return { fields: [], error: '表单 schema 不是对象' }
  const t = str(obj.type)
  if (t && t !== 'object') return { fields: [], error: '表单 schema.type 必须是 object' }
  const props = asObj(obj.properties) || {}
  const names = Object.keys(props).slice(0, MAX_FIELDS)
  const required = new Set(
    Array.isArray(obj.required) ? obj.required.filter((x): x is string => typeof x === 'string') : [],
  )
  return { fields: names.map((name) => fieldFromProp(name, props[name], required)) }
}

export function defaultValue(field: ElicitField): ElicitFieldValue {
  switch (field.kind) {
    case 'boolean':
      return { kind: 'bool', on: Boolean(field.defaultBool) }
    case 'single':
      return { kind: 'choice', index: field.defaultIndex ?? null }
    case 'multi': {
      const n = field.options?.length ?? 0
      const selected = Array.from({ length: n }, () => false)
      for (const i of field.defaultIndexes ?? []) {
        if (i >= 0 && i < n) selected[i] = true
      }
      return { kind: 'multi', selected }
    }
    case 'unsupported':
      return { kind: 'none' }
    default:
      return { kind: 'text', draft: field.defaultText ?? '' }
  }
}

export function collectElicitContent(
  fields: ElicitField[],
  values: ElicitFieldValue[],
): { content: Record<string, unknown>; errors: Record<string, string> } {
  const content: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  fields.forEach((f, i) => {
    const v = values[i] || defaultValue(f)
    const err = validateField(f, v)
    if (err) {
      errors[f.name] = err
      return
    }
    const packed = packField(f, v)
    if (packed !== undefined) content[f.name] = packed
  })
  return { content, errors }
}

function validateField(f: ElicitField, v: ElicitFieldValue): string | null {
  if (f.kind === 'unsupported') return f.required ? '不支持的字段类型' : null
  if (v.kind === 'text') {
    const d = v.draft
    if (!d) return f.required ? '必填' : null
    if (f.kind === 'integer' && !/^-?\d+$/.test(d.trim())) return '需要整数'
    if (f.kind === 'number' && !Number.isFinite(Number(d))) return '需要数字'
    if (f.minLength != null && [...d].length < f.minLength) return `至少 ${f.minLength} 字`
    if (f.maxLength != null && [...d].length > f.maxLength) return `最多 ${f.maxLength} 字`
    if (f.minimum != null && Number(d) < f.minimum) return `最小 ${f.minimum}`
    if (f.maximum != null && Number(d) > f.maximum) return `最大 ${f.maximum}`
    if (f.format === 'email' && !d.includes('@')) return '需要邮箱'
    return null
  }
  if (v.kind === 'choice') {
    if (v.index == null) return f.required ? '必填' : null
    return null
  }
  if (v.kind === 'multi') {
    const n = v.selected.filter(Boolean).length
    if (n === 0) return f.required ? '必填' : null
    if (f.minItems != null && n < f.minItems) return `至少选 ${f.minItems} 项`
    if (f.maxItems != null && n > f.maxItems) return `最多选 ${f.maxItems} 项`
    return null
  }
  return null
}

function packField(f: ElicitField, v: ElicitFieldValue): unknown {
  if (v.kind === 'text') {
    if (!v.draft) return undefined
    if (f.kind === 'integer') return Number.parseInt(v.draft, 10)
    if (f.kind === 'number') return Number(v.draft)
    return v.draft
  }
  if (v.kind === 'bool') return v.on
  if (v.kind === 'choice') {
    if (v.index == null) return undefined
    return f.options?.[v.index]?.value
  }
  if (v.kind === 'multi') {
    return f.options?.filter((_, i) => v.selected[i]).map((o) => o.value) ?? []
  }
  return undefined
}

/** 官方 pager 同款：只允许 http(s)，不要内嵌用户名密码。 */
export function checkElicitUrl(raw: string): { url: string; host: string; punycode: boolean } | { error: string } {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return { error: '链接格式不对' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: `不支持 ${parsed.protocol.replace(':', '')}` }
  }
  if (parsed.username || parsed.password) {
    return { error: '链接里带了账号密码' }
  }
  if (!parsed.hostname) return { error: '没有主机名' }
  return {
    url: parsed.toString(),
    host: parsed.hostname,
    punycode: parsed.hostname.split('.').some((p) => p.startsWith('xn--')),
  }
}
