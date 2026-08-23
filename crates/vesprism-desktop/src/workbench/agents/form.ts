/**
 * Agent 编制表单：序列化 / 校验。面板只编辑这批字段，其余仍走 YAML。
 */
import {
  isValidAgentId,
  type AgentCapability,
  type AgentRecord,
  emptyAgent,
} from '../types'

export const CAPABILITY_OPTIONS: { value: AgentCapability | ''; label: string }[] = [
  { value: '', label: '未设（展示用）' },
  { value: 'read_only', label: '只读（展示）' },
  { value: 'read_write', label: '可改文件（展示）' },
  { value: 'execute', label: '能跑命令（展示）' },
  { value: 'all', label: '全权（展示）' },
]

export type AgentFormDraft = {
  id: string
  name: string
  version: string
  description: string
  capability: AgentCapability | ''
  isolation: boolean
  disabledToolsText: string
  skillsText: string
  permissionRules: string[]
  systemPrompt: string
  /** 打开时的完整记录；保存时当基底，避免抹掉面板不编辑的字段。 */
  raw?: AgentRecord
}

export function emptyFormDraft(): AgentFormDraft {
  return {
    id: '',
    name: '',
    version: '1',
    description: '',
    capability: '',
    isolation: false,
    disabledToolsText: '',
    skillsText: '',
    permissionRules: [],
    systemPrompt: '',
  }
}

/** 逗号 / 中文逗号 / 换行拆工具名，去空白。 */
export function splitToolList(raw: string): string[] {
  return raw
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

export function joinToolList(names: string[]): string {
  return names.join(', ')
}

export function parseCapability(raw: string): AgentCapability | '' {
  if (raw === 'read_only' || raw === 'read_write' || raw === 'execute' || raw === 'all') {
    return raw
  }
  return ''
}

function cloneAgent(agent: AgentRecord): AgentRecord {
  return {
    ...agent,
    disabled_tools: [...(agent.disabled_tools ?? [])],
    permission_rules: [...(agent.permission_rules ?? [])],
    skills: [...(agent.skills ?? [])],
    flows: [...(agent.flows ?? [])],
    persona: {
      label: agent.persona?.label ?? null,
      sections: [...(agent.persona?.sections ?? [])],
    },
  }
}

export function draftFromAgent(agent: AgentRecord, systemPrompt: string): AgentFormDraft {
  return {
    id: agent.id,
    name: agent.name,
    version: agent.version || '1',
    description: agent.description,
    capability: agent.capability ?? '',
    isolation: agent.isolation,
    disabledToolsText: joinToolList(agent.disabled_tools),
    skillsText: joinToolList(agent.skills ?? []),
    permissionRules: [...(agent.permission_rules ?? [])],
    systemPrompt,
    raw: cloneAgent(agent),
  }
}

export function agentFromDraft(d: AgentFormDraft): AgentRecord {
  const base = d.raw ? cloneAgent(d.raw) : emptyAgent(d.id.trim(), d.name.trim())
  return {
    ...base,
    id: d.id.trim(),
    name: d.name.trim(),
    version: d.version.trim() || '1',
    description: d.description.trim(),
    capability: d.capability || null,
    isolation: d.isolation,
    disabled_tools: splitToolList(d.disabledToolsText),
    skills: splitToolList(d.skillsText),
    permission_rules: d.permissionRules.map((r) => r.trim()).filter(Boolean),
  }
}

/** 勾选/取消一项，写回逗号分隔文本。 */
export function toggleNamed(text: string, name: string): string {
  const n = name.trim()
  if (!n) return text
  const cur = splitToolList(text)
  const i = cur.indexOf(n)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(n)
  return joinToolList(cur)
}

/** 脏检查指纹：不含 raw（YAML 里面板不编的字段）。 */
export function formFingerprint(d: AgentFormDraft): string {
  return JSON.stringify({
    id: d.id.trim(),
    name: d.name,
    version: d.version,
    description: d.description,
    capability: d.capability,
    isolation: d.isolation,
    disabledTools: splitToolList(d.disabledToolsText),
    skills: splitToolList(d.skillsText),
    permissionRules: d.permissionRules.map((r) => r.trim()),
    systemPrompt: d.systemPrompt,
  })
}

export function isFormDirty(d: AgentFormDraft, baseline: string): boolean {
  return formFingerprint(d) !== baseline
}

/** 返回首条错误；通过则 null。 */
export function validateAgentForm(d: AgentFormDraft): string | null {
  if (!isValidAgentId(d.id.trim())) {
    return 'Agent id 不合法（1-64 位小写字母、数字、单连字符）'
  }
  if (!d.name.trim()) {
    return '显示名不能为空'
  }
  if (!d.version.trim()) {
    return '版本不能为空'
  }
  for (const rule of d.permissionRules) {
    if (!rule.trim()) return 'deny 规则不能为空'
  }
  return null
}
