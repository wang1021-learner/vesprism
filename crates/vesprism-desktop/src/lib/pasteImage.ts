import { savePasteImage } from '../bridge'

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result || '')
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    reader.onerror = () => reject(reader.error || new Error('读图片失败'))
    reader.readAsDataURL(file)
  })
}

export function revokePreviewUrl(url?: string): void {
  if (!url || !url.startsWith('blob:')) return
  try {
    URL.revokeObjectURL(url)
  } catch {
    /* 已失效 */
  }
}

/** 把 File/Blob 落到临时文件，并给出预览 URL（blob，输入栏立刻能看见）。 */
export async function persistImageFile(
  file: File,
): Promise<{ path: string; previewUrl: string }> {
  const mime = file.type || 'image/png'
  const base64 = await fileToBase64(file)
  if (!base64) throw new Error('图片为空')
  const path = await savePasteImage(base64, mime)
  const previewUrl = URL.createObjectURL(file)
  return { path, previewUrl }
}

function clipNameKey(name: string): string {
  const n = (name || '').trim().toLowerCase()
  if (
    !n ||
    /^(image|untitled|screenshot|clip)(\s*\(\d+\))?\.(png|jpe?g|gif|webp|bmp)$/.test(
      n,
    )
  ) {
    return '*'
  }
  return n
}

function fileKey(f: File): string {
  // 不用 lastModified：items.getAsFile() 和 files[] 常是同一张图的两个对象
  return `${f.type}|${f.size}|${clipNameKey(f.name)}`
}

function uniqueFiles(files: File[]): File[] {
  const seen = new Set<string>()
  const out: File[] = []
  for (const f of files) {
    const k = fileKey(f)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(f)
  }
  return out
}

const MIME_RANK: Record<string, number> = {
  'image/png': 5,
  'image/webp': 4,
  'image/jpeg': 3,
  'image/jpg': 3,
  'image/gif': 2,
  'image/bmp': 1,
  'image/x-windows-bmp': 1,
}

function looksLikeClipboardCapture(f: File): boolean {
  const n = (f.name || '').trim().toLowerCase()
  return (
    !n ||
    /^(image|untitled|screenshot|clip)(\s*\(\d+\))?\.(png|jpe?g|gif|webp|bmp)$/.test(
      n,
    )
  )
}

/** 截图常同时带 png + bmp，只留一份；两张同类型真图不合并。 */
function collapseClipboardFormats(files: File[]): File[] {
  if (files.length <= 1) return files
  if (!files.every(looksLikeClipboardCapture)) return files
  const types = new Set(files.map((f) => f.type))
  if (types.size <= 1) return files
  let best = files[0]!
  let bestRank = MIME_RANK[best.type] ?? 0
  for (const f of files.slice(1)) {
    const r = MIME_RANK[f.type] ?? 0
    if (r > bestRank) {
      best = f
      bestRank = r
    }
  }
  return [best]
}

function filesFromList(list: FileList | File[] | null | undefined): File[] {
  if (!list) return []
  return Array.from(list).filter((f) => f.type.startsWith('image/'))
}

function filesFromItems(items: DataTransferItemList | DataTransferItem[] | null | undefined): File[] {
  if (!items) return []
  const out: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) out.push(f)
    }
  }
  return out
}

/**
 * 从粘贴 / 拖放收集图片。
 * Windows 剪贴板同一张图会同时出现在 items 和 files，而且是两个 File 对象，
 * 不能用引用去重。
 */
export function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const fromFiles = filesFromList(data.files)
  // files 已有图就只用这一份；WebView 偶尔只填 items
  const raw = fromFiles.length > 0 ? fromFiles : filesFromItems(data.items)
  return collapseClipboardFormats(uniqueFiles(raw))
}
