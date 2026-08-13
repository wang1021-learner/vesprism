/** 把绝对沙箱路径收成 ~/.vesprism/sandboxes/<tab>，避免误以为改的是原仓库 */
export function formatSandboxDisplayPath(abs: string): string {
  const n = (abs || '').trim().replace(/\\/g, '/')
  if (!n) return ''
  const marker = '/.vesprism/sandboxes/'
  const i = n.toLowerCase().indexOf(marker)
  if (i >= 0) return `~${n.slice(i)}`
  return n
}
