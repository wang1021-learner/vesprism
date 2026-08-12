/**
 * 启动/重连对账：打开历史会话后，查询该会话仍在运行的子 agent
 * （官方 x.ai/subagent/list_running），恢复到父 tab 的子任务行。
 * 场景：桌面端重启 / 会话重新加载时引擎侧子 agent 仍在跑。
 */
import { upsertSubagent } from '../store'
import { listRunningSubagents } from '../bridge'

export async function reconcileRunningSubagents(tabId: string): Promise<void> {
  try {
    const subs = await listRunningSubagents(tabId)
    if (!subs?.length) return
    for (const s of subs) {
      upsertSubagent(tabId, {
        subagentId: s.subagentId,
        parentSessionId: s.parentSessionId,
        childSessionId: s.childSessionId,
        subagentType: s.subagentType,
        description: s.description,
        status: 'running',
        durationMs: s.durationMs,
        turnCount: s.turnCount,
        toolCallCount: s.toolCallCount,
        tokensUsed: s.tokensUsed,
        contextUsagePct: s.contextUsagePct,
        toolsUsed: s.toolsUsed,
        errorCount: s.errorCount,
      })
    }
  } catch {
    /* 引擎不支持 / 会话未就绪时静默，不打扰打开历史流程 */
  }
}
