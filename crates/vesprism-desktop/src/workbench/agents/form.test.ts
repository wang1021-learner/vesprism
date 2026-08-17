import { describe, expect, it } from 'vitest'
import {
  agentFromDraft,
  draftFromAgent,
  emptyFormDraft,
  parseCapability,
  splitToolList,
  validateAgentForm,
} from './form'
import { emptyAgent } from '../types'

describe('Agent 编制表单', () => {
  it('拆停用工具：逗号、中文逗号、换行', () => {
    expect(splitToolList('web_search, grep，\nrun_terminal_command')).toEqual([
      'web_search',
      'grep',
      'run_terminal_command',
    ])
  })

  it('能力档只认四档，其它当未设', () => {
    expect(parseCapability('read_only')).toBe('read_only')
    expect(parseCapability('read_write')).toBe('read_write')
    expect(parseCapability('execute')).toBe('execute')
    expect(parseCapability('all')).toBe('all')
    expect(parseCapability('read-only')).toBe('')
    expect(parseCapability('')).toBe('')
  })

  it('id 合法性：拒绝大写、空、双连字符', () => {
    const d = emptyFormDraft()
    d.name = '审查员'
    d.id = 'PR'
    expect(validateAgentForm(d)).toMatch(/id 不合法/)
    d.id = 'pr-reviewer'
    expect(validateAgentForm(d)).toBeNull()
    d.id = 'a--b'
    expect(validateAgentForm(d)).toMatch(/id 不合法/)
    d.id = 'pr-reviewer'
    d.name = ''
    expect(validateAgentForm(d)).toMatch(/显示名/)
  })

  it('draft ↔ AgentRecord 往返保留能力/隔离/停用/deny', () => {
    const rec = {
      ...emptyAgent('pr-reviewer', 'PR 审查员'),
      capability: 'read_only' as const,
      isolation: true,
      disabled_tools: ['web_search'],
      permission_rules: ['edit:**/.env'],
      description: '只读审查',
    }
    const draft = draftFromAgent(rec, '你是只读审查员')
    expect(draft.capability).toBe('read_only')
    expect(draft.isolation).toBe(true)
    expect(draft.disabledToolsText).toBe('web_search')
    expect(draft.permissionRules).toEqual(['edit:**/.env'])
    expect(draft.systemPrompt).toBe('你是只读审查员')
    const back = agentFromDraft(draft)
    expect(back.id).toBe('pr-reviewer')
    expect(back.capability).toBe('read_only')
    expect(back.isolation).toBe(true)
    expect(back.disabled_tools).toEqual(['web_search'])
    expect(back.permission_rules).toEqual(['edit:**/.env'])
  })

  it('改名字保存不抹掉 YAML 里面板不编的字段', () => {
    const rec = {
      ...emptyAgent('pr-reviewer', 'PR 审查员'),
      model: 'deepseek-chat',
      persona: { label: 'reviewer', sections: ['角色：只读', '审查安全'] },
      input_contract: 'PR diff',
      output_contract: '审查意见',
      output_schema: { type: 'object' },
      agent_type: 'explore',
      flows: ['pr-review'],
      capability: 'read_only' as const,
    }
    const draft = draftFromAgent(rec, 'system')
    draft.name = 'PR 审查员 v2'
    const back = agentFromDraft(draft)
    expect(back.name).toBe('PR 审查员 v2')
    expect(back.model).toBe('deepseek-chat')
    expect(back.persona).toEqual({ label: 'reviewer', sections: ['角色：只读', '审查安全'] })
    expect(back.input_contract).toBe('PR diff')
    expect(back.output_contract).toBe('审查意见')
    expect(back.output_schema).toEqual({ type: 'object' })
    expect(back.agent_type).toBe('explore')
    expect(back.flows).toEqual(['pr-review'])
    expect(back.capability).toBe('read_only')
  })
})
