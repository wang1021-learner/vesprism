import type { DemoFile } from './model'

/** 针对不同文件格式的交付物专用渲染器 */
export function DeliverableRenderer({
  file,
  activeSlide,
  setActiveSlide,
}: {
  file: DemoFile
  activeSlide: number
  setActiveSlide: (n: number) => void
}) {
  // PPT 幻灯片渲染器 (16:9 企业级管理层汇报画板)
  if (file.kind === 'pptx' && file.slides && file.slides.length > 0) {
    const currentSlide = file.slides.find((s) => s.index === activeSlide) ?? file.slides[0]
    return (
      <div className="od-ppt-workbench">
        {/* 幻灯片缩略切换栏 */}
        <div className="od-ppt-nav">
          {file.slides.map((s) => (
            <button
              key={s.index}
              type="button"
              className={`od-ppt-tab${s.index === activeSlide ? ' is-active' : ''}`}
              onClick={() => setActiveSlide(s.index)}
            >
              <span className="od-ppt-tab-num">P{s.index}</span>
              <span className="od-ppt-tab-title">{s.title.split('·')[0].trim()}</span>
            </button>
          ))}
        </div>

        {/* 幻灯片核心卡片画板 (16:9 比例) */}
        <div className="od-slide-canvas">
          <div className="od-slide-card">
            <div className="od-slide-card-header">
              <div className="od-slide-meta-row">
                <span className="od-slide-badge">
                  幻灯片 第 {currentSlide.index} / {file.slides.length} 页
                </span>
                <span className="od-slide-aspect-tag">16 : 9 标准画板</span>
              </div>
              <h3 className="od-slide-title">{currentSlide.title}</h3>
              {currentSlide.subtitle ? (
                <p className="od-slide-subtitle">{currentSlide.subtitle}</p>
              ) : null}
            </div>

            <div className="od-slide-body">
              <ul className="od-slide-points">
                {currentSlide.points.map((pt) => (
                  <li key={pt} className="od-slide-point-item">
                    <span className="od-point-dot" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>

            {currentSlide.notes ? (
              <div className="od-slide-notes">
                <div className="od-notes-header">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                  <span className="od-notes-label">演讲备注 (Speaker Notes)</span>
                </div>
                <p className="od-notes-text">{currentSlide.notes}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  // Excel 数据表格分析渲染器
  if (file.kind === 'xlsx' && file.tableColumns && file.tableRows) {
    return (
      <div className="od-xlsx-workbench">
        <div className="od-xlsx-summary-cards">
          <div className="od-kpi-card">
            <span className="od-kpi-label">对比品类数</span>
            <strong className="od-kpi-value">{file.tableRows.length} 项</strong>
            <span className="od-kpi-trend">覆盖华东 3 大主力款</span>
          </div>
          <div className="od-kpi-card">
            <span className="od-kpi-label">竞品最大调价幅</span>
            <strong className="od-kpi-value is-alert">-12.5%</strong>
            <span className="od-kpi-trend is-alert">Q3 价格战突发异动</span>
          </div>
          <div className="od-kpi-card">
            <span className="od-kpi-label">建议应对策略</span>
            <strong className="od-kpi-value">增值服务包打法</strong>
            <span className="od-kpi-trend">保持毛利率 &gt;40% 红线</span>
          </div>
        </div>

        <div className="od-table-container">
          <table className="od-sheet-table">
            <thead>
              <tr>
                {file.tableColumns.map((col) => (
                  <th key={col.key} style={{ width: col.width }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {file.tableRows.map((row, idx) => (
                <tr key={idx}>
                  {file.tableColumns?.map((col) => {
                    const val = row[col.key]
                    const isGap = col.key === 'gap'
                    const isStrategy = col.key === 'strategy'
                    return (
                      <td key={col.key}>
                        {isGap ? (
                          <span
                            className={`od-gap-pill ${String(val).includes('-') ? 'is-down' : 'is-up'}`}
                          >
                            {val}
                          </span>
                        ) : isStrategy ? (
                          <span className="od-strategy-pill">{val}</span>
                        ) : (
                          val
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // 公文与白皮书报告专业渲染器 (企业级专业行文流式长文档)
  return (
    <div className="od-doc-workbench">
      {/* 合同法务专属风险审查清单 */}
      {file.riskItems && file.riskItems.length > 0 ? (
        <div className="od-risk-summary-section">
          <div className="od-section-header">
            <span className="od-section-tag">合规预警</span>
            <h4 className="od-section-title">法务风险评级与修改意见 ({file.riskItems.length} 项)</h4>
          </div>
          <div className="od-risk-cards">
            {file.riskItems.map((r) => (
              <div key={r.id} className={`od-risk-card is-${r.level}`}>
                <div className="od-risk-card-header">
                  <span className={`od-risk-pill is-${r.level}`}>
                    {r.level === 'high' ? '高风险' : r.level === 'medium' ? '中风险' : '低风险'}
                  </span>
                  <strong className="od-risk-clause">{r.clause}</strong>
                </div>
                <p className="od-risk-desc">
                  <strong>风险问题:</strong> {r.risk}
                </p>
                <p className="od-risk-advice">
                  <strong>修改建议:</strong> {r.advice}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 会议纪要专属待办清单 */}
      {file.actionItems && file.actionItems.length > 0 ? (
        <div className="od-action-items-section">
          <div className="od-section-header">
            <span className="od-section-tag">行动派发</span>
            <h4 className="od-section-title">核心决议与待办跟踪 ({file.actionItems.length} 条)</h4>
          </div>
          <div className="od-action-table-wrap">
            <table className="od-action-table">
              <thead>
                <tr>
                  <th>待办任务</th>
                  <th>责任人</th>
                  <th>截止时间</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {file.actionItems.map((act) => (
                  <tr key={act.id}>
                    <td>
                      <strong>{act.task}</strong>
                    </td>
                    <td>
                      <span className="od-owner-pill">{act.owner}</span>
                    </td>
                    <td className="od-deadline-cell">{act.deadline}</td>
                    <td>
                      <span className={`od-action-status is-${act.status}`}>
                        {act.status === 'done'
                          ? '已完成'
                          : act.status === 'in_progress'
                            ? '进行中'
                            : '待处理'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* 公文正文富文本白皮书报告纸 (流式专业文档排版) */}
      <div className="od-doc-paper is-whitepaper">
        <div className="od-paper-header">
          <div className="od-doc-meta-strip">
            <span className="od-doc-type-badge">企业级呈阅件</span>
            <span className="od-doc-meta-item">内部阅读 · 密级：受限</span>
            {file.wordCount ? (
              <span className="od-doc-meta-item">{file.wordCount} 字</span>
            ) : null}
          </div>
          <h1 className="od-paper-title">{file.title}</h1>
          {file.summary ? (
            <div className="od-paper-summary-card">
              <span className="od-summary-label">执行摘要</span>
              <p className="od-paper-summary">{file.summary}</p>
            </div>
          ) : null}
        </div>
        <div className="od-paper-content">
          <pre className="od-formatted-text">{file.preview}</pre>
        </div>
      </div>
    </div>
  )
}
