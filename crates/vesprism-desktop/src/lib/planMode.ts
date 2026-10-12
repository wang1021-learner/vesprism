/**
 * 计划模式：芯片文案、模式切换、批注格式（对齐官方 plan.md 审批）。
 */
import type { PlanComment, PlanPhase } from '../types'
import {
  $activeTabId,
  $engineStatus,
  getTabState,
  patchTab,
  pushToast,
} from '../store'
import { setSessionMode } from '../bridge'

/** 模型没写出稿时仍要弹出审批卡，避免看起来像卡住。 */
export const EMPTY_PLAN_PLACEHOLDER = `\
# 还没写计划稿

模型退出计划模式时没有写出计划。

- **批准并动手** — 离开计划模式，开始改代码
- **要改** — 让模型继续规划
- **放弃** — 丢掉这份稿并关掉计划模式
`

export type SessionModeId = 'default' | 'plan' | 'ask'

export function parseSessionMode(modeId: string | null | undefined): SessionModeId {
  const m = (modeId || '').trim().toLowerCase()
  if (m === 'plan') return 'plan'
  if (m === 'ask') return 'ask'
  return 'default'
}

export function isPlanModeId(modeId: string | null | undefined): boolean {
  return parseSessionMode(modeId) === 'plan'
}

export function isAskModeId(modeId: string | null | undefined): boolean {
  return parseSessionMode(modeId) === 'ask'
}

export function planChipLabel(
  phase: PlanPhase,
  awaiting: boolean,
): { label: string; title: string; on: boolean } {
  if (awaiting) {
    return {
      label: '计划 · 等你批',
      title: '计划稿等你审批，点开预览',
      on: true,
    }
  }
  switch (phase) {
    case 'pending':
      return {
        label: '计划 · 下条生效',
        title: '下一条消息进入计划模式，只写计划稿',
        on: true,
      }
    case 'active':
      return {
        label: '计划',
        title: '计划模式开着：只改本会话 plan.md',
        on: true,
      }
    case 'exit_pending':
      return {
        label: '计划 · 本轮后关',
        title: '本轮生成结束后关掉计划模式',
        on: true,
      }
    default:
      return {
        label: '计划',
        title: '进入计划模式：先出方案再改代码',
        on: false,
      }
  }
}

/** 引擎 CurrentModeUpdate 落到本地四态。 */
export function applyModeUpdate(
  modeId: string,
  prev: PlanPhase,
): PlanPhase {
  if (isPlanModeId(modeId)) {
    if (prev === 'pending' || prev === 'exit_pending') return prev
    if (prev === 'active') return 'active'
    return 'active'
  }
  return 'off'
}

export function markPlanActivated(phase: PlanPhase): PlanPhase {
  return phase === 'pending' ? 'active' : phase
}

export function formatPlanSnippets(
  planContent: string | null | undefined,
  startLine: number,
  endLine: number,
): string {
  const lines = (planContent || '').split('\n')
  if (startLine < 1 || endLine < startLine) return '> [selected lines unavailable]'
  const slice = lines.slice(startLine - 1, endLine)
  if (!slice.length) return '> [selected lines unavailable]'
  return slice.map((line) => `> ${line}`).join('\n')
}

export function formatPlanComments(
  comments: PlanComment[],
  planContent: string | null | undefined,
): string {
  return comments
    .filter((c) => c.text.trim())
    .map((c) => {
      const start = Math.max(1, c.startLine)
      const end = Math.max(start, c.endLine)
      const label =
        start === end
          ? `Proposed plan line ${start}:`
          : `Proposed plan lines ${start}-${end}:`
      const snippets = formatPlanSnippets(planContent, start, end)
      return `${label}\n${snippets}\n\nComment:\n${c.text.trim()}`
    })
    .join('\n\n')
}

/** 行批注 + 总意见，发给模型的 feedback。 */
export function formatPlanFeedback(
  comments: PlanComment[],
  planContent: string | null | undefined,
  freeform: string | null | undefined,
): string {
  const formatted = formatPlanComments(comments, planContent)
  const extra = (freeform || '').trim()
  if (!formatted) return extra
  if (!extra) return formatted
  return `${formatted}\n\nAdditional feedback:\n${extra}`
}

export function planPreviewBody(
  content: string | null | undefined,
  hasPlan: boolean,
): string {
  if (hasPlan && (content || '').trim()) return content as string
  return EMPTY_PLAN_PLACEHOLDER
}

export function openPlanPreview(tabId?: string): void {
  const id = tabId || $activeTabId.get()
  if (!id) return
  patchTab(id, { planPreviewOpen: true })
}

export function closePlanPreview(tabId?: string): void {
  const id = tabId || $activeTabId.get()
  if (!id) return
  patchTab(id, { planPreviewOpen: false })
}

/** 点芯片：关着则 pending；开着则退出。等你批时只重开预览。 */
export async function togglePlanMode(): Promise<void> {
  const tabId = $activeTabId.get()
  if (!tabId) return
  const st = getTabState(tabId)
  if (!st) return
  if (st.planApproval) {
    patchTab(tabId, { planPreviewOpen: true })
    return
  }
  const generating = $engineStatus.get() === 'generating'
  const on =
    st.planPhase === 'pending' ||
    st.planPhase === 'active' ||
    st.planPhase === 'exit_pending'
  const nextPhase: PlanPhase = on
    ? generating
      ? 'exit_pending'
      : 'off'
    : generating
      ? 'active'
      : 'pending'
  const modeId = on ? 'default' : 'plan'
  patchTab(tabId, {
    planPhase: nextPhase,
    sessionMode: on ? 'default' : 'plan',
  })
  try {
    await setSessionMode(tabId, modeId)
  } catch (e) {
    patchTab(tabId, { planPhase: st.planPhase, sessionMode: st.sessionMode })
    pushToast(`切换计划模式失败 · ${String(e)}`, 'error')
  }
}

/** 问答模式：只问不改文件。与计划互斥，走同一套 session/set_mode。 */
export async function toggleAskMode(): Promise<void> {
  const tabId = $activeTabId.get()
  if (!tabId) return
  const st = getTabState(tabId)
  if (!st) return
  if (st.planApproval) {
    pushToast('先处理计划稿审批', 'info')
    patchTab(tabId, { planPreviewOpen: true })
    return
  }
  const on = st.sessionMode === 'ask'
  const modeId = on ? 'default' : 'ask'
  patchTab(tabId, {
    sessionMode: on ? 'default' : 'ask',
    planPhase: on ? st.planPhase : 'off',
  })
  try {
    await setSessionMode(tabId, modeId)
  } catch (e) {
    patchTab(tabId, { sessionMode: st.sessionMode, planPhase: st.planPhase })
    pushToast(`切换问答模式失败 · ${String(e)}`, 'error')
  }
}

export function markPlanActivatedOnSend(tabId?: string): void {
  const id = tabId || $activeTabId.get()
  if (!id) return
  const st = getTabState(id)
  if (!st || st.planPhase !== 'pending') return
  patchTab(id, { planPhase: 'active' })
}
