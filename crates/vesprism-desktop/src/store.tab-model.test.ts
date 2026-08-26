/**
 * Tab 模型分片 + 活动灯（共 7 例）
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  $activeTabId,
  $defaultModelId,
  $models,
  $reasoningEffort,
  $settingsDefaultModelId,
  $tabs,
  createTab,
  deriveTabActivity,
  emptyTabState,
  $workspaceCwd,
  $workspaceOptions,
  $scratchCwd,
  isScratchCwd,
  workspaceLabel,
  findNormalChatTab,
  findReadyCodingTabId,
  findTabByUtilityKind,
  isWorkbenchUtility,
  $appShell,
  setAppShell,
  shellForUtility,
  tabsForShell,
  getTabState,
  isBlankNewChat,
  looksAbsolutePath,
  patchTab,
  removeTab,
  resetTabToNewChat,
  resetTabsForTests,
  resolveNewTabModel,
  resolveNewTabCwd,
  resolveWorkspaceCwd,
  switchTab,
  tabWorkspaceCwd,
  $preferredWorkspaceCwd,
  $registeredProjects,
} from './store'
import type { ModelInfo } from './types'

const modelA: ModelInfo = {
  id: 'model-a',
  model: 'model-a',
  name: 'Model A',
  base_url: '',
  api_base_url: '',
  env_key: 'XAI_API_KEY',
  context_window: 128000,
  system_prompt_label: '',
  api_backend: 'chat_completions',
  description: '',
  temperature: null,
  top_p: null,
  max_completion_tokens: null,
  extra_headers: {},
  query_params: {},
  env_http_headers: {},
  max_retries: 0,
  inference_idle_timeout_secs: 0,
  stream_tool_calls: null,
  agent_type: 'grok-build',
  use_concise: false,
  auto_compact_threshold_percent: 0,
  supports_reasoning_effort: true,
  reasoning_effort: 'medium',
  hidden: false,
  supported_in_api: true,
  laziness_enabled: false,
  laziness_max_nudges: 0,
  compactions_remaining: '',
  compaction_at_tokens: '',
}

const modelB: ModelInfo = {
  ...modelA,
  id: 'model-b',
  model: 'model-b',
  name: 'Model B',
  reasoning_effort: 'high',
}

beforeEach(() => {
  resetTabsForTests()
  $models.set([modelA, modelB])
  $settingsDefaultModelId.set('model-a')
  $defaultModelId.set('')
  $reasoningEffort.set('medium')
  $preferredWorkspaceCwd.set('')
  $workspaceCwd.set('')
  $workspaceOptions.set([])
  $registeredProjects.set([])
})

describe('Tab 模型分片', () => {
  it('createTab 写入 modelId，switchTab 投影到全局 atom', () => {
    createTab('tab-1', { modelId: 'model-a', reasoningEffort: 'low' })
    patchTab('tab-1', { chatId: 'chat-1' })
    createTab('tab-2', { modelId: 'model-b', reasoningEffort: 'high' })

    switchTab('tab-1')
    expect($activeTabId.get()).toBe('tab-1')
    expect($defaultModelId.get()).toBe('model-a')
    expect($reasoningEffort.get()).toBe('low')

    switchTab('tab-2')
    expect($defaultModelId.get()).toBe('model-b')
    expect($reasoningEffort.get()).toBe('high')

    // 后台 tab 的值不被覆盖（tab-1 有 chatId 非空白，切走不回收）
    expect(getTabState('tab-1')?.modelId).toBe('model-a')
    expect(getTabState('tab-1')?.reasoningEffort).toBe('low')
  })

  it('切走空白 tab 自动回收；有内容/运行中的保留', () => {
    createTab('blank-1', { modelId: 'model-a' })
    createTab('blank-2', { modelId: 'model-b' })
    createTab('real-1', { modelId: 'model-c' })
    patchTab('real-1', { chatId: 'chat-1' })
    createTab('busy-1', { modelId: 'model-d' })
    patchTab('busy-1', { status: 'generating' })

    // blank-1 → blank-2：blank-1 是空白，回收
    switchTab('blank-1')
    switchTab('blank-2')
    expect(getTabState('blank-1')).toBeUndefined()

    // blank-2 → real-1：blank-2 空白回收，real-1 保留
    switchTab('real-1')
    expect(getTabState('blank-2')).toBeUndefined()
    expect(getTabState('real-1')).toBeDefined()

    // real-1 → busy-1：real-1 非空白保留；busy-1 生成中，切走也不回收
    switchTab('busy-1')
    expect(getTabState('real-1')).toBeDefined()
    switchTab('real-1')
    expect(getTabState('busy-1')).toBeDefined()
  })

  it('patchTab 只投影活跃 tab 的模型变更', () => {
    createTab('tab-1', { modelId: 'model-a', reasoningEffort: 'medium' })
    createTab('tab-2', { modelId: 'model-b', reasoningEffort: 'high' })
    switchTab('tab-1')

    patchTab('tab-2', { modelId: 'model-a', reasoningEffort: 'low' })
    // 活跃仍是 tab-1
    expect($defaultModelId.get()).toBe('model-a')
    expect($reasoningEffort.get()).toBe('medium')
    expect(getTabState('tab-2')?.modelId).toBe('model-a')
    expect(getTabState('tab-2')?.reasoningEffort).toBe('low')

    patchTab('tab-1', { modelId: 'model-b', reasoningEffort: 'high' })
    expect($defaultModelId.get()).toBe('model-b')
    expect($reasoningEffort.get()).toBe('high')
  })

  it('resolveNewTabModel 优先继承指定 tab', () => {
    createTab('tab-1', { modelId: 'model-b', reasoningEffort: 'high' })
    const r = resolveNewTabModel('tab-1')
    expect(r).toEqual({ modelId: 'model-b', reasoningEffort: 'high' })
  })

  it('resolveNewTabModel 无继承时用设置页默认', () => {
    $settingsDefaultModelId.set('model-b')
    const r = resolveNewTabModel()
    expect(r.modelId).toBe('model-b')
    expect(r.reasoningEffort).toBe('high') // 来自 modelB.reasoning_effort
  })

  it('switchTab 点当前 tab 是空操作', () => {
    createTab('tab-1', { modelId: 'model-a', reasoningEffort: 'low' })
    switchTab('tab-1')
    patchTab('tab-1', { chatId: 'chat-1' })
    switchTab('tab-1')
    expect($activeTabId.get()).toBe('tab-1')
    expect(getTabState('tab-1')?.chatId).toBe('chat-1')
  })

  it('removeTab 清理 map；关活跃 tab 时清空模型投影', () => {
    createTab('tab-1', { modelId: 'model-a', reasoningEffort: 'medium' })
    switchTab('tab-1')
    expect($tabs.get()).toHaveLength(1)

    removeTab('tab-1')
    expect(getTabState('tab-1')).toBeUndefined()
    expect($tabs.get()).toHaveLength(0)
    expect($activeTabId.get()).toBe('')
    expect($defaultModelId.get()).toBe('')
  })

  it('isBlankNewChat：有 sessionId 仍算空白新对话；有消息/历史/草稿不算', () => {
    createTab('blank', { sessionId: 'sess-engine', chatId: '', messages: [] })
    expect(isBlankNewChat(getTabState('blank')!)).toBe(true)

    createTab('draft', { composerInput: 'hello' })
    expect(isBlankNewChat(getTabState('draft')!)).toBe(false)

    createTab('hist', { chatId: 'chat-1' })
    expect(isBlankNewChat(getTabState('hist')!)).toBe(false)

    createTab('util', { utilityKind: 'tools' })
    expect(isBlankNewChat(getTabState('util')!)).toBe(false)
  })

  it('resetTabToNewChat 清空内容并保留模型', () => {
    createTab('tab-1', {
      modelId: 'model-b',
      reasoningEffort: 'high',
      chatId: 'chat-1',
      sessionId: 'sess-1',
      chatTitle: '旧标题',
      messages: [{ id: 'm1', role: 'user', text: 'hi' } as never],
      cwd: 'D:\\old',
    })
    switchTab('tab-1')
    resetTabToNewChat('tab-1', 'D:\\repo')
    const st = getTabState('tab-1')!
    expect(st.messages).toEqual([])
    expect(st.chatId).toBe('')
    expect(st.sessionId).toBe('')
    expect(st.chatTitle).toBe('')
    expect(st.modelId).toBe('model-b')
    expect(st.reasoningEffort).toBe('high')
    expect(st.cwd).toBe('D:\\repo')
    expect(st.phase).toBe('restarting')
    expect($tabs.get()[0].title).toBe('')
  })
})

describe('Tab 活动灯', () => {
  it('emptyTabState 含 subagents / userQuestion / modelId', () => {
    const s = emptyTabState()
    expect(s.userQuestion).toBeNull()
    expect(s.subagents).toEqual([])
    expect(s.permission).toBeNull()
    expect(s.modelId).toBe('')
    expect(s.reasoningEffort).toBe('medium')
    expect(s.utilityKind).toBeNull()
  })

  it('findTabByUtilityKind 可复用 workflows 专用 Tab', () => {
    createTab('tab-wf', { utilityKind: 'workflows', chatTitle: '自动化任务' })
    createTab('tab-skill', { utilityKind: 'skills', chatTitle: '技能' })
    expect(findTabByUtilityKind('workflows')).toBe('tab-wf')
    expect(findTabByUtilityKind('skills')).toBe('tab-skill')
    expect(findTabByUtilityKind('mcp')).toBeUndefined()
    expect(findTabByUtilityKind('flow-canvas')).toBeUndefined()
  })

  it('findTabByUtilityKind 可复用 flow-canvas 专用 Tab', () => {
    createTab('tab-flow', { utilityKind: 'flow-canvas', chatTitle: '流程画布' })
    expect(findTabByUtilityKind('flow-canvas')).toBe('tab-flow')
    expect(findTabByUtilityKind('workflows')).toBeUndefined()
  })

  it('findReadyCodingTabId 跳过画布 Tab，绑到已就绪对话', () => {
    createTab('tab-flow', { utilityKind: 'flow-canvas', phase: 'idle' })
    createTab('tab-chat', { utilityKind: null, phase: 'ready', sessionId: 's1' })
    $activeTabId.set('tab-flow')
    expect(isWorkbenchUtility('flow-canvas')).toBe(true)
    expect(isWorkbenchUtility('workflows')).toBe(true)
    expect(isWorkbenchUtility(null)).toBe(false)
    expect(findReadyCodingTabId()).toBe('tab-chat')
    $activeTabId.set('tab-chat')
    expect(findReadyCodingTabId()).toBe('tab-chat')
  })

  it('findTabByUtilityKind 可复用 agents 专用 Tab', () => {
    createTab('tab-agents', { utilityKind: 'agents', chatTitle: 'Agent 编制' })
    expect(findTabByUtilityKind('agents')).toBe('tab-agents')
    expect(findTabByUtilityKind('flow-canvas')).toBeUndefined()
  })

  it('编码/工作台壳：切 tab 跟着换壳，标签按壳过滤', () => {
    createTab('tab-chat', { utilityKind: null, chatTitle: '对话' })
    createTab('tab-flow', { utilityKind: 'flow-canvas', chatTitle: '流程画布' })
    $tabs.set([
      { id: 'tab-chat', title: '对话' },
      { id: 'tab-flow', title: '流程画布' },
    ])
    expect(shellForUtility(null)).toBe('coding')
    expect(shellForUtility('agents')).toBe('workbench')
    switchTab('tab-chat')
    expect($appShell.get()).toBe('coding')
    expect(tabsForShell('coding').map((t) => t.id)).toEqual(['tab-chat'])
    switchTab('tab-flow')
    expect($appShell.get()).toBe('workbench')
    expect(tabsForShell('workbench').map((t) => t.id)).toEqual(['tab-flow'])
    setAppShell('coding')
    expect($activeTabId.get()).toBe('tab-chat')
    setAppShell('workbench')
    expect($activeTabId.get()).toBe('tab-flow')
  })

  it('未登记产品 id 回落到默认产品', () => {
    createTab('tab-chat', { utilityKind: null, chatTitle: '对话' })
    switchTab('tab-chat')
    setAppShell('not-a-product')
    expect($appShell.get()).toBe('coding')
    expect($activeTabId.get()).toBe('tab-chat')
  })

  it('isScratchCwd / workspaceLabel 识别闲聊目录', () => {
    $scratchCwd.set('C:\\Users\\me\\.vesprism\\scratch')
    expect(isScratchCwd('C:/Users/me/.vesprism/scratch')).toBe(true)
    expect(isScratchCwd('C:\\Users\\me\\.vesprism\\scratch\\')).toBe(true)
    expect(isScratchCwd('D:\\repo')).toBe(false)
    $scratchCwd.set('')
    expect(isScratchCwd('C:\\Users\\me\\.vesprism\\scratch')).toBe(true)
    $scratchCwd.set('C:\\Users\\me\\.vesprism\\scratch')
    expect(workspaceLabel('C:\\Users\\me\\.vesprism\\scratch')).toBe('闲聊')
    expect(workspaceLabel('D:\\repo\\app')).toBe('app')
    expect(workspaceLabel('')).toBe('闲聊')
    $scratchCwd.set('')
  })

  it('looksAbsolutePath / resolveWorkspaceCwd 兜底空投影', () => {
    expect(looksAbsolutePath('')).toBe(false)
    expect(looksAbsolutePath('relative')).toBe(false)
    expect(looksAbsolutePath('D:\\grokbuild')).toBe(true)
    expect(looksAbsolutePath('/home/u')).toBe(true)

    $workspaceCwd.set('')
    $workspaceOptions.set([])
    createTab('tab-util', { utilityKind: 'tools', cwd: '' })
    createTab('tab-chat', {
      utilityKind: null,
      cwd: 'D:\\repo\\app',
      chatId: '',
      messages: [],
    })
    switchTab('tab-util')
    // 投影为空时仍能从其它 tab 取绝对路径
    expect(resolveWorkspaceCwd()).toBe('D:\\repo\\app')
    // 画布 / 专用面板只认自己的 cwd，不能借隔壁对话的仓库
    expect(tabWorkspaceCwd('tab-util')).toBe('')
    expect(tabWorkspaceCwd('tab-chat')).toBe('D:\\repo\\app')
  })

  it('resolveNewTabCwd 用当前 Tab，不把画布拽到别的仓库', () => {
    $preferredWorkspaceCwd.set('D:\\preferred')
    createTab('tab-canvas', { utilityKind: 'flow-canvas', cwd: 'D:\\canvas-repo' })
    createTab('tab-chat', { cwd: 'D:\\chat-repo' })
    switchTab('tab-canvas')
    expect(resolveNewTabCwd()).toBe('D:\\canvas-repo')
    expect(tabWorkspaceCwd()).toBe('D:\\canvas-repo')
    switchTab('tab-chat')
    expect(resolveNewTabCwd()).toBe('D:\\chat-repo')
    $preferredWorkspaceCwd.set('')
  })

  it('findNormalChatTab 优先空白普通对话', () => {
    createTab('tab-tools', { utilityKind: 'tools', chatTitle: '工具' })
    createTab('tab-old', {
      utilityKind: null,
      chatId: 'sess-1',
      messages: [{ id: 'm1', role: 'user', text: 'hi' } as never],
    })
    createTab('tab-blank', { utilityKind: null, chatId: '', messages: [] })
    expect(findNormalChatTab(true)).toBe('tab-blank')
    expect(findNormalChatTab(false)).toBe('tab-old')
  })

  it('deriveTabActivity 优先级：error > permission > working > idle', () => {
    expect(deriveTabActivity(emptyTabState())).toBe('idle')
    expect(
      deriveTabActivity({ ...emptyTabState(), status: 'generating' }),
    ).toBe('working')
    // 加载历史 / 切换会话：不闪绿
    expect(
      deriveTabActivity({
        ...emptyTabState(),
        phase: 'loading',
        status: 'initializing',
      }),
    ).toBe('idle')
    expect(
      deriveTabActivity({
        ...emptyTabState(),
        phase: 'restarting',
      }),
    ).toBe('idle')
    expect(
      deriveTabActivity({
        ...emptyTabState(),
        permission: {
          id: '1',
          tool: 'x',
          options: [{ id: 'a', name: 'ok' }],
        },
      }),
    ).toBe('permission')
    expect(
      deriveTabActivity({
        ...emptyTabState(),
        userQuestion: {
          requestId: 1,
          toolCallId: 't',
          mode: 'default',
          questions: [],
        },
      }),
    ).toBe('permission')
    expect(deriveTabActivity({ ...emptyTabState(), error: 'boom' })).toBe(
      'error',
    )
  })
})

describe('最近试跑历史持久化 ($recentWorkflows)', () => {
  it('支持 upsert 并持久化到 localStorage', async () => {
    const { $recentWorkflows, upsertRecentWorkflow, clearRecentWorkflows } = await import('./store')
    clearRecentWorkflows()
    expect(Object.keys($recentWorkflows.get()).length).toBe(0)

    upsertRecentWorkflow({
      runId: 'run-1',
      name: '测试工作流',
      status: 'complete',
      objective: '测试目标',
      revision: 1,
      foreground: true,
      phases: [{ title: '阶段 1', state: 'done' }],
      currentPhase: 'done',
      agentsUsed: 1,
      agentsReserved: 1,
      agentUsageIncomplete: false,
      elapsedMs: 1200,
      activeAgents: 0,
      agents: [],
    })

    expect($recentWorkflows.get()['run-1']).toBeDefined()
    expect($recentWorkflows.get()['run-1'].name).toBe('测试工作流')

    clearRecentWorkflows()
    expect(Object.keys($recentWorkflows.get()).length).toBe(0)
  })
})

