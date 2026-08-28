/**
 * 画布底部输入：与编码同一套 Composer（附件 / @ / 模型 / 发送）。
 * 关掉斜杠、工作区芯片、审批/计划/问答/用量：这里编的是流程，不是编码壳。
 * @ 仍用当前会话目录。
 * 发给引擎时仍包编排说明书。
 */
import { memo, useCallback, useEffect, useState, type PointerEvent, type WheelEvent } from 'react'
import { useStore } from '@nanostores/react'
import { Composer } from '../../components/Composer'
import { McpElicitPanel } from '../../components/McpElicit'
import { PendingApprovalFallback } from '../../components/Permission'
import { AppPlanApproval } from '../../components/PlanApproval'
import { UserQuestionPanel } from '../../components/UserQuestion'
import {
  $composerInput,
  $defaultModelId,
  $generating,
  $mcpElicit,
  $models,
  $queuedPrompts,
  $reasoningEffort,
  $sessionCaps,
  $sessionPhase,
  $shellReady,
  $userQuestion,
  $workspaceCwd,
  $workspaceOptions,
  patchActiveTab,
  patchTab,
  pushToast,
  $activeTabId,
  getTabState,
  tabWorkspaceCwd,
} from '../../store'
import {
  editQueuedPrompt,
  getEnginePrefs,
  removeQueuedPrompt,
  setCurrentModel,
  setEnginePrefs,
  type PromptAttach,
} from '../../bridge'
import { cancelActiveTurn } from '../../lib/cancelActiveTurn'
import { reasoningEffortLabel, spawnReasoningEffort } from '../../lib/reasoning'
import { sendSessionPrompt } from '../../lib/sendSessionPrompt'
import { generateId } from '../../lib/generateId'
import { useActivePermission } from '../../lib/useActivePermission'
import {
  buildDialoguePrompt,
  isCanvasContractPrimed,
  markCanvasContractPrimed,
} from '../flow/prompt'
import { consumeCanvasGraph, expectCanvasGraph, resetHealBudget } from '../generateWait'
import { isFlowRunUserText } from './applyCanvasOutput'

function stopCanvasWheel(e: WheelEvent) {
  e.stopPropagation()
}

function stopCanvasPointer(e: PointerEvent) {
  e.stopPropagation()
}

export const CanvasComposer = memo(function CanvasComposer({
  flowName,
  flowId,
  nodeIds,
  error,
  onRetryStrict,
}: {
  flowName: string
  flowId: string
  nodeIds?: string[]
  error?: string
  onRetryStrict?: () => void
}) {
  const generating = useStore($generating)
  const ready = useStore($shellReady)
  const phase = useStore($sessionPhase)
  const models = useStore($models)
  const modelId = useStore($defaultModelId)
  const effort = useStore($reasoningEffort)
  const tabId = useStore($activeTabId)
  const projectedCwd = useStore($workspaceCwd)
  const cwd = tabWorkspaceCwd(tabId) || projectedCwd
  const wsOptions = useStore($workspaceOptions)
  const queued = useStore($queuedPrompts)
  const permission = useActivePermission()
  const caps = useStore($sessionCaps)
  const userQuestion = useStore($userQuestion)
  const mcpElicit = useStore($mcpElicit)
  const [combineQueued, setCombineQueued] = useState(false)
  const [questionFocusKey, setQuestionFocusKey] = useState(0)

  useEffect(() => {
    const onFocus = () => setQuestionFocusKey((k) => k + 1)
    window.addEventListener('jike:focus-user-question', onFocus)
    return () => window.removeEventListener('jike:focus-user-question', onFocus)
  }, [])

  const onSend = useCallback(
    async (text?: string, attachments?: PromptAttach[], mode?: 'queue' | 'interject') => {
      const msg = (text ?? $composerInput.get()).trim()
      const names = (attachments ?? [])
        .map((a) => a.path.replace(/\\/g, '/').split('/').pop() || a.path)
        .filter(Boolean)
      const userLine = msg || (names.length ? `[附件] ${names.join('、')}` : '')
      const sessionId = tabId ? getTabState(tabId)?.sessionId : ''
      const primed = isCanvasContractPrimed(sessionId)
      const promptId = generateId('p_')
      const expectGraph = !isFlowRunUserText(userLine)
      if (expectGraph) expectCanvasGraph(promptId)
      const sent = await sendSessionPrompt({
        text: msg,
        wireText: buildDialoguePrompt(
          userLine,
          { name: flowName, id: flowId },
          { primed, nodeIds },
        ),
        attachments,
        mode,
        promptId,
      })
      if (sent) {
        markCanvasContractPrimed(sessionId)
        resetHealBudget()
      } else if (expectGraph) {
        consumeCanvasGraph(promptId)
      }
    },
    [flowName, flowId, tabId, nodeIds],
  )

  const onRemoveQueued = useCallback(
    async (id: string, version: number) => {
      const targetTabId = tabId || $activeTabId.get()
      if (!targetTabId) return
      const prev = getTabState(targetTabId)?.queuedPrompts ?? []
      patchTab(targetTabId, { queuedPrompts: prev.filter((q) => q.id !== id) })
      try {
        await removeQueuedPrompt(targetTabId, id, version)
      } catch (e) {
        patchTab(targetTabId, { queuedPrompts: prev, error: String(e) })
      }
    },
    [tabId],
  )

  const onEditQueued = useCallback(
    async (id: string, text: string) => {
      const targetTabId = tabId || $activeTabId.get()
      if (!targetTabId) return
      try {
        await editQueuedPrompt(targetTabId, id, text)
      } catch (e) {
        pushToast(String(e), 'error')
      }
    },
    [tabId],
  )

  const onCancel = useCallback(async () => {
    await cancelActiveTurn()
  }, [])

  useEffect(() => {
    void getEnginePrefs()
      .then((p) => setCombineQueued(Boolean(p.combine_queued_prompts)))
      .catch(() => {})
  }, [])

  const onToggleCombineQueued = useCallback(async (enabled: boolean) => {
    setCombineQueued(enabled)
    try {
      const prev = await getEnginePrefs()
      await setEnginePrefs({ ...prev, combine_queued_prompts: enabled })
    } catch (e) {
      setCombineQueued(!enabled)
      pushToast(String(e), 'error')
    }
  }, [])

  const onSwitchModel = useCallback((id: string) => {
    const tabId = $activeTabId.get()
    const prevModel = $defaultModelId.get()
    const prevEffort = $reasoningEffort.get()
    const prevTab = tabId ? getTabState(tabId) : null
    const entry = $models.get().find((m) => m.id === id)
    const nextEffort = spawnReasoningEffort(entry, $reasoningEffort.get()) || 'medium'
    $defaultModelId.set(id)
    if (nextEffort) $reasoningEffort.set(nextEffort)
    if (tabId) patchTab(tabId, { modelId: id, reasoningEffort: nextEffort || 'medium' })
    void setCurrentModel(tabId, id, nextEffort)
      .then(() => {
        const label = entry?.model?.trim() || entry?.name?.trim() || id
        pushToast(`已切换模型 · ${label}`, 'success')
      })
      .catch((e) => {
        $defaultModelId.set(prevModel)
        $reasoningEffort.set(prevEffort)
        if (tabId) {
          patchTab(tabId, {
            modelId: prevTab?.modelId || prevModel,
            reasoningEffort: prevTab?.reasoningEffort || prevEffort,
            error: String(e),
          })
        } else {
          patchActiveTab({ error: String(e) })
        }
        pushToast(`切换模型失败 · ${String(e)}`, 'error')
      })
  }, [])

  const onSwitchReasoningEffort = useCallback((e: string) => {
    const tabId = $activeTabId.get()
    const id = $defaultModelId.get()
    const prevEffort = $reasoningEffort.get()
    const prevTabEffort = tabId ? getTabState(tabId)?.reasoningEffort : prevEffort
    $reasoningEffort.set(e)
    if (tabId) patchTab(tabId, { reasoningEffort: e, ...(id ? { modelId: id } : {}) })
    if (!id || !tabId) return
    void setCurrentModel(tabId, id, e)
      .then(() =>
        pushToast(`已切换思考强度 · ${reasoningEffortLabel(e)}`, 'success'),
      )
      .catch((err) => {
        $reasoningEffort.set(prevEffort)
        patchTab(tabId, {
          reasoningEffort: prevTabEffort || prevEffort,
          error: String(err),
        })
        pushToast('切换思考强度失败', 'error')
      })
  }, [])

  return (
    <div
      className="flow-canvas-composer nowheel nopan nodrag"
      onWheel={stopCanvasWheel}
      onPointerDown={stopCanvasPointer}
    >
      <UserQuestionPanel request={userQuestion} focusKey={questionFocusKey} />
      <McpElicitPanel request={mcpElicit} />
      <AppPlanApproval />
      <PendingApprovalFallback permission={permission} force />
      <Composer
        variant="dock"
        showWorkspace={false}
        enableSlash={false}
        showShellChips={false}
        placeholder="描述流程，或说要改哪一步…"
        canSend={ready}
        engineGenerating={generating}
        shellReady={ready}
        sessionPhase={phase}
        models={models}
        selectedModelId={modelId}
        reasoningEffort={effort}
        workspaceCwd={cwd}
        workspaceOptions={wsOptions}
        canSwitchWorkspace={false}
        onSwitchModel={onSwitchModel}
        onSwitchReasoningEffort={onSwitchReasoningEffort}
        onSelectWorkspace={() => {}}
        queuedPrompts={queued}
        onSend={(t, a, mode) => void onSend(t, a, mode)}
        onRemoveQueued={(id, ver) => void onRemoveQueued(id, ver)}
        onEditQueued={caps.queueEdit ? (id, text) => void onEditQueued(id, text) : undefined}
        combineQueued={combineQueued}
        onToggleCombineQueued={(v) => void onToggleCombineQueued(v)}
        onCancel={() => void onCancel()}
      />
      {error ? (
        <div className="wb-err">
          <span>{error}</span>
          {onRetryStrict && (
            <button
              type="button"
              className="flow-btn primary"
              style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}
              onClick={onRetryStrict}
            >
              ↺ 强制纯 JSON 重试
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
})
