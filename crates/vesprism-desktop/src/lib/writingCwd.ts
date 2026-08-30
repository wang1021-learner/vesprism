/** 写台每书会话目录：~/.vesprism/writing/<id>。侧栏归到写完产品，不进编码仓库分组。 */
export function isWritingSessionCwd(cwd: string | undefined): boolean {
  const n = (cwd || '').replace(/\\/g, '/').toLowerCase()
  return n.includes('/.vesprism/writing/')
}
