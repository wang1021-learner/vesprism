import { Field, FieldRow, Section, Zone } from '../fields/Field'
import { usePatch } from '../fields/edit-ctx'
import { addCampaign, splitList } from '../model/create'
import type { VolumeCard } from '../model/types'

export function VolumeView({ card }: { card: VolumeCard }) {
  const patch = usePatch()
  const set = (partial: Partial<VolumeCard>) =>
    patch((b) => ({
      ...b,
      volumes: b.volumes.map((v) => (v.id === card.id ? { ...v, ...partial } : v)),
    }))
  const setC = (id: string, partial: Partial<VolumeCard['campaigns'][number]>) =>
    patch((b) => ({
      ...b,
      volumes: b.volumes.map((v) =>
        v.id === card.id
          ? { ...v, campaigns: v.campaigns.map((c) => (c.id === id ? { ...c, ...partial } : c)) }
          : v,
      ),
    }))

  return (
    <Section lot="卷" title={card.title || '未命名卷'}>
      <Zone title="本卷压力">
        <Field label="卷名" short value={card.title} onChange={(v) => set({ title: v })} />
        <Field label="本卷问题" value={card.question} onChange={(v) => set({ question: v })} />
        <Field label="本卷对手" value={card.antagonist} onChange={(v) => set({ antagonist: v })} />
        <Field
          label="本卷规则压力"
          warn
          value={card.rulePressure}
          onChange={(v) => set({ rulePressure: v })}
        />
      </Zone>
      <Zone title="战役">
        {card.campaigns.length === 0 ? <p className="wd-ticket-sub">还没有战役。一场战役是几章的胜负。</p> : null}
        {card.campaigns.map((c) => (
          <div key={c.id} className="wd-beat">
            <Field label="战役名" short value={c.name} onChange={(v) => setC(c.id, { name: v })} />
            <Field label="胜负" value={c.win} onChange={(v) => setC(c.id, { win: v })} />
            <FieldRow>
              <Field label="进场状态" short value={c.inState} onChange={(v) => setC(c.id, { inState: v })} />
              <Field label="出场状态" short value={c.outState} onChange={(v) => setC(c.id, { outState: v })} />
            </FieldRow>
          </div>
        ))}
        <button
          type="button"
          className="wd-action"
          onClick={() => patch((b) => addCampaign(b, card.id))}
        >
          加一场战役
        </button>
      </Zone>
      <Zone title="兑现与信息差">
        <Field
          label="必须兑现（用；分隔）"
          value={card.mustPay.join('；')}
          onChange={(v) => set({ mustPay: splitList(v) })}
        />
        <Field
          label="本卷禁止兑现"
          value={card.mustNotPay.join('；')}
          onChange={(v) => set({ mustNotPay: splitList(v) })}
        />
        <FieldRow>
          <Field label="打脸节点" value={card.slap} onChange={(v) => set({ slap: v })} />
          <Field label="卷高潮" value={card.climax} onChange={(v) => set({ climax: v })} />
        </FieldRow>
        <Field label="卷末变化" value={card.endChange} onChange={(v) => set({ endChange: v })} />
        <Field
          label="读者已经知道"
          value={card.readerKnows}
          onChange={(v) => set({ readerKnows: v })}
        />
        <Field
          label="主角还不知道"
          value={card.leadDoesNot}
          onChange={(v) => set({ leadDoesNot: v })}
        />
        <Field
          label="盟友已经知道"
          value={card.allyKnows}
          onChange={(v) => set({ allyKnows: v })}
        />
      </Zone>
    </Section>
  )
}
