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
