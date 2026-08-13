import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from 'react'

/**
 * 工具 diff 渲染（Cursor 风格，对齐官方 `components/chat/diff-lines.tsx`）：
 * - oldText 每行 → 红色删除行；newText 每行 → 绿色新增行
 * - 行窗口虚拟化：固定行高 + 分块，滚动只渲染可见块（+ overscan），
 *   离屏行不挂 DOM —— 大 diff（整文件失败回滚）不再拖垮滚动，且不丢信息。
 */

/** 固定行高（px）：虚拟化基准，必须与 CSS `.diff-line` 的行高一致（对齐官方 PREVIEW_LINE_PX=20） */
const DIFF_ROW_PX = 20
/** 分块行数：只在跨块滚动时重渲染（对齐官方 PREVIEW_CHUNK_LINES=200） */
const CHUNK_LINES = 200
/** 窗口 overscan：可视区外多渲染的行数（对齐官方 PREVIEW_OVERSCAN_LINES=400） */
const OVERSCAN_ROWS = 400

interface DiffRow {
  key: string
  kind: 'add' | 'remove'
  text: string
}

interface Chunk {
  rows: DiffRow[]
  start: number
}

function splitLines(s: string): string[] {
  const lines = s.split('\n')
  // 文本以 \n 结尾时去掉 split 产生的末尾空串
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function buildRows(oldText: string, newText: string): DiffRow[] {
  const out: DiffRow[] = []
  const oldLines = splitLines(oldText ?? '')
  const newLines = splitLines(newText ?? '')
  for (let i = 0; i < oldLines.length; i++) {
    out.push({ key: `r-${i}`, kind: 'remove', text: oldLines[i] })
  }
  for (let i = 0; i < newLines.length; i++) {
    out.push({ key: `a-${i}`, kind: 'add', text: newLines[i] })
  }
  return out
}

function chunkRows(rows: DiffRow[]): Chunk[] {
  if (rows.length <= CHUNK_LINES) {
    return [{ rows, start: 0 }]
  }
  const chunks: Chunk[] = []
  for (let start = 0; start < rows.length; start += CHUNK_LINES) {
    chunks.push({ rows: rows.slice(start, start + CHUNK_LINES), start })
  }
  return chunks
}

interface RowWindowState {
  startChunk: number
  endChunk: number
  beforeRows: number
  afterRows: number
}

/** 固定行窗口虚拟化（对齐官方 `fixed-row-window.ts`）：
 *  从 scroller 几何算可见块，只在跨块时重渲染；`before/afterRows` 用占位撑起总高度。 */
function useFixedRowWindow(totalRows: number) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const [win, setWin] = useState<RowWindowState>(() => ({
    startChunk: 0,
    endChunk: 0,
    beforeRows: 0,
    afterRows: 0,
  }))

  const compute = useCallback(
    (node: HTMLDivElement | null): RowWindowState => {
      const height = node?.clientHeight || 800
      const scrollTop = node?.scrollTop ?? 0
      const firstRow = Math.max(0, Math.floor(scrollTop / DIFF_ROW_PX) - OVERSCAN_ROWS)
      const lastRow = Math.min(totalRows, Math.ceil((scrollTop + height) / DIFF_ROW_PX) + OVERSCAN_ROWS)
      const startChunk = Math.floor(firstRow / CHUNK_LINES)
      const endChunk = Math.max(startChunk, Math.floor(Math.max(firstRow, lastRow - 1) / CHUNK_LINES))
      return {
        startChunk,
        endChunk,
        beforeRows: Math.min(totalRows, startChunk * CHUNK_LINES),
        afterRows: Math.max(0, totalRows - Math.min(totalRows, (endChunk + 1) * CHUNK_LINES)),
      }
    },
    [totalRows],
  )

  const sync = useCallback(
    (node: HTMLDivElement | null = scrollerRef.current) => {
      if (!node) return
      const next = compute(node)
      setWin((prev) =>
        prev.startChunk === next.startChunk &&
        prev.endChunk === next.endChunk &&
        prev.beforeRows === next.beforeRows &&
        prev.afterRows === next.afterRows
          ? prev
          : next,
      )
    },
    [compute],
  )

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const node = event.currentTarget
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        sync(node)
      })
    },
    [sync],
  )

  useLayoutEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    sync(node)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => sync(node))
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [sync])

  return { scrollerRef, onScroll, ...win }
}

interface DiffLinesProps {
  oldText: string
  newText: string
}

export const DiffLines = memo(function DiffLines({ oldText, newText }: DiffLinesProps) {
  const rows = useMemo(() => buildRows(oldText ?? '', newText ?? ''), [oldText, newText])
  const chunks = useMemo(() => chunkRows(rows), [rows])
  const { scrollerRef, onScroll, startChunk, endChunk, beforeRows, afterRows } =
    useFixedRowWindow(rows.length)
  const visibleChunks = chunks.slice(startChunk, endChunk + 1)

  return (
    <div className="diff-lines" ref={scrollerRef} onScroll={onScroll}>
      {beforeRows > 0 && <div aria-hidden style={{ height: beforeRows * DIFF_ROW_PX }} />}
      {visibleChunks.map((chunk) => (
        <div key={chunk.start}>
          {chunk.rows.map((row) => (
            <span
              key={row.key}
              className={`diff-line ${row.kind === 'add' ? 'diff-add' : 'diff-remove'}`}
            >
              {row.text || ' '}
            </span>
          ))}
        </div>
      ))}
      {afterRows > 0 && <div aria-hidden style={{ height: afterRows * DIFF_ROW_PX }} />}
    </div>
  )
})
