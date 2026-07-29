import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useSidePanel } from '../../context/SidePanelContext'
import { reportMarkdownCost } from '../../lib/streamMetrics'

interface AssistantMarkdownProps {
  text: string
  /**
   * 流式输出中：不跑 remark/rehype，用纯文本。
   * 结束后：先 GFM 无高亮，约 100ms 后再开 rehype-highlight。
   */
  streaming?: boolean
}

const PREVIEWABLE_LANGS = new Set(['html', 'svg'])

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_HIGHLIGHT = [rehypeHighlight]

/** 结束后延迟开高亮，错开 turn_end 当帧主线程压力 */
const HIGHLIGHT_DELAY_MS = 100

export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  streaming = false,
}: AssistantMarkdownProps) {
  const { openArtifact } = useSidePanel()

  if (streaming) {
    return (
      <div className="md-body md-body-streaming">
        <pre className="md-streaming-plain">{text}</pre>
        <span className="md-streaming-caret" aria-hidden />
      </div>
    )
  }

  return <MarkdownSettled text={text} openArtifact={openArtifact} />
})

/**
 * 流式结束后的 Markdown。
 * - 立即：remark-gfm，无 highlight（快出结构）
 * - ~100ms 后：再挂 rehype-highlight
 * - Metrics：统计「创建 ReactMarkdown 元素～microtask」的近似耗时（非纯 parser）
 */
const MarkdownSettled = memo(function MarkdownSettled({
  text,
  openArtifact,
}: {
  text: string
  openArtifact: (lang: 'html' | 'svg', code: string, title?: string) => void
}) {
  // 仅在本条 text 挂载时延迟开高亮，避免 text 引用抖动反复闪
  const [enableHighlight, setEnableHighlight] = useState(false)

  useEffect(() => {
    setEnableHighlight(false)
    const timer = window.setTimeout(() => {
      setEnableHighlight(true)
    }, HIGHLIGHT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [text])

  const components = useMemo(
    () => ({
      code(props: {
        className?: string
        children?: ReactNode
        node?: { position?: { start?: { offset?: number }; end?: { offset?: number } } }
      }) {
        const { className, children, node, ...rest } = props
        const match = /language-(\w+)/.exec(className || '')
        const lang = match?.[1]?.toLowerCase()
        const isBlock = Boolean(node?.position && !className?.includes('inline'))
        const rawSlice =
          node?.position?.start?.offset != null && node?.position?.end?.offset != null
            ? text.slice(node.position.start.offset, node.position.end.offset)
            : null
        const codeText = rawSlice
          ? rawSlice.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '')
          : String(children).replace(/\n$/, '')

        if (isBlock && lang && PREVIEWABLE_LANGS.has(lang)) {
          return (
            <div className="code-block-with-preview">
              <code className={className} {...rest}>
                {children}
              </code>
              <button
                type="button"
                className="code-preview-trigger"
                onClick={() => openArtifact(lang as 'html' | 'svg', codeText)}
              >
                预览 {lang.toUpperCase()}
              </button>
            </div>
          )
        }
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        )
      },
    }),
    [text, openArtifact],
  )

  // 创建 ReactMarkdown 元素前后计时（含插件配置选择）；仍非 pure unified 解析时间
  const start = performance.now()
  const markdown = (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={enableHighlight ? REHYPE_HIGHLIGHT : []}
      components={components}
    >
      {text}
    </ReactMarkdown>
  )
  // Metrics：createElement 路径近似；highlight 打开后的第二次渲染也会上报
  queueMicrotask(() => {
    reportMarkdownCost(performance.now() - start)
  })

  return <div className="md-body">{markdown}</div>
})
