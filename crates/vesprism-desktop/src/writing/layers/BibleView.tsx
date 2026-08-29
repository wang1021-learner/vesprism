import { Field, FieldRow, Section, Stamp, Zone } from '../fields/Field'
import { usePatch } from '../fields/edit-ctx'
import { personNode, placeNode, ruleNode } from '../model/nodes'
import type { DeskNodeId, PersonCard, PlaceCard, RuleCard } from '../model/types'

const ROLES = ['主角', '对手', '盟友', '工具'] as const

export function PersonView({ card }: { card: PersonCard }) {
  const patch = usePatch()
  const set = (partial: Partial<PersonCard>) =>
    patch((b) => ({
      ...b,
      people: b.people.map((p) => (p.id === card.id ? { ...p, ...partial } : p)),
    }))

  return (
    <Section lot="人" kicker={`人物 · ${card.role}`} title={card.name || '未命名'}>
      <div className="wd-hero">
        <Field
          label={`当前态 · 截止第${card.stateAsOfChapter || 0}章`}
          value={card.state}
          onChange={(v) => set({ state: v })}
        />
      </div>
      <Zone title="身份">
        <FieldRow>
          <Field label="姓名" short value={card.name} onChange={(v) => set({ name: v })} />
          <Field
            label="功能位"
            short
            options={ROLES}
            value={card.role}
            onChange={(v) => set({ role: v as PersonCard['role'] })}
          />
        </FieldRow>
        <FieldRow>
          <Field label="本卷弧" short value={card.volumeArc} onChange={(v) => set({ volumeArc: v })} />
          <Field
            label="当前态截止章"
            short
            value={String(card.stateAsOfChapter || '')}
            onChange={(v) => set({ stateAsOfChapter: Number(v.replace(/\D/g, '')) || 0 })}
          />
        </FieldRow>
        <Field
          label="与主角的关系（此刻）"
          value={card.relationToLead}
          onChange={(v) => set({ relationToLead: v })}
        />
      </Zone>
      <Zone title="欲望结构">
        <Field label="欲望（这卷他要什么）" value={card.want} onChange={(v) => set({ want: v })} />
        <Field label="伤口（他为什么要）" value={card.wound} onChange={(v) => set({ wound: v })} />
      </Zone>
      <Zone title="信息限制">
        <Field
          label="秘密（读者可以知道、场上人还不知道）"
          value={card.secret}
          onChange={(v) => set({ secret: v })}
        />
        <Field
          label="不能知道的"
          warn
          value={card.mustNotKnow}
          onChange={(v) => set({ mustNotKnow: v })}
        />
      </Zone>
      <Zone title="声口">
        <Field label="说话方式" value={card.voice} onChange={(v) => set({ voice: v })} />
        <Field label="一句样本" value={card.voiceSample} onChange={(v) => set({ voiceSample: v })} />
      </Zone>
    </Section>
  )
}

export function RuleView({ card }: { card: RuleCard }) {
  const patch = usePatch()
  const set = (partial: Partial<RuleCard>) =>
    patch((b) => ({
      ...b,
      rules: b.rules.map((r) => (r.id === card.id ? { ...r, ...partial } : r)),
    }))
  return (
    <Section lot="规则" title={card.name || '未命名规则'}>
      <Zone title="怎么触发">
        <Field label="名称" short value={card.name} onChange={(v) => set({ name: v })} />
        <Field label="触发条件" value={card.trigger} onChange={(v) => set({ trigger: v })} />
        <Field label="与剧情的绑定" value={card.boundTo} onChange={(v) => set({ boundTo: v })} />
      </Zone>
      <Zone title="代价">
        <Field label="第一二次" value={card.firstTwo} onChange={(v) => set({ firstTwo: v })} />
        <Field label="第三次" value={card.third} onChange={(v) => set({ third: v })} />
        <Field
          label="次数 / 冷却 / 反噬"
          warn
          value={card.quota}
          onChange={(v) => set({ quota: v })}
        />
        <Field label="明确不能做什么" value={card.cannot} onChange={(v) => set({ cannot: v })} />
      </Zone>
    </Section>
  )
}

export function PlaceView({ card }: { card: PlaceCard }) {
  const patch = usePatch()
  const set = (partial: Partial<PlaceCard>) =>
    patch((b) => ({
      ...b,
      places: b.places.map((p) => (p.id === card.id ? { ...p, ...partial } : p)),
    }))
  return (
    <Section lot="地点" title={card.name || '未命名地点'}>
      <Zone title="这一场">
        <Field label="名称" short value={card.name} onChange={(v) => set({ name: v })} />
        <Field label="这一章用它干什么" value={card.job} onChange={(v) => set({ job: v })} />
        <Field label="谁能进来" value={card.whoEnters} onChange={(v) => set({ whoEnters: v })} />
        <Field label="藏着什么" value={card.hides} onChange={(v) => set({ hides: v })} />
      </Zone>
    </Section>
  )
}

export function BibleIndex({
  people,
  rules,
  places,
  onOpen,
  onAddPerson,
  onAddRule,
  onAddPlace,
}: {
  people: PersonCard[]
  rules: RuleCard[]
  places: PlaceCard[]
  onOpen: (id: DeskNodeId) => void
  onAddPerson?: () => void
  onAddRule?: () => void
  onAddPlace?: () => void
}) {
  return (
    <Section
      lot="设定集"
      title="人物、规则、地点"
      lead="章纲只吃编号与当前态。这里不写场面。空着就点下面的新建，或点右侧让 AI 写主角卡。"
      wide
    >
      <div className="wd-bible-cols">
        <div className="wd-bible-col">
          <h3>人物</h3>
          {people.length === 0 ? <p className="wd-ticket-sub">还没有人。</p> : null}
          {people.map((p) => (
            <button key={p.id} type="button" className="wd-tile" onClick={() => onOpen(personNode(p.id))}>
              <div className="wd-tile-h">
                <Stamp tone="open">{p.role}</Stamp>
                {p.name}
                <span className="wd-ticket-id">截止第{p.stateAsOfChapter}章</span>
              </div>
              <p className="wd-ticket-sub">{p.relationToLead}</p>
              <p className="wd-ticket-line">{p.want}</p>
              <p className="wd-tile-now">{p.state || '当前态还空'}</p>
              <p className="wd-tile-ban">不能知道：{p.mustNotKnow || '还没写'}</p>
            </button>
          ))}
          {onAddPerson ? (
            <button type="button" className="wd-action" onClick={onAddPerson}>
              新建人物
            </button>
          ) : null}
        </div>
        <div className="wd-bible-col">
          <h3>规则</h3>
          {rules.length === 0 ? <p className="wd-ticket-sub">还没有规则。</p> : null}
          {rules.map((r) => (
            <button key={r.id} type="button" className="wd-tile" onClick={() => onOpen(ruleNode(r.id))}>
              <div className="wd-tile-h">
                <Stamp tone="due">规则</Stamp>
                {r.name}
              </div>
              <p className="wd-ticket-line">{r.trigger}</p>
              <p className="wd-tile-ban">{r.quota || '配额还空'}</p>
              <p className="wd-tile-ban">不能：{r.cannot || '还没写'}</p>
            </button>
          ))}
          {onAddRule ? (
            <button type="button" className="wd-action" onClick={onAddRule}>
              新建规则
            </button>
          ) : null}
        </div>
        <div className="wd-bible-col">
          <h3>地点</h3>
          {places.length === 0 ? <p className="wd-ticket-sub">还没有地点。</p> : null}
          {places.map((p) => (
            <button key={p.id} type="button" className="wd-tile" onClick={() => onOpen(placeNode(p.id))}>
              <div className="wd-tile-h">
                <Stamp tone="open">地点</Stamp>
                {p.name}
              </div>
              <p className="wd-ticket-line">{p.job}</p>
              <p className="wd-ticket-sub">谁能进：{p.whoEnters}</p>
            </button>
          ))}
          {onAddPlace ? (
            <button type="button" className="wd-action" onClick={onAddPlace}>
              新建地点
            </button>
          ) : null}
        </div>
      </div>
    </Section>
  )
}
