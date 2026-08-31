import { Section, Stamp } from '../fields/Field'
import { chapterWorkJump, chapterWorkLabel, chapterWorkState } from '../model/nodes'
import type { BookDemo, DeskNodeId } from '../model/types'

export function ChapterIndex({
  book,
  onOpen,
}: {
  book: BookDemo
  onOpen: (id: DeskNodeId) => void
}) {
  const rows = [...book.chapters].sort((a, b) => a.no - b.no)
  return (
    <Section lot="连载" title="章表" lead="空 / 试笔 / 已检 / 已入卷。点进去写。不预建空章。">
      {rows.length === 0 ? <p className="wd-ticket-sub">还没有章。先拆章纲。</p> : null}
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
                <span className="wd-ticket-line">{ch.title || '未拟题'}</span>
                <Stamp tone={tone}>{chapterWorkLabel(st)}</Stamp>
              </button>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
