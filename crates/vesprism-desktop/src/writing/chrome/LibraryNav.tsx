import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { isTauriRuntime } from '../../bridge'
import { openChatTab } from '../../lib/openChatTab'
import { pushToast } from '../../store'
import { writingExportBook } from '../storage'
import {
  $writingLoaded,
  $writingOpenId,
  $writingShelf,
  bootWritingLibrary,
  createWritingBook,
  deleteWritingBook,
  selectWritingBook,
} from '../library'

async function ensureDesk() {
  await openChatTab({ title: '写台', utilityKind: 'writing-desk' })
}

export function WritingLibraryNav() {
  const books = useStore($writingShelf)
  const loaded = useStore($writingLoaded)
  const openId = useStore($writingOpenId)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState('')
  const [logline, setLogline] = useState('')
  const filled = [title, platform, logline].map((s) => Boolean(s.trim()))
  const ready = filled.every(Boolean)
  const missing = !filled[0] ? '还差书名' : !filled[1] ? '还差平台' : !filled[2] ? '还差卖点' : ''

  useEffect(() => {
    void bootWritingLibrary()
  }, [])

  return (
    <div className="wd-lib" aria-label="书库">
      <div className="sidebar-section-label">
        <span>书</span>
        <button
          type="button"
          className="sidebar-section-add"
          title={creating ? '收起' : '新建一本'}
          aria-label={creating ? '收起新建' : '新建一本'}
          aria-expanded={creating}
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? '×' : '+'}
        </button>
      </div>
      {creating ? (
        <form
          className="wd-lib-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!ready) return
            createWritingBook({
              title: title.trim(),
              platform: platform.trim(),
              logline: logline.trim(),
            })
            setTitle('')
            setPlatform('')
            setLogline('')
            setCreating(false)
            void ensureDesk()
          }}
        >
          <div className="wd-lib-form-head">
            <span>三问</span>
            <span className="wd-lib-ticks" aria-hidden>
              {filled.map((on, i) => (
                <i key={i} className={`wd-lib-tick${on ? ' is-on' : ''}`} />
              ))}
            </span>
          </div>
          <label className="wd-lib-field">
            <span className="wd-lib-lab">书名</span>
            <input
              className="wd-lib-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="wd-lib-field">
            <span className="wd-lib-lab">平台</span>
            <input
              className="wd-lib-input"
              placeholder="番茄 / 起点"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="wd-lib-field">
            <span className="wd-lib-lab">卖点</span>
            <textarea
              className="wd-lib-input wd-lib-input--area"
              rows={2}
              placeholder="一句话，凭什么点开"
              value={logline}
              onChange={(e) => setLogline(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className={`wd-lib-go${ready ? ' is-ready' : ''}`}
            disabled={!ready}
          >
            {ready ? '进写台' : missing}
          </button>
        </form>
      ) : null}
      <div className="wd-lib-list">
        {!loaded ? <p className="sidebar-group-empty">加载书库…</p> : null}
        {loaded && books.length === 0 && !creating ? (
          <p className="sidebar-group-empty">还没有书。点右上角 + 新建一本。</p>
        ) : null}
        {books.map((b) => {
          const st = b.has_candidate ? '试笔' : '连载中'
          const on = b.id === openId
          return (
            <div key={b.id} className={`wd-lib-row${on ? ' is-on' : ''}`}>
              <button
                type="button"
                className="wd-lib-open"
                onClick={() => {
                  void selectWritingBook(b.id)
                  void ensureDesk()
                }}
              >
                <span className="wd-lib-cover" aria-hidden>
                  {b.title.slice(0, 1) || '书'}
                </span>
                <span className="wd-lib-meta">
                  <span className="wd-lib-title">{b.title}</span>
                  <span className="wd-lib-sub">
                    {b.land_line || '开卷'}
                    {b.volume_line ? ` · ${b.volume_line}` : ''} · {st} · {b.accepted}章 ·{' '}
                    {b.accepted_chars.toLocaleString('zh-CN')}字
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="wd-lib-del"
                title="导出正文"
                aria-label={`导出《${b.title}》正文`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!isTauriRuntime()) {
                    pushToast('导出只在桌面端可用。', 'info')
                    return
                  }
                  void writingExportBook(b.id)
                    .then((path) => pushToast(`已导出 ${path}`, 'success'))
                    .catch((err) => pushToast(String(err), 'error'))
                }}
              >
                导
              </button>
              <button
                type="button"
                className="wd-lib-del"
                title="删除这本书"
                aria-label={`删除《${b.title}》`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!window.confirm(`删除《${b.title}》？书稿和本会话目录都会去掉。`)) return
                  deleteWritingBook(b.id)
                  pushToast(`已删除《${b.title}》`, 'info')
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
