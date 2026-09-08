import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from '@nanostores/react'
import { SendIcon } from '../components/composerIcons'
import {
  OFFICE_FOLDERS,
  OFFICE_FORMATS,
  OFFICE_PERMISSIONS,
  QUICK_REFINEMENT_ACTIONS,
  type OfficeFormat,
} from './catalog'
import { DEMO_FOLDERS, type MaterialFile } from './model'
import {
  $officeFormat,
  $officeMaterialContext,
  $officePermission,
  MAX_OFFICE_MATERIAL_FILES,
  mountOfficeMaterial,
  unmountOfficeMaterial,
  type OfficeMaterialContext,
} from './store'

const PREVIEW_MAX = 800

function materialPreviewText(file: MaterialFile): string {
  const raw =
    (typeof file.preview === 'string' && file.preview) ||
    file.description ||
    ''
  const body = raw.trim() || `（演示）${file.name} 暂无摘要。`
  return body.length > PREVIEW_MAX ? `${body.slice(0, PREVIEW_MAX)}…` : body
}

function resolveMaterialFiles(ctx: OfficeMaterialContext | null): MaterialFile[] {
  if (!ctx) return []
  const folder = DEMO_FOLDERS.find((f) => f.id === ctx.folderId)
  if (!folder) return []
  return ctx.fileIds
    .map((id) => folder.files.find((f) => f.id === id))
    .filter((f): f is MaterialFile => Boolean(f))
}

export function OfficeComposer({
  draft,
  setDraft,
  onKey,
  onSubmit,
  isTaskView = false,
  isDone = false,
  isRunning = false,
  onRefine,
  /** 任务态只读材料快照；缺省则读全局 $officeMaterialContext。 */
  taskMaterial = null,
}: {
  draft: string
  setDraft: (v: string) => void
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (e: FormEvent) => void
  isTaskView?: boolean
  isDone?: boolean
  isRunning?: boolean
  onRefine?: (action: string) => void
  taskMaterial?: OfficeMaterialContext | null
}) {
  const format = useStore($officeFormat)
  const permission = useStore($officePermission)
  const liveCtx = useStore($officeMaterialContext)

  const materialReadonly = isTaskView || isRunning
  const ctx = materialReadonly && taskMaterial ? taskMaterial : liveCtx
  const mountedFiles = useMemo(() => resolveMaterialFiles(ctx), [ctx])

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerFolderId, setPickerFolderId] = useState<string>(
    () => DEMO_FOLDERS[0]?.id ?? 'week',
  )
  const [previewFileId, setPreviewFileId] = useState<string | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const chipRowRef = useRef<HTMLDivElement | null>(null)

  const pickerFolder =
    DEMO_FOLDERS.find((f) => f.id === pickerFolderId) ?? DEMO_FOLDERS[0] ?? null
  const atLimit = (liveCtx?.fileIds.length ?? 0) >= MAX_OFFICE_MATERIAL_FILES
  const previewFile = mountedFiles.find((f) => f.id === previewFileId) ?? null

  useEffect(() => {
    if (!pickerOpen && !previewFileId) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (pickerRef.current?.contains(t)) return
      if (chipRowRef.current?.contains(t)) return
      setPickerOpen(false)
      setPreviewFileId(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen, previewFileId])

  const onPickFile = (folderId: string, fileId: string) => {
    if (materialReadonly) return
    mountOfficeMaterial(folderId, fileId)
    setPickerOpen(false)
    setPreviewFileId(null)
  }

  const onUnload = (fileId: string) => {
    if (materialReadonly) return
    unmountOfficeMaterial(fileId)
    if (previewFileId === fileId) setPreviewFileId(null)
  }

  return (
    <form className="composer-form" onSubmit={onSubmit}>
      <div className="composer-card">
        {/* 材料 chip 行：挂载入口 + chips */}
        <div className="composer-meta-row oc-material-row" ref={chipRowRef}>
          <div className="composer-meta-left oc-composer-chips">
            {!materialReadonly ? (
              <div className="oc-mount-wrap" ref={pickerRef}>
                <button
                  type="button"
                  className="composer-chip oc-mount-btn"
                  aria-expanded={pickerOpen}
                  aria-haspopup="dialog"
                  disabled={atLimit}
                  title={atLimit ? `最多挂载 ${MAX_OFFICE_MATERIAL_FILES} 份材料` : '挂载材料'}
                  onClick={() => {
                    setPreviewFileId(null)
                    setPickerOpen((v) => !v)
                  }}
                >
                  <span className="chip-icon" aria-hidden>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                    </svg>
                  </span>
                  挂载材料
                </button>

                {pickerOpen ? (
                  <div className="oc-mount-popover" role="dialog" aria-label="挂载材料">
                    <div className="oc-mount-folders" role="listbox" aria-label="材料夹">
                      {OFFICE_FOLDERS.filter((f) => f.id !== 'none').map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          role="option"
                          aria-selected={pickerFolderId === f.id}
                          className={`oc-mount-folder${pickerFolderId === f.id ? ' is-active' : ''}`}
                          onClick={() => setPickerFolderId(f.id)}
                        >
                          {f.name}
                          <span className="oc-mount-count">{f.count}</span>
                        </button>
                      ))}
                    </div>
                    <div className="oc-mount-files" role="listbox" aria-label="文件">
                      {pickerFolder ? (
                        pickerFolder.files.map((file) => {
                          const selected = liveCtx?.folderId === pickerFolder.id && liveCtx.fileIds.includes(file.id)
                          const blocked = !selected && atLimit
                          return (
                            <button
                              key={file.id}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              disabled={blocked}
                              className={`oc-mount-file${selected ? ' is-selected' : ''}`}
                              onClick={() => onPickFile(pickerFolder.id, file.id)}
                            >
                              <span className="oc-mount-file-kind">{file.kind.toUpperCase()}</span>
                              <span className="oc-mount-file-name">{file.name}</span>
                              {selected ? <span className="oc-mount-file-tag">已挂</span> : null}
                            </button>
                          )
                        })
                      ) : (
                        <p className="oc-mount-empty">此夹暂无演示文件</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {mountedFiles.map((f) => (
              <div key={f.id} className="oc-material-chip-wrap">
                <button
                  type="button"
                  className={`composer-chip oc-material-chip${materialReadonly ? ' readonly' : ''}`}
                  aria-expanded={previewFileId === f.id}
                  onClick={() => {
                    setPickerOpen(false)
                    setPreviewFileId((cur) => (cur === f.id ? null : f.id))
                  }}
                >
                  <span className="oc-material-chip-kind">{f.kind.toUpperCase()}</span>
                  {f.name}
                </button>
                {!materialReadonly ? (
                  <button
                    type="button"
                    className="oc-material-unload"
                    title="卸下"
                    aria-label={`卸下 ${f.name}`}
                    onClick={() => onUnload(f.id)}
                  >
                    卸下
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          {previewFile ? (
            <div className="oc-chip-preview-pop" role="dialog" aria-label="材料预览">
              <div className="oc-chip-preview-hd">
                <strong>{previewFile.name}</strong>
                <span className="oc-chip-preview-kind">{previewFile.kind.toUpperCase()}</span>
              </div>
              <p className="oc-chip-preview-desc">{previewFile.description}</p>
              <pre className="oc-chip-preview-body">{materialPreviewText(previewFile)}</pre>
            </div>
          ) : null}
        </div>

        <textarea
          id="office-composer-input"
          rows={isTaskView ? 1 : 2}
          value={draft}
          aria-label={isTaskView ? '补充修改意见' : '输入消息'}
          placeholder={isTaskView ? '补充修改意见…' : '发送消息…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />

        <div className="composer-toolbar">
          <div className="toolbar-left">
            {isTaskView && isDone && onRefine ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {QUICK_REFINEMENT_ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="composer-policy-chip"
                    onClick={() => onRefine(a.label)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            ) : (
              <span className="composer-hint">
                + &nbsp; Enter 发送
              </span>
            )}
          </div>

          <div className="toolbar-right">
            {!isTaskView && (
              <>
                <label className="composer-policy-chip" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <select
                    value={permission}
                    aria-label="权限模式"
                    onChange={(e) => $officePermission.set(e.target.value as typeof permission)}
                    style={{ border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', outline: 'none', padding: 0 }}
                  >
                    {OFFICE_PERMISSIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="composer-policy-chip" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <select
                    value={format}
                    aria-label="交付格式"
                    onChange={(e) => $officeFormat.set(e.target.value as OfficeFormat)}
                    style={{ border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', outline: 'none', padding: 0 }}
                  >
                    {OFFICE_FORMATS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            <button
              type="submit"
              className={`btn-circle btn-send${draft.trim() ? ' ready' : ''}`}
              disabled={!draft.trim()}
              aria-label={isTaskView ? '应用改稿' : '发送'}
              title={isTaskView ? '应用改稿' : '发送'}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}
