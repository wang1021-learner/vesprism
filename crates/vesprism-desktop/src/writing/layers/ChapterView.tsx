import { Field, FieldRow, Section, Zone } from '../fields/Field'
import { usePatch } from '../fields/edit-ctx'
import { resolveCastIds, resolvePlaceIds, splitSlash } from '../model/create'
import type { BookDemo, ChapterCard } from '../model/types'

const JOBS = ['推进', '兑现', '缓冲', '翻盘'] as const
const HOOKS = ['悬念', '反转', '危机', '信息差', '选择'] as const

function parseCast(book: BookDemo, text: string): string[] {
  return resolveCastIds(book, splitSlash(text))
}

export function ChapterView({
  card,
  castLabels,
  whereLabels,
}: {
  card: ChapterCard
  castLabels?: string
  whereLabels?: string
}) {
  const patch = usePatch()
  const set = (partial: Partial<ChapterCard>) =>
    patch((b) => ({
      ...b,
      chapters: b.chapters.map((c) => (c.id === card.id ? { ...c, ...partial } : c)),
    }))
  const locked = Boolean(card.locked)

  return (
    <Section lot="章" kicker={`第${card.no}章`} title={card.title || '未拟题'}>
      {card.locked ? <p className="wd-lock-banner">{card.lockReason}</p> : null}
      <Zone title="本章任务">
        <Field label="章名" short value={card.title} disabled={locked} onChange={(v) => set({ title: v })} />
        <FieldRow>
          <Field
            label="本章任务"
            short
            options={JOBS}
            value={card.job}
            disabled={locked}
            onChange={(v) => set({ job: v as ChapterCard['job'] })}
          />
          <Field
            label="平台"
            short
            options={['番茄', '起点']}
            value={card.platform === 'qidian' ? '起点' : '番茄'}
            disabled={locked}
            onChange={(v) => set({ platform: v === '起点' ? 'qidian' : 'tomato' })}
            hint={card.platform === 'tomato' ? '番茄：开场必须是物理事件' : '起点'}
          />
          <Field
            label="所属单元"
            short
            value={card.unitId}
            disabled={locked}
            onChange={(v) => set({ unitId: v })}
          />
        </FieldRow>
      </Zone>
      <Zone title="骨架">
        <Field
          label="开场钩（前 300 字）"
          value={card.openHook}
          disabled={locked}
          onChange={(v) => set({ openHook: v })}
        />
        <Field label="目标" value={card.goal} disabled={locked} onChange={(v) => set({ goal: v })} />
        <Field
          label="阻力"
          value={card.resistance}
          disabled={locked}
          onChange={(v) => set({ resistance: v })}
        />
        <Field label="转折" value={card.turn} disabled={locked} onChange={(v) => set({ turn: v })} />
        <Field
          label="章爽点"
          value={card.pleasure}
          disabled={locked}
          onChange={(v) => set({ pleasure: v })}
        />
        <Field
          label="章末钩类型"
          short
          options={HOOKS}
          value={card.endHookKind}
          disabled={locked}
          onChange={(v) => set({ endHookKind: v as ChapterCard['endHookKind'] })}
        />
        <Field
          label="章末钩"
          value={card.endHook}
          disabled={locked}
          onChange={(v) => set({ endHook: v })}
        />
      </Zone>
      <Zone title="信息与出场">
        <Field
          label="信息投放"
          value={card.infoGive}
          disabled={locked}
          onChange={(v) => set({ infoGive: v })}
        />
        <Field
          label="信息禁止"
          warn
          value={card.infoForbid}
          disabled={locked}
          onChange={(v) => set({ infoForbid: v })}
        />
        <Field
          label="出场（用 / 分隔，可写名字）"
          value={castLabels || card.cast.join(' / ')}
          disabled={locked}
          onChange={(v) => patch((b) => ({
            ...b,
            chapters: b.chapters.map((c) =>
              c.id === card.id ? { ...c, cast: parseCast(b, v) } : c,
            ),
          }))}
        />
        <Field
          label="这一章在哪"
          value={whereLabels || (card.where || []).join(' / ')}
          disabled={locked}
          onChange={(v) => patch((b) => ({
            ...b,
            chapters: b.chapters.map((c) =>
              c.id === card.id ? { ...c, where: resolvePlaceIds(b, splitSlash(v)) } : c,
            ),
          }))}
        />
        <FieldRow>
          <Field label="埋" value={card.plant} disabled={locked} onChange={(v) => set({ plant: v })} />
          <Field label="催" value={card.press} disabled={locked} onChange={(v) => set({ press: v })} />
          <Field label="收" value={card.close} disabled={locked} onChange={(v) => set({ close: v })} />
        </FieldRow>
      </Zone>
      <Zone title="预算">
        <FieldRow>
          <Field
            label="字数预算"
            short
            value={card.words}
            disabled={locked}
            onChange={(v) => set({ words: v })}
          />
          <Field
            label="情绪曲线"
            short
            value={card.mood}
            disabled={locked}
            onChange={(v) => set({ mood: v })}
          />
        </FieldRow>
      </Zone>
    </Section>
  )
}
