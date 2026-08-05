/**
 * 打开会话 Tab（Tab 栏「+」与侧栏「技能 / 工具 / MCP」共用）
 *
 * 专用面板（skills / tools / mcp）：已存在则 **切换**，不再重复新建。
 */
import {
  $activeTabId,
  $workspaceCwd,
  $workspaceOptions,
  createTab,
  findTabByUtilityKind,
  patchActiveTab,
  resolveNewTabModel,
  switchTab,
  type UtilityKind,
} from '../store'
import { openTab, setCurrentModel, startSession } from '../bridge'

export type OpenChatTabOpts = {
  /** Tab 标题（技能 / 工具 / MCP / 空=新对话） */
  title?: string
  /** 专用面板：mcp / tools / skills；普通对话省略 */
  utilityKind?: UtilityKind | null
}

/**
 * 新建或复用 Tab → 启动会话 → 继承模型。
 * 成功返回 tabId；失败返回 null 并尽量把错误写到活跃 tab。
 */
export async function openChatTab(opts: OpenChatTabOpts = {}): Promise<string | null> {
  const title = (opts.title || '').trim()
  const utilityKind = opts.utilityKind ?? null

  // 专用面板：同类型已打开则直接切过去
  if (utilityKind) {
    const existing = findTabByUtilityKind(utilityKind)
    if (existing) {
      switchTab(existing)
      return existing
    }
  }

  try {
    const prevId = $activeTabId.get()
    const tabId = await openTab()
    const model = resolveNewTabModel(prevId || undefined)
    createTab(tabId, {
      modelId: model.modelId,
      reasoningEffort: model.reasoningEffort,
      chatTitle: title,
      utilityKind,
    })
    switchTab(tabId)
    const cwd = $workspaceCwd.get() || $workspaceOptions.get()[0] || ''
    await startSession(tabId, cwd)
    if (model.modelId) {
      try {
        await setCurrentModel(tabId, model.modelId, model.reasoningEffort)
      } catch {
        /* 模型应用失败不阻断新会话 */
      }
    }
    patchActiveTab({
      phase: 'ready',
      status: 'idle',
      modelId: model.modelId,
      reasoningEffort: model.reasoningEffort,
      chatTitle: title,
      utilityKind,
    })
    return tabId
  } catch (e) {
    patchActiveTab({ error: String(e) })
    return null
  }
}
