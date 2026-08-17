/**
 * 打开会话 Tab（Tab 栏「+」与侧栏「技能 / 工具 / MCP / 自动化任务 / 流程画布」共用）
 *
 * 专用面板（skills / tools / mcp / workflows / flow-canvas / agents）：已存在则 **切换**，不再重复新建。
 * 创建时必须写入绝对 cwd，避免切换面板后 $workspaceCwd 变空导致 start/restart 失败。
 */
import {
  $activeTabId,
  createTab,
  findTabByUtilityKind,
  getTabState,
  hasTab,
  looksAbsolutePath,
  patchActiveTab,
  patchTab,
  resolveNewTabModel,
  resolveWorkspaceCwd,
  switchTab,
  type UtilityKind,
} from '../store'
import { openTab, setCurrentModel, startSession } from '../bridge'

export type OpenChatTabOpts = {
  /** Tab 标题（技能 / 工具 / MCP / 自动化任务 / 流程画布 / 空=新对话） */
  title?: string
  /** 专用面板：mcp / tools / skills / workflows / flow-canvas / agents；普通对话省略 */
  utilityKind?: UtilityKind | null
}

/**
 * 新建或复用 Tab → 启动会话 → 继承模型。
 * 成功返回 tabId；失败返回 null 并尽量把错误写到活跃 tab。
 */
export async function openChatTab(opts: OpenChatTabOpts = {}): Promise<string | null> {
  const title = (opts.title || '').trim()
  const utilityKind = opts.utilityKind ?? null
  const cwd = resolveWorkspaceCwd()

  // 专用面板：同类型已打开则直接切过去（并补全缺失的 cwd）
  if (utilityKind) {
    const existing = findTabByUtilityKind(utilityKind)
    if (existing) {
      const st = getTabState(existing)
      if (cwd && looksAbsolutePath(cwd) && (!st?.cwd || !looksAbsolutePath(st.cwd))) {
        patchTab(existing, { cwd })
      }
      switchTab(existing)
      return existing
    }
  }

  if (!cwd || !looksAbsolutePath(cwd)) {
    patchActiveTab({
      error: '工作区路径无效（不是绝对路径）。请在设置中选择工作区后再试。',
    })
    return null
  }

  let tabId = ''
  try {
    const prevId = $activeTabId.get()
    tabId = await openTab()
    const model = resolveNewTabModel(prevId || undefined)
    createTab(tabId, {
      modelId: model.modelId,
      reasoningEffort: model.reasoningEffort,
      chatTitle: title,
      utilityKind,
      cwd,
    })
    switchTab(tabId)
    await startSession(tabId, cwd)
    // 启动期间用户可能已关掉这个 tab，不要把错误写到当前活跃页
    if (!hasTab(tabId)) return null
    if (model.modelId) {
      try {
        await setCurrentModel(tabId, model.modelId, model.reasoningEffort)
      } catch {
        /* 模型应用失败不阻断新会话 */
      }
    }
    if (!hasTab(tabId)) return null
    patchTab(tabId, {
      phase: 'ready',
      status: 'idle',
      modelId: model.modelId,
      reasoningEffort: model.reasoningEffort,
      chatTitle: title,
      utilityKind,
      cwd,
      error: '',
    })
    return tabId
  } catch (e) {
    if (tabId && hasTab(tabId)) {
      patchTab(tabId, { error: String(e) })
    }
    return null
  }
}
