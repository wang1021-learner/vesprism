/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ToolCallData, ToolDiffData } from '../types'

const WIDTH_STORAGE_KEY = 'jike-side-panel-width'
const DEFAULT_WIDTH = 480
const MIN_WIDTH = 320
const MAX_WIDTH_RATIO = 0.72
const MAX_TABS = 12

export type SidePanelPayload =
  | {
      type: 'artifact'
      language: 'html' | 'svg'
      code: string
      title?: string
    }
  | {
      type: 'diff'
      title?: string
      diffs: ToolDiffData[]
      fallbackText?: string
      toolCallId?: string
    }
  | {
      type: 'tool-output'
      title?: string
      text: string
      kind?: string
      toolCallId?: string
    }

export type SidePanelTab = {
  id: string
  key: string
  payload: SidePanelPayload
  createdAt: number
}

interface SidePanelContextValue {
  open: boolean
  tabs: SidePanelTab[]
  activeTabId: string | null
  payload: SidePanelPayload | null
  width: number
  setWidth: (w: number) => void
  workspaceRoot: string
  openPanel: (payload: SidePanelPayload, key?: string) => void
  selectTab: (id: string) => void
  closeTab: (id: string) => void
  closePanel: () => void
  togglePanel: () => void
  showPanel: () => void
  openArtifact: (language: 'html' | 'svg', code: string, title?: string) => void
  openToolDiff: (tool: ToolCallData) => void
  openToolOutput: (tool: ToolCallData) => void
  openToolPanel: (tool: ToolCallData) => void
}

const SidePanelContext = createContext<SidePanelContextValue | null>(null)

function loadStoredWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
    if (!raw) return DEFAULT_WIDTH
    const n = Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_WIDTH
    return clampWidth(n)
  } catch {
    return DEFAULT_WIDTH
  }
}

function clampWidth(w: number): number {
  const max = Math.max(MIN_WIDTH, Math.floor(window.innerWidth * MAX_WIDTH_RATIO))
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(w)))
}

function newTabId(): string {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function hashShort(s: string): string {
  let h = 0
  const slice = s.slice(0, 200)
  for (let i = 0; i < slice.length; i++) {
    h = (h * 31 + slice.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

function defaultKey(payload: SidePanelPayload, explicit?: string): string {
  if (explicit) return explicit
  switch (payload.type) {
    case 'artifact':
      return `artifact:${payload.title || payload.language}:${hashShort(payload.code)}`
    case 'diff':
      return payload.toolCallId
        ? `diff:${payload.toolCallId}`
        : `diff:${payload.title || 'file'}:${hashShort(payload.fallbackText || payload.diffs[0]?.newText || '')}`
    case 'tool-output':
      return payload.toolCallId
        ? `output:${payload.toolCallId}`
        : `output:${payload.title || 'out'}:${hashShort(payload.text)}`
  }
}

function kindTitle(kind: string): string {
  switch (kind) {
    case 'edit':
      return '编辑'
    case 'execute':
      return '终端输出'
    case 'read':
      return '读取'
    default:
      return '工具输出'
  }
}

function fileBase(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const parts = norm.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

export function SidePanelProvider({
  children,
  workspaceRoot,
}: {
  children: ReactNode
  workspaceRoot: string
}) {
  const [open, setOpen] = useState(false)
  const [tabs, setTabs] = useState<SidePanelTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [width, setWidthState] = useState(loadStoredWidth)

  const setWidth = useCallback((w: number) => {
    const next = clampWidth(w)
    setWidthState(next)
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(next))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const onResize = () => setWidthState((prev) => clampWidth(prev))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const openPanel = useCallback((payload: SidePanelPayload, key?: string) => {
    const tabKey = defaultKey(payload, key)
    // React 会同步执行 updater，因此 nextActiveId 在 setTabs 返回后可用
    let nextActiveId: string | null = null

    setTabs((prev) => {
      const existing = prev.find((t) => t.key === tabKey)
      if (existing) {
        nextActiveId = existing.id
        return prev.map((t) =>
          t.id === existing.id
            ? { ...t, payload, createdAt: Date.now() }
            : t,
        )
      }
      const tab: SidePanelTab = {
        id: newTabId(),
        key: tabKey,
        payload,
        createdAt: Date.now(),
      }
      nextActiveId = tab.id
      const next = [...prev, tab]
      if (next.length <= MAX_TABS) return next
      const sorted = [...next].sort((a, b) => a.createdAt - b.createdAt)
      const dropId = sorted.find((t) => t.id !== tab.id)?.id
      return dropId ? next.filter((t) => t.id !== dropId) : next.slice(-MAX_TABS)
    })

    if (nextActiveId) setActiveTabId(nextActiveId)
    setOpen(true)
  }, [])

  const selectTab = useCallback((id: string) => {
    setActiveTabId(id)
    setOpen(true)
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx < 0) return prev
      const next = prev.filter((t) => t.id !== id)
      setActiveTabId((cur) => {
        if (cur !== id) return cur
        if (next.length === 0) return null
        return next[Math.min(idx, next.length - 1)].id
      })
      return next
    })
  }, [])

  const closePanel = useCallback(() => setOpen(false), [])
  const showPanel = useCallback(() => setOpen(true), [])
  const togglePanel = useCallback(() => setOpen((v) => !v), [])

  const openArtifact = useCallback(
    (language: 'html' | 'svg', code: string, title?: string) => {
      const pathTitle = title?.trim()
      openPanel(
        {
          type: 'artifact',
          language,
          code,
          title: pathTitle || language.toUpperCase(),
        },
        pathTitle ? `artifact:file:${pathTitle}` : undefined,
      )
    },
    [openPanel],
  )

  const openToolDiff = useCallback(
    (tool: ToolCallData) => {
      const diffs = tool.diffs?.filter((d) => d.path || d.newText) ?? []
      const preview = tool.preview?.trim() ?? ''
      const title =
        (diffs[0] && fileBase(diffs[0].path)) ||
        fileBase(tool.detail || '') ||
        tool.title ||
        '变更'

      openPanel(
        {
          type: 'diff',
          title,
          diffs,
          fallbackText:
            preview ||
            (diffs.length === 0
              ? `(暂无 diff 正文)\n路径: ${tool.detail || tool.title || '—'}`
              : undefined),
          toolCallId: tool.toolCallId,
        },
        `diff:${tool.toolCallId}`,
      )
    },
    [openPanel],
  )

  const openToolOutput = useCallback(
    (tool: ToolCallData) => {
      const preview = tool.preview?.trim() ?? ''
      openPanel(
        {
          type: 'tool-output',
          title: tool.detail || tool.title || kindTitle(tool.kind),
          text: preview || tool.detail || tool.title || '(无输出)',
          kind: tool.kind,
          toolCallId: tool.toolCallId,
        },
        `output:${tool.toolCallId}`,
      )
    },
    [openPanel],
  )

  const openToolPanel = useCallback(
    (tool: ToolCallData) => {
      const hasStruct = (tool.diffs?.length ?? 0) > 0
      const preview = tool.preview?.trim() ?? ''
      const looksDiff =
        hasStruct ||
        preview.startsWith('diff ') ||
        /^(?:[+-]|@@)/m.test(preview)
      if (looksDiff || tool.kind === 'edit') openToolDiff(tool)
      else openToolOutput(tool)
    },
    [openToolDiff, openToolOutput],
  )

  // 对齐 activeTabId
  useEffect(() => {
    if (tabs.length === 0) {
      if (activeTabId !== null) setActiveTabId(null)
      return
    }
    if (!tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[tabs.length - 1].id)
    }
  }, [tabs, activeTabId])

  const activeTab =
    tabs.find((t) => t.id === activeTabId) ??
    (tabs.length > 0 ? tabs[tabs.length - 1] : null)
  const payload = activeTab?.payload ?? null

  const value = useMemo<SidePanelContextValue>(
    () => ({
      open,
      tabs,
      activeTabId: activeTab?.id ?? null,
      payload,
      width,
      setWidth,
      workspaceRoot,
      openPanel,
      selectTab,
      closeTab,
      closePanel,
      togglePanel,
      showPanel,
      openArtifact,
      openToolDiff,
      openToolOutput,
      openToolPanel,
    }),
    [
      open,
      tabs,
      activeTab,
      payload,
      width,
      setWidth,
      workspaceRoot,
      openPanel,
      selectTab,
      closeTab,
      closePanel,
      togglePanel,
      showPanel,
      openArtifact,
      openToolDiff,
      openToolOutput,
      openToolPanel,
    ],
  )

  return (
    <SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>
  )
}

export function useSidePanel() {
  const ctx = useContext(SidePanelContext)
  if (!ctx) throw new Error('useSidePanel must be used within SidePanelProvider')
  return ctx
}

export const useArtifact = useSidePanel
