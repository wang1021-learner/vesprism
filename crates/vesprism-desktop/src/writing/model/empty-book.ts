import type { BookDemo, CanonCard, PitchCard } from './types'

const emptyPitch = (): PitchCard => ({
  titles: [],
  platform: '',
  logline: '',
  cheat: '',
  cost: '',
  comps: '',
  emotion: '',
  hooks: ['', '', ''],
  firstThree: { ch1: '', ch2: '', ch3: '' },
  forbiddenBook: '',
})

const emptyCanon = (): CanonCard => ({
  platform: '',
  pov: '',
  chapterWords: '2000～2500',
  schedule: '',
  samples: ['', '', ''],
  powerCap: '',
  timeRule: '',
  infoRule: '',
  povRule: '',
  narrativeBan: '',
  settingBan: '',
  sentenceBan: '',
  doneWhen: '',
})

/** 开新书。入口只收书名、平台、一句话；其余仍空。 */
export function emptyBook(init?: { title?: string; platform?: string; logline?: string }): BookDemo {
  const title = (init?.title || '').trim() || '未命名'
  const platform = (init?.platform || '').trim()
  const logline = (init?.logline || '').trim()
  const pitch = emptyPitch()
  pitch.titles = title === '未命名' ? [] : [title]
  pitch.platform = platform
  pitch.logline = logline
  return {
    id: `book-${Date.now()}`,
    title,
    pitch,
    canon: emptyCanon(),
    people: [],
    rules: [],
    places: [],
    outline: {
      want: '',
      need: '',
      antagonistWant: '',
      leverage: '',
      causality: '',
      act1: '',
      act2: '',
      act3: '',
      foreshadows: [],
      volumeUpgrade: [],
    },
    volumes: [],
    units: [],
    chapters: [],
    beatsByChapter: {},
    drafts: [],
    reviews: [],
  }
}
