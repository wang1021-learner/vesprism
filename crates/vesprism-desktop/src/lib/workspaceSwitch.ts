import {
  addProject,
  getSecurityPolicy,
  listProjects,
  restartSession,
  setWorkspaceCwd,
  startSession,
} from '../bridge'
import { policyFromDto } from './executionPolicy'
import {
  $activeTabId,
  $preferredWorkspaceCwd,
  $registeredProjects,
  $securityPolicy,
  $workspaceOptions,
  getTabState,
  isBlankNewChat,
  patchTab,
} from '../store'
import {
  dedupeWorkspacePaths,
  normalizeWorkspacePath,
  preferWorkspaceDisplayPath,
} from './workspacePath'

function mergeWorkspaceOption(cwd: string) {
  const key = normalizeWorkspacePath(cwd)
  if (!key) return
  const prev = $workspaceOptions.get()
  const existing = prev.find((c) => normalizeWorkspacePath(c) === key)
  const kept = existing ? preferWorkspaceDisplayPath(existing, cwd) : cwd
  $workspaceOptions.set(
    dedupeWorkspacePaths([...prev.filter((c) => normalizeWorkspacePath(c) !== key), kept]),
  )
}

export async function refreshRegisteredProjects(): Promise<string[]> {
  const rows = await listProjects()
  const roots = rows.map((r) => r.root)
  $registeredProjects.set(roots)
  for (const root of roots) mergeWorkspaceOption(root)
  return roots
}

/** 钉住仓库根，并切到该工作区。不改官方审批。 */
export async function registerAndSwitchWorkspace(
  root: string,
  opts?: { restartTab?: boolean },
): Promise<string> {
  const row = await addProject(root)
  mergeWorkspaceOption(row.root)
  const registered = $registeredProjects.get()
  if (!registered.some((r) => normalizeWorkspacePath(r) === row.root)) {
    $registeredProjects.set([row.root, ...registered])
  }
  return switchPreferredWorkspace(row.root, opts)
}

export async function switchPreferredWorkspace(
  root: string,
  opts?: { restartTab?: boolean },
): Promise<string> {
  const applied = await setWorkspaceCwd(root)
  $preferredWorkspaceCwd.set(applied)
  mergeWorkspaceOption(applied)
  try {
    $securityPolicy.set(policyFromDto(await getSecurityPolicy(applied)))
  } catch {
    /* 沿用当前策略 */
  }
  const tabId = $activeTabId.get()
  const st = tabId ? getTabState(tabId) : undefined
  const restart =
    Boolean(tabId && st && st.status !== 'generating') &&
    (opts?.restartTab || isBlankNewChat(st!))
  if (restart && tabId && st) {
    patchTab(tabId, {
      cwd: applied,
      phase: 'restarting',
      sessionId: '',
      chatId: '',
      error: '',
    })
    const spawn = { modelId: st.modelId, reasoningEffort: st.reasoningEffort }
    try {
      await restartSession(tabId, applied, spawn)
    } catch {
      await startSession(tabId, applied, spawn)
    }
    patchTab(tabId, { phase: 'ready', status: 'idle', cwd: applied, error: '' })
  }
  return applied
}
