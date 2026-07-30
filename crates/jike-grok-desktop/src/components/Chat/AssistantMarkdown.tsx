import { memo } from 'react'
import { Streamdown } from 'streamdown'

interface Props { text: string }

export const AssistantMarkdown = memo(function AssistantMarkdown({ text }: Props) {
  if (!text) return null
  return <Streamdown>{text}</Streamdown>
})
