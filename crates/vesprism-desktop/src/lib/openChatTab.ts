/**
 * 打开会话 Tab（Tab 栏「+」与侧栏「技能 / 工具 / MCP / 自动化任务 / 流程画布」共用）
 *
 * 专用面板（技能 / 工具 / MCP / 记忆 / 插件 / 工作流 / 画布 / Agent）：已存在则切换。
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
  resolveNewTabCwd,
  switchTab,
  $scratchCwd,
  type UtilityKind,
} from '../store'
import { openTab, startSession } from '../bridge'

export type OpenChatTabOpts = {
  /** Tab 标题（技能 / 工具 / MCP / 自动化任务 / 流程画布 / 空=新对话） */
  title?: string
  /** 专用面板：mcp / tools / skills / workflows / flow-canvas / agents；普通对话省略 */
  utilityKind?: UtilityKind | null
  /** 只开面板、不启引擎会话（试跑详情 / 写台演示） */
  skipSession?: boolean
  /** 跳过「同类型面板复用」，画布「新建」要并列开新 Tab */
  forceNew?: boolean
  /** 画布 Tab 一创建就带上流程 id，避免挂载恢复读到上一张图 */
  flowId?: string
}

/**
 * 新建或复用 Tab → 启动会话 → 继承模型。
 * 成功返回 tabId；失败返回 null 并尽量把错误写到活跃 tab。
 */
export async function openChatTab(opts: OpenChatTabOpts = {}): Promise<string | null> {
  const title = (opts.title || '').trim()
  const utilityKind = opts.utilityKind ?? null
  const cwd = resolveNewTabCwd() || $scratchCwd.get()

  // 专用面板：同类型已打开则直接切过去。已有 cwd 一律不动，避免主聊天换仓把画布拽走。
  // forceNew：画布允许并列多 Tab，侧栏入口仍走复用。
  if (utilityKind && !opts.forceNew) {
    const existing = findTabByUtilityKind(utilityKind)
    if (existing) {
      const st = getTabState(existing)
      if (cwd && looksAbsolutePath(cwd) && (!st?.cwd || !looksAbsolutePath(st.cwd))) {
        patchTab(existing, { cwd })
      }
      if (
        title &&
        title !== '流程画布' &&
        title !== 'Agent 编制' &&
        (utilityKind === 'flow-canvas' || utilityKind === 'agents') &&
        st?.chatTitle !== title
      ) {
        patchTab(existing, { chatTitle: title })
      }
      switchTab(existing)
      return existing
    }
  }

  if (!cwd || !looksAbsolutePath(cwd)) {
    patchActiveTab({
      error: '无法创建会话：闲聊目录不可用。',
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
      ...(opts.flowId ? { flowId: opts.flowId } : {}),
    })
    switchTab(tabId)
    if (!opts.skipSession && utilityKind !== 'flow-run' && utilityKind !== 'writing-desk') {
      await startSession(tabId, cwd, {
        modelId: model.modelId,
        reasoningEffort: model.reasoningEffort,
      })
    }
    // 启动期间用户可能已关掉这个 tab，不要把错误写到当前活跃页
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
      ...(opts.flowId ? { flowId: opts.flowId } : {}),
    })
    return tabId
  } catch (e) {
    if (tabId && hasTab(tabId)) {
      patchTab(tabId, { error: String(e) })
    }
    return null
  }
}
