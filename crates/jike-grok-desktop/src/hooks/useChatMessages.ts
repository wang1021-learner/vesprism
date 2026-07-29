import { useCallback, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { createPendingPrompts } from '../lib/pendingPrompts'
import { createStreamTypewriter } from '../lib/streamTypewriter'
import type {
  ChatMessage,
  ChatRole,
  PermissionRequest,
  ToolCallData,
  ToolCallUpdateData,
} from '../types'

/**
 * 消息列表 + 流式打字机 + 工具卡。
 * 打字机细节见 createStreamTypewriter；此处只接线。
 */
export function useChatMessages() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [contextUsedTokens, setContextUsedTokens] = useState(0)
  const [usageDetail, setUsageDetail] = useState<Record<string, unknown> | null>(null)
  const [usageDetailLoading, setUsageDetailLoading] = useState(false)
  const [permissionQueue, setPermissionQueue] = useState<PermissionRequest[]>([])
  const permission = permissionQueue[0] ?? null

  const nextId = useRef(1)
  const streamRef = useRef<ReturnType<typeof createStreamTypewriter> | null>(null)
  if (!streamRef.current) {
    streamRef.current = createStreamTypewriter({
      apply: (fn) => setMessages(fn),
      allocId: () => nextId.current++,
    })
  }
  const stream = streamRef.current

  const pendingPromptsRef = useRef<ReturnType<typeof createPendingPrompts> | null>(null)
  if (!pendingPromptsRef.current) {
    pendingPromptsRef.current = createPendingPrompts()
  }
  const pendingPrompts = pendingPromptsRef.current

  /** 流式 append 或整段 push */
  const pushMessage = useCallback(
    (role: ChatRole, text: string, append = false, promptId?: string) => {
      if (append) {
        stream.append(role, text)
        return
      }
      stream.push(role, text, promptId)
    },
    [stream],
  )

  const fetchUsageDetail = useCallback(async () => {
    if (usageDetailLoading) return
    setUsageDetailLoading(true)
    try {
      const detail = await invoke('get_session_usage')
      setUsageDetail(detail as Record<string, unknown>)
    } catch (e) {
      pushMessage('system', `获取用量明细失败: ${String(e)}`)
    } finally {
      setUsageDetailLoading(false)
    }
  }, [usageDetailLoading, pushMessage])

  const upsertToolCall = useCallback(
    (tool: ToolCallData) => {
      stream.commitSealed((prev) => {
        const idx = prev.findIndex(
          (m) => m.role === 'tool' && m.tool.toolCallId === tool.toolCallId,
        )
        if (idx >= 0) {
          const copy = [...prev]
          const cur = copy[idx]
          if (cur.role !== 'tool') return prev
          copy[idx] = {
            id: cur.id,
            role: 'tool',
            text: tool.detail || tool.title,
            tool: { ...cur.tool, ...tool },
          }
          return copy
        }
        return [
          ...prev,
          {
            id: nextId.current++,
            role: 'tool' as const,
            text: tool.detail || tool.title,
            tool,
          },
        ]
      })
    },
    [stream],
  )

  const patchToolCall = useCallback(
    (update: ToolCallUpdateData) => {
      stream.commitSealed((prev) => {
        const idx = prev.findIndex(
          (m) => m.role === 'tool' && m.tool.toolCallId === update.toolCallId,
        )
        if (idx < 0) {
          const tool: ToolCallData = {
            toolCallId: update.toolCallId,
            kind: update.kind ?? 'other',
            status: update.status ?? 'in_progress',
            title: update.title ?? '工具调用',
            detail: update.detail ?? '',
            preview: update.preview ?? '',
            diffs: update.diffs ?? [],
          }
          return [
            ...prev,
            {
              id: nextId.current++,
              role: 'tool' as const,
              text: tool.detail || tool.title,
              tool,
            },
          ]
        }
        const copy = [...prev]
        const cur = copy[idx]
        if (cur.role !== 'tool') return prev
        const old = cur.tool
        const next: ToolCallData = {
          toolCallId: old.toolCallId,
          kind: update.kind ?? old.kind,
          status: update.status ?? old.status,
          title: update.title ?? old.title,
          detail: update.detail ?? old.detail,
          preview: update.preview ?? old.preview,
          diffs: update.diffs ?? old.diffs,
        }
        copy[idx] = {
          id: cur.id,
          role: 'tool',
          text: next.detail || next.title,
          tool: next,
        }
        return copy
      })
    },
    [stream],
  )

  const resetConversationUi = useCallback(() => {
    stream.discard()
    stream.setActiveRole(null)
    pendingPrompts.clearAll()
    setMessages([])
    setContextUsedTokens(0)
    setPermissionQueue([])
    setUsageDetail(null)
  }, [stream, pendingPrompts])

  return {
    messages,
    setMessages,
    contextUsedTokens,
    setContextUsedTokens,
    usageDetail,
    usageDetailLoading,
    fetchUsageDetail,
    permissionQueue,
    setPermissionQueue,
    permission,
    pushMessage,
    /** 统一流式控制：flush / discard / seal / getActiveRole … */
    stream,
    pendingPrompts,
    upsertToolCall,
    patchToolCall,
    resetConversationUi,
  }
}

export type ChatMessagesApi = ReturnType<typeof useChatMessages>
