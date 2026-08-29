import { Field, Section } from '../fields/Field'
import { usePatch } from '../fields/edit-ctx'
import { addBeat } from '../model/create'
import type { BeatCard, ChapterCard } from '../model/types'

export function BeatsView({
  chapter,
  beats,
  onAddBeat,
}: {
  chapter: ChapterCard
  beats: BeatCard[]
  onAddBeat?: () => void
}) {
  const patch = usePatch()
  const set = (id: string, partial: Partial<BeatCard>) =>
    patch((b) => ({
      ...b,
      beatsByChapter: {
        ...b.beatsByChapter,
        [chapter.id]: (b.beatsByChapter[chapter.id] || []).map((x) =>
          x.id === id ? { ...x, ...partial } : x,
        ),
      },
    }))

  if (!beats.length) {
    return (
      <Section
        lot="切块"
        kicker={`第${chapter.no}章`}
        title="还没有切块"
        lead="一块只干一件事，800 到 1200 字。没有至少三块，不能写正文。"
      >
        {chapter.locked ? <p className="wd-lock-banner">{chapter.lockReason}</p> : null}
        <button
          type="button"
          className="wd-action"
          onClick={() => (onAddBeat ? onAddBeat() : patch((b) => addBeat(b, chapter.id).book))}
        >
          加一个切块
        </button>
      </Section>
    )
  }
  return (
    <Section
      lot="切块"
      kicker={`第${chapter.no}章`}
      title="一块只干一件事"
      lead="写正文时模型只吃这些块 + 出场人物当前态 + 到期伏笔，不吃长线全文。"
    >
      {beats.map((b, i) => (
        <article key={b.id} className="wd-beat">
          <h3>
            切块 {i + 1} · {b.title || '未命名'}
          </h3>
          <Field label="切块名" short value={b.title} onChange={(v) => set(b.id, { title: v })} />
          <Field label="场面" value={b.scene} onChange={(v) => set(b.id, { scene: v })} />
          <Field label="任务" value={b.job} onChange={(v) => set(b.id, { job: v })} />
          <Field label="对白任务" value={b.dialogue} onChange={(v) => set(b.id, { dialogue: v })} />
          <Field label="信息" value={b.info} onChange={(v) => set(b.id, { info: v })} />
          <Field label="情绪" short value={b.mood} onChange={(v) => set(b.id, { mood: v })} />
          <Field label="落点" value={b.land} onChange={(v) => set(b.id, { land: v })} />
        </article>
      ))}
      <button
        type="button"
        className="wd-action"
        onClick={() => (onAddBeat ? onAddBeat() : patch((b) => addBeat(b, chapter.id).book))}
      >
        再加一块
      </button>
    </Section>
  )
}
