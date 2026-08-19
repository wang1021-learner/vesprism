/** 一键生成：必须等本轮 generating 先亮再灭，才能收模型输出。 */

export type GenerateWait = {
  tabId: string
  before: number
  promptId: string
  started: boolean
}

/** 组件卸载后仍能收齐回复，避免切 tab 丢拓扑。 */
let pendingWait: GenerateWait | null = null

export function setGenerateWait(wait: GenerateWait | null): void {
  pendingWait = wait
}

export function getGenerateWait(): GenerateWait | null {
  return pendingWait
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

/** 画布发出去的 prompt：只有这些回复才允许改拓扑，避免切 Tab 回来把历史图盖上草稿。 */
const pendingCanvasGraphs = new Set<string>()
let lastExpectedCanvasGraph = ''

export function expectCanvasGraph(promptId: string): void {
  const id = promptId.trim()
  if (!id) return
  pendingCanvasGraphs.add(id)
  lastExpectedCanvasGraph = id
}

export function latestExpectedCanvasGraph(): string {
  return lastExpectedCanvasGraph
}

export function consumeCanvasGraph(promptId: string): boolean {
  return pendingCanvasGraphs.delete(promptId)
}

export function isPendingCanvasGraph(promptId: string | undefined): boolean {
  return Boolean(promptId && pendingCanvasGraphs.has(promptId))
}

/** 自愈等没有用户气泡时，正文分片挂到当前待收图的 prompt。 */
export function inheritCanvasPromptId(fallback?: string): string | undefined {
  if (fallback && pendingCanvasGraphs.has(fallback)) return fallback
  if (lastExpectedCanvasGraph && pendingCanvasGraphs.has(lastExpectedCanvasGraph)) {
    return lastExpectedCanvasGraph
  }
  return fallback
}

export function resetCanvasGraphWaitForTests(): void {
  pendingCanvasGraphs.clear()
  lastExpectedCanvasGraph = ''
  canvasHealPrompts.clear()
}

/** 某次失败已经静默自愈过；该自愈回合的 promptId 记在这里。 */
const canvasHealPrompts = new Set<string>()

export function markCanvasHeal(promptId: string): void {
  const id = promptId.trim()
  if (id) canvasHealPrompts.add(id)
}

export function isCanvasHeal(promptId: string | undefined): boolean {
  return Boolean(promptId && canvasHealPrompts.has(promptId))
}
