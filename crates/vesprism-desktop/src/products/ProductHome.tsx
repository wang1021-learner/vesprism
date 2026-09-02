import { useEffect } from 'react'
import { openChatTab } from '../lib/openChatTab'
import type { UtilityKind } from '../store'
import { navLabelForKind, type ProductDef, type ProductNavKind } from './catalog'

function isUtilityKind(kind: ProductNavKind): kind is UtilityKind {
  return kind !== 'schedule'
}

/** 面板型产品还没有专用 Tab：空桌。文案来自产品表。 */
export function ProductLand({ product }: { product: ProductDef }) {
  const kind = product.utilityKinds.find((k) => k !== 'schedule')
  const title = product.emptyTitle || product.label
  const lead = product.emptyLead || product.emptyHint
  return (
    <div className="wd-desk wd-desk--empty" role="status" aria-label={product.label}>
      <article className="wd-empty-sheet">
        <p className="wd-kicker">{product.label}</p>
        <h1>{title}</h1>
        <p className="wd-empty-lead">{lead}</p>
        {kind && isUtilityKind(kind) ? (
          <button
            type="button"
            className="wd-empty-go"
            onClick={() => {
              void openChatTab({ title: navLabelForKind(kind), utilityKind: kind })
            }}
          >
            {navLabelForKind(kind)}
          </button>
        ) : null}
      </article>
    </div>
  )
}

/** 没有专用 Tab 时直接打开面板，不停留在空桌文案。 */
export function ProductAutoOpen({ product }: { product: ProductDef }) {
  const kind = product.utilityKinds.find((k) => k !== 'schedule')
  useEffect(() => {
    if (!kind || !isUtilityKind(kind)) return
    void openChatTab({ title: navLabelForKind(kind), utilityKind: kind })
  }, [kind])
  return (
    <div className="od-desk" role="status">
      打开{product.label}…
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
