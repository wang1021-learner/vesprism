import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRODUCT_ID,
  getProduct,
  indexProducts,
  isRegisteredProduct,
  listedProducts,
  navLabelForKind,
  productIdForUtility,
  productOwnsUtility,
  productSessionGroupKeys,
  PRODUCTS,
  type ProductDef,
} from './catalog'

function extraProduct(partial: Partial<ProductDef> & Pick<ProductDef, 'id' | 'label'>): ProductDef {
  return {
    utilityKinds: [],
    emptyView: 'home',
    showRightPanel: false,
    showNewChat: false,
    showTabPlus: false,
    showAddProject: false,
    sessionList: 'product',
    sidebarNavLabel: '入口',
    sidebarListLabel: '会话',
    emptyHint: '',
    sidebarEntries: [],
    ...partial,
  }
}

describe('产品表', () => {
  it('默认产品是编码，工作台认领画布/编制/试跑/自动化任务', () => {
    expect(DEFAULT_PRODUCT_ID).toBe('coding')
    expect(getProduct('coding').isDefault).toBe(true)
    expect(getProduct('workbench').label).toBe('工作台')
    expect(productIdForUtility(null)).toBe('coding')
    expect(productIdForUtility('skills')).toBe('coding')
    expect(productIdForUtility('flow-canvas')).toBe('workbench')
    expect(productIdForUtility('agents')).toBe('workbench')
    expect(productIdForUtility('flow-run')).toBe('workbench')
    expect(productIdForUtility('workflows')).toBe('workbench')
    expect(productOwnsUtility('workbench', 'agents')).toBe(true)
    expect(productOwnsUtility('workbench', null)).toBe(false)
    expect(productOwnsUtility('coding', null)).toBe(true)
    expect(getProduct('writing').label).toBe('写完')
    expect(getProduct('writing').utilityKinds).toEqual(['writing-desk'])
    expect(productIdForUtility('writing-desk')).toBe('writing')
    expect(productIdForUtility('flow-canvas')).toBe('workbench')
  })

  it('未登记 id 回落到默认产品；顶栏只列 listed 产品', () => {
    expect(isRegisteredProduct('coding')).toBe(true)
    expect(isRegisteredProduct('nope')).toBe(false)
    expect(getProduct('nope').id).toBe('coding')
    expect(listedProducts().map((p) => p.id)).toEqual(['coding', 'workbench', 'writing'])
  })

  it('干活会话分组 key 来自表，不写死壳名', () => {
    expect(productSessionGroupKeys()).toEqual(['__workbench__', '__writing__'])
    expect(navLabelForKind('flow-canvas')).toBe('流程画布')
    expect(navLabelForKind('schedule')).toBe('定时任务')
    expect(navLabelForKind('writing-desk')).toBe('写台')
  })

  it('往表里加第三条即可被索引，不必改联合类型', () => {
    const listed = extraProduct({
      id: 'design',
      label: '设计',
      utilityKinds: ['plugins'],
      sessionGroupKey: '__design__',
      listed: true,
    })
    const hidden = extraProduct({
      id: 'draft',
      label: '草稿',
      listed: false,
    })
    const idx = indexProducts([...PRODUCTS, listed, hidden])
    expect(idx.defaultId).toBe('coding')
    expect(idx.byId.get('design')?.label).toBe('设计')
    expect(idx.utilityToProduct.get('plugins')).toBe('design')
    expect(idx.utilityToProduct.get('flow-canvas')).toBe('workbench')
    expect(idx.byId.has('draft')).toBe(true)
    const visible = [...idx.byId.values()].filter((p) => p.listed !== false).map((p) => p.id)
    expect(visible).toEqual(['coding', 'workbench', 'writing', 'design'])
  })
})
