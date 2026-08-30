import { openChatTab } from '../lib/openChatTab'
import type { UtilityKind } from '../store'
import { type ProductDef, type ProductNavKind } from './catalog'

function isUtilityKind(kind: ProductNavKind): kind is UtilityKind {
  return kind !== 'schedule'
}

/** 写完当前没有写台 Tab：空桌，不自动再建一枚。点书或点 + 再开。 */
export function ProductLand({ product }: { product: ProductDef }) {
  return (
    <div className="wd-desk wd-desk--empty" role="status">
      <p className="wd-kicker">{product.label}</p>
      <h1>从左边打开一本书</h1>
      <p>入口是书库。点 + 可新开一枚写台。关掉最后一枚不会再自动补回来。</p>
    </div>
  )
}

/** 产品入口页：文案和卡片来自产品表。 */
export function ProductHome({ product }: { product: ProductDef }) {
  const home = product.home
  if (!home) return null
  return (
    <div className="workbench-home" role="main" aria-label={product.label}>
      <div className="workbench-home-inner">
        <p className="workbench-home-kicker">{home.kicker}</p>
        <h1 className="workbench-home-title">{home.title}</h1>
        <p className="workbench-home-lead">{home.lead}</p>
        <div className="workbench-home-cards">
          {home.cards.map((c) => (
            <button
              key={c.kind}
              type="button"
              className="workbench-home-card"
              onClick={() => {
                if (!isUtilityKind(c.kind)) return
                void openChatTab({ title: c.title, utilityKind: c.kind })
              }}
            >
              <span className="workbench-home-card-title">{c.title}</span>
              <span className="workbench-home-card-hint">{c.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
