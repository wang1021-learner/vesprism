import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { advanceOfficeTask, createOfficeTask } from './model'
import {
  $officeActiveId,
  $officeFormat,
  $officeTasks,
  startOfficeTask,
} from './store'
import {
  OFFICE_PERSIST_KEY,
  bootOfficePersist,
  formatOfficeClock,
  hydrateOfficeTasks,
  loadOfficePersist,
  resetOfficePersistForTests,
  saveOfficePersist,
} from './persist'

function installStorage() {
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    clear: () => {
      map.clear()
    },
    key: () => null,
    get length() {
      return map.size
    },
  }
  vi.stubGlobal('localStorage', storage)
  return map
}

describe('office persist', () => {
  beforeEach(() => {
    resetOfficePersistForTests()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    resetOfficePersistForTests()
    vi.unstubAllGlobals()
  })

  it('没有 localStorage 时 load 返回 null、save 不扔', () => {
    expect(loadOfficePersist()).toBeNull()
    expect(() =>
      saveOfficePersist({
        v: 1,
        tasks: [],
        activeId: null,
        panel: 'home',
        folderId: 'week',
        format: 'doc',
        permission: 'default',
      }),
    ).not.toThrow()
  })

  it('周报 running 且无 file 时 hydrate 成 done 并带风险预览', () => {
    const t = createOfficeTask('weekly', '', 't-week', 'week', 'doc')
    t.status = 'running'
    t.stepIndex = 1
    t.file = null
    const out = hydrateOfficeTasks({
      v: 1,
      tasks: [t],
      activeId: 't-week',
      panel: 'home',
      folderId: 'week',
      format: 'doc',
      permission: 'default',
    })
    expect(out.tasks).toHaveLength(1)
    expect(out.tasks[0].status).toBe('done')
    expect(out.tasks[0].file?.preview).toContain('风险')
    expect(out.activeId).toBe('t-week')
  })

  it('缺 slides 的 pptx 任务被 skip，其它任务留下', () => {
    let done = createOfficeTask('weekly', '', 'good', 'week', 'doc')
    while (done.status !== 'done') done = advanceOfficeTask(done)
    const bad = {
      ...createOfficeTask('deck', '', 'bad', 'week', 'pptx'),
      status: 'done' as const,
      file: {
        name: '坏.pptx',
        title: '坏',
        kind: 'pptx' as const,
        summary: 'x',
        preview: 'x',
      },
    }
    const out = hydrateOfficeTasks({
      v: 1,
      tasks: [bad, done],
      activeId: 'bad',
      panel: 'home',
      folderId: 'week',
      format: 'doc',
      permission: 'default',
    })
    expect(out.tasks.map((x) => x.id)).toEqual(['good'])
    expect(out.activeId).toBeNull()
  })

  it('custom running + format pptx hydrate 成一页幻灯片，不被顶层 format doc 盖掉', () => {
    const t = createOfficeTask('custom', '做一页', 't-ppt', 'week', 'pptx')
    t.status = 'running'
    t.file = null
    const out = hydrateOfficeTasks({
      v: 1,
      tasks: [t],
      activeId: 't-ppt',
      panel: 'home',
      folderId: 'week',
      format: 'doc',
      permission: 'default',
    })
    expect(out.tasks[0].file?.kind).toBe('pptx')
    expect(out.tasks[0].file?.slides).toHaveLength(1)
  })

  it('boot 两次：第二次不得盖掉内存里刚 start 的任务', () => {
    const map = installStorage()
    saveOfficePersist({
      v: 1,
      tasks: [],
      activeId: null,
      panel: 'home',
      folderId: 'week',
      format: 'doc',
      permission: 'default',
    })
    expect(map.has(OFFICE_PERSIST_KEY)).toBe(true)
    bootOfficePersist()
    startOfficeTask('weekly', '刚起的')
    expect($officeTasks.get()).toHaveLength(1)
    bootOfficePersist()
    expect($officeTasks.get()[0]?.prompt).toContain('刚起')
  })

  it('首页 startOfficeTask custom 读 $officeFormat；技能第四参压过 atom', () => {
    installStorage()
    bootOfficePersist()
    $officeFormat.set('pptx')
    const custom = startOfficeTask('custom', '做一页')
    let t = $officeTasks.get().find((x) => x.id === custom.id)!
    while (t.status !== 'done') t = advanceOfficeTask(t)
    expect(t.file?.kind).toBe('pptx')
    expect(t.file?.slides).toHaveLength(1)

    resetOfficePersistForTests()
    installStorage()
    bootOfficePersist()
    $officeFormat.set('pptx')
    const weekly = startOfficeTask('weekly', '')
    expect(weekly.starterId).toBe('weekly')
    let w = weekly
    while (w.status !== 'done') w = advanceOfficeTask(w)
    expect(w.file?.kind).toBe('doc')

    resetOfficePersistForTests()
    installStorage()
    bootOfficePersist()
    $officeFormat.set('pptx')
    const skill = startOfficeTask('custom', '技能稿', undefined, 'doc')
    let s = skill
    while (s.status !== 'done') s = advanceOfficeTask(s)
    expect(s.file?.kind).toBe('doc')
    expect(s.format).toBe('doc')
  })

  it('没有 window 时 boot 不扔', () => {
    expect(() => bootOfficePersist()).not.toThrow()
    expect($officeActiveId.get()).toBeNull()
  })

  it('formatOfficeClock 把 ISO 收成 HH:mm，已是钟点则原样', () => {
    expect(formatOfficeClock('09:07')).toBe('09:07')
    const clock = formatOfficeClock('2026-09-01T01:05:00.000Z')
    expect(clock).toMatch(/^\d{2}:\d{2}$/)
  })

  it('旧 persist 的 experts 面板映射到 agents', () => {
    const out = hydrateOfficeTasks({
      v: 1,
      tasks: [],
      activeId: null,
      panel: 'experts',
      folderId: 'week',
      format: 'doc',
      permission: 'default',
    })
    expect(out.panel).toBe('agents')
  })
})
