import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from '@nanostores/react'
import { PlusIcon, SendIcon } from '../components/composerIcons'
import { DEMO_FOLDERS } from './model'
import { OFFICE_SLASH, slashHits } from './slash'
import { $officeFolderId, $officeFormat, openOfficePanel } from './store'

export function HomeDesk({
  draft,
  setDraft,
  onKey,
  onSubmit,
}: {
  draft: string
  setDraft: (v: string) => void
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (e: FormEvent) => void
}) {
  const folderId = useStore($officeFolderId)
  const currentFolder =
    folderId === 'none' ? null : (DEMO_FOLDERS.find((f) => f.id === folderId) ?? DEMO_FOLDERS[0])
  const hits = slashHits(draft)
  const [slashIx, setSlashIx] = useState(0)
  const [plusOpen, setPlusOpen] = useState(false)
  const plusRef = useRef<HTMLDivElement>(null)

  const closePlus = () => setPlusOpen(false)

  useEffect(() => {
    setSlashIx(0)
  }, [draft])

  useEffect(() => {
    if (!plusOpen) return
    const onDown = (e: MouseEvent) => {
      if (plusRef.current?.contains(e.target as Node)) return
      closePlus()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') closePlus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [plusOpen])

  const applySlash = (id: (typeof OFFICE_SLASH)[number]['id']) => {
    const hit = OFFICE_SLASH.find((s) => s.id === id)
    if (!hit) return
    $officeFormat.set(hit.format)
    setDraft(`/${hit.id} `)
    closePlus()
  }

  const onBoxKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (hits.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIx((i) => (i + 1) % hits.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIx((i) => (i - 1 + hits.length) % hits.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        applySlash(hits[slashIx]?.id ?? hits[0].id)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDraft('')
        return
      }
    }
    onKey(e)
  }

  return (
    <div className="od-desk is-home" role="main" aria-label="办公桌">
      <div className="od-home-stage is-blank">
        <form className="composer-container is-empty od-home-composer" onSubmit={onSubmit}>
          <p className="composer-hello">有什么要交的？</p>
          <div className="composer-card">
            {hits.length > 0 ? (
              <div className="composer-assist" role="listbox" aria-label="技能">
                <div className="composer-assist-group">技能</div>
                {hits.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={i === slashIx}
                    className={`composer-assist-item${i === slashIx ? ' is-active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applySlash(s.id)}
                  >
                    <span className="composer-assist-main">
                      <span className="composer-assist-label">/{s.id}</span>
                      <span className="composer-assist-kind">{s.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <textarea
              id="od-home-input"
              rows={2}
              value={draft}
              aria-label="交稿说明"
              placeholder="输入消息，或 / 选技能…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onBoxKey}
            />
            <div className="composer-toolbar">
              <div className="toolbar-left">
                <div className="composer-attach" ref={plusRef}>
                  <button
                    type="button"
                    className={`composer-attach-btn${plusOpen ? ' open' : ''}`}
                    aria-label="技能与材料"
                    aria-expanded={plusOpen}
                    aria-haspopup="menu"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setPlusOpen((open) => !open)
                    }}
                  >
                    <PlusIcon />
                  </button>
                  {plusOpen ? (
                    <div className="composer-menu attach-menu od-plus-root" role="menu">
                      <div className="od-plus-item">
                        <div className="composer-menu-item" role="menuitem" aria-haspopup="menu">
                          <span className="menu-item-body">
                            <span className="menu-item-title">材料夹文件</span>
                          </span>
                          <span className="menu-item-more" aria-hidden>
                            ›
                          </span>
                        </div>
                        <div className="composer-menu od-plus-flyout" role="menu">
                          {currentFolder ? (
                            currentFolder.files.map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                className="composer-menu-item"
                                onClick={() => {
                                  const pad = draft && !draft.endsWith(' ') ? ' ' : ''
                                  setDraft(`${draft}${pad}参考「${f.name}」`)
                                  closePlus()
                                }}
                              >
                                <span className="menu-item-body">
                                  <span className="menu-item-title">{f.name}</span>
                                  <span className="menu-item-sub">{f.size}</span>
                                </span>
                              </button>
                            ))
                          ) : (
                            <div className="composer-assist-empty">右侧栏选一个材料夹</div>
                          )}
                        </div>
                      </div>
                      <div className="od-plus-item">
                        <div className="composer-menu-item" role="menuitem" aria-haspopup="menu">
                          <span className="menu-item-body">
                            <span className="menu-item-title">技能</span>
                          </span>
                          <span className="menu-item-more" aria-hidden>
                            ›
                          </span>
                        </div>
                        <div className="composer-menu od-plus-flyout" role="menu">
                          {OFFICE_SLASH.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              className="composer-menu-item od-skill-hit"
                              onClick={() => applySlash(s.id)}
                            >
                              <span className="menu-item-body">
                                <span className="menu-item-title">{s.id}</span>
                                <span className="menu-item-sub">{s.hint}</span>
                              </span>
                              <span className="od-plus-tip">{s.blurb}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="composer-menu-divider" />
                      <button
                        type="button"
                        className="composer-menu-item"
                        onClick={() => {
                          closePlus()
                          openOfficePanel('connectors')
                        }}
                      >
                        <span className="menu-item-body">
                          <span className="menu-item-title">添加连接器</span>
                          <span className="menu-item-sub">演示未接</span>
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="toolbar-right">
                <button
                  type="submit"
                  className={`btn-circle btn-send${draft.trim() ? ' ready' : ''}`}
                  disabled={!draft.trim()}
                  aria-label="发送"
                  title="发送"
                >
                  <SendIcon />
                </button>
              </div>
            </div>
          </div>
          <p className="disclaimer-text">演示预览，还不接引擎</p>
        </form>
      </div>
    </div>
  )
}
