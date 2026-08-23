/**
 * 会话级停用工具：走官方组装单 tools.disable
 * （apply_composition → toolOverrides.disabled）。
 * 只认组装单 canonicalize 允许的官方函数名。
 */

import { applyComposition, getComposition } from '../bridge'
import { $tabs, getTabState, normPathKey } from '../store'
import { emptyComposition, type CompositionData } from './composition'

export type ChatSessionTarget = {
  tabId: string
  sessionId: string
  cwd: string
  title: string
}

/** 普通对话 tab（不含技能/工具等专用页）。cwd 有值时只收同一工作区。 */
export function listChatSessionTargets(cwd?: string): ChatSessionTarget[] {
  const key = cwd ? normPathKey(cwd) : ''
  const out: ChatSessionTarget[] = []
  for (const t of $tabs.get()) {
    const st = getTabState(t.id)
    if (!st?.sessionId || st.utilityKind) continue
    if (key && normPathKey(st.cwd || '') !== key) continue
    out.push({
      tabId: t.id,
      sessionId: st.sessionId,
      cwd: st.cwd || '',
      title: (st.chatTitle || t.title || '对话').trim() || '对话',
    })
  }
  return out
}

/** 与 grok-session `OFFICIAL_TOOL_NAMES` 对齐，未知名会被组装单拒绝。 */
export const COMPOSITION_DISABLEABLE = [
  'run_terminal_command',
  'web_search',
  'web_fetch',
  'search_replace',
  'read_file',
  'write',
  'grep',
  'glob',
  'apply_patch',
  'todo_write',
  'ask_user_question',
  'enter_plan_mode',
  'exit_plan_mode',
  'update_goal',
  'workflow',
] as const

const DISABLEABLE = new Set<string>(COMPOSITION_DISABLEABLE)

export function canDisableTool(name: string): boolean {
  return DISABLEABLE.has(name)
}

export function patchDisabledTools(
  current: string[] | null | undefined,
  name: string,
  disabled: boolean,
): string[] {
  const set = new Set((current ?? []).map((x) => x.trim()).filter(Boolean))
  if (disabled) set.add(name)
  else set.delete(name)
  return COMPOSITION_DISABLEABLE.filter((n) => set.has(n))
}

export function mergeComposition(
  raw: CompositionData | null | undefined,
): CompositionData {
  const base = emptyComposition()
  if (!raw) return base
  return {
    id: raw.id ?? base.id,
    extends: raw.extends ?? base.extends,
    persona: { ...base.persona, ...raw.persona },
    model: { ...base.model, ...raw.model },
    tools: {
      disable: Array.isArray(raw.tools?.disable) ? raw.tools.disable : [],
      overrides: raw.tools?.overrides ?? null,
    },
    skills: { ...base.skills, ...raw.skills },
    permissions: {
      mode: raw.permissions?.mode ?? base.permissions.mode,
      rules: Array.isArray(raw.permissions?.rules)
        ? raw.permissions.rules
        : base.permissions.rules,
    },
    mcp: {
      servers: Array.isArray(raw.mcp?.servers) ? raw.mcp.servers : base.mcp.servers,
      disabled_tools: raw.mcp?.disabled_tools ?? base.mcp.disabled_tools,
    },
    plugins: { dirs: Array.isArray(raw.plugins?.dirs) ? raw.plugins.dirs : base.plugins.dirs },
    flows: Array.isArray(raw.flows) ? raw.flows : [],
    agent_type: raw.agent_type ?? base.agent_type,
  }
}

export async function setSessionToolDisabled(
  tabId: string,
  sessionId: string | null,
  cwd: string,
  name: string,
  disabled: boolean,
): Promise<string[]> {
  if (!canDisableTool(name)) {
    throw new Error(`该工具不能在组装单里停用：${name}`)
  }
  const merged = mergeComposition(await getComposition(sessionId, cwd || ''))
  const disable = patchDisabledTools(merged.tools.disable, name, disabled)
  await applyComposition(tabId, sessionId, {
    ...merged,
    tools: { ...merged.tools, disable },
  })
  return disable
}

/** 停用写入同一工作区的对话会话，不写到「工具」专用页自己的会话。 */
export async function setChatToolsDisabled(
  cwd: string,
  name: string,
  disabled: boolean,
): Promise<{ disable: string[]; count: number }> {
  const targets = listChatSessionTargets(cwd)
  if (targets.length === 0) {
    throw new Error('请先打开一个对话，再在这里停用工具')
  }
  let disable: string[] = []
  for (const t of targets) {
    disable = await setSessionToolDisabled(t.tabId, t.sessionId, t.cwd, name, disabled)
  }
  return { disable, count: targets.length }
}
