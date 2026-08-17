/** 一键生成：必须等本轮 generating 先亮再灭，才能收模型输出。 */

export type GenerateWait = { before: number; started: boolean }

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
