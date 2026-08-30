import { useState } from 'react'
import { gapLabel } from '../framework/station'
import type { BookDemo } from '../model/types'

const AIM = 455

function progressPct(book: BookDemo): number {
  const done = book.drafts.filter((d) => d.accepted).length
  return Math.min(100, Math.round((done / AIM) * 1000) / 10)
}

function statusOf(book: BookDemo): { label: string; tone: 'is-cand' | 'is-ok' } {
  const hasCandidate = book.drafts.some((d) => !d.accepted) || book.reviews.some((r) => !r.adopted)
  return hasCandidate
    ? { label: '试笔', tone: 'is-cand' }
    : { label: '连载中', tone: 'is-ok' }
}

export function BookShelf({
  books,
  lastId,
  onOpen,
  onCreate,
}: {
  books: BookDemo[]
  lastId: string | null
  onOpen: (id: string) => void
  onCreate: (init: { title: string; platform: string; logline: string }) => void
}) {
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState('')
  const [logline, setLogline] = useState('')
  const ready = Boolean(title.trim() && platform.trim() && logline.trim())
  const last = lastId ? books.find((b) => b.id === lastId) : undefined

  return (
    <div className="wd-shelf" role="main" aria-label="书库">
      <header className="wd-head">
        <div>
          <p className="wd-kicker">写完 · 书库</p>
          <h1>先选一本书</h1>
        </div>
        <p className="wd-head-lead">
          入口是书，不是对话框。新建只问三句——书名、平台、一句话。没有这三句，不能写正文。
        </p>
      </header>
      <div className="wd-shelf-body">
        <div className="wd-shelf-grid">
          {last ? (
            <button
              type="button"
              className="wd-shelf-card is-last"
              onClick={() => onOpen(last.id)}
            >
              <span className="wd-shelf-cover" aria-hidden>
                续
              </span>
              <span className="wd-shelf-main">
                <span className="wd-shelf-meta">
                  {last.pitch.platform || '继续上次'}
                  <span className="wd-stamp is-cand">停在第 {last.drafts.filter((d) => !d.accepted).length ? '试笔' : '章'}</span>
                </span>
                <span className="wd-shelf-title">{last.title}</span>
                <span className="wd-shelf-sub">{gapLabel(last)}</span>
                <span className="wd-shelf-prog">
                  <span className="fill">
                    <i style={{ width: `${progressPct(last)}%` }} />
                  </span>
                  <em>
                    已进正史 {last.drafts.filter((d) => d.accepted).length} / {AIM} 章
                  </em>
                </span>
              </span>
            </button>
          ) : null}

          {books.map((b) => {
            const st = statusOf(b)
            return (
              <button key={b.id} type="button" className="wd-shelf-card" onClick={() => onOpen(b.id)}>
                <span className="wd-shelf-cover" aria-hidden>
                  {b.title.slice(0, 1)}
                </span>
                <span className="wd-shelf-main">
                  <span className="wd-shelf-meta">
                    {b.pitch.platform || '还没定平台'}
                    <span className={`wd-stamp ${st.tone}`}>{st.label}</span>
                  </span>
                  <span className="wd-shelf-title">{b.title}</span>
                  <span className="wd-shelf-sub">{b.pitch.logline || '还没有一句话卖点'}</span>
                  <span className="wd-shelf-prog">
                    <span className="fill">
                      <i style={{ width: `${progressPct(b)}%` }} />
                    </span>
                    <em>
                      已进正史 {b.drafts.filter((d) => d.accepted).length} / {AIM} 章
                    </em>
                  </span>
                </span>
              </button>
            )
          })}

          <button type="button" className="wd-shelf-new" onClick={() => setCreating(true)}>
            <span className="wd-shelf-cover is-new" aria-hidden>
              ＋
            </span>
            <span className="wd-shelf-main">
              <span className="wd-shelf-title">新建一本</span>
              <span className="wd-shelf-sub">只问三句：书名 · 平台 · 一句话</span>
            </span>
          </button>
        </div>

        {creating ? (
          <form
            className="wd-shelf-new-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!ready) return
              onCreate({ title: title.trim(), platform: platform.trim(), logline: logline.trim() })
            }}
          >
            <p className="wd-kicker">新建一本</p>
            <label className="wd-field is-edit">
              <span className="wd-field-k">书名</span>
              <input className="wd-cmd-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="点这里写" />
            </label>
            <label className="wd-field is-edit">
              <span className="wd-field-k">平台</span>
              <input
                className="wd-cmd-input"
                placeholder="番茄 / 男频 / 都市异能"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              />
            </label>
            <label className="wd-field is-edit">
              <span className="wd-field-k">一句话卖点（谁 + 局 + 靠什么活）</span>
              <textarea
                className="wd-cmd-input"
                rows={2}
                value={logline}
                onChange={(e) => setLogline(e.target.value)}
                placeholder="点这里写"
              />
            </label>
            <div className="wd-cmd-bar">
              <p className="wd-cmd-preview">
                {ready ? '三问齐了，进卖点卡。还不能写正文。' : '三问没齐，进不了写台。'}
              </p>
              <button type="submit" className="wd-action" disabled={!ready}>
                进入写台
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  )
}
