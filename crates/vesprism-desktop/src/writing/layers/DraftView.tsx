import { Section, Stamp } from '../fields/Field'
import { useOptionalPatch } from '../fields/edit-ctx'
import type { BeatCard, DraftPage } from '../model/types'

function charCount(draft: DraftPage): number {
  return draft.beats.reduce((n, b) => n + b.body.replace(/\s/g, '').length, 0)
}

export function DraftView({
  draft,
  beats,
  chapterNo,
  title,
  wordsBudget,
  mood,
  selectedBeatId,
  onSelectBeat,
  onAdopt,
  onDiscard,
  onRevert,
}: {
  draft: DraftPage | undefined
  beats: BeatCard[]
  chapterNo: number
  title?: string
  wordsBudget?: string
  mood?: string
  selectedBeatId?: string
  onSelectBeat?: (id: string) => void
  onAdopt?: () => void
  onDiscard?: () => void
  onRevert?: () => void
}) {
  const patch = useOptionalPatch()
  if (!draft) {
    return (
      <Section
        lot="稿纸"
        title={`第${chapterNo}章还没有纸面`}
        lead="点右侧「写这一章」出试笔。未点进正史之前，案卷不动。"
      />
    )
  }
  const candidate = !draft.accepted
  const chars = charCount(draft)
  return (
    <Section lot="稿纸" title={`第${chapterNo}章 ${title || ''}`.trim()}>
      <div className="wd-mast">
        <Stamp tone={candidate ? 'due' : 'ok'}>{candidate ? '试笔 · 还不是正史' : '已进正史'}</Stamp>
        <span className="wd-mast-stat">
          {chars} 字{wordsBudget ? ` · 预算 ${wordsBudget}` : ''}
        </span>
        {mood ? <span className="wd-mast-mood">{mood}</span> : null}
        {candidate ? (
          <span className="wd-cand-bar">
            <button type="button" className="wd-action" onClick={onAdopt}>
              采纳进正史
            </button>
            <button type="button" className="wd-btn wd-btn-danger" onClick={onDiscard}>
              丢掉重写
            </button>
          </span>
        ) : (
          <span className="wd-cand-bar">
            <button type="button" className="wd-btn wd-btn-ghost" onClick={onRevert}>
              退回试笔
            </button>
          </span>
        )}
      </div>
      <div
        className={`wd-paper${candidate ? ' is-cand' : ' is-canon'}`}
        role="document"
        aria-label={`第${chapterNo}章${candidate ? '试笔' : '正文'}`}
      >
        <p className="wd-paper-title">
          第{chapterNo}章{title ? ` ${title}` : ''}
        </p>
        {draft.beats.map((block) => {
          const meta = beats.find((b) => b.id === block.beatId)
          const on = selectedBeatId === block.beatId
          return (
            <article
              key={block.beatId}
              className={`wd-paper-beat${on ? ' is-on' : ''}`}
              onClick={() => onSelectBeat?.(block.beatId)}
            >
              <h3>{meta?.title ?? block.beatId}</h3>
              <textarea
                className="wd-paper-input"
                aria-label={meta?.title ?? '切块正文'}
                value={block.body}
                rows={Math.max(4, block.body.split('\n').length + 1)}
                onFocus={() => onSelectBeat?.(block.beatId)}
                onChange={(e) => {
                  const body = e.target.value
                  patch?.((b) => ({
                    ...b,
                    drafts: b.drafts.map((d) =>
                      d.chapterId === draft.chapterId
                        ? {
                            ...d,
                            beats: d.beats.map((x) =>
                              x.beatId === block.beatId ? { ...x, body } : x,
                            ),
                          }
                        : d,
                    ),
                  }))
                }}
              />
            </article>
          )
        })}
      </div>
    </Section>
  )
}
