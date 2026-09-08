import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from '@nanostores/react'
import { pushToast } from '../store'
import type { OfficeTask } from './model'
import { formatOfficeClock } from './persist'
import {
  $officeArchivedIds,
  $officeDemoError,
  archiveOfficeTask,
  deleteOfficeTask,
  duplicateOfficeTask,
  openOfficeArtifact,
  openOfficeHome,
} from './store'
import { ConversationStream } from './ConversationStream'
import { OfficeComposer } from './OfficeComposer'

/**
 * 任务主区：顶栏 + ConversationStream + 底栏 Composer。
 * 产物只走全局 OfficeRail，不再内嵌 oc-col-artifact。
 */
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
  const demoError = useStore($officeDemoError)

  const isDone = task.status === 'done'
  const isRunning = task.status === 'running'
  const archived = archivedIds.includes(task.id)

  return (
    <div className="oc-task-workspace" role="main" aria-label="任务工作台">
      <header className="oc-task-topbar">
        <div className="oc-task-topbar-left">
          <button
            type="button"
            className="oc-back-home-btn"
            onClick={onBackHome}
            title="返回办公首页"
          >
            ← 工作台
          </button>
          <span className="oc-sep" aria-hidden="true">/</span>
          <h2 className="oc-topbar-task-title">{task.title}</h2>
          <span className={`oc-status-badge is-${task.status}`}>
            {isDone ? '已交付' : isRunning ? '执行中…' : '排队中'}
          </span>
        </div>

        <div className="oc-task-topbar-right">
          <span className="oc-task-time">{formatOfficeClock(task.createdAt)}</span>

          {isDone && (
            <div className="oc-topbar-actions">
              <button
                type="button"
                className="oc-topbar-btn"
                title="重新复制一份新任务执行"
                onClick={() => {
                  duplicateOfficeTask(task.id)
                  pushToast('已重开一份任务', 'info')
                }}
              >
                再来一份
              </button>
              <button
                type="button"
                className={`oc-topbar-btn${archived ? ' is-active' : ''}`}
                onClick={() => archiveOfficeTask(task.id)}
              >
                {archived ? '已归档' : '归档'}
              </button>
            </div>
          )}

          {confirmDelete ? (
            <div className="oc-del-confirm-wrap">
              <button
                type="button"
                className="oc-topbar-btn"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="oc-del-btn is-danger"
                onClick={() => {
                  setConfirmDelete(false)
                  deleteOfficeTask(task.id)
                }}
              >
                确认删除
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="oc-del-btn"
              onClick={() => setConfirmDelete(true)}
              title="删除此任务"
            >
              删除
            </button>
          )}
        </div>
      </header>

      <div className="oc-task-columns is-single">
        <div className="oc-col-stream is-full">
          {demoError ? (
            <div className="oc-demo-error" role="alert">
              <span>{demoError}</span>
              <button
                type="button"
                className="oc-demo-error-btn"
                onClick={() => openOfficeHome()}
              >
                回工作台
              </button>
            </div>
          ) : null}
          <div className="oc-col-stream-content">
            <ConversationStream
              task={task}
              onOpenArtifact={() => openOfficeArtifact()}
            />
          </div>

          <div className="oc-stream-composer-wrap">
            <OfficeComposer
              draft={draft}
              setDraft={setDraft}
              onKey={onKey}
              onSubmit={onSubmit}
              isTaskView={true}
              isDone={isDone}
              isRunning={isRunning}
              taskMaterial={
                task.folderId
                  ? { folderId: task.folderId, fileIds: task.fileIds ?? [] }
                  : null
              }
              onRefine={onRefine}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
