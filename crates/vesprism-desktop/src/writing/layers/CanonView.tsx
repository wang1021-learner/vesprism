import { Field, FieldRow, Section, Zone } from '../fields/Field'
import { usePatch } from '../fields/edit-ctx'
import type { CanonCard } from '../model/types'

export function CanonView({ card }: { card: CanonCard }) {
  const patch = usePatch()
  const set = (partial: Partial<CanonCard>) =>
    patch((b) => ({ ...b, canon: { ...b.canon, ...partial } }))
  const setSample = (i: 0 | 1 | 2, v: string) => {
    const samples: CanonCard['samples'] = [card.samples[0], card.samples[1], card.samples[2]]
    samples[i] = v
    set({ samples })
  }

  return (
    <Section lot="规矩" title="全书裁判，不是随笔">
      <Zone title="平台与篇幅">
        <FieldRow>
          <Field
            label="平台 / 频道 / 品类"
            short
            value={card.platform}
            onChange={(v) => set({ platform: v })}
          />
          <Field label="视角" short value={card.pov} onChange={(v) => set({ pov: v })} />
        </FieldRow>
        <FieldRow>
          <Field
            label="章目标字数"
            short
            value={card.chapterWords}
            onChange={(v) => set({ chapterWords: v })}
          />
          <Field
            label="日更 / 备稿"
            short
            value={card.schedule}
            onChange={(v) => set({ schedule: v })}
          />
        </FieldRow>
      </Zone>
      <Zone title="声口样本">
        <Field label="文风样本 1" value={card.samples[0]} onChange={(v) => setSample(0, v)} />
        <Field label="文风样本 2" value={card.samples[1]} onChange={(v) => setSample(1, v)} />
        <Field label="文风样本 3" value={card.samples[2]} onChange={(v) => setSample(2, v)} />
      </Zone>
      <Zone title="硬门">
        <Field label="力量上限" warn value={card.powerCap} onChange={(v) => set({ powerCap: v })} />
        <Field label="时间规则" value={card.timeRule} onChange={(v) => set({ timeRule: v })} />
        <Field label="信息规则" value={card.infoRule} onChange={(v) => set({ infoRule: v })} />
        <Field label="视角规则" value={card.povRule} onChange={(v) => set({ povRule: v })} />
      </Zone>
      <Zone title="禁区">
        <Field label="叙事禁" value={card.narrativeBan} onChange={(v) => set({ narrativeBan: v })} />
        <Field label="设定禁" value={card.settingBan} onChange={(v) => set({ settingBan: v })} />
        <Field label="句式禁" value={card.sentenceBan} onChange={(v) => set({ sentenceBan: v })} />
        <Field label="一章算写完" value={card.doneWhen} onChange={(v) => set({ doneWhen: v })} />
      </Zone>
    </Section>
  )
}
