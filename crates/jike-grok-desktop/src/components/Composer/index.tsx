import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import type { ModelEntry } from '../../types'
import { REASONING_LEVELS } from '../../types'

export interface ComposerHandle {
  focus: () => void
}

interface ComposerProps {
  input: string
  setInput: (v: string) => void
  canSend: boolean
  isGenerating: boolean
  ready: boolean
  /** 正在 start/restart 会话（New chat / 首次启动） */
  starting?: boolean
  models: ModelEntry[]
  selectedModelId: string
  /** 当前会话推理强度（仅 supports_reasoning 模型有效） */
  reasoningEffort: string
  /** 当前工作区路径 */
  workspaceCwd: string
  /** 历史去重工作区列表 */
  workspaceOptions: string[]
  /** 会话累计已用 tokens（引擎估计） */
  contextUsedTokens: number
  /** 当前是否允许切换工作区 */
  canSwitchWorkspace: boolean
  onSwitchModel: (id: string) => void
  /** 切换推理强度（同模型 + meta.reasoningEffort） */
  onSwitchReasoningEffort: (effort: string) => void
  onSelectWorkspace: (cwd: string) => void
  onBrowseWorkspace: () => void
  onSend: () => void
  onCancel: () => void
}

function formatTokenK(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  const k = n / 1000
  if (k < 10) return `${k.toFixed(1)}K`
  if (k < 1000) return `${Math.round(k)}K`
  return `${(k / 1000).toFixed(1)}M`
}

function formatWorkspaceLabel(p: string): string {
  if (!p) return '选择工作区'
  const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || normalized
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      {open ? (
        <path
          d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

function ChevronIcon({ up = false }: { up?: boolean }) {
  return (
    <svg
      className={`composer-chevron${up ? ' up' : ''}`}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      shapeRendering="geometricPrecision"
    >
      <path
        d="M12 19V5M5 12l7-7 7 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 中断：实心圆角方块（对齐 ChatGPT / Claude 停止按钮样式） */
function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
  )
}

function BrowseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 11v6M9 14h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12l5 5L20 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    input,
    setInput,
    canSend,
    isGenerating,
    ready,
    starting: _starting = false,
    models,
    selectedModelId,
    reasoningEffort,
    workspaceCwd,
    workspaceOptions,
    contextUsedTokens,
    canSwitchWorkspace,
    onSwitchModel,
    onSwitchReasoningEffort,
    onSelectWorkspace,
    onBrowseWorkspace,
    onSend,
    onCancel,
  }: ComposerProps,
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wsPickerRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus()
    },
  }))

  const [wsOpen, setWsOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)

  useEffect(() => {
    if (!canSwitchWorkspace) setWsOpen(false)
  }, [canSwitchWorkspace])

  // 点击外部关闭下拉
  useEffect(() => {
    if (!wsOpen && !modelOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (wsOpen && wsPickerRef.current && !wsPickerRef.current.contains(t)) {
        setWsOpen(false)
      }
      if (modelOpen && modelPickerRef.current && !modelPickerRef.current.contains(t)) {
        setModelOpen(false)
      }
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWsOpen(false)
        setModelOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [wsOpen, modelOpen])

  const effortIndex = useMemo(() => {
    const i = REASONING_LEVELS.findIndex((x) => x.value === (reasoningEffort || 'medium'))
    return i >= 0 ? i : 3 // medium
  }, [reasoningEffort])

  // textarea 自适应高度
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  const contextWindow = useMemo(() => {
    const m = models.find((x) => x.id === selectedModelId)
    return m?.context_window && m.context_window > 0 ? m.context_window : 0
  }, [models, selectedModelId])

  const selectedModel = useMemo(
    () => models.find((x) => x.id === selectedModelId),
    [models, selectedModelId],
  )

  const selectedModelLabel = useMemo(() => {
    return selectedModel?.model?.trim() || selectedModel?.id || '选择模型'
  }, [selectedModel])

  const showReasoning =
    Boolean(selectedModel?.supports_reasoning_effort) && ready

  const effortLabel = useMemo(() => {
    const lv = REASONING_LEVELS.find((x) => x.value === reasoningEffort)
    return lv?.label || '中'
  }, [reasoningEffort])

  const usage = useMemo(() => {
    const used = Math.max(0, contextUsedTokens || 0)
    const total = contextWindow
    const pct = total > 0 ? Math.min(100, Math.round((used * 100) / total)) : 0
    const tone = pct >= 95 ? 'danger' : pct >= 85 ? 'warn' : ''
    return {
      used,
      total,
      pct,
      tone,
      label:
        total > 0
          ? `${formatTokenK(used)} / ${formatTokenK(total)}`
          : used > 0
            ? formatTokenK(used)
            : '—',
      title:
        total > 0
          ? `上下文用量约 ${used.toLocaleString()} / ${total.toLocaleString()} tokens（${pct}%）`
          : used > 0
            ? `已用约 ${used.toLocaleString()} tokens（未配置窗口上限）`
            : '上下文用量（对话后更新）',
    }
  }, [contextUsedTokens, contextWindow])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend && input.trim()) onSend()
    }
  }

  const canSubmit = canSend && !!input.trim()
  const wsLabel = formatWorkspaceLabel(workspaceCwd)
  const currentWsKey = normPath(workspaceCwd)

  return (
    <footer className="composer-container">
      {/* 工作区芯片：可切换时下拉；不可切换时只读展示 */}
      <div className="composer-meta-row">
        <div className="composer-meta-left" ref={wsPickerRef}>
          {canSwitchWorkspace ? (
            <>
              <button
                type="button"
                className={`composer-chip workspace-chip${wsOpen ? ' open' : ''}`}
                title={`当前工作目录\n${workspaceCwd || '未设置'}\n\n点击切换`}
                aria-expanded={wsOpen}
                onClick={() => {
                  setModelOpen(false)
                  setWsOpen((v) => !v)
                }}
              >
                <span className="chip-icon">
                  <FolderIcon open={wsOpen} />
                </span>
                <span className="chip-label">{wsLabel}</span>
                <ChevronIcon up={wsOpen} />
              </button>
              {wsOpen && (
                <div className="composer-menu workspace-menu" role="listbox">
                  <div className="composer-menu-label">工作区</div>
                  {workspaceOptions.map((cwd) => {
                    const active = normPath(cwd) === currentWsKey
                    return (
                      <button
                        key={cwd}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`composer-menu-item${active ? ' active' : ''}`}
                        title={cwd}
                        onClick={() => {
                          setWsOpen(false)
                          onSelectWorkspace(cwd)
                        }}
                      >
                        <span className="menu-item-icon">
                          <FolderIcon />
                        </span>
                        <span className="menu-item-body">
                          <span className="menu-item-title">{formatWorkspaceLabel(cwd)}</span>
                          <span className="menu-item-sub">{cwd}</span>
                        </span>
                        {active && (
                          <span className="menu-item-check">
                            <CheckIcon />
                          </span>
                        )}
                      </button>
                    )
                  })}
                  <div className="composer-menu-divider" />
                  <button
                    type="button"
                    className="composer-menu-item menu-browse"
                    onClick={() => {
                      setWsOpen(false)
                      onBrowseWorkspace()
                    }}
                  >
                    <span className="menu-item-icon">
                      <BrowseIcon />
                    </span>
                    <span className="menu-item-body">
                      <span className="menu-item-title">浏览其他文件夹…</span>
                    </span>
                  </button>
                </div>
              )}
            </>
          ) : (
            <div
              className="composer-chip workspace-chip readonly"
              title={`当前工作目录\n${workspaceCwd || '未设置'}\n\n有对话内容时请从侧栏打开对应会话，或新建后再切换`}
            >
              <span className="chip-icon">
                <FolderIcon />
              </span>
              <span className="chip-label">{wsLabel}</span>
            </div>
          )}
        </div>
      </div>

      <div className={`composer-card${isGenerating ? ' is-generating' : ''}`}>
        {/* placeholder 固定；New chat 静默重建时不提示「创建中」 */}
        <textarea
          ref={textareaRef}
          value={input}
          rows={1}
          placeholder="输入消息…"
          disabled={isGenerating}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="composer-toolbar">
          <div className="toolbar-left">
            <span className="composer-hint">
              {isGenerating
                ? '生成中 · 点左侧方块可中断 · Esc 失焦'
                : 'Enter 发送 · Shift+Enter 换行'}
            </span>
          </div>
          <div className="toolbar-right">
            {/* 中断：始终展示，仅生成中可点 */}
            <button
              type="button"
              className={`btn-circle btn-stop${isGenerating ? ' active' : ''}`}
              disabled={!isGenerating}
              title={isGenerating ? '停止生成' : '无生成任务'}
              aria-label="停止生成"
              onClick={onCancel}
            >
              <StopIcon />
            </button>
            {/* 发送：始终展示，有内容且可发送时高亮 */}
            <button
              type="button"
              className={`btn-circle btn-send${canSubmit ? ' ready' : ''}`}
              disabled={!canSubmit}
              title="发送消息 (Enter)"
              aria-label="发送消息"
              onClick={onSend}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>

      <div className="composer-below">
        <div className="composer-below-left">
          {/* 思考强度：滑动选择（Claude Code /model 旁 effort 滑条交互） */}
          {showReasoning && (
            <div
              className="effort-slider-wrap"
              title="拖动调节思考强度"
            >
              <span className="effort-slider-label">思考</span>
              <input
                type="range"
                className="effort-slider"
                min={0}
                max={REASONING_LEVELS.length - 1}
                step={1}
                value={effortIndex}
                disabled={!ready || isGenerating}
                aria-label="思考强度"
                aria-valuetext={effortLabel}
                onChange={(e) => {
                  const idx = Number(e.target.value)
                  const lv = REASONING_LEVELS[idx]
                  if (lv) onSwitchReasoningEffort(lv.value)
                }}
              />
              <span className="effort-slider-value">{effortLabel}</span>
            </div>
          )}

          {models.length > 0 && (
            <div className="model-picker" ref={modelPickerRef}>
              <button
                type="button"
                className={`composer-chip model-chip${modelOpen ? ' open' : ''}`}
                disabled={!ready}
                title="切换当前会话模型"
                aria-expanded={modelOpen}
                onClick={() => {
                  if (!ready) return
                  setWsOpen(false)
                  setModelOpen((v) => !v)
                }}
              >
                <span className="chip-label">{selectedModelLabel}</span>
                <ChevronIcon up={modelOpen} />
              </button>
              {modelOpen && (
                <div className="composer-menu model-menu" role="listbox">
                  <div className="composer-menu-label">模型</div>
                  {models.map((m) => {
                    const active = m.id === selectedModelId
                    const title = m.model?.trim() || m.id
                    const subBits = [
                      m.supports_reasoning_effort ? '支持推理' : '',
                      m.api_backend && m.api_backend !== 'chat_completions'
                        ? m.api_backend
                        : '',
                      m.context_window > 0
                        ? `上下文 ${formatTokenK(m.context_window)}`
                        : '',
                    ].filter(Boolean)
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`composer-menu-item${active ? ' active' : ''}`}
                        onClick={() => {
                          setModelOpen(false)
                          onSwitchModel(m.id)
                        }}
                      >
                        <span className="menu-item-body">
                          <span className="menu-item-title">{title}</span>
                          {subBits.length > 0 && (
                            <span className="menu-item-sub">{subBits.join(' · ')}</span>
                          )}
                        </span>
                        {active && (
                          <span className="menu-item-check">
                            <CheckIcon />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="composer-below-right">
          <div
            className={`context-meter${usage.tone ? ` ${usage.tone}` : ''}`}
            title={usage.title}
          >
            {usage.total > 0 && (
              <span className="context-meter-ring" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="6" className="ring-track" />
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    className="ring-value"
                    style={{
                      strokeDasharray: `${(usage.pct / 100) * 37.7} 37.7`,
                    }}
                  />
                </svg>
              </span>
            )}
            <span className="context-meter-text">
              {usage.label}
              {usage.total > 0 ? (
                <span className="context-meter-pct"> · {usage.pct}%</span>
              ) : null}
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
})
