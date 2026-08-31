/** 一键生成：必须等本轮 generating 先亮再灭，才能收模型输出。 */

export type GenerateWait = {
  tabId: string
  before: number
  promptId: string
  started: boolean
}

/** 组件卸载后仍能收齐回复，避免切 tab 丢拓扑。按 tab 分片，避免两个画布互相覆盖。 */
const pendingWaits = new Map<string, GenerateWait>()

export function setGenerateWait(wait: GenerateWait | null, tabId?: string): void {
  if (!wait) {
    if (tabId) pendingWaits.delete(tabId)
    else pendingWaits.clear()
    return
  }
  pendingWaits.set(wait.tabId, wait)
}

export function getGenerateWait(tabId?: string): GenerateWait | null {
  if (tabId) return pendingWaits.get(tabId) ?? null
  if (pendingWaits.size === 1) return pendingWaits.values().next().value ?? null
  return null
}

export function noteGenerateProgress(
  wait: GenerateWait | null,
  aiBusy: boolean,
  generating: boolean,
): 'ignore' | 'started' | 'finish' {
  if (!wait || !aiBusy) return 'ignore'
  if (generating) return 'started'
  if (!wait.started) return 'ignore'
  return 'finish'
}

type TabGraphWait = {
  pending: Set<string>
  lastExpected: string
  healPrompts: Set<string>
  healBudget: number
}

/** 空 key = 单测 / 未标明 Tab。生产路径必须传入 tabId，避免两个画布互相覆盖。 */
const HEAL_BUDGET = 2
const canvasWaits = new Map<string, TabGraphWait>()

function tabKey(tabId?: string): string {
  return (tabId ?? '').trim()
}

function bucket(tabId?: string): TabGraphWait {
  const key = tabKey(tabId)
  let wait = canvasWaits.get(key)
  if (!wait) {
    wait = {
      pending: new Set(),
      lastExpected: '',
      healPrompts: new Set(),
      healBudget: HEAL_BUDGET,
    }
    canvasWaits.set(key, wait)
  }
  return wait
}

/** 画布发出去的 prompt：只有这些回复才允许改拓扑。按 Tab 分片；切走不清 in-flight。 */
export function expectCanvasGraph(promptId: string, tabId?: string): void {
  const id = promptId.trim()
  if (!id) return
  const wait = bucket(tabId)
  wait.pending.add(id)
  wait.lastExpected = id
}

export function latestExpectedCanvasGraph(tabId?: string): string {
  return bucket(tabId).lastExpected
}

export function consumeCanvasGraph(promptId: string, tabId?: string): boolean {
  return bucket(tabId).pending.delete(promptId)
}

export function isPendingCanvasGraph(promptId: string | undefined, tabId?: string): boolean {
  return Boolean(promptId && bucket(tabId).pending.has(promptId))
}

/**
 * 自愈等没有用户气泡时，正文分片挂到当前待收图的 prompt。
 * 必须带 tabId：否则编码 Tab 的助手分片会吃到画布的 pid。
 */
export function inheritCanvasPromptId(fallback?: string, tabId?: string): string | undefined {
  const wait = bucket(tabId)
  if (fallback && wait.pending.has(fallback)) return fallback
  if (wait.lastExpected && wait.pending.has(wait.lastExpected)) return wait.lastExpected
  return fallback
}

/** 清掉某 Tab 的认图等待（试跑 / 关 Tab）。不传 tabId 则全清（测试）。切走画布不要调用。 */
export function resetCanvasGraphWait(tabId?: string): void {
  const key = tabKey(tabId)
  if (tabId !== undefined && key) {
    canvasWaits.delete(key)
    return
  }
  canvasWaits.clear()
}

export function resetCanvasGraphWaitForTests(): void {
  resetCanvasGraphWait()
}

export function markCanvasHeal(promptId: string, tabId?: string): void {
  const id = promptId.trim()
  if (id) bucket(tabId).healPrompts.add(id)
}

export function isCanvasHeal(promptId: string | undefined, tabId?: string): boolean {
  return Boolean(promptId && bucket(tabId).healPrompts.has(promptId))
}

export function canHeal(tabId?: string): boolean {
  return bucket(tabId).healBudget > 0
}

export function spendHeal(tabId?: string): void {
  const wait = bucket(tabId)
  wait.healBudget = wait.healBudget > 0 ? wait.healBudget - 1 : 0
}

export function resetHealBudget(tabId?: string): void {
  bucket(tabId).healBudget = HEAL_BUDGET
}
