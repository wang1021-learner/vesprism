import { Field, Section, Zone } from '../fields/Field'
import { usePatch } from '../fields/edit-ctx'
import { addForeshadow } from '../model/create'
import { foreshadowLabel } from '../model/dossier'
import type { ForeshadowState, OutlineCard } from '../model/types'

const STATES: ForeshadowState[] = ['open', 'due', 'closed']

export function OutlineView({
  card,
  onAddForeshadow,
}: {
  card: OutlineCard
  onAddForeshadow?: () => void
}) {
  const patch = usePatch()
  const set = (partial: Partial<OutlineCard>) =>
    patch((b) => ({ ...b, outline: { ...b.outline, ...partial } }))
  const setF = (id: string, partial: Partial<OutlineCard['foreshadows'][number]>) =>
    patch((b) => ({
      ...b,
      outline: {
        ...b.outline,
        foreshadows: b.outline.foreshadows.map((f) => (f.id === id ? { ...f, ...partial } : f)),
      },
    }))
  const upgrades = card.volumeUpgrade.length ? card.volumeUpgrade : ['']

  return (
    <Section lot="长线" title="怎么升级，不写细场面">
      <Zone title="欲望与对手">
        <Field label="主角要什么" value={card.want} onChange={(v) => set({ want: v })} />
        <Field label="真正需要什么" value={card.need} onChange={(v) => set({ need: v })} />
        <Field
          label="对手要什么"
          value={card.antagonistWant}
          onChange={(v) => set({ antagonistWant: v })}
        />
        <Field
          label="他凭什么能压主角"
          value={card.leverage}
          onChange={(v) => set({ leverage: v })}
        />
        <Field
          label="全书一句话因果"
          value={card.causality}
          onChange={(v) => set({ causality: v })}
        />
      </Zone>
      <Zone title="三幕">
        <Field label="第1幕（建制）" value={card.act1} onChange={(v) => set({ act1: v })} />
        <Field label="第2幕（对抗）" value={card.act2} onChange={(v) => set({ act2: v })} />
        <Field label="第3幕（收束）" value={card.act3} onChange={(v) => set({ act3: v })} />
      </Zone>
      <Zone title="长线伏笔">
        <table className="wd-table">
          <caption>伏线（正文只吃到期的那些）</caption>
          <thead>
            <tr>
              <th>编号</th>
              <th>一句话</th>
              <th>埋</th>
              <th>本卷</th>
              <th>回收</th>
              <th>态</th>
            </tr>
          </thead>
          <tbody>
            {card.foreshadows.map((f) => (
              <tr key={f.id}>
                <td>{f.id}</td>
                <td>
                  <input value={f.line} onChange={(e) => setF(f.id, { line: e.target.value })} />
                </td>
                <td>
                  <input
                    value={f.plantVolume}
                    onChange={(e) => setF(f.id, { plantVolume: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={f.thisVolume}
                    onChange={(e) => setF(f.id, { thisVolume: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={f.closeWhen}
                    onChange={(e) => setF(f.id, { closeWhen: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={f.state}
                    onChange={(e) => setF(f.id, { state: e.target.value as ForeshadowState })}
                  >
                    {STATES.map((s) => (
                      <option key={s} value={s}>
                        {foreshadowLabel(s)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="wd-action"
          onClick={() => (onAddForeshadow ? onAddForeshadow() : patch((b) => addForeshadow(b).book))}
        >
          加一条伏笔
        </button>
        {upgrades.map((line, i) => (
          <Field
            key={i}
            label={`升级节奏 ${i + 1}`}
            value={line}
            onChange={(v) => {
              const next = [...(card.volumeUpgrade.length ? card.volumeUpgrade : [''])]
              next[i] = v
              set({ volumeUpgrade: next.filter((x, idx) => x.trim() || idx === next.length - 1) })
            }}
          />
        ))}
      </Zone>
    </Section>
  )
}
