/** 写台卡面模型。百万字靠章循环 + 案卷，不靠一次读完全书。 */

export type PersonRole = '主角' | '对手' | '盟友' | '工具'
export type ForeshadowState = 'open' | 'due' | 'closed'
export type ChapterJob = '推进' | '兑现' | '缓冲' | '翻盘'
export type HookKind = '悬念' | '反转' | '危机' | '信息差' | '选择'
export type PlatformId = 'tomato' | 'qidian'

export type DeskNodeId = string

export interface PitchCard {
  titles: string[]
  platform: string
  logline: string
  cheat: string
  cost: string
  comps: string
  emotion: string
  hooks: [string, string, string]
  firstThree: { ch1: string; ch2: string; ch3: string }
  forbiddenBook: string
}

export interface CanonCard {
  platform: string
  pov: string
  chapterWords: string
  schedule: string
  samples: [string, string, string]
  powerCap: string
  timeRule: string
  infoRule: string
  povRule: string
  narrativeBan: string
  settingBan: string
  sentenceBan: string
  doneWhen: string
}

export interface PersonCard {
  id: string
  name: string
  role: PersonRole
  want: string
  wound: string
  secret: string
  mustNotKnow: string
  voice: string
  voiceSample: string
  relationToLead: string
  stateAsOfChapter: number
  state: string
  volumeArc: string
}

export interface RuleCard {
  id: string
  name: string
  trigger: string
  firstTwo: string
  third: string
  quota: string
  /** 入卷后的剩余；空表示等于 quota */
  quotaLeft: string
  quotaAsOfChapter: number
  cannot: string
  boundTo: string
}

export interface PlaceCard {
  id: string
  name: string
  job: string
  whoEnters: string
  hides: string
}

export interface ForeshadowRow {
  id: string
  line: string
  plantVolume: string
  thisVolume: string
  closeWhen: string
  state: ForeshadowState
}

export interface OutlineCard {
  want: string
  need: string
  antagonistWant: string
  leverage: string
  causality: string
  act1: string
  act2: string
  act3: string
  foreshadows: ForeshadowRow[]
  volumeUpgrade: string[]
}

export interface CampaignSlice {
  id: string
  name: string
  win: string
  inState: string
  outState: string
}

export interface VolumeCard {
  id: string
  title: string
  question: string
  antagonist: string
  rulePressure: string
  campaigns: CampaignSlice[]
  mustPay: string[]
  mustNotPay: string[]
  slap: string
  climax: string
  endChange: string
  readerKnows: string
  leadDoesNot: string
  allyKnows: string
}

export interface UnitCard {
  id: string
  volumeId: string
  name: string
  chapters: string
  campaign: string
  win: string
  antagonistMove: string
  spent: string
  infoPlan: string
  endHook: string
  peopleChange: string
}

export interface ChapterCard {
  id: string
  no: number
  title: string
  unitId: string
  job: ChapterJob
  openHook: string
  goal: string
  resistance: string
  turn: string
  pleasure: string
  infoGive: string
  infoForbid: string
  cast: string[]
  plant: string
  press: string
  close: string
  endHookKind: HookKind | ''
  endHook: string
  words: string
  mood: string
  platform: PlatformId
  locked?: boolean
  lockReason?: string
}

export interface BeatCard {
  id: string
  title: string
  scene: string
  job: string
  dialogue: string
  info: string
  mood: string
  land: string
}

export interface DraftPage {
  chapterId: string
  accepted: boolean
  beats: { beatId: string; body: string }[]
}

export interface ReviewCard {
  chapterId: string
  openHookOk: string
  goalOk: string
  endHookOk: string
  voiceLeak: string
  forbiddenKnow: string
  cheatAbuse: string
  dueSeen: string
  unnumbered: string
  states: string[]
  foreshadow: string[]
  summary80: string
  adopted: boolean
}

export interface BookDemo {
  id: string
  title: string
  /** 最近保存时间（ISO；落盘时写入，书库排序用） */
  updatedAt?: string
  pitch: PitchCard
  canon: CanonCard
  people: PersonCard[]
  rules: RuleCard[]
  places: PlaceCard[]
  outline: OutlineCard
  volumes: VolumeCard[]
  units: UnitCard[]
  chapters: ChapterCard[]
  beatsByChapter: Record<string, BeatCard[]>
  drafts: DraftPage[]
  reviews: ReviewCard[]
}

export type Gate = {
  id: string
  from: string
  to: string
  ok: boolean
  need: string
}
