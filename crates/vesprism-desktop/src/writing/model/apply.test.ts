import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import {
  adoptIntoDossier,
  applyBeatBody,
  applyFillResult,
  applyReviewFromJson,
  draftBodyForBeat,
  fillTargetOf,
  mergeJsonIntoCard,
  parseDraftFromText,
  registerForeshadowsFromReview,
  upsertDraft,
} from './apply'
import { writeSlice } from './slice'

describe('写台真实回写', () => {
  it('草稿按「【切块】正文」分块，映射回节拍', () => {
    const slice = writeSlice(YANPIN_EYE, 'ch-4')
    const draft = parseDraftFromText(
      '【切块 1】他伸手推门。\n【切块 2】旧门半开。\n\n【切块 3】有人先到。',
      'ch-4',
      slice,
    )
    expect(draft.accepted).toBe(false)
    expect(draft.chapterId).toBe('ch-4')
    expect(draft.beats.map((b) => b.body)).toEqual([
      '他伸手推门。',
      '旧门半开。',
      '有人先到。',
    ])
    // beatId 映射到已存在的节拍（标题匹配）
    expect(draft.beats[0]?.beatId).toBe(slice?.beats[0]?.id)
  })

  it('草稿按节拍标题「旧门」映射，不靠切块序号碰巧对上', () => {
    const slice = writeSlice(YANPIN_EYE, 'ch-4')
    const draft = parseDraftFromText(
      '【旧门】他伸手推门。\n【逼开】旧门半开。\n【死局】有人先到。',
      'ch-4',
      slice,
    )
    expect(draft.beats.map((b) => b.beatId)).toEqual(slice?.beats.map((b) => b.id))
    expect(draftBodyForBeat(draft, slice?.beats[1]?.id || '', '')).toBe('旧门半开。')
  })

  it('没有分块标记时整段归第一个切块', () => {
    const slice = writeSlice(YANPIN_EYE, 'ch-4')
    const draft = parseDraftFromText('一整段正文，没有标题。', 'ch-4', slice)
    expect(draft.beats).toHaveLength(1)
    expect(draft.beats[0]?.body).toContain('一整段正文')
  })

  it('upsertDraft 同章只留最新一版', () => {
    const a = upsertDraft(YANPIN_EYE, { chapterId: 'ch-4', accepted: false, beats: [] })
    const b = upsertDraft(a, {
      chapterId: 'ch-4',
      accepted: true,
      beats: [{ beatId: 'ch-4-b1', body: '定稿' }],
    })
    expect(b.drafts.filter((d) => d.chapterId === 'ch-4')).toHaveLength(1)
    expect(b.drafts.find((d) => d.chapterId === 'ch-4')?.accepted).toBe(true)
  })

  it('检查单 JSON 填卡，adopted 保持原值', () => {
    const json = {
      openHookOk: '前 300 字落地。',
      goalOk: '目标做成。',
      endHookOk: '钩还在。',
      states: ['沈见真：看见死局。'],
      foreshadow: ['F001：due → 兑现'],
      summary80: '80 字。',
    }
    const next = applyReviewFromJson(YANPIN_EYE, 'ch-4', json)
    const card = next.reviews.find((r) => r.chapterId === 'ch-4')
    expect(card?.openHookOk).toBe('前 300 字落地。')
    expect(card?.states).toEqual(['沈见真：看见死局。'])
    expect(card?.adopted).toBe(false)
  })

  it('入卷：必须已进正史；写回当前态；解锁下一章而不是本章', () => {
    const withReview = applyReviewFromJson(YANPIN_EYE, 'ch-4', {
      states: ['沈见真：配额用尽，瞳孔见血。', '顾晚宁：没拦住第三次。'],
      foreshadow: ['F001：已收。'],
      summary80: '库房旧门有人逼开第三眼。',
    })
    expect(adoptIntoDossier(withReview, 'ch-4').reviews.find((r) => r.chapterId === 'ch-4')?.adopted).toBe(
      false,
    )
    const accepted = {
      ...withReview,
      drafts: withReview.drafts.map((d) => (d.chapterId === 'ch-4' ? { ...d, accepted: true } : d)),
    }
    const next = adoptIntoDossier(accepted, 'ch-4')
    expect(next.reviews.find((r) => r.chapterId === 'ch-4')?.adopted).toBe(true)
    const shen = next.people.find((p) => p.name === '沈见真')
    expect(shen?.state).toContain('配额用尽')
    expect(shen?.stateAsOfChapter).toBe(4)
    expect(next.outline.foreshadows.find((f) => f.id === 'F001')?.state).toBe('closed')
    expect(next.chapters.find((c) => c.id === 'ch-4')?.locked).toBeFalsy()
    expect(next.chapters.find((c) => c.id === 'ch-5')?.locked).toBe(false)
  })

  it('补卡：lead 目标自动建主角卡，AI JSON 只覆盖非空字段', () => {
    const { book, card } = fillTargetOf(YANPIN_EYE, 'lead')
    expect(book.people.some((p) => p.role === '主角')).toBe(true)
    const merged = mergeJsonIntoCard(card, {
      name: '沈见真',
      want: '看懂那面门',
      secret: '',
      state: '刚开第三眼',
    })
    expect(merged.want).toBe('看懂那面门')
    // 空串不覆盖
    expect(merged.secret).toBe(YANPIN_EYE.people[0]?.secret ?? '')
  })

  it('补卡：beats 整组替换', () => {
    const { book: withBeats, card } = fillTargetOf(YANPIN_EYE, 'beats', 'ch-4')
    const merged = mergeJsonIntoCard(card, {
      beats: [
        { title: '开门', scene: '库房' },
        { title: '对视', scene: '旧门' },
        { title: '逼问', scene: '廊下' },
      ],
    })
    const next = applyFillResult(withBeats, 'beats', merged, 'ch-4')
    expect(next.beatsByChapter['ch-4']?.map((b) => b.title)).toEqual([
      '开门',
      '对视',
      '逼问',
    ])
  })

  it('补卡：写章纲打正在看的那一章，不是最后一章', () => {
    const { card } = fillTargetOf(YANPIN_EYE, 'chapter', { chapterId: 'ch-1' })
    expect(card.id).toBe('ch-1')
    expect(card.no).toBe(1)
  })

  it('补卡：章纲出场名字解析成设定集 id', () => {
    const { book, card } = fillTargetOf(YANPIN_EYE, 'chapter', { chapterId: 'ch-4' })
    const merged = mergeJsonIntoCard(card, { cast: ['沈见真', '顾晚宁', '地下库房'] })
    const next = applyFillResult(book, 'chapter', merged, { chapterId: 'ch-4' })
    const ch = next.chapters.find((c) => c.id === 'ch-4')
    expect(ch?.cast).toEqual(['shen', 'gu', 'vault'])
  })

  it('补卡：开卷 titles 写成字符串也不会把卡打崩', () => {
    const { book, card } = fillTargetOf(YANPIN_EYE, 'pitch')
    const merged = mergeJsonIntoCard(card, {
      titles: '赝品眼 / 第二名',
      hooks: '打脸',
      firstThree: '只有一句',
    })
    const next = applyFillResult(book, 'pitch', merged)
    expect(Array.isArray(next.pitch.titles)).toBe(true)
    expect(next.pitch.titles[0]).toBe('赝品眼')
    expect(next.pitch.hooks).toHaveLength(3)
    expect(next.pitch.firstThree.ch1).toBeTruthy()
  })

  it('洗这块只覆盖选中 beat 的正文，节拍 job/info/land 不变', () => {
    const beatId = YANPIN_EYE.beatsByChapter['ch-4'][0].id
    const otherId = YANPIN_EYE.beatsByChapter['ch-4'][1].id
    const beforeJobs = YANPIN_EYE.beatsByChapter['ch-4'].map((b) => b.job)
    const beforeOther = YANPIN_EYE.drafts
      .find((d) => d.chapterId === 'ch-4')
      ?.beats.find((b) => b.beatId === otherId)?.body
    const next = applyBeatBody(YANPIN_EYE, 'ch-4', beatId, '洗过的句子，没有套话。')
    const draft = next.drafts.find((d) => d.chapterId === 'ch-4')
    expect(draft?.beats.find((b) => b.beatId === beatId)?.body).toBe('洗过的句子，没有套话。')
    expect(draft?.beats.find((b) => b.beatId === otherId)?.body).toBe(beforeOther)
    expect(next.beatsByChapter['ch-4'].map((b) => b.job)).toEqual(beforeJobs)
    expect(next.beatsByChapter['ch-4'].map((b) => [b.info, b.land])).toEqual(
      YANPIN_EYE.beatsByChapter['ch-4'].map((b) => [b.info, b.land]),
    )
  })

  it('入卷按 id 写当前态；同名只改对上的那张', () => {
    const twins = {
      ...YANPIN_EYE,
      people: [
        ...YANPIN_EYE.people,
        { ...YANPIN_EYE.people[0], id: 'shen-2', name: '沈见真', state: '影子未被改' },
      ],
    }
    const withReview = applyReviewFromJson(twins, 'ch-4', {
      states: ['shen：配额用尽'],
      summary80: '库房旧门有人逼开第三眼。',
    })
    const accepted = {
      ...withReview,
      drafts: withReview.drafts.map((d) => (d.chapterId === 'ch-4' ? { ...d, accepted: true } : d)),
    }
    const next = adoptIntoDossier(accepted, 'ch-4')
    expect(next.people.find((p) => p.id === 'shen')?.state).toContain('配额用尽')
    expect(next.people.find((p) => p.id === 'shen-2')?.state).toBe('影子未被改')
  })

  it('名字回退仍可用；规则配额和地点谁能进按 id 写回', () => {
    const withReview = applyReviewFromJson(YANPIN_EYE, 'ch-4', {
      states: ['沈见真：看见死局。', 'eye：剩余 0 次', 'vault：只有夜场员工'],
      foreshadow: ['F001：已收。'],
      summary80: '库房旧门有人逼开第三眼。',
    })
    const accepted = {
      ...withReview,
      drafts: withReview.drafts.map((d) => (d.chapterId === 'ch-4' ? { ...d, accepted: true } : d)),
    }
    const next = adoptIntoDossier(accepted, 'ch-4')
    expect(next.people.find((p) => p.id === 'shen')?.state).toContain('看见死局')
    expect(next.people.find((p) => p.id === 'shen')?.stateAsOfChapter).toBe(4)
    expect(next.rules.find((r) => r.id === 'eye')?.quotaLeft).toContain('0')
    expect(next.rules.find((r) => r.id === 'eye')?.quotaAsOfChapter).toBe(4)
    expect(next.places.find((p) => p.id === 'vault')?.whoEnters).toContain('夜场员工')
  })

  it('未编号行能进伏笔表，不覆盖已有 F001', () => {
    const withReview = applyReviewFromJson(YANPIN_EYE, 'ch-4', {
      unnumbered: '旧门后还有第二把钥匙',
    })
    const next = registerForeshadowsFromReview(withReview, 'ch-4')
    const added = next.outline.foreshadows.filter((f) => f.line.includes('第二把钥匙'))
    expect(added).toHaveLength(1)
    expect(added[0].id).toMatch(/^F\d{3}$/)
    expect(added[0].state).toBe('open')
    expect(next.outline.foreshadows.find((f) => f.id === 'F001')?.line).toBe(
      YANPIN_EYE.outline.foreshadows.find((f) => f.id === 'F001')?.line,
    )
  })

  it('摘要空则入卷不写回、不解锁下一章', () => {
    const withReview = applyReviewFromJson(YANPIN_EYE, 'ch-4', {
      states: ['沈见真：不该被写回'],
      summary80: '  ',
    })
    const accepted = {
      ...withReview,
      drafts: withReview.drafts.map((d) => (d.chapterId === 'ch-4' ? { ...d, accepted: true } : d)),
      chapters: withReview.chapters.map((c) =>
        c.id === 'ch-5' ? { ...c, locked: true, lockReason: '没入卷' } : c,
      ),
    }
    const next = adoptIntoDossier(accepted, 'ch-4')
    expect(next.reviews.find((r) => r.chapterId === 'ch-4')?.adopted).toBe(false)
    expect(next.people.find((p) => p.id === 'shen')?.state).toBe(
      YANPIN_EYE.people.find((p) => p.id === 'shen')?.state,
    )
    expect(next.chapters.find((c) => c.id === 'ch-5')?.locked).toBe(true)
  })
})
