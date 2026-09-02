import type { OfficeFormat } from './catalog'

export const OFFICE_SLASH: readonly {
  id: 'docx' | 'pdf' | 'pptx' | 'xlsx'
  format: OfficeFormat
  hint: string
  blurb: string
}[] = [
  { id: 'docx', format: 'doc', hint: '文稿预览', blurb: '生成文稿预览（不是真 Word）' },
  { id: 'pdf', format: 'doc', hint: '文稿预览', blurb: '文稿预览（没有 PDF 渲染）' },
  { id: 'pptx', format: 'pptx', hint: '幻灯片预览', blurb: '生成幻灯片预览' },
  { id: 'xlsx', format: 'xlsx', hint: '表格预览', blurb: '生成表格预览' },
]

export function slashHits(draft: string): (typeof OFFICE_SLASH)[number][] {
  if (!draft.startsWith('/')) return []
  if (/\s/.test(draft)) return []
  const q = draft.slice(1).toLowerCase()
  return OFFICE_SLASH.filter((s) => s.id.startsWith(q))
}

export function parseOfficeSlash(text: string): { prompt: string; format?: OfficeFormat } {
  const raw = text.trim()
  const m = raw.match(/^\/(docx|pdf|pptx|xlsx)(?:\s+|$)/i)
  if (!m) return { prompt: raw }
  const tag = m[1].toLowerCase() as (typeof OFFICE_SLASH)[number]['id']
  const rest = raw.slice(m[0].length).trim()
  const hit = OFFICE_SLASH.find((s) => s.id === tag)
  const format = hit?.format ?? 'doc'
  return { prompt: rest || `出一份 ${tag} 预览`, format }
}
