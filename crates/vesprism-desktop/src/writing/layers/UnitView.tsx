import { Field, FieldRow, Section, Zone } from '../fields/Field'
import { usePatch } from '../fields/edit-ctx'
import type { UnitCard } from '../model/types'

export function UnitView({ card }: { card: UnitCard }) {
  const patch = usePatch()
  const set = (partial: Partial<UnitCard>) =>
    patch((b) => ({
      ...b,
      units: b.units.map((u) => (u.id === card.id ? { ...u, ...partial } : u)),
    }))
  return (
    <Section lot="战役" title={card.name || '未命名单元'}>
      <Zone title="这场战役">
        <Field label="名称" short value={card.name} onChange={(v) => set({ name: v })} />
        <FieldRow>
          <Field label="所属卷" short value={card.volumeId} onChange={(v) => set({ volumeId: v })} />
          <Field label="章范围" short value={card.chapters} onChange={(v) => set({ chapters: v })} />
        </FieldRow>
        <Field label="战役一句话" value={card.campaign} onChange={(v) => set({ campaign: v })} />
        <Field label="胜负条件" warn value={card.win} onChange={(v) => set({ win: v })} />
        <Field
          label="对手这单元的手段"
          value={card.antagonistMove}
          onChange={(v) => set({ antagonistMove: v })}
        />
        <Field label="被逼用掉的资源" value={card.spent} onChange={(v) => set({ spent: v })} />
        <Field label="信息投放计划" value={card.infoPlan} onChange={(v) => set({ infoPlan: v })} />
        <Field label="单元末钩" value={card.endHook} onChange={(v) => set({ endHook: v })} />
        <Field
          label="人物进出"
          value={card.peopleChange}
          onChange={(v) => set({ peopleChange: v })}
        />
      </Zone>
    </Section>
  )
}
