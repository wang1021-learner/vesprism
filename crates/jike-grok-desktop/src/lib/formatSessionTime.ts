/** 格式化时间戳为易读短文本（侧栏会话列表） */
export function formatSessionTime(isoString: string): string {
  if (!isoString) return ''
  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return isoString

    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / (1000 * 60))
    const diffHour = Math.floor(diffMs / (1000 * 60 * 60))

    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin}分钟前`
    if (diffHour < 24 && date.getDate() === now.getDate()) {
      return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    }

    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${month}-${day}`
  } catch {
    return isoString
  }
}
