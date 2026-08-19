import { useEffect, useRef, useState } from 'react'
import {
  gcDesktopWorktrees,
  getEnginePrefs,
  getWorktreeStatus,
  setEnginePrefs,
  type EnginePrefs,
  type WorktreeStatusInfo,
} from '../bridge'

function parseDomainLines(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function EngineSettings({
  saving,
  setSaving,
  onToast,
  bindSave,
}: {
  saving: boolean
  setSaving: (v: boolean) => void
  onToast: (message: string, type: 'success' | 'error') => void
  bindSave?: (fn: (() => Promise<void>) | null) => void
}) {
  const [prefs, setPrefs] = useState<EnginePrefs | null>(null)
  const [allowedText, setAllowedText] = useState('')
  const [excludedText, setExcludedText] = useState('')
  const [wt, setWt] = useState<WorktreeStatusInfo | null>(null)
  const [gcBusy, setGcBusy] = useState(false)

  const load = async () => {
    try {
      const p = await getEnginePrefs()
      setPrefs(p)
      setAllowedText(p.web_search_allowed.join('\n'))
      setExcludedText(p.web_search_excluded.join('\n'))
    } catch (e) {
      onToast(String(e), 'error')
    }
    try {
      setWt(await getWorktreeStatus())
    } catch {
      setWt(null)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const save = async () => {
    if (!prefs) {
      onToast('引擎设置尚未加载完成', 'error')
      return
    }
    setSaving(true)
    try {
      const next = await setEnginePrefs({
        ...prefs,
        web_search_allowed: parseDomainLines(allowedText),
        web_search_excluded: parseDomainLines(excludedText),
      })
      setPrefs(next)
      setAllowedText(next.web_search_allowed.join('\n'))
      setExcludedText(next.web_search_excluded.join('\n'))
      onToast('引擎设置已写入 config.toml', 'success')
    } catch (e) {
      onToast(String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    bindSave?.(() => saveRef.current())
    return () => bindSave?.(null)
  }, [bindSave])

  const runGc = async (dryRun: boolean) => {
    setGcBusy(true)
    try {
      const r = await gcDesktopWorktrees(dryRun)
      onToast(r.message, 'success')
      setWt(await getWorktreeStatus())
    } catch (e) {
      onToast(String(e), 'error')
    } finally {
      setGcBusy(false)
    }
  }

  if (!prefs) {
    return <p className="settings-hint">正在读取官方配置…</p>
  }

  const allowWins = parseDomainLines(allowedText).length > 0

  return (
    <div className="settings-panel-inner">
      <section className="settings-card">
        <h3 className="settings-card-title">会话搜索索引</h3>
        <p className="settings-card-desc">
          对应官方 <code>[features] session_search</code> / <code>GROK_SESSION_SEARCH</code>。
          关闭后本机不再建 FTS 索引，适合多进程共享同一 GROK_HOME。
        </p>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={prefs.session_search}
            onChange={(e) => setPrefs({ ...prefs, session_search: e.target.checked })}
          />
          启用会话搜索索引（默认开）
        </label>
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">Web 搜索域名</h3>
        <p className="settings-card-desc">
          写入 <code>[toolset.web_search]</code>。白名单与黑名单同时填写时，官方只认白名单。
        </p>
        <label className="settings-label" htmlFor="ws-allow">
          允许域名（每行一个）
        </label>
        <textarea
          id="ws-allow"
          className="settings-input settings-textarea"
          rows={4}
          value={allowedText}
          onChange={(e) => setAllowedText(e.target.value)}
          placeholder="docs.x.ai&#10;arxiv.org"
        />
        <label className="settings-label" htmlFor="ws-deny">
          排除域名（每行一个）
        </label>
        <textarea
          id="ws-deny"
          className="settings-input settings-textarea"
          rows={3}
          value={excludedText}
          onChange={(e) => setExcludedText(e.target.value)}
          disabled={allowWins}
          placeholder="reddit.com"
        />
        {allowWins ? (
          <p className="settings-hint">已填写白名单，排除列表不会写入（官方 allowlist 优先）。</p>
        ) : (
          <p className="settings-hint">留空表示不限制。保存后新会话生效。</p>
        )}
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">图像 / 视频生成限流</h3>
        <p className="settings-card-desc">
          官方 <code>[tools.media_gen]</code>：模型单步最多能请求几次生成，避免刷爆。
        </p>
        <div className="settings-row">
          <label className="settings-label" htmlFor="img-cap">
            图像并行上限
          </label>
          <input
            id="img-cap"
            type="number"
            min={1}
            max={32}
            className="settings-input"
            style={{ maxWidth: 120 }}
            value={prefs.max_parallel_image_gen_calls}
            onChange={(e) =>
              setPrefs({
                ...prefs,
                max_parallel_image_gen_calls: Number(e.target.value) || 1,
              })
            }
          />
        </div>
        <div className="settings-row">
          <label className="settings-label" htmlFor="vid-cap">
            视频并行上限
          </label>
          <input
            id="vid-cap"
            type="number"
            min={1}
            max={16}
            className="settings-input"
            style={{ maxWidth: 120 }}
            value={prefs.max_parallel_video_gen_calls}
            onChange={(e) =>
              setPrefs({
                ...prefs,
                max_parallel_video_gen_calls: Number(e.target.value) || 1,
              })
            }
          />
        </div>
        <p className="settings-hint">官方默认图像 8、视频 4。保存写入 config.toml。</p>
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">Worktree 回收</h3>
        <p className="settings-card-desc">
          官方会自动清理 <code>~/.vesprism/worktrees</code> 里闲置的隔离拷贝，且不会删最后一份。
        </p>
        {wt ? (
          <p className="settings-hint">
            {wt.home}
            <br />
            记录 {wt.total} · 存活 {wt.alive} · 已死 {wt.dead}
            {wt.db_bytes ? ` · 索引 ${(wt.db_bytes / 1024).toFixed(1)} KB` : ''}
            <br />
            {wt.note}
          </p>
        ) : (
          <p className="settings-hint">无法读取 worktree 索引。</p>
        )}
        <div className="settings-row">
          <button
            type="button"
            className="btn-secondary"
            disabled={gcBusy}
            onClick={() => void runGc(true)}
          >
            预检可回收
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={gcBusy || !wt?.available}
            onClick={() => void runGc(false)}
          >
            {gcBusy ? '处理中…' : '清理闲置 worktree'}
          </button>
        </div>
      </section>

      <button
        type="button"
        className="btn-primary"
        disabled={saving}
        onClick={() => void save()}
      >
        保存引擎设置
      </button>
    </div>
  )
}
