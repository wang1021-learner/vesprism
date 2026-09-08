import { useMemo, useState } from 'react'
import { Section, Stamp } from '../fields/Field'
import { chapterWorkJump, chapterWorkLabel, chapterWorkState } from '../model/nodes'
import { searchChapters } from '../model/chapterSearch'
import { findReferences } from '../model/referenceSearch'
import type { BookDemo, DeskNodeId } from '../model/types'

const JOBS = ['推进', '兑现', '缓冲', '翻盘'] as const
const HOOKS = ['悬念', '反转', '危机', '信息差', '选择'] as const

export function ChapterIndex({
  book,
  onOpen,
}: {
  book: BookDemo
  onOpen: (id: DeskNodeId) => void
}) {
  const [query, setQuery] = useState('')
  const [job, setJob] = useState('')
  const [hook, setHook] = useState('')

  const rows = useMemo(
    () => searchChapters(book, { query, job, hook }),
    [book, query, job, hook],
  )
  const refs = useMemo(
    () => (query.trim() ? findReferences(book, query) : null),
    [book, query],
  )

  return (
    <Section
      lot="连载"
      title="章表 · 长书检索"
      lead="按关键词 / 章纲 job / 章末钩类型过滤，找某人物参与过的章、所有翻盘章、第一次出现某地点的章。"
    >
      <div className="wd-index-filters">
        <input
          className="wd-cmd-input"
          value={query}
          placeholder="搜人物 / 地点 / 章名 / 钩子…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="wd-index-chips">
          {JOBS.map((j) => (
            <button
              key={j}
              type="button"
              className={`wd-cmd-chip${job === j ? ' is-on' : ''}`}
              onClick={() => setJob(job === j ? '' : j)}
            >
              {j}
            </button>
          ))}
          <span className="wd-index-sep" />
          {HOOKS.map((h) => (
            <button
              key={h}
              type="button"
              className={`wd-cmd-chip${hook === h ? ' is-on' : ''}`}
              onClick={() => setHook(hook === h ? '' : h)}
            >
              钩·{h}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <p className="wd-ticket-sub">没有匹配的章。</p> : null}
      <p className="wd-ticket-sub">命中 {rows.length} 章。</p>
      <ul className="wd-ticket-list">
        {rows.map((ch) => {
          const st = chapterWorkState(book, ch.id)
          const tone = st === 'adopted' ? 'ok' : st === 'empty' ? 'lock' : st === 'draft' ? 'due' : 'open'
          return (
            <li key={ch.id}>
              <button
                type="button"
                className={`wd-ticket is-${tone}`}
                onClick={() => onOpen(chapterWorkJump(book, ch.id))}
              >
                <span className="wd-ticket-id">第{ch.no}章</span>
                <span className="wd-ticket-line">
                  {ch.title || '未拟题'}
                  {ch.job ? ` · ${ch.job}` : ''}
                  {ch.endHookKind ? ` · 钩${ch.endHookKind}` : ''}
                </span>
                <Stamp tone={tone}>{chapterWorkLabel(st)}</Stamp>
              </button>
            </li>
          )
        })}
      </ul>
      {refs && (refs.people.length > 0 || refs.places.length > 0 || refs.foreshadows.length > 0 || refs.reviews.length > 0) ? (
        <div className="wd-index-refs">
          {refs.people.length > 0 ? (
            <p className="wd-ticket-sub">人物：{refs.people.map((p) => p.name).join('、')}</p>
          ) : null}
          {refs.places.length > 0 ? (
            <p className="wd-ticket-sub">地点：{refs.places.map((p) => p.name).join('、')}</p>
          ) : null}
          {refs.foreshadows.length > 0 ? (
            <p className="wd-ticket-sub">
              伏笔：{refs.foreshadows.map((f) => `${f.id} ${f.line}`).join('；')}
            </p>
          ) : null}
          {refs.reviews.length > 0 ? (
            <p className="wd-ticket-sub">
              检查单提到：{refs.reviews.map((r) => `第${book.chapters.find((c) => c.id === r.chapterId)?.no ?? '?'}章`).join('、')}
            </p>
          ) : null}
        </div>
      ) : null}
    </Section>
  )
}
