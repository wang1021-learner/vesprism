/**
 * nanostores 状态 — 对齐原始 jike-grok-desktop
 */
import { atom, computed } from 'nanostores'
import type { ChatMessage, ModelInfo, PermissionRequest, SessionPhase, SessionStatus } from './types'

// ── 会话 ──
export const $activeSessionId = atom('')
export const $messages = atom<ChatMessage[]>([])
export const $permission = atom<PermissionRequest | null>(null)
export const $error = atom('')
export const $engineStatus = atom<SessionStatus>('unknown')
export const $sessionPhase = atom<SessionPhase>('idle')

export const $generating = computed($engineStatus, (s) => s === 'generating')
export const $shellReady = computed($sessionPhase, (p) => p === 'ready')

// ── 模型 ──
export const $models = atom<ModelInfo[]>([])
export const $defaultModelId = atom('')
export const $reasoningEffort = atom('medium')

// ── 工作区 ──
export const $workspaceCwd = atom('')
export const $workspaceOptions = atom<string[]>([])

// ── 上下文用量 ──
export const $contextUsedTokens = atom(0)

// ── UI ──
export const $sidebarCollapsed = atom(false)
export const $settingsOpen = atom(false)

// ── 聊天列表 ──
export interface ChatSummary {
  id: string
  title: string
  cwd: string
  updatedAt: string
}
export const $chats = atom<ChatSummary[]>([])
export const $activeChatId = atom('')

// ── Composer 状态 ──
export const $composerInput = atom('')

// ── Toast（顶部浮层，不进对话历史；如切换模型） ──
export type ToastTone = 'info' | 'success' | 'error'
export type ToastItem = {
  id: string
  message: string
  tone?: ToastTone
}
export const $toasts = atom<ToastItem[]>([])

export function pushToast(message: string, tone: ToastTone = 'info') {
  const id = `toast_${crypto.randomUUID()}`
  const prev = $toasts.get()
  $toasts.set([...prev.slice(-4), { id, message, tone }])
}

export function dismissToast(id: string) {
  $toasts.set($toasts.get().filter((t) => t.id !== id))
}

// ── 操作 ──
export function addMessage(msg: ChatMessage) {
  $messages.set([...$messages.get(), msg])
}

export function appendToLastMessage(text: string, role: ChatMessage['role'] = 'assistant') {
  const msgs = $messages.get()
  const last = msgs[msgs.length - 1]
  if (last && last.role === role) {
    $messages.set([...msgs.slice(0, -1), { ...last, text: last.text + text }])
  } else {
    addMessage({ id: crypto.randomUUID(), role, text })
  }
}
