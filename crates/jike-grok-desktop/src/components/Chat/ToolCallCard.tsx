import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { ToolCallData } from '../../types'
import { useSidePanel } from '../../context/SidePanelContext'

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

function hasDiffContent(tool: ToolCallData): boolean {
  if (tool.diffs && tool.diffs.length > 0) return true
  const p = tool.preview?.trim() ?? ''
  return p.startsWith('diff ') || /^(?:[+-]|@@)/m.test(p)
}

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const { openArtifact, openToolDiff, openToolOutput, workspaceRoot } =
    useSidePanel()

  const hasPreview = Boolean(tool.preview?.trim())
  const hasDiff = hasDiffContent(tool)
  /** 编辑类一律给 Diff 入口，避免后端未带 diffs 时按钮消失 */
  const showDiffBtn = hasDiff || tool.kind === 'edit'
  const showOutputBtn = hasPreview || tool.kind === 'execute' || tool.kind === 'read'
  const canExpand = hasPreview || hasDiff
  const headline = tool.detail?.trim() || tool.title?.trim() || tool.toolCallId

  const previewLang =
    (tool.kind === 'edit' || tool.kind === 'write') &&
    (tool.status === 'completed' || tool.status === 'failed')
      ? getPreviewLanguage(tool.detail)
      : tool.detail
        ? getPreviewLanguage(tool.detail)
        : null

  const handlePreviewFile = async () => {
    if (!previewLang || previewLoading) return
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const content = await invoke<string>('read_file_for_preview', {
        path: tool.detail,
        workspaceRoot,
      })
      openArtifact(previewLang, content, tool.detail)
    } catch (e) {
      setPreviewError(String(e))
    } finally {
      setPreviewLoading(false)
    }
  }

  const showActions = showDiffBtn || showOutputBtn || previewLang

  return (
    <div className={`tool-card status-${tool.status} kind-${tool.kind}`}>
      <button
        type="button"
        className="tool-card-header"
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        title={canExpand ? (expanded ? '收起输出' : '展开输出') : undefined}
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
        <span className={`tool-status status-${tool.status}`}>
          {statusLabel(tool.status)}
        </span>
        {canExpand && (
          <span className="tool-expand" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
        )}
      </button>

      {showActions && (
        <div className="tool-card-preview-action">
          {showDiffBtn && (
            <button
              type="button"
              className="tool-preview-open-btn tool-preview-diff-btn"
              onClick={(e) => {
                e.stopPropagation()
                openToolDiff(tool)
              }}
              title="在右侧栏打开 Diff（独立标签，不覆盖其它预览）"
            >
              <span className="tool-preview-btn-icon" aria-hidden>
                ≷
              </span>
              <span>预览 Diff</span>
            </button>
          )}
          {showOutputBtn && (
            <button
              type="button"
              className="tool-preview-open-btn"
              onClick={(e) => {
                e.stopPropagation()
                openToolOutput(tool)
              }}
              title="在右侧栏打开输出（独立标签）"
            >
              <span className="tool-preview-btn-icon" aria-hidden>
                ⧉
              </span>
              <span>预览输出</span>
            </button>
          )}
          {previewLang && (
            <button
              type="button"
              className="tool-preview-open-btn"
              onClick={(e) => {
                e.stopPropagation()
                void handlePreviewFile()
              }}
              disabled={previewLoading}
              title="在右侧栏打开 HTML/SVG（独立标签）"
            >
              <span className="tool-preview-btn-icon" aria-hidden>
                🌐
              </span>
              <span>
                {previewLoading
                  ? '加载中…'
                  : `预览 ${previewLang.toUpperCase()}`}
              </span>
            </button>
          )}
          {previewError && (
            <span className="tool-preview-error">{previewError}</span>
          )}
        </div>
      )}

      {expanded && hasPreview && (
        <pre className={`tool-preview${hasDiff ? ' tool-preview-diff' : ''}`}>
          {hasDiff
            ? tool.preview.split('\n').map((line, i) => {
                let cls = 'tool-preview-line'
                if (line.startsWith('+') && !line.startsWith('+++'))
                  cls += ' is-add'
                else if (line.startsWith('-') && !line.startsWith('---'))
                  cls += ' is-del'
                else if (line.startsWith('diff ') || line.startsWith('@@'))
                  cls += ' is-hunk'
                return (
                  <span key={i} className={cls}>
                    {line}
                    {'\n'}
                  </span>
                )
              })
            : tool.preview}
        </pre>
      )}
    </div>
  )
}
