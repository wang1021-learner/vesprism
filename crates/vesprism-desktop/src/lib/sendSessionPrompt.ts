/**
 * 当前会话发送：乐观用户气泡 + 排队 / 插话。
 * `wireText` 只发给引擎（画布编排说明书），气泡和队列仍显示用户原话。
 */
import {
  $activeTabId,
  $composerInput,
  $generating,
  $messages,
  $queuedPrompts,
  patchActiveTab,
} from '../store'
import { interjectPrompt, sendPrompt, type PromptAttach } from '../bridge'
import { generateId } from './generateId'
import { markPlanActivatedOnSend } from './planMode'
import { removeUserMessageByPromptId } from './sessionTranscript'

export type SendSessionPromptOpts = {
  text?: string
  wireText?: string
  attachments?: PromptAttach[]
  mode?: 'queue' | 'interject'
  /** 画布自愈：发给引擎但不进用户气泡/队列 */
  hidden?: boolean
  /** 预发 id，便于画布在 IPC 返回前就开始认图 */
  promptId?: string
}

export async function sendSessionPrompt(
  opts: SendSessionPromptOpts = {},
): Promise<string | null> {
  const msg = (opts.text ?? $composerInput.get()).trim()
  const attach = opts.attachments?.filter((a) => a.path.trim()) ?? []
  if (!msg && attach.length === 0 && !opts.hidden) return null
  const wasGenerating = $generating.get()
  const interject = opts.mode === 'interject' && wasGenerating
  const promptId = (opts.promptId || '').trim() || generateId('p_')
  const names = attach.map((a) => a.path.replace(/\\/g, '/').split('/').pop() || a.path)
  const display = attach.length
    ? `${msg}${msg ? '\n\n' : ''}[附件] ${names.join('、')}`
    : msg
  const wire = (opts.wireText ?? msg).trim() || display
  const tabId = $activeTabId.get()
  if (!opts.hidden) markPlanActivatedOnSend(tabId)
  if (opts.hidden) {
    if (!wire) return null
    try {
      patchActiveTab({ status: 'generating', error: '' })
      await sendPrompt(tabId, wire, promptId, attach)
      return promptId
    } catch (e) {
      patchActiveTab({
        error: String(e),
        status: wasGenerating ? 'generating' : 'idle',
      })
      return null
    }
  }
  patchActiveTab({ composerInput: '' })

  if (wasGenerating && !interject) {
    const prev = $queuedPrompts.get()
    patchActiveTab({
      queuedPrompts: [
        ...prev,
        { id: promptId, version: 0, text: display, position: prev.length },
      ],
      error: '',
    })
    try {
      await sendPrompt(tabId, wire, promptId, attach)
    } catch (e) {
      patchActiveTab({
        queuedPrompts: $queuedPrompts.get().filter((q) => q.id !== promptId),
        composerInput: msg,
        error: String(e),
      })
      return null
    }
    return promptId
  }

  patchActiveTab({
    messages: [
      ...$messages.get(),
      {
        id: generateId('msg_'),
        role: 'user' as const,
        text: display,
        promptId,
      },
    ],
  })
  try {
    patchActiveTab({ status: 'generating', error: '' })
    if (interject) {
      await interjectPrompt(tabId, wire, promptId, attach)
    } else {
      await sendPrompt(tabId, wire, promptId, attach)
    }
  } catch (e) {
    patchActiveTab({
      messages: removeUserMessageByPromptId($messages.get(), promptId),
      composerInput: msg,
      error: String(e),
      status: wasGenerating ? 'generating' : 'idle',
    })
    return null
  }
  return promptId
}
