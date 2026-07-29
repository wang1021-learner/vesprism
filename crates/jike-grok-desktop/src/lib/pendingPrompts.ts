/**
 * 乐观发送 promptId 登记：用于忽略「自己发的」user_text_chunk 回显，并做超时清理。
 * 与打字机无关，单独小模块，避免和 streamTypewriter 缠在一起。
 */
export type PendingPrompts = {
  track: (promptId: string, timeoutMs?: number) => void
  has: (promptId: string) => boolean
  clear: (promptId: string) => void
  clearAll: () => void
}

export function createPendingPrompts(): PendingPrompts {
  const map = new Map<string, ReturnType<typeof setTimeout>>()

  const clear = (promptId: string) => {
    const t = map.get(promptId)
    if (t) clearTimeout(t)
    map.delete(promptId)
  }

  return {
    track(promptId: string, timeoutMs = 30_000) {
      clear(promptId)
      const t = setTimeout(() => {
        map.delete(promptId)
      }, timeoutMs)
      map.set(promptId, t)
    },
    has(promptId: string) {
      return map.has(promptId)
    },
    clear,
    clearAll() {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    },
  }
}
