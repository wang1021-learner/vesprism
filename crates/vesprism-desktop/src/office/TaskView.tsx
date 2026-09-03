import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from '@nanostores/react'
import { SendIcon } from '../components/composerIcons'
import { pushToast } from '../store'
import { OFFICE_FOLDERS, QUICK_REFINEMENT_ACTIONS } from './catalog'
import { DeliverableRenderer } from './Deliverable'
import { kindIcon, kindLabel, stepState } from './labels'
import type { OfficeTask } from './model'
import { formatOfficeClock } from './persist'
import { $officeArchivedIds, archiveOfficeTask, deleteOfficeTask, duplicateOfficeTask } from './store'

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
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted')
  const [activeSlide, setActiveSlide] = useState(1)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const archivedIds = useStore($officeArchivedIds)

  const isDone = task.status === 'done'
  const isRunning = task.status === 'running'
  const archived = archivedIds.includes(task.id)
  const currentStep = task.plan[Math.max(task.stepIndex, 0)]
  const file = task.file
  const folderLabel =
    OFFICE_FOLDERS.find((f) => f.id === task.folderId)?.name ?? '演示材料夹'

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
            ← 返回
          </button>
          <span className="od-divider" aria-hidden>
            /
          </span>
          <h2 className="od-task-title">{task.title}</h2>
          <span className={`od-status-pill is-${task.status}`}>
            {isDone ? '已交付' : isRunning ? '执行中' : '待规划'}
          </span>
        </div>
        <div className="od-task-header-right">
          {isDone && (
            <span className="od-task-done-actions">
              <button
                type="button"
                className="od-hdr-btn"
                title="按原任务再来一次（演示）"
                onClick={() => {
                  duplicateOfficeTask(task.id)
                  pushToast('已按此任务重开一份（演示）', 'info')
                }}
              >
                再来一份
              </button>
              <button
                type="button"
                className={`od-hdr-btn${archived ? ' is-active' : ''}`}
                title={archived ? '取消归档' : '归档到已归档'}
                onClick={() => archiveOfficeTask(task.id)}
              >
                {archived ? '已归档' : '归档'}
              </button>
            </span>
          )}
          <span className="od-meta-time">{formatOfficeClock(task.createdAt)}</span>
          {confirmDelete ? (
            <span className="od-del-confirm">
              <button type="button" className="od-hdr-btn" onClick={() => setConfirmDelete(false)}>
                取消
              </button>
              <button
                type="button"
                className="od-del-btn is-danger"
                onClick={() => {
                  setConfirmDelete(false)
                  deleteOfficeTask(task.id)
                }}
              >
                确认删除
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="od-del-btn"
              onClick={() => setConfirmDelete(true)}
              title="删除任务"
            >
              删除
            </button>
          )}
        </div>
      </div>

      <div className="od-cols">
        {/* 左栏：计划与改稿 */}
        <section className="od-thread" aria-label="演示计划">
          <div className="od-log">
            {/* 用户意图 — 对话气泡 */}
            <div className="od-chat-msg od-chat-user">
              <div className="od-chat-avatar od-chat-avatar-user" aria-hidden="true">你</div>
              <div className="od-chat-bubble od-chat-bubble-user">
                <p className="od-chat-text">{task.prompt || task.title}</p>
                <div className="od-chat-bubble-meta">
                  <span className="od-folder-badge">{folderLabel}</span>
                </div>
              </div>
            </div>

            {/* Agent 执行计划 — 回复气泡 */}
            <div className="od-chat-msg od-chat-agent">
              <div className="od-chat-avatar od-chat-avatar-agent" aria-hidden="true">AI</div>
              <div className="od-plan-panel">
                <div className="od-plan-panel-header">
                  <span className="od-plan-title">执行计划</span>
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
                <div className="od-loading-mark" aria-hidden>
                  {Math.max(task.stepIndex + 1, 0)}/{task.plan.length}
                </div>
                <p>演示步进中</p>
                <span>{currentStep?.label ?? '初始化'}</span>
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
