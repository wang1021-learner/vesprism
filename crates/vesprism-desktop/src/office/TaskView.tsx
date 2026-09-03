import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from '@nanostores/react'
import { SendIcon } from '../components/composerIcons'
import { $rightPanelOpen, pushToast } from '../store'
import { OFFICE_FOLDERS, QUICK_REFINEMENT_ACTIONS } from './catalog'
import { kindIcon, kindLabel, stepState } from './labels'
import type { OfficeTask } from './model'
import { formatOfficeClock } from './persist'
import {
  $officeArchivedIds,
  $officeRailTab,
  archiveOfficeTask,
  deleteOfficeTask,
  duplicateOfficeTask,
  openOfficeArtifact,
} from './store'

/** 任务执行态与规划会话区（类似 Claude Artifacts 模式：宽敞居中工作流） */
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const archivedIds = useStore($officeArchivedIds)
  const rightOpen = useStore($rightPanelOpen)
  const railTab = useStore($officeRailTab)

  const isDone = task.status === 'done'
  const isRunning = task.status === 'running'
  const archived = archivedIds.includes(task.id)
  const file = task.file
  const folderLabel =
    OFFICE_FOLDERS.find((f) => f.id === task.folderId)?.name ?? '演示材料夹'

  const toggleArtifactDrawer = () => {
    if (rightOpen && railTab === 'artifact') {
      $rightPanelOpen.set(false)
    } else {
      openOfficeArtifact()
    }
  }

  return (
    <div className="od-task-view is-single-col">
      {/* 顶栏控制条 */}
      <header className="od-task-header">
        <div className="od-task-header-left">
          <button type="button" className="od-back-btn" onClick={onBackHome} title="返回工作台">
            ← 工作台
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
          {/* 画板抽屉快捷开关按钮 */}
          <button
            type="button"
            className={`od-hdr-btn od-artifact-toggle-btn${rightOpen && railTab === 'artifact' ? ' is-active' : ''}`}
            onClick={toggleArtifactDrawer}
            title={rightOpen ? '收起右侧交付物画板' : '在右侧打开交付物画板'}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M9.5 1v12" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span>{file ? '交付画板' : '右侧面板'}</span>
          </button>

          {isDone && (
            <span className="od-task-done-actions">
              <button
                type="button"
                className="od-hdr-btn"
                title="按原任务重新起草一份"
                onClick={() => {
                  duplicateOfficeTask(task.id)
                  pushToast('已重开一份任务', 'info')
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
      </header>

      {/* 中央宽敞单栏内容流 */}
      <div className="od-task-scroll">
        <div className="od-task-main-col">
          {/* 任务目标卡片 */}
          <div className="od-user-goal-card">
            <div className="od-user-goal-label">任务目标</div>
            <p className="od-user-goal-text">{task.prompt || task.title}</p>
            <div className="od-user-goal-meta">
              <span className="od-folder-badge">{folderLabel}</span>
            </div>
          </div>

          {/* 执行计划进度轴 */}
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

          {/* 交付成果就绪卡片（引导在右侧边栏查阅） */}
          {file ? (
            <div className="od-artifact-ready-card">
              <div className="od-arc-head">
                <span className="od-arc-icon">{kindIcon(file.kind)}</span>
                <div className="od-arc-meta">
                  <strong className="od-arc-name">{file.name}</strong>
                  <span className="od-arc-sub">
                    {kindLabel(file.kind)} {file.wordCount ? `· ${file.wordCount} 字` : ''} · 已就绪
                  </span>
                </div>
                <button
                  type="button"
                  className="od-arc-open-btn"
                  onClick={openOfficeArtifact}
                >
                  在右侧画板查看 →
                </button>
              </div>
              <p className="od-arc-desc">{file.summary}</p>
            </div>
          ) : null}

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
      </div>

      {/* 底部改稿与微调 Dock（全幅底座，居中卡片） */}
      <div className="od-dock-container">
        <form className="composer-container is-dock od-task-composer" onSubmit={onSubmit}>
          <div className="composer-card">
            <textarea
              rows={1}
              value={draft}
              aria-label="改稿意见"
              placeholder="提出修改意见（例如：增加风险应对措施、生成英文版）…"
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
    </div>
  )
}
