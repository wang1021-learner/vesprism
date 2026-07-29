import { useSyncExternalStore } from 'react'
import {
  getStreamMetrics,
  subscribeStreamMetrics,
  type StreamMetrics,
} from '../lib/streamMetrics'

function useStreamMetrics(): StreamMetrics {
  return useSyncExternalStore(subscribeStreamMetrics, getStreamMetrics, getStreamMetrics)
}

/** 开发态流式性能浮层：Ctrl+Shift+D 切换 */
export function StreamDebugOverlay({ visible }: { visible: boolean }) {
  const m = useStreamMetrics()
  if (!visible) return null

  const rows: { label: string; value: string; warn?: boolean }[] = [
    { label: 'FPS', value: String(m.fps || '—'), warn: m.fps > 0 && m.fps < 45 },
    { label: 'Pending', value: String(m.pendingChars) },
    { label: 'Batch', value: String(m.batchSize) },
    { label: 'Tick', value: `${m.tickCost.toFixed(1)}ms`, warn: m.tickCost > 6 },
    { label: 'Commit', value: `${m.commitCost.toFixed(1)}ms`, warn: m.commitCost > 4 },
    { label: 'Markdown', value: `${m.markdownCost.toFixed(1)}ms`, warn: m.markdownCost > 16 },
    { label: 'Dropped', value: String(m.droppedFrames), warn: m.droppedFrames > 0 },
  ]

  return (
    <div className="stream-debug-overlay" aria-hidden>
      <div className="stream-debug-title">
        Stream Metrics
        <span className="stream-debug-hint">Ctrl+Shift+D</span>
      </div>
      <table className="stream-debug-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.warn ? 'is-warn' : undefined}>
              <td className="stream-debug-label">{r.label}</td>
              <td className="stream-debug-value">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
