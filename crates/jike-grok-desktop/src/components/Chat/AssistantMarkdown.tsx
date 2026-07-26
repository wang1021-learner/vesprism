import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

interface AssistantMarkdownProps {
  text: string
  /** 流式输出中：跳过语法高亮，减少每帧全量 re-parse 开销 */
  streaming?: boolean
}

export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  streaming = false,
}: AssistantMarkdownProps) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // 流式阶段不做 highlight，结束后再启用，避免未闭合代码块反复重算
        rehypePlugins={streaming ? [] : [rehypeHighlight]}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
