import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from '@nanostores/react'
import {
  OFFICE_FOLDERS,
  OFFICE_FORMATS,
  OFFICE_PERMISSIONS,
  type OfficeFormat,
} from './catalog'
import { kindLabel } from './labels'
import { DEMO_FOLDERS } from './model'
import {
  $officeDraftSeed,
  $officeFolderId,
  $officeFormat,
  $officePermission,
  $officeTasks,
  selectOfficeTask,
} from './store'

/** 极简工作首页：顶条材料夹 · 最近交付 / 空态 · 沉底输入 dock（无场景卡、无问候大标题）。 */
export function HomeDesk({
  draft,
  setDraft,
  onKey,
  onSubmit,
}: {
  draft: string
  setDraft: (v: string) => void
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (e: FormEvent) => void
}) {
  const folderId = useStore($officeFolderId)
  const format = useStore($officeFormat)
  const permission = useStore($officePermission)
  const tasks = useStore($officeTasks)
  const seed = useStore($officeDraftSeed)

  const currentFolder =
    folderId === 'none' ? null : (DEMO_FOLDERS.find((f) => f.id === folderId) ?? DEMO_FOLDERS[0])
  const lastDone = tasks.find((t) => t.status === 'done') ?? null
  const running = tasks.find((t) => t.status === 'running') ?? null
  const folderMeta = OFFICE_FOLDERS.find((f) => f.id === folderId)
  const fileCount = currentFolder?.files.length ?? folderMeta?.count ?? 0
  const folderName = currentFolder?.name ?? folderMeta?.name

  // 消费右栏「以此起草」种子：预填草稿回沉底 dock，供用户审后再提交
  useEffect(() => {
    if (seed) {
      setDraft(seed)
      $officeDraftSeed.set(null)
    }
  }, [seed, setDraft])

  return (
    <div className="od-desk is-home" role="main" aria-label="办公工作台">
      {/* ── 顶条：材料夹 + 演示标注 + 执行中提示 ── */}
      <header className="od-home-bar">
        <div className="od-home-bar-left">
          <label className="od-folder-select">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path
                d="M1 4.8C1 3.8 1.8 3 2.8 3h2.1l1.1 1.4H11c.6 0 1 .4 1 1V10c0 1-.8 1.8-1.8 1.8H2.8A1.8 1.8 0 0 1 1 10V4.8z"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
                strokeLinejoin="round"
              />
            </svg>
            <span className="sr-only">材料夹</span>
            <select
              value={folderId}
              aria-label="材料夹"
              onChange={(e) => $officeFolderId.set(e.target.value)}
            >
              {OFFICE_FOLDERS.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
          {folderId !== 'none' && folderName && (
            <span className="od-home-meta">{folderName} · {fileCount} 份</span>
          )}
          <span className="od-home-demo-pill">演示</span>
        </div>
        {running && (
          <div className="od-home-bar-right">
            <span className="od-running-notice">
              <span className="od-running-dot" aria-hidden="true" />
              《{running.title}》演示步进中…
            </span>
          </div>
        )}
      </header>

      {/* ── 中央：最近交付 / 空态（一卡，无卡片墙） ── */}
      <main className="od-home-main">
        {lastDone?.file ? (
          <section className="od-home-last" aria-label="最近交付">
            <div className="od-home-section-label">最近交付</div>
            <button
              type="button"
              className="od-recent-card"
              onClick={() => selectOfficeTask(lastDone.id)}
            >
              <div className="od-recent-card-head">
                <span className="od-recent-kind-badge">{kindLabel(lastDone.file.kind)}</span>
                <span className="od-status-pill is-done">已交付</span>
                <span className="od-recent-cta">
                  打开画板
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M2 6h8M6.5 2.5L10 6l-3.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
              <strong className="od-recent-title">{lastDone.file.title}</strong>
              <p className="od-recent-summary">{lastDone.file.summary}</p>
            </button>
          </section>
        ) : (
          <p className="od-home-empty">
            还没有交付稿。在右侧材料夹挑一份文件点「以此起草」，或直接在下框描述要交付的成果。
          </p>
        )}
      </main>

      {/* ── 沉底 dock：交稿输入 + 权限 / 格式 + 开始 ── */}
      <form className="od-dock-home" onSubmit={onSubmit}>
        <textarea
          rows={2}
          value={draft}
          aria-label="交稿说明"
          placeholder="描述需要的成果，例如：根据本周材料出第 12 周周报，文稿预览，内部阅读权限…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="od-dock-home-bar">
          <div className="od-dock-home-controls">
            <label className="od-select-wrap">
              <span className="sr-only">权限</span>
              <select
                value={permission}
                aria-label="权限"
                onChange={(e) => $officePermission.set(e.target.value as typeof permission)}
              >
                {OFFICE_PERMISSIONS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="od-select-wrap">
              <span className="sr-only">格式</span>
              <select
                value={format}
                aria-label="格式"
                onChange={(e) => $officeFormat.set(e.target.value as OfficeFormat)}
              >
                {OFFICE_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className="od-home-submit" disabled={!draft.trim()}>
            开始规划
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M2.5 7h9M8 3l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </form>
    </div>
  )
}
