import { Field, FieldRow, Section, Zone } from '../fields/Field'
import { usePatch } from '../fields/edit-ctx'
import { splitSlash } from '../model/create'
import type { PitchCard } from '../model/types'

export function PitchView({ card }: { card: PitchCard }) {
  const patch = usePatch()
  const set = (partial: Partial<PitchCard>, title?: string) =>
    patch((b) => ({
      ...b,
      title: title ?? b.title,
      pitch: { ...b.pitch, ...partial },
    }))
  const setHook = (i: 0 | 1 | 2, v: string) => {
    const hooks: PitchCard['hooks'] = [card.hooks[0], card.hooks[1], card.hooks[2]]
    hooks[i] = v
    set({ hooks })
  }

  return (
    <Section
      lot="卖点"
      title="这本书凭什么被点开"
      lead="起点是这张卡，不是第1章。书名、平台、一句话是入口三问；其余用右侧「补全立项」。"
    >
      <Zone title="入口三问（硬门）">
        <FieldRow>
          <Field
            label="书名候选（用 / 分隔）"
            short
            value={card.titles.join(' / ')}
            onChange={(v) => {
              const titles = splitSlash(v)
              set({ titles }, titles[0] || '未命名')
            }}
          />
          <Field
            label="平台 / 频道 / 品类"
            short
            value={card.platform}
            onChange={(v) => set({ platform: v })}
          />
        </FieldRow>
        <Field
          label="一句话卖点（谁 + 局 + 靠什么活）"
          value={card.logline}
          onChange={(v) => set({ logline: v })}
        />
      </Zone>
      <Zone title="金手指与代价">
        <FieldRow>
          <Field label="金手指" value={card.cheat} onChange={(v) => set({ cheat: v })} />
          <Field
            label="代价（必须可被读者看见）"
            warn
            value={card.cost}
            onChange={(v) => set({ cost: v })}
          />
        </FieldRow>
      </Zone>
      <Zone title="读者为什么点">
        <Field label="对标（像谁，但不像谁）" value={card.comps} onChange={(v) => set({ comps: v })} />
        <Field label="读者来读什么情绪" value={card.emotion} onChange={(v) => set({ emotion: v })} />
        <Field label="核心爽点 1" value={card.hooks[0]} onChange={(v) => setHook(0, v)} />
        <Field label="核心爽点 2" value={card.hooks[1]} onChange={(v) => setHook(1, v)} />
        <Field label="核心爽点 3" value={card.hooks[2]} onChange={(v) => setHook(2, v)} />
      </Zone>
      <Zone title="前三章必须看见">
        <Field
          label="第1章"
          value={card.firstThree.ch1}
          onChange={(v) => set({ firstThree: { ...card.firstThree, ch1: v } })}
        />
        <Field
          label="第2章"
          value={card.firstThree.ch2}
          onChange={(v) => set({ firstThree: { ...card.firstThree, ch2: v } })}
        />
        <Field
          label="第3章"
          value={card.firstThree.ch3}
          onChange={(v) => set({ firstThree: { ...card.firstThree, ch3: v } })}
        />
        <Field
          label="不能写成的书"
          value={card.forbiddenBook}
          onChange={(v) => set({ forbiddenBook: v })}
        />
      </Zone>
    </Section>
  )
}
