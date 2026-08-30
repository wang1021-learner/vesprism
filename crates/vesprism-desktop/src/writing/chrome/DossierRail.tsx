import { ForeshadowStamp } from '../fields/Field'
import { foreshadowJump, type BookDossier } from '../model/dossier'
import { personNode, placeNode, ruleNode } from '../model/nodes'
import type { DeskNodeId } from '../model/types'

export function DossierRail({
  dossier,
  onOpen,
}: {
  dossier: BookDossier
  onOpen: (id: DeskNodeId) => void
}) {
  return (
    <aside className="wd-ledger" aria-label="案卷 · 当前态">
      <p className="wd-kicker">案卷 · 写到现在还欠着这些</p>
      <h2 className="wd-ledger-title">伏线</h2>
      <ul className="wd-ticket-list">
        {dossier.foreshadows
          .filter((f) => f.state !== 'closed')
          .map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className={`wd-ticket is-${f.state}`}
                onClick={() => onOpen(foreshadowJump(f))}
              >
                <span className="wd-ticket-id">{f.id}</span>
                <span className="wd-ticket-line">{f.line}</span>
                <ForeshadowStamp state={f.state} />
              </button>
            </li>
          ))}
      </ul>
      {dossier.foreshadows.some((f) => f.state === 'closed') ? (
        <details className="wd-ledger-closed">
          <summary>已经收回 · {dossier.foreshadows.filter((f) => f.state === 'closed').length}</summary>
          <ul className="wd-ticket-list">
            {dossier.foreshadows
              .filter((f) => f.state === 'closed')
              .map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="wd-ticket is-closed"
                    onClick={() => onOpen(foreshadowJump(f))}
                  >
                    <span className="wd-ticket-id">{f.id}</span>
                    <span className="wd-ticket-line">{f.line}</span>
                    <ForeshadowStamp state={f.state} />
                  </button>
                </li>
              ))}
          </ul>
        </details>
      ) : null}
      <h2 className="wd-ledger-title">人物现在怎样</h2>
      <ul className="wd-ticket-list">
        {dossier.people.map((p) => (
          <li key={p.id}>
            <button type="button" className="wd-ticket is-cast" onClick={() => onOpen(personNode(p.id))}>
              <span className="wd-ticket-id">{p.role}</span>
              <span className="wd-ticket-line">
                {p.name} · 截止第{p.asOf}章
              </span>
              <span className="wd-ticket-sub">{p.state}</span>
            </button>
          </li>
        ))}
      </ul>
      <h2 className="wd-ledger-title">地点这一场怎么用</h2>
      <ul className="wd-ticket-list">
        {dossier.places.map((p) => (
          <li key={p.id}>
            <button type="button" className="wd-ticket is-place" onClick={() => onOpen(placeNode(p.id))}>
              <span className="wd-ticket-id">地点</span>
              <span className="wd-ticket-line">{p.name}</span>
              <span className="wd-ticket-sub">{p.job}</span>
            </button>
          </li>
        ))}
      </ul>
      <h2 className="wd-ledger-title">规则还剩几次</h2>
      <ul className="wd-ticket-list">
        {dossier.rules.map((r) => (
          <li key={r.id}>
            <button type="button" className="wd-ticket is-quota" onClick={() => onOpen(ruleNode(r.id))}>
              <span className="wd-ticket-id">{r.name}</span>
              <span className="wd-ticket-line">{r.quota}</span>
              <span className="wd-ticket-sub">{r.boundTo}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
