import { accountLogin, accountLogout, accountStatus, reloadModels, type AccountStatus } from '../bridge'
import { formatEngineError } from './errorMessage'
import { $activeTabId, pushToast } from '../store'

function refreshModelsIfSession(): void {
  const tabId = $activeTabId.get()
  if (tabId) void reloadModels(tabId).catch(() => {})
}

export type { AccountStatus }

export async function fetchAccountStatus(): Promise<AccountStatus | null> {
  try {
    return await accountStatus()
  } catch {
    return null
  }
}

/** 打开系统浏览器走官方授权；凭证写入本机 auth.json。 */
export async function startAccountLogin(): Promise<AccountStatus | null> {
  try {
    const st = await accountLogin()
    const who = st.display_name || st.email
    pushToast(who ? `已登录 ${who}` : '已登录', 'success')
    refreshModelsIfSession()
    return st
  } catch (e) {
    pushToast(formatEngineError(e), 'error')
    return null
  }
}

export async function signOutAccount(): Promise<AccountStatus | null> {
  try {
    const st = await accountLogout()
    pushToast(st.api_key_env ? '已退出账号。环境变量里的密钥仍会用来发请求。' : '已退出账号', 'success')
    refreshModelsIfSession()
    return st
  } catch (e) {
    pushToast(formatEngineError(e), 'error')
    return null
  }
}
