import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from '@nanostores/react'
import { pushToast } from '../store'
import {
  DEMO_FOLDERS,
  type DemoFile,
  type DemoFolder,
  type OfficeKind,
  type OfficeTask,
  type SlideCard,
} from './model'
import {
  OFFICE_CAPSULES,
  OFFICE_CONNECTORS,
  OFFICE_EXPERTS,
  OFFICE_FOLDERS,
  OFFICE_FORMATS,
  OFFICE_KNOWLEDGE,
  OFFICE_PERMISSIONS,
  OFFICE_SCHEDULES,
  OFFICE_SKILLS,
  OFFICE_SUGGESTIONS,
  QUICK_REFINEMENT_ACTIONS,
  type OfficeCapsule,
  type OfficeFormat,
  type OfficePanel,
} from './catalog'
import {
  $officeActiveId,
  $officeFolderId,
  $officeFormat,
  $officePanel,
  $officePermission,
  $officeTasks,
  deleteOfficeTask,
  openOfficeHome,
  openOfficePanel,
  refineOfficeTask,
  selectOfficeTask,
  startOfficeTask,
  tickOfficeTask,
} from './store'

const STEP_MS = 650

function kindLabel(kind: OfficeKind): string {
  if (kind === 'pptx') return 'PPT 演示文稿'
  if (kind === 'xlsx') return 'Excel 工作簿'
  if (kind === 'pdf') return 'PDF 文档'
  if (kind === 'report') return '分析报告'
  return 'Word 文档'
}

function kindIcon(kind: OfficeKind): string {
  if (kind === 'pptx') return 'PPT'
  if (kind === 'xlsx') return 'XLS'
  if (kind === 'pdf') return 'PDF'
  if (kind === 'report') return '报告'
  return 'DOC'
}

function stepState(task: OfficeTask, i: number): 'done' | 'now' | 'todo' {
  if (i < task.stepIndex || task.status === 'done') return 'done'
  if (i === task.stepIndex && task.status === 'running') return 'now'
  return 'todo'
}

export function OfficeDesk() {
  const tasks = useStore($officeTasks)
  const activeId = useStore($officeActiveId)
  const panel = useStore($officePanel)
  const permission = useStore($officePermission)
  const folderId = useStore($officeFolderId)
  const format = useStore($officeFormat)
  const task = tasks.find((t) => t.id === activeId) ?? null

  const [draft, setDraft] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('全部')
  const [showFolderModal, setShowFolderModal] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  const run = (t: OfficeTask) => {
    if (timer.current) window.clearTimeout(timer.current)
    const step = () => {
      const next = tickOfficeTask(t.id)
      if (!next || next.status === 'done') return
      timer.current = window.setTimeout(step, STEP_MS)
    }
    timer.current = window.setTimeout(step, 240)
  }

  const begin = (starterId: string | 'custom', text: string) => {
    const t = startOfficeTask(starterId, text, folderId)
    setDraft('')
    run(t)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    begin('custom', text)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }

  const currentFolder = DEMO_FOLDERS.find((f) => f.id === folderId) ?? DEMO_FOLDERS[0]

  if (task) {
    return (
      <div className="od-desk is-task" role="main" aria-label="AI 办公工作台">
        <TaskExecutionView
          task={task}
          draft={draft}
          setDraft={setDraft}
          onKey={onKey}
          onSubmit={onSubmit}
          onRefine={(action) => {
            refineOfficeTask(task.id, action)
            pushToast(`已应用微调：${action}`, 'info')
          }}
          onBackHome={() => openOfficeHome()}
        />
      </div>
    )
  }

  if (panel !== 'home') {
    return (
      <div className="od-desk is-list" role="main" aria-label="AI 办公应用中心">
        <CatalogPage panel={panel} onRun={(id, text) => begin(id, text)} />
      </div>
    )
  }

  const categories = ['全部', '公文汇报', '数据分析', '法务合规', '会务协同', '智能调研']
  const filteredCapsules =
    selectedCategory === '全部'
      ? OFFICE_CAPSULES
      : OFFICE_CAPSULES.filter((c) => c.category === selectedCategory)

  return (
    <div className="od-desk is-home" role="main" aria-label="AI 办公工作台">
      <div className="od-home">
        <div className="od-stage">
          {/* 顶栏品牌区 */}
          <header className="od-hello">
            <h1>交一份稿</h1>
            <p className="od-hello-sub">对着材料夹写周报、汇报 PPT、合同要点。还不接引擎。</p>
          </header>

          {/* 核心任务输入与配置面板 */}
          <form className="od-compose" onSubmit={onSubmit}>
            <div className="od-box">
              <textarea
                id="od-input"
                rows={3}
                value={draft}
                placeholder="例如：根据本周材料写华东销售周报"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
              />

              {/* 材料夹绑定提示条 */}
              {folderId !== 'none' && currentFolder ? (
                <div className="od-context-bar">
                  <span className="od-context-label">材料夹</span>
                  <button
                    type="button"
                    className="od-context-badge"
                    onClick={() => setShowFolderModal(true)}
                    title="查看材料夹内文件"
                  >
                    {currentFolder.name} · {currentFolder.files.length} 份
                  </button>
                </div>
              ) : null}

              {/* 底部工具条与选项 */}
              <div className="od-box-bar">
                <div className="od-box-tools">
                  {/* 材料夹选择 */}
                  <label className="od-select-wrap" title="选择参考材料夹">
                    <select
                      value={folderId}
                      onChange={(e) => $officeFolderId.set(e.target.value)}
                    >
                      {OFFICE_FOLDERS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} ({f.count}项)
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* 权限控制 */}
                  <label className="od-select-wrap" title="执行权限与确认机制">
                    <select
                      value={permission}
                      onChange={(e) =>
                        $officePermission.set(e.target.value as typeof permission)
                      }
                    >
                      {OFFICE_PERMISSIONS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* 目标输出格式 */}
                  <label className="od-select-wrap" title="期望交付格式">
                    <select
                      value={format}
                      onChange={(e) => $officeFormat.set(e.target.value as OfficeFormat)}
                    >
                      {OFFICE_FORMATS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <button type="submit" className="od-go" disabled={!draft.trim()}>
                  开始规划
                </button>
              </div>
            </div>

            {/* 场景分类 Tabs */}
            <div className="od-category-tabs">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`od-cat-tab${selectedCategory === cat ? ' is-active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* 场景胶囊卡片 */}
            <div className="od-capsules-grid" aria-label="高频场景">
              {filteredCapsules.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="od-capsule-card"
                  onClick={() => {
                    if (c.blocked) {
                      pushToast('系统安全隔离中', 'info')
                      return
                    }
                    $officeFormat.set(c.targetFormat)
                    begin(c.starterId, c.prompt)
                  }}
                >
                  <div className="od-capsule-header">
                    <span className="od-capsule-cat">{c.category}</span>
                    <span className="od-capsule-fmt">{c.targetFormat.toUpperCase()}</span>
                  </div>
                  <strong className="od-capsule-title">{c.title}</strong>
                  <span className="od-capsule-desc">{c.description}</span>
                </button>
              ))}
            </div>
          </form>

          {/* 推荐指令 */}
          <div className="od-suggest-section">
            <div className="od-suggest-title">推荐指令</div>
            <ul className="od-suggest">
              {OFFICE_SUGGESTIONS.map((s) => (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(s.prompt)
                    }}
                  >
                    <span className="od-suggest-badge">{s.category}</span>
                    <span className="od-suggest-text">{s.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* 材料夹文件抽屉 Modal */}
      {showFolderModal ? (
        <FolderPreviewModal
          folder={currentFolder}
          onClose={() => setShowFolderModal(false)}
        />
      ) : null}
    </div>
  )
}

/** 任务执行态与独立交付物画板 (Artifacts Workbench) */
function TaskExecutionView({
  task,
  draft,
  setDraft,
  onKey,
  onSubmit,
  onRefine,
  onBackHome,
}: {
  task: OfficeTask
  draft: string
  setDraft: (v: string) => void
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (e: FormEvent) => void
  onRefine: (action: string) => void
  onBackHome: () => void
}) {
  const [viewMode, setViewMode] = useState<'formatted' | 'structured' | 'raw'>('formatted')
  const [activeSlide, setActiveSlide] = useState(1)

  const isDone = task.status === 'done'
  const isRunning = task.status === 'running'
  const currentStep = task.plan[Math.max(task.stepIndex, 0)]
  const file = task.file

  const copyToClipboard = () => {
    if (!file) return
    const text = file.preview
    void navigator.clipboard.writeText(text).then(() => {
      pushToast('已复制交付内容到剪贴板', 'info')
    })
  }

  const downloadFile = () => {
    if (!file) return
    const blob = new Blob([file.preview], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    URL.revokeObjectURL(url)
    pushToast(`已下载文件: ${file.name}`, 'info')
  }

  return (
    <div className="od-task-view">
      {/* 顶栏快速面包屑与状态 */}
      <div className="od-task-header">
        <div className="od-task-header-left">
          <button type="button" className="od-back-btn" onClick={onBackHome} title="返回新任务">
            ← 返回新任务
          </button>
          <span className="od-divider">/</span>
          <h2 className="od-task-title">{task.title}</h2>
          <span className={`od-status-pill is-${task.status}`}>
            {isDone ? '已交付' : isRunning ? '执行中' : '待规划'}
          </span>
        </div>
        <div className="od-task-header-right">
          <span className="od-meta-time">创建于 {task.createdAt}</span>
          <button
            type="button"
            className="od-del-btn"
            onClick={() => deleteOfficeTask(task.id)}
            title="删除任务"
          >
            删除
          </button>
        </div>
      </div>

      <div className="od-cols">
        {/* 左栏：Agent 推理规划与对话改稿流 */}
        <section className="od-thread" aria-label="Agent 执行流">
          <div className="od-log">
            {/* 用户意图提示卡 */}
            <div className="od-user-card">
              <div className="od-user-header">
                <span className="od-user-role">用户意图</span>
                <span className="od-folder-badge">本周工作材料</span>
              </div>
              <p className="od-user-text">{task.prompt || task.title}</p>
            </div>

            {/* Agent 多步推理与工具执行面板 */}
            <div className="od-plan-panel">
              <div className="od-plan-panel-header">
                <span className="od-plan-title">自主规划与工具执行链</span>
                <span className="od-plan-step-count">
                  {isDone ? task.plan.length : Math.max(task.stepIndex + 1, 0)} / {task.plan.length} 步
                </span>
              </div>
              <ol className="od-plan">
                {task.plan.map((step, i) => {
                  const state = stepState(task, i)
                  return (
                    <li key={step.id} className={`od-plan-item is-${state}`}>
                      <div className="od-step-dot" />
                      <div className="od-step-content">
                        <div className="od-step-row">
                          <span className="od-step-label">{step.label}</span>
                          {step.toolName ? (
                            <span className="od-step-tool">{step.toolName}</span>
                          ) : null}
                        </div>
                        {step.detail && (state === 'done' || state === 'now') ? (
                          <p className="od-step-detail">{step.detail}</p>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>

            {/* 工具执行追踪日志 */}
            {task.toolLog && task.toolLog.length > 0 ? (
              <div className="od-trace-box">
                <div className="od-trace-title">执行事件追踪</div>
                {task.toolLog.map((log) => (
                  <div key={log} className="od-trace-line">
                    {log}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* 底部改稿与微调 Dock */}
          <div className="od-dock-container">
            {isDone ? (
              <div className="od-quick-refinements">
                <span className="od-refine-label">快捷改稿:</span>
                <div className="od-refine-pills">
                  {QUICK_REFINEMENT_ACTIONS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="od-refine-pill"
                      onClick={() => onRefine(a.label)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <form className="od-dock" onSubmit={onSubmit}>
              <textarea
                rows={1}
                value={draft}
                placeholder="提出修改意见（例如：'增加风险应对措施'、'换为表格展示'）…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
              />
              <button type="submit" disabled={!draft.trim()}>
                发送指令
              </button>
            </form>
          </div>
        </section>

        {/* 右栏：Artifacts Workbench 独立交互交付物画板 */}
        <aside className="od-watch" aria-label="交付物画板">
          {/* 画板顶部控制条 */}
          <div className="od-workbench-header">
            <div className="od-wb-file-meta">
              <span className="od-wb-icon">{file ? kindIcon(file.kind) : '稿'}</span>
              <div className="od-wb-titles">
                <strong className="od-wb-name">{file?.name ?? '正在规划交付产物…'}</strong>
                {file ? (
                  <span className="od-wb-kind-badge">
                    {kindLabel(file.kind)} {file.wordCount ? `· ${file.wordCount} 字` : ''}
                  </span>
                ) : null}
              </div>
            </div>

            {file ? (
              <div className="od-wb-actions">
                <div className="od-view-switcher">
                  <button
                    type="button"
                    className={viewMode === 'formatted' ? 'is-active' : ''}
                    onClick={() => setViewMode('formatted')}
                    title="格式化排版视图"
                  >
                    排版视图
                  </button>
                  <button
                    type="button"
                    className={viewMode === 'raw' ? 'is-active' : ''}
                    onClick={() => setViewMode('raw')}
                    title="Markdown 源码"
                  >
                    源码
                  </button>
                </div>
                <button type="button" className="od-action-btn" onClick={copyToClipboard} title="复制全文">
                  复制
                </button>
                <button type="button" className="od-action-btn is-primary" onClick={downloadFile} title="导出文件">
                  导出
                </button>
              </div>
            ) : null}
          </div>

          {/* 画板正文渲染区 */}
          <div className="od-workbench-body">
            {!file ? (
              <div className="od-loading-state">
                <div className="od-spinner" />
                <p>AI 正在检索材料并撰写交付成果…</p>
                <span>当前步骤: {currentStep?.label ?? '初始化'}</span>
              </div>
            ) : viewMode === 'raw' ? (
              <pre className="od-raw-preview">{file.preview}</pre>
            ) : (
              <DeliverableRenderer
                file={file}
                activeSlide={activeSlide}
                setActiveSlide={setActiveSlide}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

/** 针对不同文件格式的交付物专用渲染器 */
function DeliverableRenderer({
  file,
  activeSlide,
  setActiveSlide,
}: {
  file: DemoFile
  activeSlide: number
  setActiveSlide: (n: number) => void
}) {
  // PPT 幻灯片渲染器
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

        {/* 幻灯片核心卡片画板 */}
        <div className="od-slide-canvas">
          <div className="od-slide-card">
            <div className="od-slide-card-header">
              <span className="od-slide-badge">幻灯片 第 {currentSlide.index} / {file.slides.length} 页</span>
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
                <span className="od-notes-label">演讲备注</span>
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
          </div>
          <div className="od-kpi-card">
            <span className="od-kpi-label">竞品最大调价幅</span>
            <strong className="od-kpi-value is-alert">-12.5%</strong>
          </div>
          <div className="od-kpi-card">
            <span className="od-kpi-label">建议应对策略</span>
            <strong className="od-kpi-value">增值服务包打法</strong>
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
                          <span className={`od-gap-pill ${String(val).includes('-') ? 'is-down' : 'is-up'}`}>
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

  // Word/公文与合同审查渲染器
  return (
    <div className="od-doc-workbench">
      {/* 合同法务专属风险审查清单 */}
      {file.riskItems && file.riskItems.length > 0 ? (
        <div className="od-risk-summary-section">
          <h4 className="od-section-title">合规风险</h4>
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
          <h4 className="od-section-title">待办</h4>
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
                    <td>{act.owner}</td>
                    <td>{act.deadline}</td>
                    <td>
                      <span className={`od-action-status is-${act.status}`}>
                        {act.status === 'done' ? '已完成' : act.status === 'in_progress' ? '进行中' : '待处理'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* 公文正文富文本卡片 */}
      <div className="od-doc-paper">
        <div className="od-paper-header">
          <h1 className="od-paper-title">{file.title}</h1>
          {file.summary ? <p className="od-paper-summary">{file.summary}</p> : null}
        </div>
        <div className="od-paper-content">
          <pre className="od-formatted-text">{file.preview}</pre>
        </div>
      </div>
    </div>
  )
}

/** 材料夹详情查看 Modal */
function FolderPreviewModal({
  folder,
  onClose,
}: {
  folder: DemoFolder
  onClose: () => void
}) {
  return (
    <div className="od-modal-overlay" onClick={onClose}>
      <div className="od-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="od-modal-header">
          <div>
            <h3>{folder.name}</h3>
            <p className="od-modal-sub">{folder.description}</p>
          </div>
          <button type="button" className="od-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="od-modal-body">
          <div className="od-modal-files">
            {folder.files.map((file) => (
              <div key={file.id} className="od-file-row">
                <div className="od-file-info">
                  <span className="od-file-icon">
                    {file.kind === 'xlsx'
                      ? 'XLS'
                      : file.kind === 'docx'
                        ? 'DOC'
                        : file.kind === 'pdf'
                          ? 'PDF'
                          : file.kind.toUpperCase()}
                  </span>
                  <div>
                    <strong className="od-file-name">{file.name}</strong>
                    <span className="od-file-desc">{file.description}</span>
                  </div>
                </div>
                <div className="od-file-meta">
                  <span className="od-file-size">{file.size}</span>
                  <span className="od-file-date">{file.updatedAt}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="od-modal-footer">
          <button type="button" className="od-modal-btn is-primary" onClick={onClose}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

/** 子页面：技能中心、专家人设、企业知识库、定时排程、连接器生态、交付历史 */
function CatalogPage({
  panel,
  onRun,
}: {
  panel: Exclude<OfficePanel, 'home'>
  onRun: (starterId: string | 'custom', text: string) => void
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
              type="text"
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
                  onClick={() => onRun('custom', s.prompt)}
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

  if (panel === 'experts') {
    return (
      <div className="od-subpage">
        <header className="od-subpage-header">
          <div>
            <h1>专家人设</h1>
            <p>按岗位口径写稿、审稿。</p>
          </div>
        </header>

        <div className="od-experts-grid">
          {OFFICE_EXPERTS.map((e) => (
            <div key={e.id} className="od-expert-card">
              <div className="od-expert-header">
                <span className="od-expert-avatar">{e.avatar}</span>
                <div>
                  <h3 className="od-expert-name">{e.name}</h3>
                  <span className="od-expert-role">{e.role}</span>
                </div>
              </div>
              <p className="od-expert-blurb">{e.blurb}</p>
              <div className="od-expert-style">
                <span className="od-style-label">工作风格:</span>
                <span className="od-style-val">{e.style}</span>
              </div>
              <div className="od-expert-tags">
                {e.skills.map((sk) => (
                  <span key={sk} className="od-expert-tag">
                    {sk}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="od-expert-btn"
                onClick={() => onRun('custom', `请以【${e.name}】的专业口径与严谨风格协助完成：`)}
              >
                请教
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
                  onClick={() => onRun('custom', `立即执行定时任务「${s.name}」：`)}
                >
                  立即触发一次
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
                <span className={`od-conn-status is-${c.status}`}>
                  {c.status === 'connected' ? '已授权连接' : '待授权'}
                </span>
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

  // 交付历史
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
                <span>{t.createdAt}</span>
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
            <button
              type="button"
              className="od-hc-btn is-del"
              onClick={() => deleteOfficeTask(t.id)}
            >
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
