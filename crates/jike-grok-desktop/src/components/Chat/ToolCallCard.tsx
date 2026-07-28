import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { ToolCallData } from '../../types'
import { useArtifact } from '../../context/ArtifactContext'

interface ToolCallCardProps {
  tool: ToolCallData
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'read':
      return '读取'
    case 'edit':
      return '编辑'
    case 'execute':
      return '终端'
    case 'search':
      return '搜索'
    case 'fetch':
      return '抓取'
    case 'delete':
      return '删除'
    case 'move':
      return '移动'
    case 'think':
      return '思考'
    default:
      return '工具'
  }
}

function kindIcon(kind: string): string {
  switch (kind) {
    case 'read':
      return '📄'
    case 'edit':
      return '✎'
    case 'execute':
      return '⌘'
    case 'search':
      return '⌕'
    case 'fetch':
      return '↗'
    case 'delete':
      return '🗑'
    default:
      return '⚙'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return '等待中'
    case 'in_progress':
      return '运行中'
    case 'completed':
      return '完成'
    case 'failed':
      return '失败'
    default:
      return status
  }
}

const PREVIEWABLE_EXTENSIONS = new Set(['html', 'svg'])

function getPreviewLanguage(filePath: string): 'html' | 'svg' | null {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (ext && PREVIEWABLE_EXTENSIONS.has(ext)) {
    return ext as 'html' | 'svg'
  }
  return null
}

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const { openArtifact, workspaceRoot } = useArtifact()
  const hasPreview = Boolean(tool.preview?.trim())
  const headline = tool.detail?.trim() || tool.title?.trim() || tool.toolCallId

  const previewLang =
    tool.kind === 'edit' && tool.status === 'completed' ? getPreviewLanguage(tool.detail) : null

  const handlePreviewFile = async () => {
    if (!previewLang || previewLoading) return
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const content = await invoke<string>('read_file_for_preview', {
        path: tool.detail,
        workspaceRoot,
      })
      openArtifact(previewLang, content)
    } catch (e) {
      setPreviewError(String(e))
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <div className={`tool-card status-${tool.status} kind-${tool.kind}`}>
      <button
        type="button"
        className="tool-card-header"
        onClick={() => hasPreview && setExpanded((v) => !v)}
        disabled={!hasPreview}
        title={hasPreview ? (expanded ? '收起输出' : '展开输出') : undefined}
      >
        <span className="tool-kind-badge" data-kind={tool.kind}>
          <span className="tool-kind-icon" aria-hidden>
            {kindIcon(tool.kind)}
          </span>
          <span className="tool-kind-text">{kindLabel(tool.kind)}</span>
        </span>
        <span className="tool-headline" title={headline}>
          {headline}
        </span>
        <span className={`tool-status status-${tool.status}`}>{statusLabel(tool.status)}</span>
        {hasPreview && (
          <span className="tool-expand" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
        )}
      </button>
      {previewLang && (
        <div className="tool-card-preview-action">
          <button
            type="button"
            className="tool-preview-open-btn"
            onClick={handlePreviewFile}
            disabled={previewLoading}
          >
            {previewLoading ? '加载中…' : `预览 ${previewLang.toUpperCase()}`}
          </button>
          {previewError && <span className="tool-preview-error">{previewError}</span>}
        </div>
      )}
      {expanded && hasPreview && (
        <pre className="tool-preview">{tool.preview}</pre>
      )}
    </div>
  )
}
