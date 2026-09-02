import { useState } from 'react'
import { useStore } from '@nanostores/react'
import {
  OFFICE_AGENTS,
  OFFICE_CONNECTORS,
  OFFICE_KNOWLEDGE,
  OFFICE_SCHEDULES,
  OFFICE_SKILLS,
  type OfficeFormat,
  type OfficePanel,
} from './catalog'
import { formatOfficeClock } from './persist'
import {
  $officeTasks,
  deleteOfficeTask,
  openOfficeHome,
  selectOfficeTask,
} from './store'

/** 子页面：技能中心、Agent、企业知识库、定时排程、连接器生态、交付历史 */
export function CatalogPage({
  panel,
  onRun,
}: {
  panel: Exclude<OfficePanel, 'home'>
  onRun: (starterId: string | 'custom', text: string, format?: OfficeFormat) => void
}) {
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('全部')

  if (panel === 'skills') {
    const categories = ['全部', '公文写作', '数据表格', '幻灯片', '法务风控', '综合自动化']
    const filtered = OFFICE_SKILLS.filter((s) => {
      const matchCat = filterCat === '全部' || s.category === filterCat
      const matchSearch =
        !search || s.name.includes(search) || s.description.includes(search)
      return matchCat && matchSearch
    })

    return (
      <div className="od-subpage">
        <header className="od-subpage-header">
          <div>
            <h1>技能中心</h1>
            <p>选一条技能，直接开跑。</p>
          </div>
          <div className="od-subpage-search">
            <input
              type="search"
              aria-label="搜索技能"
              placeholder="搜索技能名称或描述…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </header>

        <div className="od-filter-bar">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`od-filter-tab${filterCat === c ? ' is-active' : ''}`}
              onClick={() => setFilterCat(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="od-skills-grid">
          {filtered.map((s) => (
            <div key={s.id} className="od-skill-card">
              <div className="od-skill-card-top">
                <span className="od-skill-category">{s.category}</span>
                <span className="od-skill-output">产出: {s.outputType}</span>
              </div>
              <h3 className="od-skill-name">{s.name}</h3>
              <p className="od-skill-desc">{s.description}</p>
              <div className="od-skill-inputs">
                <span className="od-inputs-label">输入材料:</span>
                <span className="od-inputs-val">{s.inputs}</span>
              </div>
              <div className="od-skill-footer">
                <button
                  type="button"
                  className="od-skill-btn"
                  onClick={() => onRun('custom', s.prompt, s.format)}
                >
                  运行
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (panel === 'agents') {
    return (
      <div className="od-subpage">
        <header className="od-subpage-header">
          <div>
            <h1>Agent</h1>
            <p>选一个岗位开跑。演示预览，还不接引擎。</p>
          </div>
        </header>

        <div className="od-agent-grid">
          {OFFICE_AGENTS.map((a) => (
            <div key={a.id} className="od-agent-card">
              <div className="od-agent-header">
                <span className="od-agent-avatar">{a.avatar}</span>
                <div>
                  <h3 className="od-agent-name">{a.name}</h3>
                  <span className="od-agent-role">{a.role}</span>
                </div>
              </div>
              <p className="od-agent-blurb">{a.blurb}</p>
              <div className="od-agent-style">
                <span>工作风格:</span>
                <span className="od-agent-style-val">{a.style}</span>
              </div>
              <div className="od-agent-tags">
                {a.skills.map((sk) => (
                  <span key={sk} className="od-agent-tag">
                    {sk}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="od-agent-btn"
                onClick={() =>
                  onRun('custom', `请以【${a.name}】的口径完成：`, 'doc')
                }
              >
                运行
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (panel === 'knowledge') {
    return (
      <div className="od-subpage">
        <header className="od-subpage-header">
          <div>
            <h1>知识库</h1>
            <p>规范、价格、红线。任务里会引用。</p>
          </div>
        </header>

        <div className="od-knowledge-list">
          {OFFICE_KNOWLEDGE.map((k) => (
            <div key={k.id} className="od-knowledge-card">
              <div className="od-knowledge-header">
                <div className="od-kh-left">
                  <span className="od-knowledge-cat">{k.category}</span>
                  <h3 className="od-knowledge-title">{k.name}</h3>
                </div>
                <span className="od-knowledge-date">更新于 {k.updatedAt}</span>
              </div>
              <div className="od-knowledge-excerpt">
                <p>“{k.excerpt}”</p>
              </div>
              <div className="od-knowledge-footer">
                <span className="od-knowledge-source">来源: {k.source}</span>
                <div className="od-knowledge-tags">
                  {k.tags.map((t) => (
                    <span key={t} className="od-ktag">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (panel === 'schedule') {
    return (
      <div className="od-subpage">
        <header className="od-subpage-header">
          <div>
            <h1>定时排程</h1>
            <p>到点抓材料、出周报、推预警。</p>
          </div>
        </header>

        <div className="od-schedule-list">
          {OFFICE_SCHEDULES.map((s) => (
            <div key={s.id} className="od-schedule-card">
              <div className="od-sch-left">
                <div className="od-sch-status-dot" />
                <div>
                  <h3 className="od-sch-name">{s.name}</h3>
                  <p className="od-sch-action">{s.action}</p>
                  <div className="od-sch-meta">
                    <span>周期 {s.when}</span>
                    <span>推送 {s.target}</span>
                  </div>
                </div>
              </div>
              <div className="od-sch-right">
                <span className="od-sch-last">{s.lastRun}</span>
                <button
                  type="button"
                  className="od-sch-btn"
                  onClick={() => onRun('custom', `立即执行定时任务「${s.name}」：`, 'doc')}
                >
                  演示跑一次
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (panel === 'connectors') {
    return (
      <div className="od-subpage">
        <header className="od-subpage-header">
          <div>
            <h1>连接器</h1>
            <p>飞书、钉钉、企业微信、WPS。演示用。</p>
          </div>
        </header>

        <div className="od-connectors-grid">
          {OFFICE_CONNECTORS.map((c) => (
            <div key={c.id} className="od-connector-card">
              <div className="od-conn-header">
                <span className="od-conn-icon">{c.icon}</span>
                <div>
                  <h3 className="od-conn-name">{c.name}</h3>
                  <span className="od-conn-cat">{c.category}</span>
                </div>
                <span className={`od-conn-status is-${c.status}`}>未接</span>
              </div>
              <p className="od-conn-desc">{c.description}</p>
              <div className="od-conn-features">
                {c.features.map((f) => (
                  <span key={f} className="od-conn-pill">
                    ✓ {f}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="od-subpage">
      <header className="od-subpage-header">
        <div>
          <h1>交付历史</h1>
          <p>已完成的任务和导出文件。</p>
        </div>
      </header>
      <HistoryList />
    </div>
  )
}

function HistoryList() {
  const tasks = useStore($officeTasks)
  if (tasks.length === 0) {
    return (
      <div className="od-empty-state">
        <h3>还没有任务</h3>
        <p>回新任务里写一句，或点一个场景。</p>
        <button type="button" className="od-modal-btn is-primary" onClick={openOfficeHome}>
          创建新任务
        </button>
      </div>
    )
  }

  return (
    <div className="od-history-list">
      {tasks.map((t) => (
        <div key={t.id} className="od-history-card">
          <div className="od-hc-info">
            <span className={`od-hc-dot is-${t.status}`} />
            <div>
              <strong className="od-hc-title">{t.title}</strong>
              <p className="od-hc-prompt">{t.prompt}</p>
              <div className="od-hc-meta">
                <span>{formatOfficeClock(t.createdAt)}</span>
                <span>{t.file ? t.file.name : '未生成文件'}</span>
                <span>
                  {t.status === 'done' ? '已交付' : t.status === 'running' ? '进行中' : '待规划'}
                </span>
              </div>
            </div>
          </div>
          <div className="od-hc-actions">
            <button
              type="button"
              className="od-hc-btn is-primary"
              onClick={() => selectOfficeTask(t.id)}
            >
              打开画板
            </button>
            <button type="button" className="od-hc-btn is-del" onClick={() => deleteOfficeTask(t.id)}>
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
