/** 试笔面板：AI 出稿先进试笔，采纳才是正史。未采纳的草稿列在这里，可点回稿纸。 */
export function CandidatePanel({
  candidates,
  onOpen,
}: {
  candidates?: { chapterId: string; label: string }[]
  onOpen?: (node: string) => void
}) {
  const list = candidates ?? []
  return (
    <section className="wd-cand" aria-label="试笔">
      <div className="wd-cand-h">
        <h2>试笔</h2>
        <span className="wd-cand-n">{list.length}</span>
      </div>
      {list.length === 0 ? (
        <p className="wd-cand-empty">
          点「写这一章」出试笔。
          <br />
          未点进正史之前，案卷不动。
        </p>
      ) : (
        <ul className="wd-ticket-list">
          {list.map((c) => (
            <li key={c.chapterId}>
              <button
                type="button"
                className="wd-ticket is-cand"
                onClick={() => onOpen?.(`${c.chapterId}:draft`)}
              >
                <span className="wd-ticket-id">试笔</span>
                <span className="wd-ticket-line">{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
