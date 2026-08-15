/** 卡片只留末尾这么多字节（砍头）。 */
export const CARD_TAIL_BYTES = 64 * 1024

/** 砍掉最旧输出，只留最后 `maxBytes`（UTF-8 字节，不切开码点）。 */
export function keepTail(text: string, maxBytes = CARD_TAIL_BYTES): { text: string; truncated: boolean } {
  if (!text) return { text: '', truncated: false }
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return { text, truncated: false }
  let off = bytes.length - maxBytes
  while (off < bytes.length && (bytes[off] & 0xc0) === 0x80) off += 1
  return { text: new TextDecoder().decode(bytes.subarray(off)), truncated: true }
}

export type TerminalOutcome = 'running' | 'ok' | 'fail' | 'killed'

export function terminalOutcome(t: {
  exited: boolean
  killed?: boolean
  exitCode?: number | null
}): TerminalOutcome {
  if (!t.exited) return 'running'
  if (t.killed) return 'killed'
  if (t.exitCode == null || t.exitCode === 0) return 'ok'
  return 'fail'
}

export function terminalStatusLabel(t: {
  exited: boolean
  killed?: boolean
  exitCode?: number | null
}): string {
  switch (terminalOutcome(t)) {
    case 'running':
      return '运行中'
    case 'ok':
      return '完成'
    case 'killed':
      return '已终止'
    case 'fail':
      return `失败（exit ${t.exitCode}）`
  }
}


