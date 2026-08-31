import { useMemo } from 'react'
import {
  clearQueuedPrompts,
  editQueuedPrompt,
  holdQueuedEdit,
  interjectQueuedPrompt,
  releaseQueuedEdit,
  removeQueuedPrompt,
  reorderQueuedPrompts,
} from '../bridge'
import { $activeTabId, getTabState, patchTab, pushToast } from '../store'
import { moveQueuedPrompt } from './queueChanged'

function tabOrActive(tabId?: string): string {
  return (tabId || $activeTabId.get()).trim()
}

export function queuedPromptActions(tabId?: string) {
  return {
    async onRemoveQueued(id: string, version: number) {
      const target = tabOrActive(tabId)
      if (!target) return
      const prev = getTabState(target)?.queuedPrompts ?? []
      patchTab(target, { queuedPrompts: prev.filter((q) => q.id !== id) })
      try {
        await removeQueuedPrompt(target, id, version)
      } catch (e) {
        patchTab(target, { queuedPrompts: prev, error: String(e) })
      }
    },
    async onEditQueued(id: string, text: string) {
      const target = tabOrActive(tabId)
      if (!target) return
      try {
        await editQueuedPrompt(target, id, text)
      } catch (e) {
        pushToast(String(e), 'error')
      }
    },
    async onReorderQueued(id: string, delta: -1 | 1) {
      const target = tabOrActive(tabId)
      if (!target) return
      const prev = getTabState(target)?.queuedPrompts ?? []
      const next = moveQueuedPrompt(prev, id, delta)
      if (next === prev) return
      patchTab(target, { queuedPrompts: next })
      try {
        await reorderQueuedPrompts(
          target,
          next.map((q) => q.id),
        )
      } catch (e) {
        patchTab(target, { queuedPrompts: prev, error: String(e) })
      }
    },
    async onClearQueued() {
      const target = tabOrActive(tabId)
      if (!target) return
      const prev = getTabState(target)?.queuedPrompts ?? []
      if (!prev.length) return
      patchTab(target, { queuedPrompts: [] })
      try {
        await clearQueuedPrompts(target)
      } catch (e) {
        patchTab(target, { queuedPrompts: prev, error: String(e) })
      }
    },
    async onSendQueuedNow(id: string, version: number) {
      const target = tabOrActive(tabId)
      if (!target) return
      const prev = getTabState(target)?.queuedPrompts ?? []
      patchTab(target, { queuedPrompts: prev.filter((q) => q.id !== id) })
      try {
        await interjectQueuedPrompt(target, id, version)
      } catch (e) {
        patchTab(target, { queuedPrompts: prev, error: String(e) })
      }
    },
    onHoldQueued(id: string) {
      const target = tabOrActive(tabId)
      if (!target) return
      void holdQueuedEdit(target, id).catch((e) => pushToast(String(e), 'error'))
    },
    onReleaseQueued(id: string) {
      const target = tabOrActive(tabId)
      if (!target) return
      void releaseQueuedEdit(target, id).catch(() => {})
    },
  }
}

export function useQueuedPromptActions(tabId?: string) {
  return useMemo(() => queuedPromptActions(tabId), [tabId])
}
