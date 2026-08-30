/**
 * 产品表。壳切换、侧栏入口、首页、Tab 过滤都查这里。
 *
 * 加新产品：往 PRODUCTS 推一条；专用面板仍在 AppMainBody 按 utilityKind 挂。
 * 不要再给 AppShell 加联合成员。listed: false 可先登记不出现在顶栏。
 */

export type ProductId = string

/** 侧栏入口 / 首页卡片 / 专用面板。schedule 只导航，不开 Tab。 */
export type ProductNavKind =
  | 'schedule'
  | 'mcp'
  | 'skills'
  | 'tools'
  | 'workflows'
  | 'flow-canvas'
  | 'flow-run'
  | 'agents'
  | 'memory'
  | 'plugins'
  | 'writing-desk'

export type ProductSidebarEntry = {
  kind: ProductNavKind
  label: string
}

export type ProductHomeCard = {
  kind: ProductNavKind
  title: string
  hint: string
}

export type ProductHomeCopy = {
  kicker: string
  title: string
  lead: string
  cards: readonly ProductHomeCard[]
}

export type ProductDef = {
  id: ProductId
  label: string
  /** 未声明的 utilityKind / 普通对话归这个产品。必须恰好一条。 */
  isDefault?: boolean
  /** 属于本产品的专用面板。未被认领的 kind 归默认产品。 */
  utilityKinds: readonly ProductNavKind[]
  /**
   * home：当前 Tab 不属于本产品时显示入口页（工作台）。
   * stay：切过来时尽量落到已有对话 Tab（编码）。
   * panel：只有一个专用面板，切过来就打开它，不再套一层入口页（写完）。
   */
  emptyView: 'home' | 'stay' | 'panel'
  showRightPanel: boolean
  showNewChat: boolean
  showTabPlus: boolean
  showAddProject: boolean
  /** projects=按仓库分组；product=本产品干活会话一组；none=不列引擎会话（写完用书库）。 */
  sessionList: 'projects' | 'product' | 'none'
  /** sessionList=product 时侧栏分组 key */
  sessionGroupKey?: string
  sidebarNavLabel: string
  sidebarListLabel: string
  emptyHint: string
  home?: ProductHomeCopy
  sidebarEntries: readonly ProductSidebarEntry[]
  /** 默认 true；false 登记但不出现在顶栏切换。 */
  listed?: boolean
}

export type ProductIndex = {
  defaultId: ProductId
  byId: Map<ProductId, ProductDef>
  utilityToProduct: Map<string, ProductId>
}

export function indexProducts(list: readonly ProductDef[]): ProductIndex {
  const byId = new Map<ProductId, ProductDef>()
  const utilityToProduct = new Map<string, ProductId>()
  let defaultId = ''
  for (const p of list) {
    byId.set(p.id, p)
    if (p.isDefault) defaultId = p.id
    for (const kind of p.utilityKinds) {
      utilityToProduct.set(kind, p.id)
    }
  }
  if (!defaultId) defaultId = list[0]?.id ?? 'coding'
  return { defaultId, byId, utilityToProduct }
}

export const PRODUCTS: readonly ProductDef[] = [
  {
    id: 'coding',
    label: '编码',
    isDefault: true,
    utilityKinds: [],
    emptyView: 'stay',
    showRightPanel: true,
    showNewChat: true,
    showTabPlus: true,
    showAddProject: true,
    sessionList: 'projects',
    sidebarNavLabel: '能力入口',
    sidebarListLabel: '会话',
    emptyHint: '暂无历史会话。点上方 + 添加项目。',
    sidebarEntries: [{ kind: 'schedule', label: '定时任务' }],
  },
  {
    id: 'workbench',
    label: '工作台',
    utilityKinds: ['flow-canvas', 'agents', 'flow-run', 'workflows'],
    emptyView: 'home',
    showRightPanel: false,
    showNewChat: false,
    showTabPlus: false,
    showAddProject: false,
    sessionList: 'product',
    sessionGroupKey: '__workbench__',
    sidebarNavLabel: '工作台入口',
    sidebarListLabel: '干活会话',
    emptyHint: '还没有画布或编制会话。',
    home: {
      kicker: '工作台',
      title: '画布、编制、自动化任务',
      lead: '编码对话还在另一边。这里只放流程和岗位。',
      cards: [
        { kind: 'flow-canvas', title: '流程画布', hint: '编排节点、发布可调用流程' },
        { kind: 'agents', title: 'Agent 编制', hint: '岗位、权限与人设' },
        { kind: 'workflows', title: '自动化任务', hint: '已发布流程与定时任务脚本' },
      ],
    },
    sidebarEntries: [
      { kind: 'workflows', label: '自动化任务' },
      { kind: 'flow-canvas', label: '流程画布' },
      { kind: 'agents', label: 'Agent 编制' },
    ],
  },
  {
    id: 'writing',
    label: '写完',
    utilityKinds: ['writing-desk'],
    emptyView: 'panel',
    showRightPanel: false,
    showNewChat: false,
    showTabPlus: true,
    showAddProject: false,
    sessionList: 'none',
    sessionGroupKey: '__writing__',
    sidebarNavLabel: '写作入口',
    sidebarListLabel: '书',
    emptyHint: '还没有书。点 + 新建一本。',
    sidebarEntries: [{ kind: 'writing-desk', label: '写台' }],
  },
]

const INDEX = indexProducts(PRODUCTS)

export const DEFAULT_PRODUCT_ID: ProductId = INDEX.defaultId

export function listedProducts(): ProductDef[] {
  return PRODUCTS.filter((p) => p.listed !== false)
}

export function isRegisteredProduct(id: string | null | undefined): id is ProductId {
  return Boolean(id && INDEX.byId.has(id))
}

export function getProduct(id: string | null | undefined): ProductDef {
  return (
    (id && INDEX.byId.get(id)) ||
    INDEX.byId.get(INDEX.defaultId) ||
    PRODUCTS[0]
  )
}

export function productIdForUtility(kind: string | null | undefined): ProductId {
  if (!kind) return INDEX.defaultId
  return INDEX.utilityToProduct.get(kind) ?? INDEX.defaultId
}

export function productOwnsUtility(
  productId: string,
  kind: string | null | undefined,
): boolean {
  return productIdForUtility(kind) === productId
}

export function productSessionGroupKeys(): string[] {
  return PRODUCTS.map((p) => p.sessionGroupKey).filter(
    (k): k is string => Boolean(k),
  )
}

export function isProductSessionGroup(cwdKey: string): boolean {
  return productSessionGroupKeys().includes(cwdKey)
}

/** 写完列书，不列引擎会话。sessionList=none 时侧栏禁止走项目/干活会话，展开和收起都不画能力入口。 */
export function usesEngineSessionList(product: ProductDef): boolean {
  return product.sessionList !== 'none'
}

/** 切到该产品时直接打开专用面板，不经过营销入口页。 */
export function landsOnOwnPanel(product: ProductDef): boolean {
  return product.emptyView === 'panel'
}

export function navLabelForKind(kind: string): string {
  for (const p of PRODUCTS) {
    const entry = p.sidebarEntries.find((e) => e.kind === kind)
    if (entry) return entry.label
    const card = p.home?.cards.find((c) => c.kind === kind)
    if (card) return card.title
  }
  return kind
}
