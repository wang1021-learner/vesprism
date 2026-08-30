import { Field, Section, Stamp, Zone } from '../fields/Field'
import { usePatch } from '../fields/edit-ctx'
import type { ReviewCard } from '../model/types'

export function ReviewView({
  card,
  chapterNo,
  blocks,
  styleNotes,
  onRegisterUnnumbered,
}: {
  card: ReviewCard | undefined
  chapterNo: number
  blocks?: string[]
  styleNotes?: string[]
  onRegisterUnnumbered?: () => void
}) {
  const patch = usePatch()
  if (!card) {
    return (
      <Section
        lot="检查"
        kicker={`第${chapterNo}章`}
        title="还没有检查单"
        lead="对照章纲和设定，不是看写得美不美。点右侧「检查这一章」。"
      />
    )
  }
  const set = (partial: Partial<ReviewCard>) =>
    patch((b) => ({
      ...b,
      reviews: b.reviews.map((r) => (r.chapterId === card.chapterId ? { ...r, ...partial } : r)),
    }))
  return (
    <Section
      lot="检查"
      kicker={`第${chapterNo}章`}
      title="确认后才准改案卷"
      lead="没点「入卷」，不准开下一章。"
    >
      <p className="wd-lead">
        <Stamp tone={card.adopted ? 'ok' : 'lock'}>
          {card.adopted
            ? '已入卷'
            : blocks && blocks.length
              ? '红项未过，不准入卷'
              : '试笔 · 还没入卷'}
        </Stamp>
      </p>
      {blocks && blocks.length > 0 ? (
        <p className="wd-lead" role="status">
          {blocks.join('；')}
        </p>
      ) : null}
      {styleNotes && styleNotes.length > 0 ? (
        <p className="wd-lead">去稿纸点一块，用「洗这块」。不挡入卷。</p>
      ) : null}
      <Zone title="对照章纲">
        <Field
          label="开场钩是否在前 300 字落地"
          value={card.openHookOk}
          onChange={(v) => set({ openHookOk: v })}
        />
        <Field
          label="目标是否做成或明确失败"
          value={card.goalOk}
          onChange={(v) => set({ goalOk: v })}
        />
        <Field
          label="章末钩是否还在"
          value={card.endHookOk}
          onChange={(v) => set({ endHookOk: v })}
        />
        <Field
          label="谁说了不该说的话"
          value={card.voiceLeak}
          onChange={(v) => set({ voiceLeak: v })}
        />
        <Field
          label="谁知道了不能知道的"
          value={card.forbiddenKnow}
          onChange={(v) => set({ forbiddenKnow: v })}
        />
        <Field
          label="金手指有没有白用"
          value={card.cheatAbuse}
          onChange={(v) => set({ cheatAbuse: v })}
        />
        <Field
          label="到期伏笔是否被看见"
          value={card.dueSeen}
          onChange={(v) => set({ dueSeen: v })}
        />
        <Field
          label="有没有没编号的新埋"
          value={card.unnumbered}
          onChange={(v) => set({ unnumbered: v })}
        />
        {onRegisterUnnumbered && card.unnumbered.trim() && !/^(无|没有|无新埋|无未编号)[。.]?$/.test(card.unnumbered.trim()) ? (
          <button type="button" className="wd-btn wd-btn-ghost" onClick={onRegisterUnnumbered}>
            编号进伏笔表
          </button>
        ) : null}
      </Zone>
      <Zone title="建议入卷">
        {card.states.map((s, i) => (
          <Field
            key={i}
            label="人物当前态"
            value={s}
            onChange={(v) => {
              const next = [...card.states]
              next[i] = v
              set({ states: next })
            }}
          />
        ))}
        {card.foreshadow.map((s, i) => (
          <Field
            key={i}
            label="伏笔状态"
            value={s}
            onChange={(v) => {
              const next = [...card.foreshadow]
              next[i] = v
              set({ foreshadow: next })
            }}
          />
        ))}
        <Field
          label="80 字章摘要"
          value={card.summary80}
          onChange={(v) => set({ summary80: v })}
        />
      </Zone>
    </Section>
  )
}
