import { describe, expect, it } from 'vitest'
import { settingsSavedMessage } from './settingsHelpers'

describe('settingsSavedMessage', () => {
  it('模型保存后当前会话已热加载，不要求重启', () => {
    const m = settingsSavedMessage('models')
    expect(m).toContain('已重载模型列表')
    expect(m).not.toContain('重启')
  })

  it('引擎偏好只写盘，要新开会话或重启', () => {
    const m = settingsSavedMessage('engine')
    expect(m).toContain('config.toml')
    expect(m).toContain('新开会话')
    expect(m).toContain('重启')
  })

  it('Hooks 写盘，当前会话要点重载或重启', () => {
    const m = settingsSavedMessage('hooks')
    expect(m).toContain('config.toml')
    expect(m).toMatch(/重载|重启/)
  })
})
