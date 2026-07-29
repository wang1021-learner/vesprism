import type { SessionStatus } from '../types'

/**
 * 前端会话壳层阶段（互斥）。
 * - phase：桌面壳层生命周期（能否 mutate / 是否可交互）
 * - engineStatus：后端 ACP turn 状态（idle / generating / …）
 */
export type SessionPhase =
  | 'idle' // 尚未成功启动
  | 'booting' // 首次 start_session
  | 'ready' // 壳层就绪（发送仍受 engineStatus 约束）
  | 'restarting' // New chat / 换工作区 / 删当前后重建
  | 'loading' // load_session
  | 'failed' // 最近一次生命周期操作失败

export type SessionShellState = {
  phase: SessionPhase
  engineStatus: SessionStatus
  activeSessionId: string
}

export type SessionShellAction =
  | { type: 'BOOT_START' }
  | { type: 'BOOT_OK' }
  | { type: 'BOOT_FAIL' }
  | { type: 'RESTART_START' }
  | { type: 'RESTART_OK' }
  | { type: 'RESTART_FAIL' }
  | { type: 'LOAD_START'; sessionId: string }
  | { type: 'LOAD_OK' }
  | { type: 'LOAD_FAIL'; restoreSessionId: string }
  | { type: 'ENGINE_STATUS'; status: SessionStatus }
  | { type: 'SESSION_ID'; sessionId: string }

export const initialSessionShell: SessionShellState = {
  phase: 'idle',
  engineStatus: 'unknown',
  activeSessionId: '1',
}

/** 壳层忙碌：禁止并行 start / restart / load */
export function isShellBusy(phase: SessionPhase): boolean {
  return phase === 'booting' || phase === 'restarting' || phase === 'loading'
}

/** 壳层已就绪（可切换模型、在空会话时换工作区等） */
export function isShellReady(phase: SessionPhase): boolean {
  return phase === 'ready'
}

/** 正在恢复历史会话（消息列表应显示加载态） */
export function isLoadingHistory(phase: SessionPhase): boolean {
  return phase === 'loading'
}

/** 引擎是否在生成一轮回复 */
export function isEngineGenerating(engineStatus: SessionStatus): boolean {
  return engineStatus === 'generating'
}

/** 是否允许发送用户消息 */
export function selectCanSend(inTauri: boolean, state: SessionShellState): boolean {
  if (!inTauri) return false
  if (state.phase !== 'ready') return false
  if (state.engineStatus === 'generating') return false
  if (state.engineStatus === 'initializing') return false
  return true
}

/**
 * 会话壳层状态机。
 * 非法转换保持原状态，避免异步乱序导致矛盾组合。
 */
export function sessionShellReducer(
  state: SessionShellState,
  action: SessionShellAction,
): SessionShellState {
  switch (action.type) {
    case 'BOOT_START': {
      if (state.phase !== 'idle' && state.phase !== 'failed') return state
      return {
        ...state,
        phase: 'booting',
        engineStatus: 'initializing',
      }
    }

    case 'BOOT_OK': {
      if (state.phase !== 'booting') return state
      return {
        ...state,
        phase: 'ready',
        engineStatus:
          state.engineStatus === 'unknown' || state.engineStatus === 'initializing'
            ? 'idle'
            : state.engineStatus,
      }
    }

    case 'BOOT_FAIL': {
      if (state.phase !== 'booting') return state
      return {
        ...state,
        phase: 'failed',
        engineStatus: 'ended',
      }
    }

    case 'RESTART_START': {
      if (state.phase === 'loading' || state.phase === 'booting') return state
      if (state.phase === 'restarting') return state
      return {
        ...state,
        phase: 'restarting',
        engineStatus: 'initializing',
      }
    }

    case 'RESTART_OK': {
      if (state.phase !== 'restarting') return state
      return {
        ...state,
        phase: 'ready',
        engineStatus:
          state.engineStatus === 'unknown' || state.engineStatus === 'initializing'
            ? 'idle'
            : state.engineStatus,
      }
    }

    case 'RESTART_FAIL': {
      if (state.phase !== 'restarting') return state
      return {
        ...state,
        phase: 'failed',
        engineStatus: 'ended',
      }
    }

    case 'LOAD_START': {
      if (isShellBusy(state.phase)) return state
      return {
        ...state,
        phase: 'loading',
        engineStatus: 'initializing',
        activeSessionId: action.sessionId,
      }
    }

    case 'LOAD_OK': {
      if (state.phase !== 'loading') return state
      return {
        ...state,
        phase: 'ready',
        engineStatus:
          state.engineStatus === 'unknown' || state.engineStatus === 'initializing'
            ? 'idle'
            : state.engineStatus,
      }
    }

    case 'LOAD_FAIL': {
      if (state.phase !== 'loading') return state
      return {
        ...state,
        phase: 'failed',
        engineStatus: 'ended',
        activeSessionId: action.restoreSessionId,
      }
    }

    case 'ENGINE_STATUS': {
      return {
        ...state,
        engineStatus: action.status,
      }
    }

    case 'SESSION_ID': {
      return {
        ...state,
        activeSessionId: action.sessionId,
      }
    }

    default:
      return state
  }
}
