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

/** 把 File/Blob 落到临时文件，返回绝对路径。 */
export async function persistImageFile(file: File): Promise<string> {
  const mime = file.type || 'image/png'
  const base64 = await fileToBase64(file)
  if (!base64) throw new Error('图片为空')
  return savePasteImage(base64, mime)
}

/** 从剪贴板事件收集图片 File。 */
export function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  const seen = new Set<File>()
  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f && !seen.has(f)) {
          seen.add(f)
          out.push(f)
        }
      }
    }
  }
  if (data.files) {
    for (const f of Array.from(data.files)) {
      if (f.type.startsWith('image/') && !seen.has(f)) {
        seen.add(f)
        out.push(f)
      }
    }
  }
  return out
}
