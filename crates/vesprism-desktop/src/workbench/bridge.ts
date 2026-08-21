/**
 * 工作台 IPC。聊天区 bridge.ts 不承载 Agent / Flow / .vesp。
 * 跑流程仍经聊天会话的 sendPrompt（引擎挂在会话上）。
 */
import { invoke } from '@tauri-apps/api/core'
import type {
  FlowListItem,
  FlowRecord,
  ImportFlowResult,
} from './flow'
import type { AgentDetail, AgentListItem, AgentRecord } from './types'

export type FlowSavePayload = {
  id: string
  name: string
  description?: string
  version?: string
  input_schema?: unknown
  output_schema?: unknown
  nodes?: unknown
  edges?: unknown
  publish?: boolean
  stage?: boolean
  ephemeral?: boolean
  rhai?: string | null
  prompts?: string | null
}

export const saveFlow = (payload: FlowSavePayload) =>
  invoke<FlowRecord>('save_flow', { payload })
export const listFlows = () => invoke<FlowListItem[]>('list_flows')
export const getFlow = (id: string) => invoke<FlowRecord>('get_flow', { id })
export const deleteFlow = (id: string) => invoke('delete_flow', { id })
export const exportFlow = (id: string, destPath: string) =>
  invoke<string>('export_flow', { id, destPath })
export const importFlow = (zipPath: string, conflictMode?: string | null) =>
  invoke<ImportFlowResult>('import_flow', {
    zipPath,
    conflictMode: conflictMode ?? null,
  })

export const listAgents = () => invoke<AgentListItem[]>('list_agents')
export const getAgent = (id: string) => invoke<AgentDetail>('get_agent', { id })
export const saveAgent = (agent: AgentRecord, systemPrompt?: string) =>
  invoke<AgentRecord>('save_agent', {
    payload: { agent, systemPrompt: systemPrompt ?? null },
  })
export const deleteAgent = (id: string) => invoke('delete_agent', { id })

export const updateSessionFlows = (tabId: string, flows: string[]) =>
  invoke<void>('update_session_flows', { tabId, flows })

export const purgeRerunSidecars = (except?: string | null) =>
  invoke<number>('purge_rerun_sidecars', { except: except ?? null })

/** 把内置 MCP server 挂载进 <cwd>/.mcp.json（官方热加载，子 agent 获得 database/knowledge 工具）。 */
export const mountMcp = (cwd: string) => invoke<string>('mount_mcp', { cwd })
