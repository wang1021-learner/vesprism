import { useState } from 'react'
import type { ModelEntry } from '../../types'

type SettingsTab = 'general' | 'models'

interface SettingsModalProps {
  settingsCwd: string
  setSettingsCwd: (cwd: string) => void
  pickDirectory: () => void
  models: ModelEntry[]
  selectedModelId: string
  selectModel: (id: string) => void
  draftModelIds: string[]
  startAddModel: () => void
  discardSelectedDraft: () => void
  /** 从列表移除当前模型（保存后从 config 删除） */
  removeSelectedModel: () => void
  updateSelectedModel: (patch: Partial<ModelEntry>) => void
  modelConfigPath: string
  keyStatus: { key_name: string; is_set: boolean } | null
  keyInput: string
  setKeyInput: (val: string) => void
  keyVisible: boolean
  setKeyVisible: (fn: (v: boolean) => boolean) => void
  envFilePath: string
  savingSettings: boolean
  onClose: () => void
  onSave: () => void
}

export function SettingsModal({
  settingsCwd,
  setSettingsCwd,
  pickDirectory,
  models,
  selectedModelId,
  selectModel,
  draftModelIds,
  startAddModel,
  discardSelectedDraft,
  removeSelectedModel,
  updateSelectedModel,
  modelConfigPath,
  keyStatus,
  keyInput,
  setKeyInput,
  keyVisible,
  setKeyVisible,
  envFilePath,
  savingSettings,
  onClose,
  onSave,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>('models')
  const selectedModel = models.find((m) => m.id === selectedModelId)
  const isDraft = selectedModelId ? draftModelIds.includes(selectedModelId) : false

  return (
    <div className="modal-backdrop settings-backdrop" onClick={onClose}>
      <div
        className="settings-shell"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="settings-shell-header">
          <h2 id="settings-title">设置</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="settings-layout">
          {/* 左侧菜单 */}
          <nav className="settings-nav" aria-label="设置分类">
            <button
              type="button"
              className={`settings-nav-item${tab === 'general' ? ' active' : ''}`}
              onClick={() => setTab('general')}
            >
              通用
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'models' ? ' active' : ''}`}
              onClick={() => setTab('models')}
            >
              模型
            </button>
          </nav>

          {/* 右侧内容 */}
          <div className="settings-panel">
            {tab === 'general' && (
              <div className="settings-panel-inner">
                <h3 className="settings-panel-title">通用</h3>
                <div className="settings-section">
                  <label className="settings-label" htmlFor="settings-cwd">
                    工作目录 (CWD)
                  </label>
                  <div className="settings-row">
                    <input
                      id="settings-cwd"
                      type="text"
                      value={settingsCwd}
                      onChange={(e) => setSettingsCwd(e.target.value)}
                      className="settings-input"
                    />
                    <button type="button" className="btn-secondary" onClick={pickDirectory}>
                      选择…
                    </button>
                  </div>
                  <p className="settings-hint">
                    当前为展示项；会话仍使用应用启动时的工作目录。
                  </p>
                </div>
              </div>
            )}

            {tab === 'models' && (
              <div className="settings-models-layout">
                {/* 模型列表 */}
                <div className="settings-models-list">
                  <div className="settings-models-list-header">
                    <span>模型列表</span>
                    <button
                      type="button"
                      className="btn-inline"
                      disabled={savingSettings}
                      onClick={startAddModel}
                    >
                      + 新增
                    </button>
                  </div>

                  {models.length === 0 ? (
                    <p className="settings-hint settings-models-empty">
                      尚未配置模型。点击「新增」添加。
                    </p>
                  ) : (
                    <ul className="settings-models-items">
                      {models.map((m) => {
                        const draft = draftModelIds.includes(m.id)
                        const active = m.id === selectedModelId
                        const label = m.model?.trim() || m.id || '(未命名)'
                        return (
                          <li key={m.id}>
                            <button
                              type="button"
                              className={`settings-model-item${active ? ' active' : ''}`}
                              onClick={() => selectModel(m.id)}
                            >
                              <span className="settings-model-item-name">
                                {draft ? '[新] ' : ''}
                                {label}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {modelConfigPath && (
                    <p className="settings-hint settings-models-path" title={modelConfigPath}>
                      配置：{modelConfigPath}
                    </p>
                  )}
                </div>

                {/* 模型详情 / 编辑 */}
                <div className="settings-models-detail">
                  {!selectedModel ? (
                    <div className="settings-models-empty-detail">
                      <p className="settings-hint">
                        {models.length === 0
                          ? '点击左侧「新增」创建第一个模型。'
                          : '从左侧选择一个模型进行编辑。'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="settings-models-detail-header">
                        <h3 className="settings-panel-title">
                          {isDraft ? '新增模型' : '编辑模型'}
                        </h3>
                        <div className="settings-models-detail-actions">
                          {isDraft ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={savingSettings}
                              onClick={discardSelectedDraft}
                            >
                              取消新增
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary btn-danger-outline"
                              disabled={savingSettings || models.length <= 1}
                              title={
                                models.length <= 1
                                  ? '至少保留一个模型'
                                  : '从列表删除（保存后写入配置）'
                              }
                              onClick={removeSelectedModel}
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="settings-model-fields">
                        <label className="settings-label">API 模型 ID</label>
                        <input
                          type="text"
                          className="settings-input"
                          value={selectedModel.model}
                          placeholder="如 deepseek-v4-flash"
                          onChange={(e) => updateSelectedModel({ model: e.target.value })}
                        />
                        <p className="settings-hint">界面显示名与此相同，无需另填。</p>

                        <label className="settings-label">Base URL</label>
                        <input
                          type="text"
                          className="settings-input"
                          value={selectedModel.base_url}
                          placeholder="https://api.example.com"
                          onChange={(e) => updateSelectedModel({ base_url: e.target.value })}
                        />

                        <label className="settings-label" htmlFor="settings-context-k">
                          上下文窗口 (K)
                        </label>
                        <div className="settings-row">
                          <input
                            id="settings-context-k"
                            type="number"
                            min={1}
                            step={1}
                            className="settings-input"
                            value={
                              selectedModel.context_window > 0
                                ? Math.round(selectedModel.context_window / 1000)
                                : ''
                            }
                            placeholder="例如 128、256、1000"
                            onChange={(e) => {
                              const raw = e.target.value.trim()
                              if (raw === '') {
                                updateSelectedModel({ context_window: 0 })
                                return
                              }
                              const k = Number(raw)
                              if (!Number.isFinite(k) || k <= 0) {
                                updateSelectedModel({ context_window: 0 })
                                return
                              }
                              updateSelectedModel({
                                context_window: Math.round(k) * 1000,
                              })
                            }}
                          />
                          <span className="settings-unit">K</span>
                        </div>
                        <p className="settings-hint">
                          按模型文档填写，如 128 表示 128K tokens；1M 填 1000。
                          {selectedModel.context_window > 0
                            ? ` 当前 ${selectedModel.context_window.toLocaleString()} tokens。`
                            : ''}
                        </p>

                        <div className="settings-key-block">
                          <label className="settings-label">API Key</label>
                          {keyStatus?.is_set ? (
                            <div className="settings-key-set-banner" aria-disabled="true">
                              <span className="settings-key-set-text">已配置</span>
                              <span className="settings-hint">
                                密钥已保存在本地，无需重复填写
                              </span>
                            </div>
                          ) : (
                            <>
                              <div className="settings-row">
                                <input
                                  type={keyVisible ? 'text' : 'password'}
                                  value={keyInput}
                                  onChange={(e) => setKeyInput(e.target.value)}
                                  placeholder="粘贴 API Key"
                                  className="settings-input"
                                  autoComplete="off"
                                />
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => setKeyVisible((v) => !v)}
                                >
                                  {keyVisible ? '隐藏' : '显示'}
                                </button>
                              </div>
                              <p className="settings-hint">
                                密钥保存在本地{' '}
                                {envFilePath || '%USERPROFILE%\\.jike-grok-desktop\\.env'}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="settings-shell-footer">
          <button
            type="button"
            className="btn-secondary"
            disabled={savingSettings}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={savingSettings}
            onClick={onSave}
          >
            {savingSettings ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
