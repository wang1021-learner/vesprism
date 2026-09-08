import { useState } from 'react'
import type { DemoFile, OfficeTask } from './model'
import { DeliverableRenderer } from './Deliverable'
import { pushToast } from '../store'

function safePreview(file: { preview?: string } | null | undefined): string {
  return typeof file?.preview === 'string' ? file.preview : ''
}

export function ArtifactPanel({
  task,
}: {
  task: OfficeTask
}) {
  const [activeSlide, setActiveSlide] = useState(1)
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted')
  const file = task.file

  const isStreaming = task.status === 'running' && task.stepIndex >= task.plan.length && task.streamCursor !== undefined
  const previewFull = safePreview(file)

  // 如果在流式打字中，截取 preview；缺失按空串
  const displayFile: DemoFile | null = file
    ? isStreaming && task.streamCursor !== undefined
      ? {
          ...file,
          preview: previewFull.slice(0, Math.max(0, task.streamCursor ?? 0)),
        }
      : { ...file, preview: previewFull }
    : null

  const onCopy = async () => {
    if (!file) return
    try {
      await navigator.clipboard.writeText(previewFull)
      pushToast('已复制产物全文到剪贴板', 'info')
    } catch {
      pushToast('复制失败，请手动复制', 'error')
    }
  }

  const onDownload = () => {
    if (!file) return
    const blob = new Blob([previewFull], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name || '交付成果.md'
    a.click()
    URL.revokeObjectURL(url)
    pushToast(`已开始下载《${file.name}》`, 'info')
  }

  const currentStep = task.stepIndex >= 0 ? task.plan[task.stepIndex] : null

  return (
    <div className="oc-artifact-panel" role="region" aria-label="产物">
      <div className="oc-artifact-topbar">
        <div className="oc-artifact-title-wrap">
          <span className="oc-artifact-pill">
            {file ? (file.kind === 'pptx' ? 'PPT 幻灯片' : file.kind === 'xlsx' ? '数据报表' : '公文报告') : '产物就绪中'}
          </span>
          <h3 className="oc-artifact-heading">
            {file?.title || task.title}
          </h3>
          {isStreaming ? (
            <span className="oc-streaming-indicator">
              <span className="oc-pulse-dot" />
              正在生成…
            </span>
          ) : null}
        </div>

        {file ? (
          <div className="oc-artifact-actions">
            <div className="od-view-switcher" role="group" aria-label="视图模式切换">
              <button
                type="button"
                className={viewMode === 'formatted' ? 'is-active' : ''}
                onClick={() => setViewMode('formatted')}
                title="格式化排版视图"
              >
                排版
              </button>
              <button
                type="button"
                className={viewMode === 'raw' ? 'is-active' : ''}
                onClick={() => setViewMode('raw')}
                title="Markdown 源码"
              >
                源码
              </button>
            </div>
            <button
              type="button"
              className="oc-action-btn"
              onClick={onCopy}
              title="复制正文"
            >
              <span>复制</span>
            </button>
            <button
              type="button"
              className="oc-action-btn"
              onClick={onDownload}
              title="导出文件"
            >
              <span>导出</span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="oc-artifact-body">
        {displayFile ? (
          <div className="oc-artifact-content">
            {viewMode === 'raw' ? (
              <pre className="od-raw-preview">{displayFile.preview}</pre>
            ) : (
              <DeliverableRenderer
                file={displayFile}
                activeSlide={activeSlide}
                setActiveSlide={setActiveSlide}
              />
            )}
            {isStreaming ? (
              <div className="oc-stream-typing-line">
                <span className="oc-cursor" />
              </div>
            ) : null}
          </div>
        ) : task.status === 'running' ? (
          <div className="oc-artifact-empty">
            <div className="oc-empty-card">
              <div className="od-loading-mark" aria-hidden>
                {Math.max(task.stepIndex + 1, 0)}/{task.plan.length}
              </div>
              <h4>正在执行规划步骤…</h4>
              <p>{currentStep?.label ?? '初始化'}</p>
            </div>
          </div>
        ) : (
          <div className="oc-artifact-empty">
            <div className="oc-empty-card">
              <div className="oc-empty-sparkle">✦</div>
              <h4>产物</h4>
              <p>提交任务后，交付预览会出现在这里</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
