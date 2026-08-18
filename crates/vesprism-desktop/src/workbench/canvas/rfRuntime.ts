/** 写回草稿前必须剔除的 RF 瞬时字段，避免 execStatus/回调进 .json。 */
export const RF_RUNTIME_KEYS = [
  'nodeType',
  'execStatus',
  'execDuration',
  'onRunFromHere',
  'onDuplicate',
  'onDeleteNode',
  'selected',
  'measured',
  'dragging',
] as const

export function stripRfRuntime(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const params = { ...data }
  for (const key of RF_RUNTIME_KEYS) {
    delete params[key]
  }
  return params
}
