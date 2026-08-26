/**
 * Composer / 与 @ 补全：
 * `/` 官方斜杠目录（命令 / 技能 / 工作流，分类和说明跟设置页对齐）+ 本地 sandbox/rewind
 * `@` 工作区文件搜索，选中变成附件芯片
 */
import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  $activeTabId,
  $sessionPhase,
  $tabs,
  openRewind,
  openSettings,
} from '../store'
import { listSessionCommands, searchWorkspaceFiles } from '../bridge'
import {
  COMPOSER_KIND_LABEL,
  collapseSlashAliases,
  filterComposerCommands,
  groupComposerCommands,
  mergeComposerCommands,
  parseOfficialCommands,
  type ComposerCommand,
} from '../lib/composerCommands'
import { zhCommandPurpose } from '../lib/toolChinese'
import { attachKindFromPath, enableSessionSandbox } from '../lib/sessionSandbox'
import { openPlanPreview, toggleAskMode } from '../lib/planMode'
import { openChatFind, openSessionInsight, openSessionSchedule, requestRecap, sendEngineSlash } from '../lib/engineSlash'
import { openChatTab } from '../lib/openChatTab'

type Item = ComposerCommand

function localCommand(
  id: string,
  rest: Pick<Item, 'insert' | 'run'>,
): Item {
  return {
    id,
    label: `/${id}`,
    hint: zhCommandPurpose(id) || id,
    kind: 'command',
    insert: rest.insert,
    run: rest.run,
  }
}

const LOCAL_SLASH: Item[] = [
  localCommand('goal', { insert: '/goal ' }),
  localCommand('sandbox', {
    insert: '',
    run: () => {
      void enableSessionSandbox()
    },
  }),
  localCommand('rewind', {
    insert: '',
    run: () => {
      const tabId = $activeTabId.get()
      if (tabId) openRewind(tabId)
    },
  }),
  localCommand('plan', { insert: '/plan ' }),
  localCommand('ask', {
    insert: '',
    run: () => {
      void toggleAskMode()
    },
  }),
  localCommand('view-plan', { insert: '', run: () => openPlanPreview() }),
  localCommand('show-plan', { insert: '', run: () => openPlanPreview() }),
  localCommand('plan-view', { insert: '', run: () => openPlanPreview() }),
  localCommand('compact', { insert: '', run: () => openSessionInsight() }),
  localCommand('context', { insert: '', run: () => openSessionInsight() }),
  localCommand('usage', { insert: '', run: () => openSessionInsight() }),
  localCommand('session-info', { insert: '', run: () => openSessionInsight() }),
  localCommand('flush', {
    insert: '',
    run: () => {
      void sendEngineSlash('/flush')
    },
  }),
  localCommand('dream', {
    insert: '',
    run: () => {
      void sendEngineSlash('/dream')
    },
  }),
  localCommand('memory', {
    insert: '',
    run: () => {
      openSettings('memory')
    },
  }),
  localCommand('loop', { insert: '', run: () => openSessionSchedule() }),
  localCommand('recap', {
    insert: '',
    run: () => {
      void requestRecap()
    },
  }),
  localCommand('find', { insert: '', run: () => openChatFind() }),
  localCommand('skills', {
    insert: '',
    run: () => {
      openSettings('skills')
    },
  }),
  localCommand('tools', {
    insert: '',
    run: () => {
      openSettings('tools')
    },
  }),
  localCommand('mcp', {
    insert: '',
    run: () => {
      openSettings('mcp')
    },
  }),
  localCommand('plugins', {
    insert: '',
    run: () => {
      openSettings('plugins')
    },
  }),
  localCommand('workflows', {
    insert: '',
    run: () => {
      void openChatTab({ title: '自动化任务', utilityKind: 'workflows' })
    },
  }),
]

function bindComposerCommand(c: ComposerCommand): ComposerCommand {
  if (c.kind && c.kind !== 'command') return c
  const name = c.label.slice(1).toLowerCase()
  const open = (run: () => void): ComposerCommand => ({ ...c, insert: '', run })
  if (name === 'view-plan' || name === 'show-plan' || name === 'plan-view') {
    return open(() => openPlanPreview())
  }
  if (
    name === 'compact' ||
    name === 'context' ||
    name === 'usage' ||
    name === 'session-info' ||
    name === 'status' ||
    name === 'info' ||
    name === 'compact-mode'
  ) {
    return open(() => openSessionInsight())
  }
  if (name === 'memory') {
    return open(() => openSettings('memory'))
  }
  if (name === 'skills') {
    return open(() => openSettings('skills'))
  }
  if (name === 'tools') {
    return open(() => openSettings('tools'))
  }
  if (name === 'mcp') {
    return open(() => openSettings('mcp'))
  }
  if (name === 'plugins' || name === 'marketplace') {
    return open(() => openSettings('plugins'))
  }
  if (name === 'workflows') {
    return open(() => {
      void openChatTab({ title: '自动化任务', utilityKind: 'workflows' })
    })
  }
  if (name === 'loop') {
    return open(() => openSessionSchedule())
  }
  if (name === 'ask') {
    return open(() => void toggleAskMode())
  }
  if (name === 'recap' || name === 'summarize') {
    return open(() => void requestRecap())
  }
  if (name === 'find') {
    return open(() => openChatFind())
  }
  if (name === 'sandbox') {
    return open(() => {
      void enableSessionSandbox()
    })
  }
  if (name === 'rewind') {
    return open(() => {
      const id = $activeTabId.get()
      if (id) openRewind(id)
    })
  }
  if (name === 'flush') {
    return open(() => {
      void sendEngineSlash('/flush')
    })
  }
  if (name === 'dream') {
    return open(() => {
      void sendEngineSlash('/dream')
    })
  }
  return c
}

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
  const tabId = useStore($activeTabId)
  const phase = useStore($sessionPhase)
  const [files, setFiles] = useState<
    Array<{ path: string; rel: string; is_dir: boolean }>
  >([])
  const [official, setOfficial] = useState<Item[]>([])
  const [active, setActive] = useState(0)
  const activeRef = useRef<HTMLButtonElement>(null)

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
    if (!tabId || phase !== 'ready') return
    let alive = true
    listSessionCommands(tabId, cwd || undefined)
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
  }, [enableSlash, cwd, tabId, phase])

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

  const { items, groups } = useMemo(() => {
    if (mode === 'slash') {
      const filtered = collapseSlashAliases(
        filterComposerCommands(
          mergeComposerCommands(official, LOCAL_SLASH).map(bindComposerCommand),
          query,
        ),
        query,
      )
      const nextGroups = groupComposerCommands(filtered)
      return { items: nextGroups.flatMap((g) => g.items), groups: nextGroups }
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
      const atItems = [...fileItems, ...tabs].filter(
        (x) => !query || x.label.toLowerCase().includes(query),
      )
      return { items: atItems, groups: [] }
    }
    return { items: [], groups: [] }
  }, [mode, query, files, official, opts?.onAttachPath])

  useEffect(() => {
    setActive(0)
  }, [mode, query])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active, items])

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

  const renderItem = (it: Item, i: number) => (
    <button
      key={it.id}
      type="button"
      ref={i === active ? activeRef : undefined}
      className={`composer-assist-item${i === active ? ' is-active' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault()
        apply(it)
      }}
    >
      <span className="composer-assist-main">
        <span className="composer-assist-label">{it.label}</span>
        {it.displayName ? (
          <span className="composer-assist-aka">{it.displayName}</span>
        ) : null}
        {it.kind && it.kind !== 'command' ? (
          <span className="composer-assist-kind">
            {it.sourceLabel || COMPOSER_KIND_LABEL[it.kind]}
          </span>
        ) : null}
      </span>
      <span className="composer-assist-hint">{it.hint}</span>
    </button>
  )

  const menu =
    mode === 'slash' ? (
      <div className="composer-assist" role="listbox">
        {items.length === 0 ? (
          <div className="composer-assist-empty">
            {query ? `没有匹配「/${query}」` : '还没有可用命令'}
          </div>
        ) : (
          groups.map((g) => {
            const start = items.indexOf(g.items[0])
            return (
              <div key={g.kind} className="composer-assist-section">
                <div className="composer-assist-group" role="presentation">
                  {COMPOSER_KIND_LABEL[g.kind]}
                </div>
                {g.items.map((it, j) => renderItem(it, start + j))}
              </div>
            )
          })
        )}
      </div>
    ) : mode === 'at' && items.length > 0 ? (
      <div className="composer-assist" role="listbox">
        {items.map((it, i) => renderItem(it, i))}
      </div>
    ) : null

  return { onKeyDown, menu, openSlash: () => setInput('/'), openAt: () => setInput(input ? `${input.replace(/\s+$/, '')} @` : '@') }
}
