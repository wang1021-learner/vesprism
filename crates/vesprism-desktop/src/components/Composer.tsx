import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { ModelInfo, SessionPhase } from '../types'
import { REASONING_LEVELS } from '../types'
import { generateId } from '../lib/generateId'
import { useComposerAssist } from './ComposerAssist'
import {
  $planApproval,
  $planPhase,
  $sandboxCwd,
  $scratchCwd,
  $securityPolicy,
  $sessionPolicyOverride,
  $totalTokens,
  isScratchCwd,
  pushToast,
  workspaceLabel,
} from '../store'
import { dedupeWorkspacePaths, normalizeWorkspacePath } from '../lib/workspacePath'
import {
  applyComposerPolicy,
  attachKindFromPath,
  COMPOSER_POLICY_OPTIONS,
} from '../lib/sessionSandbox'
import { clipboardImageFiles, persistImageFile } from '../lib/pasteImage'
import { planChipLabel, togglePlanMode } from '../lib/planMode'
import { openSessionInsight } from '../lib/engineSlash'
import { useStore } from '@nanostores/react'
import type { PromptAttach } from '../bridge'
import type { QueuedPrompt } from '../store'

export interface ComposerHandle {
  focus: () => void
}

const PASTE_FOLD_THRESHOLD = 800

interface PasteBlock {
  id: string
  text: string
  lineCount: number
  charCount: number
}

interface ComposerProps {
  input: string
  setInput: (v: string) => void
  canSend: boolean
  /** 引擎正在生成（engineStatus === generating） */
  engineGenerating: boolean
  /** 壳层 phase === ready */
  shellReady: boolean
  /** 会话壳层阶段（可选展示 / 禁用逻辑） */
  sessionPhase: SessionPhase
  models: ModelInfo[]
  selectedModelId: string
  /** 当前会话推理强度（仅 supports_reasoning 模型有效） */
  reasoningEffort: string
  /** 当前工作区路径 */
  workspaceCwd: string
  /** 历史去重工作区列表 */
  workspaceOptions: string[]
  /** 当前是否允许切换工作区 */
  canSwitchWorkspace: boolean
  onSwitchModel: (id: string) => void
  /** 切换推理强度（同模型 + meta.reasoningEffort） */
  onSwitchReasoningEffort: (effort: string) => void
  onSelectWorkspace: (cwd: string) => void
  queuedPrompts?: QueuedPrompt[]
  onSend: (text?: string, attachments?: PromptAttach[], mode?: 'queue' | 'interject') => void
  onRemoveQueued?: (id: string, version: number) => void
  onCancel: () => void
  /** 画布第二主聊天关掉 /goal /sandbox，避免和试跑 `/流程id` 撞车 */
  enableSlash?: boolean
  placeholder?: string
  /** dock：铺满工作栏，不显示底部免责声明 */
  variant?: 'default' | 'dock'
  /** 画布输入不展示工作区芯片 */
  showWorkspace?: boolean
  extraActions?: ReactNode
}

type AttachChip = {
  id: string
  kind: 'file' | 'folder' | 'image'
  path: string
  name: string
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
  if (!p || isScratchCwd(p)) return '闲聊'
  return workspaceLabel(p)
}

/** 简洁文件夹线框（不用 emoji / 系统桌面图标） */
function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l1.8 1.8c.2.2.5.3.8.3H19.5A1.5 1.5 0 0 1 21 9.6v8.9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-11Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        opacity={open ? 1 : 0.92}
      />
      {open ? (
        <path
          d="M3 11h18"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          opacity="0.55"
        />
      ) : null}
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

/** 中断：实心圆角方块 */
function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
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

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function FileTextIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
        stroke="currentColor"
        strokeWidth="1.8"
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
    engineGenerating,
    shellReady,
    sessionPhase,
    models,
    selectedModelId,
    reasoningEffort,
    workspaceCwd,
    workspaceOptions,
    canSwitchWorkspace,
    onSwitchModel,
    onSwitchReasoningEffort,
    onSelectWorkspace,
    queuedPrompts = [],
    onSend,
    onRemoveQueued,
    onCancel,
    enableSlash = true,
    placeholder,
    variant = 'default',
    showWorkspace = true,
    extraActions,
  }: ComposerProps,
  ref,
) {
  // 别名：与历史 isGenerating 语义一致，便于阅读
  const isGenerating = engineGenerating
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wsPickerRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus()
    },
  }))

  useEffect(() => {
    const onFocus = () => {
      textareaRef.current?.focus()
    }
    /** 空态快捷卡片等：写入输入框并聚焦 */
    const onSetInput = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text
      if (typeof text === 'string' && text.length > 0) {
        setInput(text)
      }
      // 等 state 提交后再聚焦，避免与受控输入抢焦点
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        const el = textareaRef.current
        if (el && typeof text === 'string' && text.length > 0) {
          const len = text.length
          el.setSelectionRange(len, len)
        }
      })
    }
    window.addEventListener('jike:focus-composer', onFocus)
    window.addEventListener('jike:set-composer-input', onSetInput)
    return () => {
      window.removeEventListener('jike:focus-composer', onFocus)
      window.removeEventListener('jike:set-composer-input', onSetInput)
    }
  }, [setInput])

  const scratch = useStore($scratchCwd)
  const [wsOpen, setWsOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const policyPickerRef = useRef<HTMLDivElement>(null)
  const [pasteBlocks, setPasteBlocks] = useState<PasteBlock[]>([])
  const [attachChips, setAttachChips] = useState<AttachChip[]>([])
  const [dragging, setDragging] = useState(false)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const securityPolicy = useStore($securityPolicy)
  const policyOverride = useStore($sessionPolicyOverride)
  const sandboxCwd = useStore($sandboxCwd)
  const totalTokens = useStore($totalTokens)
  const planPhase = useStore($planPhase)
  const planApproval = useStore($planApproval)
  const planChip = planChipLabel(planPhase, Boolean(planApproval))

  useEffect(() => {
    if (!canSwitchWorkspace) setWsOpen(false)
  }, [canSwitchWorkspace])

  // 点击外部关闭下拉
  useEffect(() => {
    if (!wsOpen && !modelOpen && !attachOpen && !policyOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (wsOpen && wsPickerRef.current && !wsPickerRef.current.contains(t)) {
        setWsOpen(false)
      }
      if (modelOpen && modelPickerRef.current && !modelPickerRef.current.contains(t)) {
        setModelOpen(false)
      }
      if (policyOpen && policyPickerRef.current && !policyPickerRef.current.contains(t)) {
        setPolicyOpen(false)
      }
      if (attachOpen && attachMenuRef.current && !attachMenuRef.current.contains(t)) {
        setAttachOpen(false)
      }
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWsOpen(false)
        setModelOpen(false)
        setPolicyOpen(false)
        setAttachOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [wsOpen, modelOpen, attachOpen, policyOpen])

  const selectedModel = useMemo(
    () => models.find((x) => x.id === selectedModelId),
    [models, selectedModelId],
  )

  // 官方 messages backend 主动过滤掉 none/minimal 两档
  // （见 xai-grok-sampling-types 的 to_messages_api），选了也不会
  // 真正发给模型；这里同步隐藏，避免用户选中一个静默失效的档位。
  const availableReasoningLevels = useMemo(() => {
    if (selectedModel?.api_backend === 'messages') {
      return REASONING_LEVELS.filter((lv) => lv.value !== 'none' && lv.value !== 'minimal')
    }
    return REASONING_LEVELS
  }, [selectedModel])

  const effortIndex = useMemo(() => {
    const i = availableReasoningLevels.findIndex((x) => x.value === (reasoningEffort || 'medium'))
    return i >= 0 ? i : 3 // medium
  }, [reasoningEffort, availableReasoningLevels])

  // textarea 自适应高度（空内容保持舒适行高）
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    const next = Math.min(Math.max(el.scrollHeight, 36), 160)
    el.style.height = `${next}px`
  }, [input])

  // chat_completions backend（DeepSeek 等第三方）官方代码对这个参数
  // 不做任何过滤，是否真正生效取决于目标服务商是否支持，这里给用户
  // 一个提示而非保证。
  const reasoningEffortUnverified = selectedModel?.api_backend === 'chat_completions'

  const selectedModelLabel = useMemo(() => {
    return selectedModel?.model?.trim() || selectedModel?.id || '选择模型'
  }, [selectedModel])

  const showReasoning =
    Boolean(selectedModel?.supports_reasoning_effort) && shellReady

  const pushAttach = useCallback((kind: AttachChip['kind'], path: string) => {
    const p = path.trim()
    if (!p) return
    const name = p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p
    setAttachChips((prev) =>
      prev.some((a) => a.path === p)
        ? prev
        : [...prev, { id: generateId('att_'), kind, path: p, name }],
    )
  }, [])

  const ingestImageFiles = useCallback(
    async (files: File[]) => {
      for (const f of files) {
        try {
          const path = await persistImageFile(f)
          pushAttach('image', path)
        } catch (err) {
          pushToast(`图片失败：${String(err)}`, 'error')
        }
      }
    },
    [pushAttach],
  )

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = clipboardImageFiles(e.clipboardData)
    if (images.length > 0) {
      e.preventDefault()
      void ingestImageFiles(images)
      return
    }
    const text = e.clipboardData.getData('text')
    if (text.length <= PASTE_FOLD_THRESHOLD) return
    const el = e.currentTarget
    if (el.selectionStart !== el.selectionEnd) return
    e.preventDefault()
    const block: PasteBlock = {
      id: generateId('paste_'),
      text,
      lineCount: text.split('\n').length,
      charCount: text.length,
    }
    setPasteBlocks((prev) => [...prev, block])
  }

  const onCardDragOver = (e: DragEvent) => {
    if (![...e.dataTransfer.types].some((t) => t === 'Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  const onCardDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const images = clipboardImageFiles(e.dataTransfer)
    const files = Array.from(e.dataTransfer.files)
    void ingestImageFiles(images)
    for (const f of files) {
      if (f.type.startsWith('image/') && images.includes(f)) continue
      const nativePath = (f as File & { path?: string }).path
      if (nativePath) {
        pushAttach(attachKindFromPath(nativePath), nativePath)
      } else if (f.type.startsWith('image/')) {
        void ingestImageFiles([f])
      }
    }
  }

  const removePasteBlock = (id: string) => {
    setPasteBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  const buildFinalText = () => {
    const pasted = pasteBlocks.map((b) => b.text).join('\n\n')
    const typed = input.trim()
    if (pasted && typed) return `${pasted}\n\n${typed}`
    return pasted || typed
  }

  const pickFiles = async () => {
    setAttachOpen(false)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: true, title: '选择要附上的文件' })
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
      for (const p of paths) {
        if (typeof p === 'string') pushAttach(attachKindFromPath(p), p)
      }
    } catch (e) {
      console.warn('选择文件失败', e)
    }
  }

  const pickFolder = async () => {
    setAttachOpen(false)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ directory: true, title: '选择要附上的文件夹' })
      if (typeof selected === 'string') pushAttach('folder', selected)
    } catch (e) {
      console.warn('选择文件夹失败', e)
    }
  }

  const handleSend = () => {
    const finalText = buildFinalText()
    const attachments: PromptAttach[] = attachChips.map((a) => ({
      kind: a.kind,
      path: a.path,
    }))
    if (!finalText && attachments.length === 0) return
    onSend(finalText, attachments)
    setPasteBlocks([])
    setAttachChips([])
  }

  const handleInterject = () => {
    if (!canSend) return
    const extra = pasteBlocks.map((b) => b.text).join('\n\n')
    const finalText = [input.trim(), extra].filter(Boolean).join('\n\n')
    const attachments: PromptAttach[] = attachChips.map((a) => ({
      kind: a.kind,
      path: a.path,
    }))
    if (!finalText && attachments.length === 0) return
    onSend(finalText, attachments, 'interject')
    setPasteBlocks([])
    setAttachChips([])
  }

  const assist = useComposerAssist(input, setInput, workspaceCwd, {
    enableSlash,
    onAttachPath: (path, kind) => pushAttach(kind, path),
  })

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || (e as unknown as { keyCode?: number }).keyCode === 229) {
      return
    }
    if (assist.onKeyDown(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!canSend || !(input.trim() || pasteBlocks.length > 0 || attachChips.length > 0)) return
      if (isGenerating && (e.ctrlKey || e.metaKey)) handleInterject()
      else handleSend()
    }
  }

  const canSubmit =
    canSend && (!!input.trim() || pasteBlocks.length > 0 || attachChips.length > 0)
  const execPolicy = policyOverride || securityPolicy.executionPolicy
  const policyChip =
    sandboxCwd || execPolicy === 'proceed-in-sandbox'
      ? { label: '副本', title: '文件写入 git 副本，不是进程沙箱' }
      : execPolicy === 'always-proceed'
        ? { label: '放行', title: '信任模式：命令自动放行' }
        : { label: '审批', title: '命令需要确认后执行' }
  const contextPct =
    selectedModel && selectedModel.context_window > 0 && totalTokens > 0
      ? Math.min(100, Math.round((totalTokens / selectedModel.context_window) * 100))
      : null
  const casual = isScratchCwd(workspaceCwd)
  const wsLabel = formatWorkspaceLabel(workspaceCwd)
  const currentWsKey = normalizeWorkspacePath(workspaceCwd)
  const projectOptions = dedupeWorkspacePaths(
    workspaceOptions.filter((cwd) => !isScratchCwd(cwd)),
  )

  return (
    <footer className={`composer-container${variant === 'dock' ? ' is-dock' : ''}`}>
      {queuedPrompts.length > 0 ? (
        <div className="composer-queue" aria-label="排队中的消息">
          <span className="composer-queue-label">排队 {queuedPrompts.length}</span>
          <ul className="composer-queue-list">
            {queuedPrompts.map((q, i) => (
              <li key={q.id} className="composer-queue-item">
                <span className="composer-queue-idx">{i + 1}</span>
                <span className="composer-queue-text" title={q.text}>
                  {q.text.trim() || '（附件）'}
                </span>
                {onRemoveQueued ? (
                  <button
                    type="button"
                    className="composer-queue-remove"
                    title="取消排队"
                    aria-label="取消排队"
                    onClick={() => onRemoveQueued(q.id, q.version)}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div
        className={`composer-card${isGenerating ? ' is-generating' : ''}${dragging ? ' is-drop' : ''}`}
        onDragEnter={onCardDragOver}
        onDragOver={onCardDragOver}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false)
        }}
        onDrop={onCardDrop}
      >
        {variant !== 'dock' && showWorkspace ? (
        <div className="composer-meta-row">
          <div className="composer-meta-left" ref={wsPickerRef}>
            {canSwitchWorkspace ? (
              <>
                <button
                  type="button"
                  className={`composer-chip workspace-chip${wsOpen ? ' open' : ''}`}
                  title={
                    casual
                      ? '闲聊：未绑定项目，可先说话或点 + 附上文件\n点此选择项目'
                      : `当前项目\n${workspaceCwd}\n\n点击切换`
                  }
                  aria-expanded={wsOpen}
                  onClick={() => {
                    setModelOpen(false)
                    setPolicyOpen(false)
                    setAttachOpen(false)
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
                    <div className="composer-menu-label">会话位置</div>
                    <button
                      type="button"
                      role="option"
                      aria-selected={casual}
                      className={`composer-menu-item${casual ? ' active' : ''}`}
                      title={scratch || '闲聊'}
                      onClick={() => {
                        setWsOpen(false)
                        onSelectWorkspace(scratch || '')
                      }}
                    >
                      <span className="menu-item-icon">
                        <FolderIcon />
                      </span>
                      <span className="menu-item-body">
                        <span className="menu-item-title">闲聊</span>
                        <span className="menu-item-sub">不绑定项目，先说话或附上文件</span>
                      </span>
                      {casual && (
                        <span className="menu-item-check">
                          <CheckIcon />
                        </span>
                      )}
                    </button>
                    {projectOptions.length > 0 && (
                      <div className="composer-menu-label">最近项目</div>
                    )}
                    {projectOptions.map((cwd) => {
                      const active = normalizeWorkspacePath(cwd) === currentWsKey
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
                  </div>
                )}
              </>
            ) : (
              <div
                className="composer-chip workspace-chip readonly"
                title={
                  casual
                    ? '闲聊（本会话已开始，换项目请新建对话）'
                    : `当前项目\n${workspaceCwd || '未设置'}\n\n有对话内容时请新建对话后再切换，或从侧栏打开该项目下的历史会话`
                }
              >
                <span className="chip-icon">
                  <FolderIcon />
                </span>
                <span className="chip-label">{wsLabel}</span>
              </div>
            )}
          </div>
        </div>
        ) : null}

        {/* placeholder 固定；New chat 静默重建时不提示「创建中」 */}
        {(pasteBlocks.length > 0 || attachChips.length > 0) && (
          <div className="paste-blocks">
            {attachChips.map((a) => (
              <div key={a.id} className="paste-block-card">
                <div className="paste-block-icon">
                  {a.kind === 'folder' ? <FolderIcon /> : <FileTextIcon />}
                </div>
                <div className="paste-block-info">
                  <div className="paste-block-title" title={a.path}>
                    {a.name}
                  </div>
                  <div className="paste-block-meta">
                    {a.kind === 'folder' ? '文件夹' : a.kind === 'image' ? '图片' : '文件'}
                  </div>
                </div>
                <button
                  type="button"
                  className="paste-block-remove"
                  onClick={() =>
                    setAttachChips((prev) => prev.filter((x) => x.id !== a.id))
                  }
                  aria-label="移除附件"
                  title="移除此附件"
                >
                  ×
                </button>
              </div>
            ))}
            {pasteBlocks.map((b) => {
              const rawFirstLine = b.text.trim().split('\n')[0]?.trim() || '剪贴板文本'
              const title = rawFirstLine.length > 24 ? `${rawFirstLine.slice(0, 24)}…` : rawFirstLine
              return (
                <div key={b.id} className="paste-block-card">
                  <div className="paste-block-icon">
                    <FileTextIcon />
                  </div>
                  <div className="paste-block-info">
                    <div className="paste-block-title" title={rawFirstLine}>
                      {title}
                    </div>
                    <div className="paste-block-meta">
                      {b.charCount.toLocaleString()} 字符 · {b.lineCount} 行
                    </div>
                  </div>
                  <button
                    type="button"
                    className="paste-block-remove"
                    onClick={() => removePasteBlock(b.id)}
                    aria-label="移除粘贴内容"
                    title="移除此附件"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          rows={1}
          placeholder={
            placeholder
              ? isGenerating
                ? '生成中也可继续输入，Enter 排队…'
                : placeholder
              : isGenerating
                ? '生成中也可继续输入，Enter 排队…'
                : casual
                  ? '随便问问…'
                  : '输入消息…'
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        {assist.menu}
        <div className="composer-toolbar">
          <div className="toolbar-left">
            <div className="composer-attach" ref={attachMenuRef}>
              <button
                type="button"
                className={`composer-attach-btn${attachOpen ? ' open' : ''}`}
                title="命令、引用或附件"
                aria-label="命令、引用或附件"
                aria-expanded={attachOpen}
                onClick={() => {
                  setWsOpen(false)
                  setModelOpen(false)
                  setPolicyOpen(false)
                  setAttachOpen((v) => !v)
                }}
              >
                <PlusIcon />
              </button>
              {attachOpen && (
                <div className="composer-menu attach-menu" role="menu">
                  {enableSlash ? (
                    <>
                  <div className="composer-menu-label">命令</div>
                  <button
                    type="button"
                    className="composer-menu-item"
                    onClick={() => {
                      setAttachOpen(false)
                      assist.openSlash()
                      requestAnimationFrame(() => textareaRef.current?.focus())
                    }}
                  >
                    <span className="menu-item-body">
                      <span className="menu-item-title">插入命令…</span>
                      <span className="menu-item-sub">输入 / 打开斜杠目录</span>
                    </span>
                  </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="composer-menu-item"
                    onClick={() => {
                      setAttachOpen(false)
                      assist.openAt()
                      requestAnimationFrame(() => textareaRef.current?.focus())
                    }}
                  >
                    <span className="menu-item-body">
                      <span className="menu-item-title">引用文件…</span>
                      <span className="menu-item-sub">输入 @ 搜索工作区</span>
                    </span>
                  </button>
                  <div className="composer-menu-divider" />
                  <div className="composer-menu-label">附件</div>
                  <button
                    type="button"
                    className="composer-menu-item"
                    onClick={() => void pickFiles()}
                  >
                    <span className="menu-item-icon">
                      <FileTextIcon />
                    </span>
                    <span className="menu-item-body">
                      <span className="menu-item-title">添加文件…</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="composer-menu-item"
                    onClick={() => void pickFolder()}
                  >
                    <span className="menu-item-icon">
                      <FolderIcon />
                    </span>
                    <span className="menu-item-body">
                      <span className="menu-item-title">添加文件夹…</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
            <span className="composer-hint">
              {isGenerating
                ? '生成中 · Enter 排队 · Ctrl+Enter 插话'
                : sessionPhase === 'failed'
                  ? '会话未就绪，可新建或重试'
                  : sessionPhase === 'loading' ||
                    sessionPhase === 'booting' ||
                    sessionPhase === 'restarting'
                    ? ''
                    : 'Enter 发送'}
            </span>
          </div>
          <div className="toolbar-right">
            <div className="model-picker" ref={policyPickerRef}>
              <button
                type="button"
                className={`composer-chip policy-chip${policyOpen ? ' open' : ''}`}
                title={policyChip.title}
                aria-expanded={policyOpen}
                aria-haspopup="listbox"
                onClick={() => {
                  setWsOpen(false)
                  setModelOpen(false)
                  setAttachOpen(false)
                  setPolicyOpen((v) => !v)
                }}
              >
                <span className="chip-label">{policyChip.label}</span>
                <ChevronIcon up={policyOpen} />
              </button>
              {policyOpen && (
                <div className="composer-menu policy-menu" role="listbox">
                  <div className="composer-menu-label">执行策略</div>
                  {COMPOSER_POLICY_OPTIONS.map((opt) => {
                    const active =
                      opt.value === 'proceed-in-sandbox'
                        ? Boolean(sandboxCwd) || execPolicy === 'proceed-in-sandbox'
                        : !sandboxCwd && execPolicy === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`composer-menu-item${active ? ' active' : ''}`}
                        onClick={() => {
                          setPolicyOpen(false)
                          if (active) return
                          void applyComposerPolicy(opt.value)
                        }}
                      >
                        <span className="menu-item-body">
                          <span className="menu-item-title">{opt.label}</span>
                          <span className="menu-item-sub">{opt.hint}</span>
                        </span>
                        {active ? (
                          <span className="menu-item-check">
                            <CheckIcon />
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              className={`composer-chip plan-chip${planChip.on ? ' is-on' : ''}`}
              title={planChip.title}
              aria-pressed={planChip.on}
              disabled={!shellReady}
              onClick={() => {
                setWsOpen(false)
                setModelOpen(false)
                setAttachOpen(false)
                setPolicyOpen(false)
                void togglePlanMode()
              }}
            >
              <span className="chip-label">{planChip.label}</span>
            </button>
            {contextPct != null ? (
              <button
                type="button"
                className={`composer-context-meter${contextPct >= 75 ? ' is-warn' : ''}`}
                title={`已用约 ${totalTokens.toLocaleString()} / ${formatTokenK(selectedModel?.context_window || 0)} token · 打开上下文`}
                onClick={() => openSessionInsight()}
              >
                {contextPct}%
              </button>
            ) : (
              <button
                type="button"
                className="composer-context-meter"
                title="打开上下文与用量"
                onClick={() => openSessionInsight()}
              >
                用量
              </button>
            )}
            {models.length > 0 && (
              <div className="model-picker" ref={modelPickerRef}>
                <button
                  type="button"
                  className={`composer-chip model-chip${modelOpen ? ' open' : ''}`}
                  disabled={!shellReady}
                  title="切换当前会话模型及思考强度"
                  aria-expanded={modelOpen}
                  onClick={() => {
                    if (!shellReady) return
                    setWsOpen(false)
                    setPolicyOpen(false)
                    setAttachOpen(false)
                    setModelOpen((v) => !v)
                  }}
                >
                  <span className="chip-label">{selectedModelLabel}</span>
                  <ChevronIcon up={modelOpen} />
                </button>

                {modelOpen && (
                  <div className="composer-menu model-menu" role="listbox">
                    {/* 下拉面板顶部：智能 / 思考强度调节区（对齐图 2） */}
                    {showReasoning && (
                      <div className="model-menu-reasoning-section">
                        <div className="model-menu-header">
                          <span>推理挡位</span>
                          <span className="model-menu-reasoning-val-badge">
                            {availableReasoningLevels[effortIndex]?.label ||
                              `Tier ${effortIndex}`}
                          </span>
                        </div>
                        <div
                          className="effort-pills"
                          role="radiogroup"
                          aria-label="思考强度"
                          title={
                            reasoningEffortUnverified
                              ? '仅影响当前会话；该服务商是否支持所有档位未经验证'
                              : '仅影响当前会话，不修改模型默认档位'
                          }
                        >
                          {availableReasoningLevels.map((lv, idx) => (
                            <button
                              key={lv.value}
                              type="button"
                              role="radio"
                              aria-checked={idx === effortIndex}
                              className={`effort-pill${idx === effortIndex ? ' is-active' : ''}`}
                              disabled={!shellReady || isGenerating}
                              onClick={() => onSwitchReasoningEffort(lv.value)}
                            >
                              {lv.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {showReasoning && (
                      <div className="composer-menu-divider" />
                    )}

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

            {extraActions}
            {isGenerating && canSubmit ? (
              <>
                <button
                  type="button"
                  className="composer-live-action"
                  title="本轮结束后发送 (Enter)"
                  onClick={handleSend}
                >
                  排队
                </button>
                <button
                  type="button"
                  className="composer-live-action"
                  title="立刻插进当前轮 (Ctrl+Enter)"
                  onClick={handleInterject}
                >
                  插话
                </button>
              </>
            ) : null}
            {isGenerating ? (
              <button
                type="button"
                className="btn-circle btn-stop active"
                title="停止生成"
                aria-label="停止生成"
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onCancel()
                }}
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                className={`btn-circle btn-send${canSubmit ? ' ready' : ''}`}
                disabled={!canSubmit}
                title="发送消息 (Enter)"
                aria-label="发送消息"
                onClick={handleSend}
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>

      {variant !== 'dock' ? (
        <div className="composer-below">
          <div className="composer-below-center">
            <p className="disclaimer-text">AI 可能会出错，请核对重要信息</p>
          </div>
        </div>
      ) : null}
    </footer>
  )
})
