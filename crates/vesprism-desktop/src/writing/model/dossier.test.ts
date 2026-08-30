import { describe, expect, it } from 'vitest'
import { YANPIN_EYE } from './demo-yanpin'
import { bookDossier, foreshadowJump, foreshadowLabel } from './dossier'

describe('写台案卷', () => {
  it('到期伏线跳到点名的章，未点名的回总纲', () => {
    const f001 = YANPIN_EYE.outline.foreshadows.find((f) => f.id === 'F001')
    const f002 = YANPIN_EYE.outline.foreshadows.find((f) => f.id === 'F002')
    expect(f001 && foreshadowJump(f001)).toBe('ch-4')
    expect(f002 && foreshadowJump(f002)).toBe('outline')
    expect(foreshadowLabel('due')).toBe('到期')
    expect(foreshadowLabel('open')).toBe('未收')
  })

  it('案卷列出伏线、人物当前态、规则配额', () => {
    const dossier = bookDossier(YANPIN_EYE)
    expect(dossier.foreshadows.map((f) => f.id)).toEqual(['F001', 'F003', 'F002', 'F004'])
    expect(dossier.people.some((p) => p.id === 'shen' && p.asOf === 3)).toBe(true)
    expect(dossier.rules[0]?.name).toBe('鉴真瞳')
    expect(dossier.places.map((p) => p.id)).toEqual(['hall', 'vault'])
  })
})
