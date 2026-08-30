/** 试笔面板：AI 出稿先进试笔，采纳才是正史。现在展示空态与提示。 */
export function CandidatePanel() {
  return (
    <section className="wd-cand" aria-label="试笔">
      <div className="wd-cand-h">
        <h2>试笔</h2>
        <span className="wd-cand-n">0</span>
      </div>
      <p className="wd-cand-empty">
        点「写这一章」出试笔。
        <br />
        未点进正史之前，案卷不动。
      </p>
    </section>
  )
}
