import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useArtifact } from '../../context/ArtifactContext'

interface AssistantMarkdownProps {
  text: string
  /** 流式输出中：跳过语法高亮，减少每帧全量 re-parse 开销 */
  streaming?: boolean
}

const PREVIEWABLE_LANGS = new Set(['html', 'svg'])

export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  streaming = false,
}: AssistantMarkdownProps) {
  const { openArtifact } = useArtifact()

  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={streaming ? [] : [rehypeHighlight]}
        components={{
          code(props) {
            const { className, children, node, ...rest } = props
            const match = /language-(\w+)/.exec(className || '')
            const lang = match?.[1]?.toLowerCase()
            const isBlock = node?.position && !className?.includes('inline')
            // 直接按 AST 节点在原始 markdown 源文本中的位置切片，取真正的
            // 原始代码文本；不能用 String(children)，因为 rehype-highlight
            // 处理后 children 是一堆 React 元素，强转字符串会变成 [object Object]
            const rawSlice =
              node?.position?.start.offset != null && node?.position?.end.offset != null
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
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
