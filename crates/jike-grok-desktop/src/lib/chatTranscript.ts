/**
 * 会话 transcript 组装：history（已定稿）+ live（当前流式条）。
 * 历史回放在 replay 缓冲里攒齐后一次 commit，不经打字机。
 */
import type { ChatMessage, ChatRole, ToolCallData, ToolCallUpdateData } from '../types'

export type LiveMessage = {
  id: number
  role: 'assistant' | 'thought'
  text: string
}

export type TranscriptSnapshot = {
  history: ChatMessage[]
  live: LiveMessage | null
}

/** 可渲染的完整列表 = history + live */
export function viewMessages(snap: TranscriptSnapshot): ChatMessage[] {
  if (!snap.live) return snap.history
  return [
    ...snap.history,
    { id: snap.live.id, role: snap.live.role, text: snap.live.text },
  ]
}

type AllocId = () => number

/** 可变组装器：实时与回放共用同一套规则 */
export function createTranscriptAssembler(allocId: AllocId) {
  let history: ChatMessage[] = []
  let live: LiveMessage | null = null

  const sealLive = () => {
    if (!live) return
    if (live.text.length > 0) {
      history = [
        ...history,
        { id: live.id, role: live.role, text: live.text },
      ]
    }
    live = null
  }

  const appendLive = (role: 'assistant' | 'thought', text: string) => {
    if (!text) return
    if (live && live.role === role) {
      live = { ...live, text: live.text + text }
      return
    }
    sealLive()
    live = { id: allocId(), role, text }
  }

  const pushUser = (text: string, promptId?: string) => {
    sealLive()
    history = [
      ...history,
      promptId != null
        ? { id: allocId(), role: 'user' as const, text, promptId }
        : { id: allocId(), role: 'user' as const, text },
    ]
  }

  /** 追加到末条 user（若无则新建） */
  const appendUser = (text: string) => {
    if (!text) return
    sealLive()
    const last = history[history.length - 1]
    if (last?.role === 'user') {
      const copy = history.slice()
      copy[copy.length - 1] = { ...last, text: last.text + text }
      history = copy
      return
    }
    history = [...history, { id: allocId(), role: 'user', text }]
  }

  const pushSystem = (text: string) => {
    sealLive()
    history = [...history, { id: allocId(), role: 'system', text }]
  }

  const upsertTool = (tool: ToolCallData) => {
    sealLive()
    const idx = history.findIndex(
      (m) => m.role === 'tool' && m.tool.toolCallId === tool.toolCallId,
    )
    if (idx >= 0) {
      const cur = history[idx]
      if (cur.role !== 'tool') return
      const copy = history.slice()
      copy[idx] = {
        id: cur.id,
        role: 'tool',
        text: tool.detail || tool.title,
        tool: { ...cur.tool, ...tool },
      }
      history = copy
      return
    }
    history = [
      ...history,
      {
        id: allocId(),
        role: 'tool',
        text: tool.detail || tool.title,
        tool,
      },
    ]
  }

  const patchTool = (update: ToolCallUpdateData) => {
    sealLive()
    const idx = history.findIndex(
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
      history = [
        ...history,
        {
          id: allocId(),
          role: 'tool',
          text: tool.detail || tool.title,
          tool,
        },
      ]
      return
    }
    const cur = history[idx]
    if (cur.role !== 'tool') return
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
    const copy = history.slice()
    copy[idx] = {
      id: cur.id,
      role: 'tool',
      text: next.detail || next.title,
      tool: next,
    }
    history = copy
  }

  const snapshot = (): TranscriptSnapshot => ({
    history,
    live: live ? { ...live } : null,
  })

  const replaceAll = (msgs: ChatMessage[]) => {
    history = msgs
    live = null
  }

  const clear = () => {
    history = []
    live = null
  }

  const filterHistory = (pred: (m: ChatMessage) => boolean) => {
    history = history.filter(pred)
  }

  return {
    appendLive,
    sealLive,
    pushUser,
    appendUser,
    pushSystem,
    upsertTool,
    patchTool,
    snapshot,
    replaceAll,
    clear,
    filterHistory,
    /** 当前 live 角色（无则 null） */
    liveRole: (): ChatRole | null => live?.role ?? null,
  }
}

export type TranscriptAssembler = ReturnType<typeof createTranscriptAssembler>
