/**
 * Composer / 与 @ 补全：
 * `/` 以官方 commands/list 为唯一源；仅补桌面独有入口（sandbox/rewind/find 等）
 * `@` 工作区文件搜索，选中变成附件芯片
 */
import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  $activeTabId,
  $sessionPhase,
  $tabs,
  openFeedback,
  openRewind,
  openSessionIntent,
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
import { signOutAccount, startAccountLogin } from '../lib/accountAuth'
import { openChatFind, openSessionInsight, openSessionSchedule, requestRecap, sendEngineSlashToast } from '../lib/engineSlash'
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

/** 仅桌面壳有的入口。官方已有的同名斜杠以 list_session_commands 为准，这里补不上。 */
const LOCAL_SLASH: Item[] = [
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
  localCommand('ask', {
    insert: '',
    run: () => {
      void toggleAskMode()
    },
  }),
  localCommand('view-plan', { insert: '', run: () => openPlanPreview() }),
  localCommand('show-plan', { insert: '', run: () => openPlanPreview() }),
  localCommand('plan-view', { insert: '', run: () => openPlanPreview() }),
  localCommand('usage', { insert: '', run: () => openSessionInsight() }),
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
  localCommand('workflows', {
    insert: '',
    run: () => {
      void openChatTab({ title: '自动化任务', utilityKind: 'workflows' })
    },
  }),
  localCommand('login', {
    insert: '',
    run: () => {
      openSettings('general')
      void startAccountLogin()
    },
  }),
  localCommand('logout', {
    insert: '',
    run: () => {
      void signOutAccount()
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
    name === 'context' ||
    name === 'usage' ||
    name === 'session-info' ||
    name === 'status' ||
    name === 'info' ||
    name === 'compact-mode'
  ) {
    return open(() => openSessionInsight())
  }
  if (name === 'always-approve' || name === 'yolo') {
    return open(() => {
      void sendEngineSlashToast('/always-approve', '本会话不再弹出工具审批')
    })
  }
  if (
    name === 'hooks-list' ||
    name === 'hooks-trust' ||
    name === 'hooks-untrust' ||
    name === 'reload-plugins'
  ) {
    return open(() => {
      const ok =
        name === 'hooks-list'
          ? '正在列出 Hooks'
          : name === 'hooks-trust'
            ? '已请求信任本仓库 Hooks'
            : name === 'hooks-untrust'
              ? '已请求取消 Hooks 信任'
              : '已请求重载插件'
      void sendEngineSlashToast(`/${name}`, ok)
    })
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
  if (name === 'login') {
    return open(() => {
      openSettings('general')
      void startAccountLogin()
    })
  }
  if (name === 'logout') {
    return open(() => {
      void signOutAccount()
    })
  }
  if (name === 'feedback') {
    return open(() => openFeedback())
  }
  if (name === 'goal') {
    return open(() => openSessionIntent('goal'))
  }
  if (name === 'deep-research') {
    return open(() => openSessionIntent('research'))
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
      void sendEngineSlashToast('/flush', '正在把对话记忆写入磁盘')
    })
  }
  if (name === 'dream') {
    return open(() => {
      void sendEngineSlashToast('/dream', '正在整理记忆')
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
      const nextGroups = groupComposerCommands(filtered).map((g) => ({
        key: g.kind,
        label: COMPOSER_KIND_LABEL[g.kind],
        items: g.items,
      }))
      return { items: nextGroups.flatMap((g) => g.items), groups: nextGroups }
    }
    if (mode === 'at') {
      const q = query.trim().toLowerCase()
      const match = (label: string) => !q || label.toLowerCase().includes(q)
      const fileItems: Item[] = files
        .filter((f) => match(f.rel) || match(`@${f.rel}`))
        .map((f) => ({
          id: `f-${f.path}`,
          label: `@${f.rel}`,
          hint: f.is_dir ? '目录' : '文件',
          insert: `@${f.rel} `,
          run: () => {
            opts?.onAttachPath?.(f.path, attachKindFromPath(f.path, f.is_dir))
          },
        }))
      const tabItems: Item[] = $tabs
        .get()
        .filter((t) => match(t.title || '新对话') || match(t.id))
        .map((t) => ({
          id: `tab-${t.id}`,
          label: `@${(t.title || '新对话').trim() || '新对话'}`,
          hint: '其它会话',
          insert: `@tab:${t.id} `,
        }))
      const nextGroups = [
        { key: 'file', label: '文件', items: fileItems },
        { key: 'session', label: '其它会话', items: tabItems },
      ].filter((g) => g.items.length > 0)
      return { items: nextGroups.flatMap((g) => g.items), groups: nextGroups }
    }
    return { items: [], groups: [] as { key: string; label: string; items: Item[] }[] }
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
    if (!mode) return false
    if (items.length === 0) {
      if (e.key === 'Escape' && mode === 'slash') {
        e.preventDefault()
        setInput('')
        return true
      }
      return false
    }
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
    mode === 'slash' || mode === 'at' ? (
      <div className="composer-assist" role="listbox">
        {items.length === 0 ? (
          <div className="composer-assist-empty">
            {mode === 'slash'
              ? query
                ? `没有匹配「/${query}」`
                : '还没有可用命令'
              : query
                ? `没有匹配「@${query}」的文件或会话`
                : '没有可引用的文件或会话'}
          </div>
        ) : (
          groups.map((g) => {
            const start = items.indexOf(g.items[0])
            return (
              <div key={g.key} className="composer-assist-section">
                <div className="composer-assist-group" role="presentation">
                  {g.label}
                </div>
                {g.items.map((it, j) => renderItem(it, start + j))}
              </div>
            )
          })
        )}
      </div>
    ) : null

  return { onKeyDown, menu, openSlash: () => setInput('/'), openAt: () => setInput(input ? `${input.replace(/\s+$/, '')} @` : '@') }
}
