/** 候选面板：AI 出稿先进候选，采纳才是正史。现在展示空态与提示。 */
export function CandidatePanel() {
  return (
    <section className="wd-cand" aria-label="候选">
      <div className="wd-cand-h">
        <h2>候选</h2>
        <span className="wd-cand-n">0</span>
      </div>
      <p className="wd-cand-empty">
        点「写这一章」出候选。
        <br />
        未点进正史之前，账本不动。
      </p>
    </section>
  )
}
