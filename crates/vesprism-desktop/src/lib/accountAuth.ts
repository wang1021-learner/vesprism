import {
  accountLogin,
  accountLogout,
  accountStatus,
  getModelSettings,
  reloadModels,
  type AccountStatus,
} from '../bridge'
import { formatEngineError } from './errorMessage'
import {
  $activeTabId,
  $models,
  $settingsDefaultModelId,
  getTabState,
  patchTab,
  pushToast,
} from '../store'

/** 登录/退出后重拉设置页模型目录（官方 Grok 在已登录时并进列表）。 */
async function refreshModelCatalog(): Promise<void> {
  try {
    const settings = await getModelSettings()
    $models.set(settings.models)
    const def = settings.default_id || settings.models[0]?.id || ''
    if (def) $settingsDefaultModelId.set(def)
    const tabId = $activeTabId.get()
    if (!tabId) return
    void reloadModels(tabId).catch(() => {})
    const st = getTabState(tabId)
    if (st && !st.modelId.trim() && def) {
      patchTab(tabId, { modelId: def })
    }
  } catch {
    /* 保持当前列表 */
  }
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
    await refreshModelCatalog()
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
    await refreshModelCatalog()
    return st
  } catch (e) {
    pushToast(formatEngineError(e), 'error')
    return null
  }
}
