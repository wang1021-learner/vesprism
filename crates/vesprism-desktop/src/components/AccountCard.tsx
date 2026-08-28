import { useCallback, useEffect, useState } from 'react'
import {
  fetchAccountStatus,
  signOutAccount,
  startAccountLogin,
  type AccountStatus,
} from '../lib/accountAuth'
import { SettingsLabel } from './SettingsHelp'

/** 设置 · 通用：官方账号登录（浏览器回环，凭证在 ~/.vesprism）。 */
export function AccountCard() {
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const next = await fetchAccountStatus()
    setStatus(next)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const who = status?.display_name || status?.email
  const loggedIn = Boolean(status?.logged_in)

  return (
    <section className="settings-card">
      <h3 className="settings-card-title">账号</h3>
      <p className="settings-card-desc">
        用官方账号登录后，模型和会话走你的订阅。也可以只在「模型」页填 API 密钥。
        凭证在本机 Vesprism 目录，不会沿用命令行已经登录的账号。
      </p>
      <SettingsLabel help="会打开系统浏览器完成官方授权。要在桌面再登一次，和命令行不是同一份 auth.json。">
        {loggedIn ? '当前账号' : '未登录'}
      </SettingsLabel>
      <p className="settings-hint">
        {loggedIn
          ? [who, status?.team_name, status?.mode].filter(Boolean).join(' · ')
          : status?.api_key_env
            ? '未登录账号。环境变量里的密钥仍可发请求。'
            : '登录后才能用官方模型和会话搜索等账号能力。'}
      </p>
      <div className="settings-row settings-row-follow">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void startAccountLogin()
              .then((next) => {
                if (next) setStatus(next)
              })
              .finally(() => setBusy(false))
          }}
        >
          {busy ? '等待浏览器…' : loggedIn ? '重新登录' : '登录'}
        </button>
        {loggedIn ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void signOutAccount()
                .then((next) => {
                  if (next) setStatus(next)
                })
                .finally(() => setBusy(false))
            }}
          >
            退出登录
          </button>
        ) : null}
      </div>
    </section>
  )
}
