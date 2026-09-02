import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { SendIcon } from '../components/composerIcons'
import { pushToast } from '../store'
import { QUICK_REFINEMENT_ACTIONS } from './catalog'
import { DeliverableRenderer } from './Deliverable'
import { kindIcon, kindLabel, stepState } from './labels'
import type { OfficeTask } from './model'
import { formatOfficeClock } from './persist'
import { deleteOfficeTask } from './store'

/** 任务执行态与独立交付物画板 (Artifacts Workbench) */
export function TaskExecutionView({
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
          <span className="od-meta-time">创建于 {formatOfficeClock(task.createdAt)}</span>
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
        {/* 左栏：计划与改稿 */}
        <section className="od-thread" aria-label="演示计划">
          <div className="od-log">
            {/* 用户意图提示卡 */}
            <div className="od-user-card">
              <div className="od-user-header">
                <span className="od-user-role">用户意图</span>
                <span className="od-folder-badge">本周工作材料</span>
              </div>
              <p className="od-user-text">{task.prompt || task.title}</p>
            </div>

            {/* 演示四步计划 */}
            <div className="od-plan-panel">
              <div className="od-plan-panel-header">
                <span className="od-plan-title">演示计划（四步）</span>
                <span className="od-plan-step-count">
                  {isDone ? task.plan.length : Math.max(task.stepIndex + 1, 0)} / {task.plan.length}{' '}
                  步
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
            <form className="composer-container is-dock od-task-composer" onSubmit={onSubmit}>
              <div className="composer-card">
                <textarea
                  rows={1}
                  value={draft}
                  aria-label="改稿意见"
                  placeholder="提出修改意见（例如：增加风险应对措施）…"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKey}
                />
                <div className="composer-toolbar">
                  <div className="toolbar-left">
                    {isDone
                      ? QUICK_REFINEMENT_ACTIONS.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            className="composer-chip"
                            onClick={() => onRefine(a.label)}
                          >
                            {a.label}
                          </button>
                        ))
                      : null}
                  </div>
                  <div className="toolbar-right">
                    <button
                      type="submit"
                      className={`btn-circle btn-send${draft.trim() ? ' ready' : ''}`}
                      disabled={!draft.trim()}
                      aria-label="发送"
                      title="发送"
                    >
                      <SendIcon />
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </section>

        {/* 右栏：交付物画板 */}
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
                <button
                  type="button"
                  className="od-action-btn is-primary"
                  onClick={downloadFile}
                  title="导出预览文本"
                >
                  导出预览文本
                </button>
              </div>
            ) : null}
          </div>

          {/* 画板正文渲染区 */}
          <div className="od-workbench-body">
            {!file ? (
              <div className="od-loading-state">
                <p>演示步进：正在套预置稿…</p>
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
