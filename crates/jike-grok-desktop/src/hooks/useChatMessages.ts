import { useCallback, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  createTranscriptAssembler,
  viewMessages,
  type LiveMessage,
  type TranscriptAssembler,
} from '../lib/chatTranscript'
import { createPendingPrompts } from '../lib/pendingPrompts'
import { noteFrameTimestamp, reportStreamTick } from '../lib/streamMetrics'
import type {
  ChatMessage,
  ChatRole,
  PermissionRequest,
  ToolCallData,
  ToolCallUpdateData,
} from '../types'

/**
 * history（定稿）+ live（当前流式条）+ 历史回放组装。
 *
 * - 实时：assistant/thought 只改 live（rAF 合帧 setState）；user/tool 进 history
 * - 回放：事件先写入 assembler，finishReplay 一次 setHistory
 * - 文本合并：官方 bufferingSettings；前端只做一帧一次 live 更新
 */
export function useChatMessages() {
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [live, setLive] = useState<LiveMessage | null>(null)
  const [contextUsedTokens, setContextUsedTokens] = useState(0)
  const [usageDetail, setUsageDetail] = useState<Record<string, unknown> | null>(
    null,
  )
  const [usageDetailLoading, setUsageDetailLoading] = useState(false)
  const [permissionQueue, setPermissionQueue] = useState<PermissionRequest[]>([])
  const permission = permissionQueue[0] ?? null

  const nextId = useRef(1)
  const allocId = useCallback(() => nextId.current++, [])

  /** 实时路径 assembler（与 React state 同步） */
  const liveAsm = useRef<TranscriptAssembler | null>(null)
  if (!liveAsm.current) {
    liveAsm.current = createTranscriptAssembler(allocId)
  }

  /** 回放路径：独立 assembler，finish 时一次性落到 React */
  const replayAsm = useRef<TranscriptAssembler | null>(null)
  const replaying = useRef(false)

  const pendingPromptsRef = useRef<ReturnType<typeof createPendingPrompts> | null>(
    null,
  )
  if (!pendingPromptsRef.current) {
    pendingPromptsRef.current = createPendingPrompts()
  }
  const pendingPrompts = pendingPromptsRef.current

  /** live 文本 rAF 合帧：一帧最多一次 setLive */
  const liveRaf = useRef(0)
  const scheduleLivePaint = useCallback(() => {
    if (liveRaf.current) return
    liveRaf.current = requestAnimationFrame(() => {
      liveRaf.current = 0
      const t0 = performance.now()
      const frameDelta = noteFrameTimestamp(t0)
      const snap = liveAsm.current!.snapshot()
      setLive(snap.live)
      reportStreamTick({
        tickCost: performance.now() - t0,
        commitCost: performance.now() - t0,
        pendingChars: 0,
        batchSize: snap.live?.text.length ?? 0,
        frameDeltaMs: frameDelta,
      })
    })
  }, [])

  const cancelLiveRaf = useCallback(() => {
    if (liveRaf.current) {
      cancelAnimationFrame(liveRaf.current)
      liveRaf.current = 0
    }
  }, [])

  const paintHistoryFromLiveAsm = useCallback(() => {
    cancelLiveRaf()
    const snap = liveAsm.current!.snapshot()
    setHistory(snap.history)
    setLive(snap.live)
  }, [cancelLiveRaf])

  const activeAsm = (): TranscriptAssembler => {
    if (replaying.current && replayAsm.current) return replayAsm.current
    return liveAsm.current!
  }

  // ── 回放 API ──────────────────────────────────────────
  const beginReplay = useCallback(() => {
    cancelLiveRaf()
    replaying.current = true
    replayAsm.current = createTranscriptAssembler(allocId)
    liveAsm.current!.clear()
    setHistory([])
    setLive(null)
  }, [allocId, cancelLiveRaf])

  const finishReplay = useCallback(() => {
    if (!replaying.current || !replayAsm.current) return
    replayAsm.current.sealLive()
    const snap = replayAsm.current.snapshot()
    // 把结果拷到 live assembler，保持后续实时一致
    liveAsm.current!.replaceAll(snap.history)
    replaying.current = false
    replayAsm.current = null
    setHistory(snap.history)
    setLive(null)
  }, [])

  const isReplaying = useCallback(() => replaying.current, [])

  // ── 消息写入 ──────────────────────────────────────────
  const appendAgent = useCallback(
    (role: 'assistant' | 'thought', text: string) => {
      if (!text) return
      const asm = activeAsm()
      asm.appendLive(role, text)
      if (replaying.current) return
      scheduleLivePaint()
    },
    [scheduleLivePaint],
  )

  const pushUser = useCallback(
    (text: string, promptId?: string) => {
      const asm = activeAsm()
      asm.pushUser(text, promptId)
      if (replaying.current) return
      paintHistoryFromLiveAsm()
    },
    [paintHistoryFromLiveAsm],
  )

  const pushSystem = useCallback(
    (text: string) => {
      const asm = activeAsm()
      asm.pushSystem(text)
      if (replaying.current) return
      paintHistoryFromLiveAsm()
    },
    [paintHistoryFromLiveAsm],
  )

  /** 兼容旧 pushMessage(role, text, append?, promptId?) */
  const pushMessage = useCallback(
    (role: ChatRole, text: string, append = false, promptId?: string) => {
      if (role === 'tool') return
      if (role === 'system') {
        pushSystem(text)
        return
      }
      if (role === 'user') {
        if (append) {
          activeAsm().appendUser(text)
          if (!replaying.current) paintHistoryFromLiveAsm()
          return
        }
        pushUser(text, promptId)
        return
      }
      if (role === 'assistant' || role === 'thought') {
        if (append) appendAgent(role, text)
        else {
          // 整段：当作 live 后 seal
          const asm = activeAsm()
          asm.sealLive()
          asm.appendLive(role, text)
          asm.sealLive()
          if (!replaying.current) paintHistoryFromLiveAsm()
        }
      }
    },
    [appendAgent, paintHistoryFromLiveAsm, pushSystem, pushUser],
  )

  const upsertToolCall = useCallback(
    (tool: ToolCallData) => {
      activeAsm().upsertTool(tool)
      if (!replaying.current) paintHistoryFromLiveAsm()
    },
    [paintHistoryFromLiveAsm],
  )

  const patchToolCall = useCallback(
    (update: ToolCallUpdateData) => {
      activeAsm().patchTool(update)
      if (!replaying.current) paintHistoryFromLiveAsm()
    },
    [paintHistoryFromLiveAsm],
  )

  const sealLive = useCallback(() => {
    if (replaying.current) {
      replayAsm.current?.sealLive()
      return
    }
    liveAsm.current!.sealLive()
    paintHistoryFromLiveAsm()
  }, [paintHistoryFromLiveAsm])

  const resetConversationUi = useCallback(() => {
    cancelLiveRaf()
    replaying.current = false
    replayAsm.current = null
    liveAsm.current!.clear()
    pendingPrompts.clearAll()
    setHistory([])
    setLive(null)
    setContextUsedTokens(0)
    setPermissionQueue([])
    setUsageDetail(null)
  }, [cancelLiveRaf, pendingPrompts])

  const setMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      cancelLiveRaf()
      const snap = liveAsm.current!.snapshot()
      const base = viewMessages(snap)
      const next = typeof updater === 'function' ? updater(base) : updater
      liveAsm.current!.replaceAll(next)
      setHistory(next)
      setLive(null)
    },
    [cancelLiveRaf],
  )

  const messages = useMemo(
    () => viewMessages({ history, live }),
    [history, live],
  )

  const fetchUsageDetail = useCallback(async () => {
    if (usageDetailLoading) return
    setUsageDetailLoading(true)
    try {
      const detail = await invoke('get_session_usage')
      setUsageDetail(detail as Record<string, unknown>)
    } catch (e) {
      pushSystem(`获取用量明细失败: ${String(e)}`)
    } finally {
      setUsageDetailLoading(false)
    }
  }, [usageDetailLoading, pushSystem])

  /** 兼容旧 stream.* API（桌面其它调用点） */
  const stream = useMemo(
    () => ({
      append: (role: ChatRole, text: string) => {
        if (role === 'assistant' || role === 'thought') appendAgent(role, text)
      },
      appendImmediate: (role: ChatRole, text: string) => {
        if (role === 'assistant' || role === 'thought') {
          appendAgent(role, text)
          if (!replaying.current) {
            cancelLiveRaf()
            setLive(liveAsm.current!.snapshot().live)
          }
        }
      },
      push: (role: ChatRole, text: string, promptId?: string) => {
        pushMessage(role, text, false, promptId)
      },
      flush: () => {
        if (replaying.current) return
        cancelLiveRaf()
        setLive(liveAsm.current!.snapshot().live)
      },
      discard: () => {
        cancelLiveRaf()
        // 丢弃 live，不写 history
        const h = liveAsm.current!.snapshot().history
        liveAsm.current!.replaceAll(h)
        setLive(null)
      },
      seal: () => sealLive(),
      commitSealed: (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
        if (replaying.current) {
          const asm = replayAsm.current!
          asm.sealLive()
          const base = viewMessages(asm.snapshot())
          asm.replaceAll(updater(base))
          return
        }
        sealLive()
        setMessages(updater)
      },
      getActiveRole: (): ChatRole | null => {
        if (replaying.current) return replayAsm.current?.liveRole() ?? null
        return liveAsm.current!.liveRole()
      },
      setActiveRole: (_role: ChatRole | null) => {
        /* live 由 append 驱动 */
      },
      getPendingChars: () => liveAsm.current!.snapshot().live?.text.length ?? 0,
    }),
    [appendAgent, cancelLiveRaf, pushMessage, sealLive, setMessages],
  )

  return {
    messages,
    history,
    live,
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
    appendAgent,
    pushUser,
    pushSystem,
    stream,
    pendingPrompts,
    upsertToolCall,
    patchToolCall,
    sealLive,
    resetConversationUi,
    beginReplay,
    finishReplay,
    isReplaying,
  }
}

export type ChatMessagesApi = ReturnType<typeof useChatMessages>
