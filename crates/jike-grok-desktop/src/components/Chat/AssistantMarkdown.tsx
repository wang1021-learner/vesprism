import { memo, useMemo } from 'react'
import { Streamdown } from 'streamdown'
import { 
  tailBoundedRemend, 
  parseMarkdownIntoBlocks, 
} from '@assistant-ui/react-streamdown'
import { createMathPlugin } from '@streamdown/math'

// 简单的预处理流水线示例，后续可按需丰富
function preprocessMarkdown(text: string): string {
  let processed = text
  // 去除可能的 preview 标记噪声 (示例)
  processed = processed.replace(/<preview>[\s\S]*?<\/preview>/g, '')
  // 规范化数学分隔符 (示例：将 \\( 转为 $)
  processed = processed.replace(/\\\((.*?)\\\)/g, '$$$1$$')
  return processed
}

function preprocessWithTailRepair(text: string): string {
  return tailBoundedRemend(preprocessMarkdown(text))
}

interface Props { text: string }

export const AssistantMarkdown = memo(function AssistantMarkdown({ text }: Props) {
  const plugins = useMemo(() => {
    return { math: createMathPlugin({ singleDollarTextMath: true }) }
  }, [])

  const processedText = useMemo(() => preprocessWithTailRepair(text), [text])

  if (!text) return null

  return (
    <Streamdown
      parseIncompleteMarkdown={false}
      parseMarkdownIntoBlocksFn={parseMarkdownIntoBlocks}
      plugins={plugins}
    >
      {processedText}
    </Streamdown>
  )
})
