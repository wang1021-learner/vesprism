/**
 * Composer / 与 @ 补全：
 * `/` 官方斜杠目录 + 本地 sandbox/rewind
 * `@` 工作区文件搜索，选中变成附件芯片
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  $activeTabId,
  $tabs,
  openRewind,
  getTabState,
} from '../store'
import { listSessionCommands, searchWorkspaceFiles } from '../bridge'
import { openChatTab } from '../lib/openChatTab'
import {
  filterComposerCommands,
  mergeComposerCommands,
  parseOfficialCommands,
  type ComposerCommand,
} from '../lib/composerCommands'
import { attachKindFromPath, enableSessionSandbox } from '../lib/sessionSandbox'
import { openPlanPreview } from '../lib/planMode'
import { openSessionInsight, openSessionSchedule, sendEngineSlash } from '../lib/engineSlash'

type Item = ComposerCommand

const LOCAL_SLASH: Item[] = [
  {
    id: 'goal',
    label: '/goal',
    hint: '长程规划：先拆目标再执行',
    insert: '/goal ',
  },
  {
    id: 'sandbox',
    label: '/sandbox',
    hint: '本会话把文件改动写到 git 副本目录（不是进程沙箱）',
    insert: '',
    run: () => {
      void enableSessionSandbox()
    },
  },
  {
    id: 'rewind',
    label: '/rewind',
    hint: '回滚会话到某条提问之前',
    insert: '',
    run: () => {
      const tabId = $activeTabId.get()
      if (tabId) openRewind(tabId)
    },
  },
  {
    id: 'plan',
    label: '/plan',
    hint: '只读规划，先出方案再改代码',
    insert: '/plan ',
  },
  {
    id: 'view-plan',
    label: '/view-plan',
    hint: '打开最近一份计划稿',
    insert: '',
    run: () => openPlanPreview(),
  },
  {
    id: 'show-plan',
    label: '/show-plan',
    hint: '打开最近一份计划稿',
    insert: '',
    run: () => openPlanPreview(),
  },
  {
    id: 'plan-view',
    label: '/plan-view',
    hint: '打开最近一份计划稿',
    insert: '',
    run: () => openPlanPreview(),
  },
  {
    id: 'compact',
    label: '/compact',
    hint: '压缩上下文，腾出空间',
    insert: '',
    run: () => openSessionInsight(),
  },
  {
    id: 'context',
    label: '/context',
    hint: '查看上下文拆分',
    insert: '',
    run: () => openSessionInsight(),
  },
  {
    id: 'usage',
    label: '/usage',
    hint: '查看本会话用量',
    insert: '',
    run: () => openSessionInsight(),
  },
  {
    id: 'session-info',
    label: '/session-info',
    hint: '会话详情',
    insert: '',
    run: () => openSessionInsight(),
  },
  {
    id: 'flush',
    label: '/flush',
    hint: '立刻把本会话写入记忆',
    insert: '',
    run: () => {
      void sendEngineSlash('/flush')
    },
  },
  {
    id: 'dream',
    label: '/dream',
    hint: '整理记忆日志',
    insert: '',
    run: () => {
      void sendEngineSlash('/dream')
    },
  },
  {
    id: 'memory',
    label: '/memory',
    hint: '打开记忆面板',
    insert: '',
    run: () => {
      void openChatTab({ title: '记忆', utilityKind: 'memory' })
    },
  },
  {
    id: 'loop',
    label: '/loop',
    hint: '按间隔反复执行同一条指令',
    insert: '',
    run: () => openSessionSchedule(),
  },
]

export function useComposerAssist(
  input: string,
  setInput: (v: string) => void,
  cwd: string,
  opts?: {
    enableSlash?: boolean
    onAttachPath?: (path: string, kind: 'file' | 'folder' | 'image') => void
  },
) {
  const enableSlash = opts?.enableSlash !== false
  const [files, setFiles] = useState<
    Array<{ path: string; rel: string; is_dir: boolean }>
  >([])
  const [official, setOfficial] = useState<Item[]>([])
  const [active, setActive] = useState(0)

  const mode = useMemo(() => {
    if (enableSlash && /^\/[^\s]*$/.test(input)) return 'slash' as const
    const at = input.lastIndexOf('@')
    if (at >= 0 && !input.slice(at).includes(' ')) return 'at' as const
    return null
  }, [input, enableSlash])

  const query = useMemo(() => {
    if (mode === 'slash') return input.slice(1).toLowerCase()
    if (mode === 'at') return input.slice(input.lastIndexOf('@') + 1).toLowerCase()
    return ''
  }, [input, mode])

  useEffect(() => {
    if (!enableSlash) return
    const tabId = $activeTabId.get()
    if (!tabId || getTabState(tabId)?.phase !== 'ready') return
    let alive = true
    listSessionCommands(tabId)
      .then((resp) => {
        if (!alive) return
        setOfficial(parseOfficialCommands(resp?.commands))
      })
      .catch(() => {
        if (alive) setOfficial([])
      })
    return () => {
      alive = false
    }
  }, [enableSlash, cwd])

  useEffect(() => {
    if (mode !== 'at' || !cwd) return
    let alive = true
    const t = window.setTimeout(() => {
      searchWorkspaceFiles(cwd, query, 24)
        .then((hits) => {
          if (alive) setFiles(Array.isArray(hits) ? hits : [])
        })
        .catch(() => {
          if (alive) setFiles([])
        })
    }, 120)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [mode, cwd, query])

  const items: Item[] = useMemo(() => {
    if (mode === 'slash') {
      return filterComposerCommands(
        mergeComposerCommands(official, LOCAL_SLASH).map((c) => {
          const name = c.label.slice(1).toLowerCase()
          if (name === 'view-plan' || name === 'show-plan' || name === 'plan-view') {
            return { ...c, insert: '', run: () => openPlanPreview() }
          }
          if (
            name === 'compact' ||
            name === 'context' ||
            name === 'usage' ||
            name === 'session-info' ||
            name === 'status' ||
            name === 'info'
          ) {
            return { ...c, insert: '', run: () => openSessionInsight() }
          }
          if (name === 'memory') {
            return {
              ...c,
              insert: '',
              run: () => {
                void openChatTab({ title: '记忆', utilityKind: 'memory' })
              },
            }
          }
          if (name === 'plugins' || name === 'marketplace') {
            return {
              ...c,
              insert: '',
              run: () => {
                void openChatTab({ title: '插件', utilityKind: 'plugins' })
              },
            }
          }
          if (name === 'loop') {
            return { ...c, insert: '', run: () => openSessionSchedule() }
          }
          return c
        }),
        query,
      )
    }
    if (mode === 'at') {
      const tabs = $tabs.get().map((t) => ({
        id: `tab-${t.id}`,
        label: `@${(t.title || '新对话').trim() || '新对话'}`,
        hint: '其它会话',
        insert: `@tab:${t.id} `,
      }))
      const fileItems = files.map((f) => ({
        id: `f-${f.path}`,
        label: `@${f.rel}`,
        hint: f.is_dir ? '目录' : '文件',
        insert: `@${f.rel} `,
        run: () => {
          opts?.onAttachPath?.(f.path, attachKindFromPath(f.path, f.is_dir))
        },
      }))
      return [...fileItems, ...tabs].filter(
        (x) => !query || x.label.toLowerCase().includes(query),
      )
    }
    return []
  }, [mode, query, files, official, opts?.onAttachPath])

  useEffect(() => {
    setActive(0)
  }, [mode, query])

  const apply = (item: Item) => {
    if (item.run) {
      item.run()
      if (mode === 'slash') {
        setInput('')
        return
      }
      const at = input.lastIndexOf('@')
      setInput(at >= 0 ? input.slice(0, at) : input)
      return
    }
    if (mode === 'slash') {
      setInput(item.insert)
      return
    }
    const at = input.lastIndexOf('@')
    setInput(input.slice(0, at) + item.insert)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.nativeEvent.isComposing || (e as unknown as { keyCode?: number }).keyCode === 229) {
      return false
    }
    if (!mode || items.length === 0) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % items.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + items.length) % items.length)
      return true
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      apply(items[active] || items[0])
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      if (mode === 'slash') setInput('')
      return true
    }
    return false
  }

  const menu =
    mode && items.length > 0 ? (
      <div className="composer-assist" role="listbox">
        {items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            className={`composer-assist-item${i === active ? ' is-active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault()
              apply(it)
            }}
          >
            <span className="composer-assist-main">
              <span className="composer-assist-label">{it.label}</span>
              {it.kind && it.kind !== 'command' ? (
                <span className="composer-assist-kind">
                  {it.kind === 'skill' ? '技能' : '工作流'}
                </span>
              ) : null}
            </span>
            <span className="composer-assist-hint">{it.hint}</span>
          </button>
        ))}
      </div>
    ) : null

  return { onKeyDown, menu, openSlash: () => setInput('/'), openAt: () => setInput(input ? `${input.replace(/\s+$/, '')} @` : '@') }
}
