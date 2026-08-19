/**
 * 画布第二主聊天：同一套 Composer（附件 / @ / 多行 / 排队 / 插话 / 切模型）。
 * 工作区只读；关掉斜杠命令。发给引擎时包编排说明书。
 */
import { useCallback } from 'react'
import { useStore } from '@nanostores/react'
import { Composer } from '../../components/Composer'
import {
  $composerInput,
  $defaultModelId,
  $generating,
  $models,
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
import { consumeCanvasGraph, expectCanvasGraph } from '../generateWait'

export function CanvasComposer({
  flowName,
  flowId,
  nodeIds,
  onRun,
}: {
  flowName: string
  flowId: string
  nodeIds?: string[]
  onRun: () => void
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
      expectCanvasGraph(promptId)
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
      } else {
        consumeCanvasGraph(promptId)
      }
    },
    [flowName, flowId, tabId, nodeIds],
  )

  const onRemoveQueued = useCallback(async (id: string, version: number) => {
    const prev = $queuedPrompts.get()
    patchActiveTab({ queuedPrompts: prev.filter((q) => q.id !== id) })
    try {
      await removeQueuedPrompt($activeTabId.get(), id, version)
    } catch (e) {
      patchActiveTab({ queuedPrompts: prev, error: String(e) })
    }
  }, [])

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
    <Composer
      variant="dock"
      enableSlash={false}
      placeholder="描述流程或 Agent，+ 附项目文件，@ 引用路径"
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
      extraActions={
        <button
          type="button"
          className="wb-btn"
          title="打开测试输入并运行当前流程"
          disabled={generating}
          onClick={onRun}
        >
          ▶ 试跑
        </button>
      }
    />
  )
}
