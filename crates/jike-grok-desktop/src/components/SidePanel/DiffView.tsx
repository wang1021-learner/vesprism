import { useMemo, useState } from 'react'
import type { ToolDiffData } from '../../types'
import { computeUnifiedDiff, parsePreviewAsDiffLines, type DiffLine } from '../../utils/lineDiff'

interface DiffViewProps {
  diffs: ToolDiffData[]
  fallbackText?: string
  title?: string
}

function fileName(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const parts = norm.split('/').filter(Boolean)
  return parts[parts.length - 1] || path || 'file'
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const gutterOld =
    line.kind === 'add' ? '' : line.oldNo != null ? String(line.oldNo) : ''
  const gutterNew =
    line.kind === 'del' ? '' : line.newNo != null ? String(line.newNo) : ''
  const prefix =
    line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'hunk' ? '' : ' '

  return (
    <div className={`diff-line diff-line-${line.kind}`}>
      <span className="diff-gutter diff-gutter-old">{gutterOld}</span>
      <span className="diff-gutter diff-gutter-new">{gutterNew}</span>
      <span className="diff-prefix" aria-hidden>
        {prefix}
      </span>
      <span className="diff-code">{line.text || ' '}</span>
    </div>
  )
}

function SingleFileDiff({
  path,
  oldText,
  newText,
}: {
  path: string
  oldText?: string | null
  newText: string
}) {
  const lines = useMemo(
    () => computeUnifiedDiff(oldText ?? '', newText),
    [oldText, newText],
  )
  const adds = lines.filter((l) => l.kind === 'add').length
  const dels = lines.filter((l) => l.kind === 'del').length

  return (
    <div className="diff-file">
      <div className="diff-file-header" title={path}>
        <span className="diff-file-name">{fileName(path)}</span>
        <span className="diff-file-path">{path}</span>
        <span className="diff-file-stats">
          <span className="diff-stat-add">+{adds}</span>
          <span className="diff-stat-del">−{dels}</span>
        </span>
      </div>
      <div className="diff-lines" role="table" aria-label={`${path} diff`}>
        {lines.map((line, i) => (
          <DiffLineRow key={i} line={line} />
        ))}
      </div>
    </div>
  )
}

function FallbackDiff({ text }: { text: string }) {
  const lines = useMemo(() => {
    const parsed = parsePreviewAsDiffLines(text)
    if (parsed) return parsed
    return text.split('\n').map((t) => ({ kind: 'context' as const, text: t }))
  }, [text])

  return (
    <div className="diff-file">
      <div className="diff-file-header">
        <span className="diff-file-name">预览</span>
      </div>
      <div className="diff-lines">
        {lines.map((line, i) => (
          <DiffLineRow key={i} line={line} />
        ))}
      </div>
    </div>
  )
}

export function DiffView({ diffs, fallbackText, title }: DiffViewProps) {
  const [activeIdx, setActiveIdx] = useState(0)
  const multi = diffs.length > 1
  const safeIdx = Math.min(activeIdx, Math.max(0, diffs.length - 1))

  if (diffs.length === 0) {
    if (fallbackText?.trim()) {
      return (
        <div className="side-panel-diff">
          {title && <div className="side-panel-subhead">{title}</div>}
          <FallbackDiff text={fallbackText} />
        </div>
      )
    }
    return (
      <div className="side-panel-empty">
        <p>暂无 diff 内容</p>
      </div>
    )
  }

  const current = diffs[safeIdx]

  return (
    <div className="side-panel-diff">
      {multi && (
        <div className="diff-file-tabs" role="tablist">
          {diffs.map((d, i) => (
            <button
              key={`${d.path}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === safeIdx}
              className={`diff-file-tab${i === safeIdx ? ' active' : ''}`}
              onClick={() => setActiveIdx(i)}
              title={d.path}
            >
              {fileName(d.path)}
            </button>
          ))}
        </div>
      )}
      <SingleFileDiff
        path={current.path}
        oldText={current.oldText}
        newText={current.newText}
      />
    </div>
  )
}
