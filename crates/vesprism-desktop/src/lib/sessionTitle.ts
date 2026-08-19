/**
 * 会话标题：侧栏记录和顶栏 Tab 共用。
 * 画布首轮会把编排说明书包进 <user_query>，必须取最里层用户原话。
 */

const USER_QUERY_OPEN = '<user_query>'
const USER_QUERY_CLOSE = '</user_query>'

export function innermostUserQuery(text: string): string | null {
  const t = text || ''
  const start = t.toLowerCase().lastIndexOf(USER_QUERY_OPEN)
  if (start < 0) return null
  const after = t.slice(start + USER_QUERY_OPEN.length)
  const end = after.toLowerCase().indexOf(USER_QUERY_CLOSE)
  const inner = (end >= 0 ? after.slice(0, end) : after).trim()
  if (!inner || inner === '(see attachments)') return null
  return inner
}

function isContractNoise(s: string): boolean {
  const t = s.trim()
  return (
    !t ||
    t.startsWith('<') ||
    t.startsWith('You are the Vesprism') ||
    t.startsWith('你是这个流程画布') ||
    t.startsWith('你是 Vesprism') ||
    t.startsWith('interface FlowGraph') ||
    t.startsWith('Emit ONE JSON') ||
    t.startsWith('Prefer a single')
  )
}

export function cleanSessionTitle(raw: string, fallback = '新对话'): string {
  let t = (raw || '').trim()
  if (!t) return fallback
  const query = innermostUserQuery(t)
  if (query) t = query
  t = t
    .replace(/<instructions>[\s\S]*?<\/instructions>/gi, '')
    .replace(/<current_graph>[\s\S]*?<\/current_graph>/gi, '')
    .trim()
  const gen = t.match(/^生成流程图：\s*(.+)$/m)
  if (gen?.[1]) t = gen[1].trim()
  if (/流程画布|flow-canvas orchestrator|Vesprism 流程/.test(t)) {
    const user = t.match(/(?:用户|User)\s*[：:]\s*([\s\S]+)$/)
    if (user?.[1]) t = user[1].trim()
  }
  const line = t.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || ''
  if (isContractNoise(line)) return fallback
  return line.replace(/\s+/g, ' ')
}
