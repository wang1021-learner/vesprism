/**
 * Composer @ / 补全：
 * `/goal` 长程规划前缀 · `/sandbox` 本会话沙箱策略
 * `@` 插入当前工作区文件 / 其它 Tab 标题
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  $activeTabId,
  $sessionPolicyOverride,
  $tabs,
  $workspaceCwd,
  getTabState,
  pushToast,
} from '../store'
import { enableTabSandbox, listDir, restartSession } from '../bridge'

type Item = { id: string; label: string; hint: string; insert: string; run?: () => void }

const SLASH: Item[] = [
  {
    id: 'goal',
    label: '/goal',
    hint: '长程规划：先拆目标再执行',
    insert: '/goal ',
    run: undefined,
  },
  {
    id: 'sandbox',
    label: '/sandbox',
    hint: '本会话把文件改动写到 git 副本目录（不是进程沙箱）',
    insert: '',
    run: () => {
      const tabId = $activeTabId.get()
      const cwd = $workspaceCwd.get()
      $sessionPolicyOverride.set('proceed-in-sandbox')
      void (async () => {
        try {
          if (tabId) await enableTabSandbox(tabId)
          if (tabId && cwd) {
            const st = getTabState(tabId)
            await restartSession(tabId, cwd, {
              modelId: st?.modelId,
              reasoningEffort: st?.reasoningEffort,
            })
          }
          pushToast('本会话文件改动将写入 git 副本，不会动原仓库（命令仍用系统权限）', 'info')
        } catch (e) {
          pushToast(`无法启动工作区副本：${String(e)}`, 'error')
        }
      })()
    },
  },
]

export function useComposerAssist(
  input: string,
  setInput: (v: string) => void,
  cwd: string,
  opts?: { enableSlash?: boolean },
) {
  const enableSlash = opts?.enableSlash !== false
  const [files, setFiles] = useState<string[]>([])
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
    if (mode !== 'at' || !cwd) return
    let alive = true
    listDir(cwd)
      .then((ents) => {
        if (alive) setFiles(ents.slice(0, 40).map((e) => e.name + (e.is_dir ? '/' : '')))
      })
      .catch(() => {
        if (alive) setFiles([])
      })
    return () => {
      alive = false
    }
  }, [mode, cwd])

  const items: Item[] = useMemo(() => {
    if (mode === 'slash') {
      return SLASH.filter((x) => x.label.slice(1).startsWith(query) || query === '')
    }
    if (mode === 'at') {
      const tabs = $tabs.get().map((t) => ({
        id: `tab-${t.id}`,
        label: `@${(t.title || '新对话').trim() || '新对话'}`,
        hint: '其它会话',
        insert: `@tab:${t.id} `,
      }))
      const fileItems = files
        .filter((n) => !query || n.toLowerCase().includes(query))
        .slice(0, 12)
        .map((n) => ({
          id: `f-${n}`,
          label: `@${n}`,
          hint: n.endsWith('/') ? '目录' : '文件',
          insert: `@${n} `,
        }))
      return [...fileItems, ...tabs].filter((x) => !query || x.label.toLowerCase().includes(query))
    }
    return []
  }, [mode, query, files])

  useEffect(() => {
    setActive(0)
  }, [mode, query])

  const apply = (item: Item) => {
    if (item.run) {
      item.run()
      setInput('')
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
            <span className="composer-assist-label">{it.label}</span>
            <span className="composer-assist-hint">{it.hint}</span>
          </button>
        ))}
      </div>
    ) : null

  return { onKeyDown, menu }
}
