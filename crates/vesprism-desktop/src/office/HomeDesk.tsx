import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from '@nanostores/react'
import { SendIcon } from '../components/composerIcons'
import {
  OFFICE_CAPSULES,
  OFFICE_FOLDERS,
  OFFICE_FORMATS,
  OFFICE_PERMISSIONS,
  type OfficeCapsule,
  type OfficeFormat,
} from './catalog'
import { kindIcon, kindLabel } from './labels'
import { DEMO_FOLDERS } from './model'
import { formatOfficeClock } from './persist'
import {
  $officeArchivedIds,
  $officeDraftSeed,
  $officeFolderId,
  $officeFormat,
  $officePermission,
  $officeStarredIds,
  $officeTasks,
  selectOfficeTask,
  toggleOfficeStar,
} from './store'

type HomeFilter = 'all' | 'running' | 'done' | 'archived'

/** 深度对齐「编码」工作台的办公首页：灰底画布 · 记录列表流 / 2×2 空态卡片 · 浮动 Composer 输入卡片 */
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
  const archivedIds = useStore($officeArchivedIds)
  const starredIds = useStore($officeStarredIds)

  const [filter, setFilter] = useState<HomeFilter>('all')

  const currentFolder =
    folderId === 'none' ? null : (DEMO_FOLDERS.find((f) => f.id === folderId) ?? DEMO_FOLDERS[0])
  const running = tasks.find((t) => t.status === 'running') ?? null
  const folderMeta = OFFICE_FOLDERS.find((f) => f.id === folderId)
  const fileCount = currentFolder?.files.length ?? folderMeta?.count ?? 0
  const folderName = currentFolder?.name ?? folderMeta?.name

  // 消费右栏「以此起草」种子
  useEffect(() => {
    if (seed) {
      setDraft(seed)
      $officeDraftSeed.set(null)
    }
  }, [seed, setDraft])

  const isArchived = (id: string) => archivedIds.includes(id)
  const baseTasks =
    filter === 'archived'
      ? tasks.filter((t) => isArchived(t.id))
      : tasks.filter((t) => !isArchived(t.id))

  const filteredTasks = baseTasks.filter((t) => {
    if (filter === 'all' || filter === 'archived') return true
    if (filter === 'running') return t.status === 'running' || t.status === 'idle'
    return t.status === 'done'
  })

  // 快捷场景卡片
  const starters: readonly OfficeCapsule[] = OFFICE_CAPSULES.slice(0, 4)

  const applyStarter = (starterPrompt: string, targetFormat: OfficeFormat) => {
    setDraft(starterPrompt)
    $officeFormat.set(targetFormat)
  }

  return (
    <div className="od-desk is-home is-gray-canvas" role="main" aria-label="办公工作台">
      {/* ── 顶部透明工具条：材料夹 + 演示标注 + 运行提示 ── */}
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
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          {folderId !== 'none' && folderName && (
            <span className="od-home-meta">
              {folderName} · {fileCount} 份材料
            </span>
          )}
          <span className="od-home-demo-pill">演示模式</span>
        </div>

        {running && (
          <div className="od-home-bar-right">
            <button
              type="button"
              className="od-running-notice"
              onClick={() => selectOfficeTask(running.id)}
              title="查看执行中的任务"
            >
              <span className="od-running-dot" aria-hidden="true" />
              《{running.title}》正在执行…
            </button>
          </div>
        )}
      </header>

      {/* ── 中央主视口：记录流（有记录时） / 空态场景卡片（无记录时） ── */}
      <main className="od-home-main">
        {tasks.length > 0 ? (
          /* ── 模式 A：任务记录流（浮动白纸卡片） ── */
          <section className="od-home-records-section" aria-label="任务记录">
            <div className="od-records-header">
              <div className="od-records-title-wrap">
                <h2 className="od-records-title">任务记录</h2>
                <span className="od-records-count">{tasks.length} 项</span>
              </div>
              <div className="od-rec-filters" role="group" aria-label="按状态过滤任务记录">
                {(
                  [
                    { id: 'all', label: '全部' },
                    { id: 'running', label: '进行中' },
                    { id: 'done', label: '已交付' },
                    { id: 'archived', label: '已归档' },
                  ] as const
                ).map((seg) => (
                  <button
                    key={seg.id}
                    type="button"
                    className={`od-rec-filter${filter === seg.id ? ' is-active' : ''}`}
                    aria-pressed={filter === seg.id}
                    onClick={() => setFilter(seg.id)}
                  >
                    {seg.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="od-records-list">
              {filteredTasks.length === 0 ? (
                <div className="od-records-empty">
                  <p>没有符合当前筛选条件的任务记录。</p>
                </div>
              ) : (
                filteredTasks.map((t) => {
                  const starred = starredIds.includes(t.id)
                  const folder = OFFICE_FOLDERS.find((f) => f.id === t.folderId)?.name ?? '材料夹'
                  return (
                    <article
                      key={t.id}
                      className="od-task-card"
                      onClick={() => selectOfficeTask(t.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') selectOfficeTask(t.id)
                      }}
                    >
                      <div className="od-task-card-left">
                        <span className="od-task-card-icon">
                          {t.file ? kindIcon(t.file.kind) : kindIcon(t.format)}
                        </span>
                        <div className="od-task-card-body">
                          <div className="od-task-card-headline">
                            <strong className="od-task-card-title">{t.title}</strong>
                            <span className={`od-status-pill is-${t.status}`}>
                              {t.status === 'done'
                                ? '已交付'
                                : t.status === 'running'
                                  ? '执行中'
                                  : '待规划'}
                            </span>
                          </div>
                          <p className="od-task-card-prompt">{t.prompt}</p>
                          <div className="od-task-card-meta">
                            <span className="od-task-folder-tag">{folder}</span>
                            <span>·</span>
                            <span>{formatOfficeClock(t.createdAt)}</span>
                            {t.file && t.file.wordCount ? (
                              <>
                                <span>·</span>
                                <span>{t.file.wordCount} 字</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="od-task-card-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={`od-task-star-btn${starred ? ' is-on' : ''}`}
                          aria-label={starred ? '取消星标' : '星标'}
                          title={starred ? '取消星标' : '星标'}
                          onClick={() => toggleOfficeStar(t.id)}
                        >
                          <svg width="13" height="13" viewBox="0 0 12 12" fill={starred ? 'currentColor' : 'none'}>
                            <path
                              d="M6 1.4l1.4 2.9 3.2.5-2.3 2.2.5 3.2L6 8.9 3.2 10.2l.5-3.2L1.4 4.8l3.2-.5L6 1.4z"
                              stroke="currentColor"
                              strokeWidth="1"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </section>
        ) : (
          /* ── 模式 B：空态 Hero 居中区（与编码模式 chat-empty.css 高度一致） ── */
          <div className="empty-hero-container">
            <h1 className="empty-hero-title">有什么要交付的？</h1>
            <p className="empty-hero-subtitle">
              描述交付诉求或选择场景底稿，AI Agent 将自主规划、提取材料并生成富产物。
            </p>

            <div className="empty-starter-grid">
              {starters.map((s: OfficeCapsule) => (
                <button
                  key={s.id}
                  type="button"
                  className="empty-starter-card"
                  onClick={() => applyStarter(s.prompt, s.targetFormat)}
                >
                  <span className="od-starter-badge">{kindIcon(s.targetFormat)}</span>
                  <div className="starter-card-content">
                    <strong className="starter-card-title">{s.title}</strong>
                    <span className="starter-card-desc">{s.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── 底部输入区：完全复刻编码模式的 Composer 结构 ── */}
      <footer className="composer-container od-home-composer-container">
        <form className="composer-card od-composer-card" onSubmit={onSubmit}>
          {/* 顶部 Meta Row：芯片选择器 */}
          <div className="composer-meta-row od-composer-meta-row">
            <label className="composer-chip od-chip-select">
              <span className="od-chip-icon">📁</span>
              <span className="sr-only">材料夹</span>
              <select
                value={folderId}
                aria-label="选择材料夹"
                onChange={(e) => $officeFolderId.set(e.target.value)}
              >
                {OFFICE_FOLDERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="composer-chip od-chip-select">
              <span className="od-chip-icon">🛡️</span>
              <span className="sr-only">权限模式</span>
              <select
                value={permission}
                aria-label="权限模式"
                onChange={(e) => $officePermission.set(e.target.value as typeof permission)}
              >
                {OFFICE_PERMISSIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="composer-chip od-chip-select">
              <span className="od-chip-icon">📑</span>
              <span className="sr-only">交付格式</span>
              <select
                value={format}
                aria-label="交付格式"
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

          {/* 文本输入区 */}
          <textarea
            rows={2}
            value={draft}
            aria-label="交付成果说明"
            placeholder="描述需要的成果，例如：根据本周材料出第 12 周周报，文稿预览，内部阅读权限…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
          />

          {/* 底部工具条：快捷动作与圆形发送按钮 */}
          <div className="composer-toolbar od-composer-toolbar">
            <div className="toolbar-left">
              <span className="od-toolbar-tip">支持使用 /docx /pptx /xlsx 快速指定格式</span>
            </div>
            <div className="toolbar-right">
              <button
                type="submit"
                className={`btn-circle btn-send${draft.trim() ? ' ready' : ''}`}
                disabled={!draft.trim()}
                aria-label="开始交付"
                title="开始交付"
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </form>
      </footer>
    </div>
  )
}
