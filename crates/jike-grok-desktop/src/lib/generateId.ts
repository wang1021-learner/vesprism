/** 统一 id 生成，兼容无 crypto.randomUUID 的 WebView */
export function generateId(prefix = ''): string {
  let body = ''
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      body = crypto.randomUUID().replace(/-/g, '')
    }
  } catch {
    /* fall through */
  }
  if (!body) {
    body = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  }
  return prefix ? `${prefix}${body}` : body
}

/** 短 id（模型草稿后缀等） */
export function generateShortId(len = 12): string {
  return generateId().replace(/-/g, '').slice(0, len)
}
