import { Field, FieldRow, ForeshadowStamp, Section } from '../fields/Field'
import type { WriteSlice } from '../model/slice'

export function SlicePanel({ slice }: { slice: WriteSlice }) {
  return (
    <Section
      lot="只吃这些"
      title="写正文时 AI 只能看见这些"
      lead="规矩切片 + 出场当前态 + 到期伏笔 + 切块。长线全文不进这一刀。"
    >
      {slice.locked ? <p className="wd-lock-banner">{slice.lockReason}</p> : null}
      <FieldRow>
        <Field label="视角">{slice.canon.pov}</Field>
        <Field label="章目标字数">{slice.canon.chapterWords}</Field>
      </FieldRow>
      <Field label="力量上限" warn>
        {slice.canon.powerCap}
      </Field>
      <Field label="叙事禁">{slice.canon.narrativeBan}</Field>
      <Field label="句式禁">{slice.canon.sentenceBan}</Field>
      {slice.canon.samples.filter((s) => s.trim()).length > 0 ? (
        <Field label="文风样本">
          {slice.canon.samples
            .filter((s) => s.trim())
            .slice(0, 3)
            .map((s, i) => `样本${i + 1}：「${s}」`)
            .join('\n')}
        </Field>
      ) : null}
      <Field label="一章算写完">{slice.canon.doneWhen}</Field>
      {slice.people.map((p) => (
        <Field key={p.id} label={`出场 · ${p.name} · 当前态`} warn>
          {p.state}
          {'\n'}不能知道：{p.mustNotKnow}
          {'\n'}样本：「{p.voiceSample}」
        </Field>
      ))}
      {slice.places.map((p) => (
        <Field key={p.id} label={`地点 · ${p.name}`}>
          {p.job}
        </Field>
      ))}
      {slice.rules.map((r) => (
        <Field key={r.id} label={`规则 · ${r.name}`} warn>
          {r.quota}
          {'\n'}不能：{r.cannot}
        </Field>
      ))}
      {slice.due.length === 0 ? (
        <Field label="到期伏笔">本章没有到期伏线</Field>
      ) : (
        slice.due.map((f) => (
          <Field key={f.id} label={`到期 · ${f.id}`} warn>
            <ForeshadowStamp state={f.state} /> {f.line} · {f.thisVolume}
          </Field>
        ))
      )}
      {slice.watch.map((f) => (
        <Field key={`w-${f.id}`} label={`旁观 · ${f.id}`}>
          <ForeshadowStamp state={f.state} /> {f.line} · {f.thisVolume}
        </Field>
      ))}
      {slice.beats.length === 0 ? (
        <Field label="切块">还没有切块</Field>
      ) : (
        slice.beats.map((b, i) => (
          <Field key={b.id} label={`切块 ${i + 1} · ${b.title}`}>
            {b.job}
          </Field>
        ))
      )}
    </Section>
  )
}
