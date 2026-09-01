import { describe, expect, it } from 'vitest'
import {
  advanceOfficeTask,
  applyRefinement,
  createOfficeTask,
  deliverableForTask,
  planForTask,
  titleForCustom,
} from './model'

describe('办公任务模型', () => {
  it('周报有四步，最后一步是落成 Word', () => {
    const plan = planForTask('weekly')
    expect(plan).toHaveLength(4)
    expect(plan[0].label).toMatch(/材料/)
    expect(plan.at(-1)?.label).toMatch(/Word/)
  })

  it('未知起手走通用四步', () => {
    expect(planForTask('nope').map((s) => s.id)).toEqual(['read', 'plan', 'draft', 'file'])
  })

  it('周报产物是 docx，预览里有风险和下周', () => {
    const file = deliverableForTask('weekly')
    expect(file.name).toMatch(/\.docx$/)
    expect(file.kind).toBe('doc')
    expect(file.preview).toContain('风险')
    expect(file.preview).toContain('下周')
    expect(file.actionItems?.length).toBeGreaterThan(0)
  })

  it('PPT 产物包含 8 页幻灯片卡片与演讲备注', () => {
    const file = deliverableForTask('deck')
    expect(file.name).toMatch(/\.pptx$/)
    expect(file.kind).toBe('pptx')
    expect(file.slides).toHaveLength(8)
    expect(file.slides?.[0].notes).toBeDefined()
  })

  it('合同审查产物包含法务风险条目与评级', () => {
    const file = deliverableForTask('contract')
    expect(file.riskItems?.length).toBeGreaterThan(0)
    expect(file.riskItems?.some((r) => r.level === 'high')).toBe(true)
  })

  it('Excel 对账分析包含表格列与数据行', () => {
    const file = deliverableForTask('excel_analysis')
    expect(file.kind).toBe('xlsx')
    expect(file.tableColumns?.length).toBeGreaterThan(0)
    expect(file.tableRows?.length).toBeGreaterThan(0)
  })

  it('自定义标题截断空白', () => {
    expect(titleForCustom('  给领导的一页纸请今天下午前  ')).toBe('给领导的一页纸请今天下午前')
    expect(titleForCustom('甲'.repeat(25))).toBe(`${'甲'.repeat(24)}…`)
    expect(titleForCustom('   ')).toBe('未命名任务')
  })

  it('从 idle 推到 done 会带上文件与工具执行日志', () => {
    let t = createOfficeTask('weekly', '', 't1')
    expect(t.status).toBe('idle')
    expect(t.file).toBeNull()
    const n = t.plan.length + 1
    for (let i = 0; i < n; i++) t = advanceOfficeTask(t)
    expect(t.status).toBe('done')
    expect(t.file?.name).toMatch(/周报/)
    expect(t.toolLog?.length).toBeGreaterThan(0)
    const again = advanceOfficeTask(t)
    expect(again).toEqual(t)
  })

  it('产物支持快捷微调迭代', () => {
    let t = createOfficeTask('weekly', '', 't1')
    for (let i = 0; i < t.plan.length + 1; i++) t = advanceOfficeTask(t)
    const refined = applyRefinement(t, '精简为一页纸')
    expect(refined.file?.summary).toContain('精简版')
  })
})
