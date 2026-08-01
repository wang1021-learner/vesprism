import { memo, useMemo } from 'react'

/**
 * 工具 diff 渲染（Cursor 风格）：
 * - 输入是 {oldText, newText} 整块结构（非 unified diff）
 * - oldText 每行 → 红色删除行；newText 每行 → 绿色新增行
 * - 去掉 +/- 前缀，靠底色 + 左侧 2px 色条区分
 */
interface DiffLinesProps {
  oldText: string
  newText: string
}

function splitLines(s: string): string[] {
  const lines = s.split('\n')
  // 文本以 \n 结尾时去掉 split 产生的末尾空串
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export const DiffLines = memo(function DiffLines({ oldText, newText }: DiffLinesProps) {
  const oldLines = useMemo(() => splitLines(oldText ?? ''), [oldText])
  const newLines = useMemo(() => splitLines(newText ?? ''), [newText])

  return (
    <pre className="diff-lines">
      {oldLines.map((line, i) => (
        <span key={`r-${i}`} className="diff-line diff-remove">
          {line || ' '}
        </span>
      ))}
      {newLines.map((line, i) => (
        <span key={`a-${i}`} className="diff-line diff-add">
          {line || ' '}
        </span>
      ))}
    </pre>
  )
})
