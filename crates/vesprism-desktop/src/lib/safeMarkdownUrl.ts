/** 助手 Markdown 链接：只放行 http(s)/mailto/页内锚点。 */
export function safeMarkdownHref(href: string | undefined | null): string | undefined {
  const s = (href || '').trim()
  if (!s) return undefined
  if (s.startsWith('#')) return s
  if (/^(https?:|mailto:)/i.test(s)) return s
  return undefined
}

/** 助手 Markdown 图片：只放行 http(s) 与 data:image。 */
export function safeMarkdownImgSrc(src: string | undefined | null): string | undefined {
  const s = (src || '').trim()
  if (!s) return undefined
  if (/^https?:\/\//i.test(s)) return s
  if (/^data:image\//i.test(s)) return s
  return undefined
}
