import { useMemo, useState } from 'react'
import type { ModelEntry } from '../../types'
import { ModelSamplingFields } from './ModelSamplingFields'
import {
  API_BACKENDS,
  headersToText,
  textToHeaders,
  type SettingsTab,
} from './settingsHelpers'

interface SettingsModalProps {
  settingsCwd: string
  setSettingsCwd: (cwd: string) => void
  pickDirectory: () => void
  canSwitchWorkspace: boolean
  models: ModelEntry[]
  selectedModelId: string
  selectModel: (id: string) => void
  draftModelIds: string[]
  startAddModel: () => void
  discardSelectedDraft: () => void
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
  onSave: () => Promise<{ ok: boolean; error?: string }> | void
}

export function SettingsModal({
  settingsCwd,
  setSettingsCwd,
  pickDirectory,
  canSwitchWorkspace,
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
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const selectedModel = models.find((m) => m.id === selectedModelId)
  const isDraft = selectedModelId ? draftModelIds.includes(selectedModelId) : false

  const handleSave = async () => {
    setToast(null)
    const res = await onSave()
    if (res && res.ok) {
      setToast({ message: '配置模型成功', type: 'success' })
      setTimeout(() => {
        setToast(null)
      }, 3000)
    } else if (res && res.error) {
      setToast({ message: res.error, type: 'error' })
    }
  }

  const headersText = useMemo(
    () => headersToText(selectedModel?.extra_headers),
    [selectedModel?.extra_headers],
  )
  const [headersDraft, setHeadersDraft] = useState<string | null>(null)
  const headersValue =
    headersDraft !== null && selectedModel ? headersDraft : headersText

  const onSelectModel = (id: string) => {
    setHeadersDraft(null)
    setShowAdvanced(false)
    selectModel(id)
  }

  return (
    <div className="modal-backdrop settings-backdrop" onClick={onClose}>
      <div
        className="settings-shell"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        {toast && (
          <div className={`settings-toast ${toast.type}`} role="alert">
            <span className="toast-icon">{toast.type === 'success' ? '✓' : '✕'}</span>
            <span className="toast-text">{toast.message}</span>
          </div>
        )}
        <div className="settings-shell-header">
          <div className="settings-shell-heading">
            <h2 id="settings-title">设置</h2>
            <p className="settings-shell-sub">工作区与模型（对齐官方 config.toml）</p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            <button
              type="button"
              className={`settings-nav-item${tab === 'general' ? ' active' : ''}`}
              onClick={() => setTab('general')}
            >
              <span className="settings-nav-icon" aria-hidden>
                ◎
              </span>
              通用
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'models' ? ' active' : ''}`}
              onClick={() => setTab('models')}
            >
              <span className="settings-nav-icon" aria-hidden>
                ◆
              </span>
              模型
            </button>
          </nav>

          <div className="settings-panel">
            {tab === 'general' && (
              <div className="settings-panel-inner">
                <section className="settings-card">
                  <h3 className="settings-card-title">工作目录</h3>
                  <p className="settings-card-desc">
                    Agent 读写文件、执行命令时使用的项目根路径。
                  </p>
                  {canSwitchWorkspace ? (
                    <>
                      <label className="settings-label" htmlFor="settings-cwd">
                        路径
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
                          浏览…
                        </button>
                      </div>
                      <p className="settings-hint">保存后写入本地配置；若会话已就绪会重建以切换目录。</p>
                    </>
                  ) : (
                    <p className="settings-hint">
                      当前会话已有对话内容时不可在此切换工作区。请新建对话后再改，或使用输入框上方的工作区选择器（空会话时可用）。
                    </p>
                  )}
                </section>
              </div>
            )}

            {tab === 'models' && (
              <div className="settings-models-layout">
                <div className="settings-models-list">
                  <div className="settings-models-list-header">
                    <span>已配置</span>
                    <button
                      type="button"
                      className="btn-inline"
                      disabled={savingSettings}
                      onClick={() => {
                        setHeadersDraft(null)
                        startAddModel()
                      }}
                    >
                      + 新增
                    </button>
                  </div>

                  {models.length === 0 ? (
                    <p className="settings-hint settings-models-empty">尚无模型，点击「新增」。</p>
                  ) : (
                    <ul className="settings-models-items">
                      {models.map((m) => {
                        const draft = draftModelIds.includes(m.id)
                        const active = m.id === selectedModelId
                        const title = m.model?.trim() || m.id
                        const sub = m.api_backend || 'chat_completions'
                        return (
                          <li key={m.id}>
                            <button
                              type="button"
                              className={`settings-model-item${active ? ' active' : ''}`}
                              onClick={() => onSelectModel(m.id)}
                            >
                              <span className="settings-model-item-name">
                                {draft ? (
                                  <span className="settings-badge-new">新</span>
                                ) : null}
                                {title}
                              </span>
                              <span className="settings-model-item-sub">{sub}</span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {modelConfigPath && (
                    <p className="settings-hint settings-models-path" title={modelConfigPath}>
                      {modelConfigPath}
                    </p>
                  )}
                </div>

                <div className="settings-models-detail">
                  {!selectedModel ? (
                    <div className="settings-models-empty-detail">
                      <p className="settings-empty-title">选择或新增模型</p>
                      <p className="settings-hint">
                        配置写入官方格式的 <code>[model.&lt;id&gt;]</code>，可对接 OpenAI 兼容 / Anthropic Messages 等。
                      </p>
                    </div>
                  ) : (
                    <div className="settings-models-detail-scroll">
                      <div className="settings-models-detail-header">
                        <div>
                          <h3 className="settings-panel-title">
                            {isDraft ? '新增模型' : '编辑模型'}
                          </h3>
                        </div>
                        <div className="settings-models-detail-actions">
                          {isDraft ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={savingSettings}
                              onClick={() => {
                                setHeadersDraft(null)
                                discardSelectedDraft()
                              }}
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
                              onClick={() => {
                                setHeadersDraft(null)
                                removeSelectedModel()
                              }}
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </div>

                      {/* —— 连接 —— */}
                      <section className="settings-field-section">
                        <h4 className="settings-field-section-title">连接</h4>

                        <div className="settings-field">
                          <label className="settings-label">模型名称</label>
                          <input
                            type="text"
                            className="settings-input"
                            value={selectedModel.model}
                            placeholder="deepseek-chat / claude-sonnet-4-6 / llama3.1:8b"
                            onChange={(e) =>
                              updateSelectedModel({
                                model: e.target.value,
                                name: e.target.value,
                              })
                            }
                          />
                          <p className="settings-hint">
                            即发往 API 的 model id，同时作为列表与下拉中的显示名称。
                          </p>
                        </div>

                        <div className="settings-field">
                          <label className="settings-label">Base URL</label>
                          <input
                            type="text"
                            className="settings-input"
                            value={selectedModel.base_url}
                            placeholder="https://api.example.com/v1"
                            onChange={(e) => updateSelectedModel({ base_url: e.target.value })}
                          />
                          <p className="settings-hint">OpenAI 兼容接口通常需以 /v1 结尾。</p>
                        </div>

                        <div className="settings-field">
                          <label className="settings-label">API 协议 (api_backend)</label>
                          <div className="settings-backend-options" role="radiogroup">
                            {API_BACKENDS.map((opt) => {
                              const active =
                                (selectedModel.api_backend || 'chat_completions') === opt.value
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  role="radio"
                                  aria-checked={active}
                                  className={`settings-backend-card${active ? ' active' : ''}`}
                                  onClick={() =>
                                    updateSelectedModel({ api_backend: opt.value })
                                  }
                                >
                                  <span className="settings-backend-label">{opt.label}</span>
                                  <span className="settings-backend-hint">{opt.hint}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div className="settings-field-grid">
                          <div className="settings-field">
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
                                placeholder="128"
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
                              <span className="settings-unit">K tokens</span>
                            </div>
                          </div>
                          <div className="settings-field">
                            <label className="settings-label">描述（可选）</label>
                            <input
                              type="text"
                              className="settings-input"
                              value={selectedModel.description || ''}
                              placeholder="简短说明"
                              onChange={(e) =>
                                updateSelectedModel({ description: e.target.value })
                              }
                            />
                          </div>
                        </div>
                      </section>

                      {/* —— 推理：设置里只声明是否支持；强度在输入栏切换模型时选择 —— */}
                      <section className="settings-field-section">
                        <h4 className="settings-field-section-title">推理</h4>
                        <label className="settings-checkbox-label settings-reasoning-enable">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedModel.supports_reasoning_effort)}
                            onChange={(e) => {
                              const on = e.target.checked
                              updateSelectedModel({
                                supports_reasoning_effort: on,
                                reasoning_effort: on ? 'medium' : '',
                              })
                            }}
                          />
                          <span>
                            <strong>此模型支持推理 / 思考</strong>
                            <span className="settings-hint settings-hint-inline">
                              仅声明能力。强度在下方输入栏切换模型时选择（类似 Claude / Codex）
                            </span>
                          </span>
                        </label>
                      </section>

                      {/* —— 密钥 —— */}
                      <section className="settings-field-section">
                        <h4 className="settings-field-section-title">密钥</h4>
                        <div className="settings-key-block">
                          {keyStatus?.is_set ? (
                            <div className="settings-key-set-banner">
                              <span className="settings-key-set-text">已配置</span>
                              <span className="settings-hint">
                                变量 {keyStatus.key_name} · 明文不在 config.toml
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
                                保存至 {envFilePath || '桌面 .env'}，通过 env_key 注入进程。
                              </p>
                            </>
                          )}
                        </div>
                      </section>

                      {/* —— 高级 —— */}
                      <section className="settings-field-section">
                        <button
                          type="button"
                          className="settings-advanced-toggle"
                          onClick={() => setShowAdvanced((v) => !v)}
                          aria-expanded={showAdvanced}
                        >
                          <span>高级选项</span>
                          <span className="settings-advanced-chevron">
                            {showAdvanced ? '▾' : '▸'}
                          </span>
                        </button>

                        {showAdvanced && (
                          <div className="settings-advanced-body">
                            <ModelSamplingFields
                              selectedModel={selectedModel}
                              updateSelectedModel={updateSelectedModel}
                            />

                            <div className="settings-field">
                              <label className="settings-label">
                                API 专用地址 (api_base_url)
                              </label>
                              <input
                                type="text"
                                className="settings-input"
                                value={selectedModel.api_base_url || ''}
                                placeholder="空 = 与 Base URL 相同；仅 API Key 鉴权时用此地址"
                                onChange={(e) =>
                                  updateSelectedModel({ api_base_url: e.target.value })
                                }
                              />
                            </div>

                            <div className="settings-field-grid">
                              <div className="settings-field">
                                <label className="settings-label">最大重试次数 (max_retries)</label>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="settings-input"
                                  value={
                                    selectedModel.max_retries > 0
                                      ? selectedModel.max_retries
                                      : ''
                                  }
                                  placeholder="默认"
                                  onChange={(e) => {
                                    const raw = e.target.value.trim()
                                    if (raw === '') {
                                      updateSelectedModel({ max_retries: 0 })
                                      return
                                    }
                                    const n = Math.floor(Number(raw))
                                    updateSelectedModel({
                                      max_retries: Number.isFinite(n) && n > 0 ? n : 0,
                                    })
                                  }}
                                />
                              </div>
                              <div className="settings-field">
                                <label className="settings-label">
                                  流式空闲超时秒 (inference_idle_timeout_secs)
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="settings-input"
                                  value={
                                    selectedModel.inference_idle_timeout_secs > 0
                                      ? selectedModel.inference_idle_timeout_secs
                                      : ''
                                  }
                                  placeholder="默认 300"
                                  onChange={(e) => {
                                    const raw = e.target.value.trim()
                                    if (raw === '') {
                                      updateSelectedModel({ inference_idle_timeout_secs: 0 })
                                      return
                                    }
                                    const n = Math.floor(Number(raw))
                                    updateSelectedModel({
                                      inference_idle_timeout_secs:
                                        Number.isFinite(n) && n > 0 ? n : 0,
                                    })
                                  }}
                                />
                              </div>
                            </div>

                            <div className="settings-field-grid">
                              <div className="settings-field">
                                <label className="settings-label">
                                  流式工具调用 (stream_tool_calls)
                                </label>
                                <select
                                  className="settings-input settings-select"
                                  value={
                                    selectedModel.stream_tool_calls === null ||
                                    selectedModel.stream_tool_calls === undefined
                                      ? ''
                                      : selectedModel.stream_tool_calls
                                        ? 'true'
                                        : 'false'
                                  }
                                  onChange={(e) => {
                                    const v = e.target.value
                                    updateSelectedModel({
                                      stream_tool_calls:
                                        v === '' ? null : v === 'true',
                                    })
                                  }}
                                >
                                  <option value="">默认（不写配置）</option>
                                  <option value="true">开启</option>
                                  <option value="false">关闭</option>
                                </select>
                              </div>
                              <div className="settings-field">
                                <label className="settings-label">
                                  自动压缩阈值 % (auto_compact_threshold)
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={1}
                                  className="settings-input"
                                  value={
                                    selectedModel.auto_compact_threshold_percent > 0
                                      ? selectedModel.auto_compact_threshold_percent
                                      : ''
                                  }
                                  placeholder="默认约 85"
                                  onChange={(e) => {
                                    const raw = e.target.value.trim()
                                    if (raw === '') {
                                      updateSelectedModel({
                                        auto_compact_threshold_percent: 0,
                                      })
                                      return
                                    }
                                    const n = Math.floor(Number(raw))
                                    updateSelectedModel({
                                      auto_compact_threshold_percent:
                                        Number.isFinite(n) && n > 0
                                          ? Math.min(100, n)
                                          : 0,
                                    })
                                  }}
                                />
                              </div>
                            </div>

                            <div className="settings-field-grid">
                              <div className="settings-field">
                                <label className="settings-label">
                                  智能体类型 (agent_type)
                                </label>
                                <input
                                  type="text"
                                  className="settings-input"
                                  value={selectedModel.agent_type || 'grok-build'}
                                  placeholder="grok-build"
                                  onChange={(e) =>
                                    updateSelectedModel({ agent_type: e.target.value })
                                  }
                                />
                              </div>
                              <div className="settings-field settings-field-checkbox">
                                <label className="settings-label settings-checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(selectedModel.use_concise)}
                                    onChange={(e) =>
                                      updateSelectedModel({ use_concise: e.target.checked })
                                    }
                                  />
                                  简洁模式 (use_concise)
                                </label>
                              </div>
                            </div>

                            <div className="settings-field">
                              <label className="settings-label">
                                额外请求头 (extra_headers)
                              </label>
                              <textarea
                                className="settings-textarea"
                                rows={4}
                                value={headersValue}
                                placeholder={
                                  '每行一条：Header-Name: value\nanthropic-version: 2023-06-01'
                                }
                                onChange={(e) => {
                                  setHeadersDraft(e.target.value)
                                  updateSelectedModel({
                                    extra_headers: textToHeaders(e.target.value),
                                  })
                                }}
                                onBlur={() => setHeadersDraft(null)}
                              />
                              <p className="settings-hint">
                                Claude 等可附加 anthropic-version / x-api-key 等头。
                              </p>
                            </div>

                            <h5 className="settings-field-subtitle">可见性 (visibility)</h5>
                            <div className="settings-field-grid">
                              <label className="settings-checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={Boolean(selectedModel.hidden)}
                                  onChange={(e) =>
                                    updateSelectedModel({ hidden: e.target.checked })
                                  }
                                />
                                隐藏模型 (hidden)
                              </label>
                              <label className="settings-checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={selectedModel.supported_in_api !== false}
                                  onChange={(e) =>
                                    updateSelectedModel({
                                      supported_in_api: e.target.checked,
                                    })
                                  }
                                />
                                API Key 用户可见 (supported_in_api)
                              </label>
                            </div>

                            <h5 className="settings-field-subtitle">
                              懒惰检测 (laziness_detector)
                            </h5>
                            <div className="settings-field-grid">
                              <label className="settings-checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={Boolean(selectedModel.laziness_enabled)}
                                  onChange={(e) =>
                                    updateSelectedModel({
                                      laziness_enabled: e.target.checked,
                                    })
                                  }
                                />
                                启用检测 (enabled)
                              </label>
                              <div className="settings-field">
                                <label className="settings-label">
                                  每会话最大提醒次数 (max_nudges_per_session)
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  className="settings-input"
                                  value={
                                    selectedModel.laziness_max_nudges > 0
                                      ? selectedModel.laziness_max_nudges
                                      : ''
                                  }
                                  placeholder="0 = 只观察不提醒"
                                  onChange={(e) => {
                                    const raw = e.target.value.trim()
                                    if (raw === '') {
                                      updateSelectedModel({ laziness_max_nudges: 0 })
                                      return
                                    }
                                    const n = Math.floor(Number(raw))
                                    updateSelectedModel({
                                      laziness_max_nudges:
                                        Number.isFinite(n) && n > 0 ? n : 0,
                                    })
                                  }}
                                />
                              </div>
                            </div>

                            <h5 className="settings-field-subtitle">
                              压缩相关头 (compaction headers)
                            </h5>
                            <div className="settings-field-grid">
                              <div className="settings-field">
                                <label className="settings-label">
                                  剩余压缩次数 (compactions_remaining)
                                </label>
                                <select
                                  className="settings-input settings-select"
                                  value={selectedModel.compactions_remaining || ''}
                                  onChange={(e) =>
                                    updateSelectedModel({
                                      compactions_remaining: e.target.value,
                                    })
                                  }
                                >
                                  <option value="">不设置</option>
                                  <option value="dynamic">动态</option>
                                  <option value="off">关闭</option>
                                  <option value="1">固定 1</option>
                                  <option value="0">固定 0</option>
                                </select>
                              </div>
                              <div className="settings-field">
                                <label className="settings-label">
                                  压缩触发 Token (compaction_at_tokens)
                                </label>
                                <select
                                  className="settings-input settings-select"
                                  value={
                                    ['', 'dynamic', 'off'].includes(
                                      selectedModel.compaction_at_tokens || '',
                                    )
                                      ? selectedModel.compaction_at_tokens || ''
                                      : 'custom'
                                  }
                                  onChange={(e) => {
                                    const v = e.target.value
                                    if (v === 'custom') {
                                      updateSelectedModel({
                                        compaction_at_tokens: '100000',
                                      })
                                    } else {
                                      updateSelectedModel({ compaction_at_tokens: v })
                                    }
                                  }}
                                >
                                  <option value="">不设置</option>
                                  <option value="dynamic">按阈值动态</option>
                                  <option value="off">关闭</option>
                                  <option value="custom">固定 token 数…</option>
                                </select>
                                {selectedModel.compaction_at_tokens &&
                                  !['', 'dynamic', 'off'].includes(
                                    selectedModel.compaction_at_tokens,
                                  ) && (
                                    <input
                                      type="number"
                                      min={1}
                                      className="settings-input"
                                      style={{ marginTop: 8 }}
                                      value={selectedModel.compaction_at_tokens}
                                      onChange={(e) =>
                                        updateSelectedModel({
                                          compaction_at_tokens: e.target.value.replace(
                                            /\D/g,
                                            '',
                                          ),
                                        })
                                      }
                                    />
                                  )}
                              </div>
                            </div>
                          </div>
                        )}
                      </section>
                    </div>
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
            onClick={handleSave}
          >
            {savingSettings ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
