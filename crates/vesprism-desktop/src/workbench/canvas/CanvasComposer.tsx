/**
 * 画布第二主聊天：同一套 Composer（附件 / @ / 多行 / 排队 / 插话 / 切模型）。
 * 浮在画布底部中间；工作区只读；关掉斜杠命令。发给引擎时包编排说明书。
 */
import { memo, useCallback, type PointerEvent, type WheelEvent } from 'react'
import { useStore } from '@nanostores/react'
import { Composer } from '../../components/Composer'
import { PendingApprovalFallback } from '../../components/Permission'
import {
  $composerInput,
  $defaultModelId,
  $generating,
  $models,
  $permission,
  $queuedPrompts,
  $reasoningEffort,
  $sessionPhase,
  $shellReady,
  $workspaceCwd,
  $workspaceOptions,
  patchActiveTab,
  patchTab,
  pushToast,
  $activeTabId,
  getTabState,
  tabWorkspaceCwd,
} from '../../store'
import { removeQueuedPrompt, setCurrentModel, type PromptAttach } from '../../bridge'
import { cancelActiveTurn } from '../../lib/cancelActiveTurn'
import { sendSessionPrompt } from '../../lib/sendSessionPrompt'
import { generateId } from '../../lib/generateId'
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
  const input = useStore($composerInput)
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
  const permission = useStore($permission)

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

  const onCancel = useCallback(async () => {
    await cancelActiveTurn()
  }, [])

  const onSwitchModel = useCallback((id: string) => {
    const tabId = $activeTabId.get()
    const entry = $models.get().find((m) => m.id === id)
    const nextEffort = entry?.supports_reasoning_effort
      ? entry.reasoning_effort || $reasoningEffort.get() || 'medium'
      : $reasoningEffort.get() || 'medium'
    $defaultModelId.set(id)
    if (nextEffort) $reasoningEffort.set(nextEffort)
    if (tabId) patchTab(tabId, { modelId: id, reasoningEffort: nextEffort || 'medium' })
    void setCurrentModel(tabId, id, nextEffort)
      .then(() => {
        const label = entry?.model?.trim() || entry?.name?.trim() || id
        pushToast(`已切换模型 · ${label}`, 'success')
      })
      .catch((e) => {
        patchActiveTab({ error: String(e) })
        pushToast(`切换模型失败 · ${String(e)}`, 'error')
      })
  }, [])

  const onSwitchReasoningEffort = useCallback((e: string) => {
    const tabId = $activeTabId.get()
    const id = $defaultModelId.get()
    $reasoningEffort.set(e)
    if (tabId) patchTab(tabId, { reasoningEffort: e, ...(id ? { modelId: id } : {}) })
    if (!id || !tabId) return
    void setCurrentModel(tabId, id, e)
      .then(() => pushToast(`已切换思考强度 · ${e}`, 'success'))
      .catch((err) => {
        patchActiveTab({ error: String(err) })
        pushToast('切换思考强度失败', 'error')
      })
  }, [])

  return (
    <div
      className="flow-canvas-composer nowheel nopan nodrag"
      onWheel={stopCanvasWheel}
      onPointerDown={stopCanvasPointer}
    >
      <PendingApprovalFallback permission={permission} force />
      <Composer
        enableSlash={false}
        showWorkspace={false}
        placeholder="输入消息…  + 附文件  @ 引用路径"
        input={input}
        setInput={(v) => patchActiveTab({ composerInput: v })}
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
        onBrowseWorkspace={() => {}}
        queuedPrompts={queued}
        onSend={(t, a, mode) => void onSend(t, a, mode)}
        onRemoveQueued={(id, ver) => void onRemoveQueued(id, ver)}
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
