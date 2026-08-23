/**
 * 本会话打开 git 副本写入（/sandbox）。不是进程沙箱。
 */
import {
  $activeTabId,
  $securityPolicy,
  $sessionPolicyOverride,
  $workspaceCwd,
  getTabState,
  pushToast,
} from '../store'
import {
  disableTabSandbox,
  enableTabSandbox,
  restartSession,
  setSecurityPolicy,
} from '../bridge'
import {
  policyFromDto,
  type ExecutionPolicy,
} from './executionPolicy'

export const COMPOSER_POLICY_OPTIONS: {
  value: ExecutionPolicy
  label: string
  hint: string
}[] = [
  {
    value: 'request-review',
    label: '审批',
    hint: '命令改文件、跑终端前先问你',
  },
  {
    value: 'always-proceed',
    label: '放行',
    hint: '信任模式：命令自动执行',
  },
  {
    value: 'proceed-in-sandbox',
    label: '副本',
    hint: '文件写入 git 副本，不是进程沙箱',
  },
]

export async function enableSessionSandbox(): Promise<void> {
  await applyComposerPolicy('proceed-in-sandbox')
}

export async function applyComposerPolicy(next: ExecutionPolicy): Promise<void> {
  const tabId = $activeTabId.get()
  const cwd = $workspaceCwd.get()
  const cur = $securityPolicy.get()
  $sessionPolicyOverride.set(next)
  try {
    if (next === 'proceed-in-sandbox') {
      if (tabId) await enableTabSandbox(tabId)
    } else if (tabId) {
      await disableTabSandbox(tabId)
    }
    const saved = policyFromDto(
      await setSecurityPolicy({
        execution_policy: next,
        internet_access: cur.internetAccess,
        file_access: cur.fileAccess,
        scope: cur.scope,
        cwd: cwd || cur.cwd,
      }),
    )
    $securityPolicy.set(saved)
    const st = tabId ? getTabState(tabId) : undefined
    const canRestart = Boolean(tabId && cwd && st && st.status !== 'generating')
    if (canRestart) {
      await restartSession(tabId, cwd, {
        modelId: st?.modelId,
        reasoningEffort: st?.reasoningEffort,
      })
    }
    const picked = COMPOSER_POLICY_OPTIONS.find((o) => o.value === next)
    pushToast(
      canRestart
        ? `执行策略 · ${picked?.label ?? next}`
        : `已记下 ${picked?.label ?? next}，下一轮生效`,
      'info',
    )
  } catch (e) {
    pushToast(`切换策略失败：${String(e)}`, 'error')
  }
}

export function attachKindFromPath(
  path: string,
  isDir?: boolean,
): 'file' | 'folder' | 'image' {
  if (isDir) return 'folder'
  const ext = path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image'
  return 'file'
}
