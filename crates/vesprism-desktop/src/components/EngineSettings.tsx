import { useEffect, useRef, useState } from 'react'
import {
  gcDesktopWorktrees,
  getEnginePrefs,
  getWorktreeStatus,
  setEnginePrefs,
  type EnginePrefs,
  type WorktreeStatusInfo,
} from '../bridge'
import { SettingsHelp, SettingsLabel } from './SettingsHelp'

function parseDomainLines(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function EngineSettings({
  saving: _saving,
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
  /**
   * Web 搜索限制模式（互斥）：官方 WebSearchOptions::validate 拒绝 allowed+excluded 并存
   * （allowlist wins，安全 fail-closed）。UI 用单选从源头杜绝并存：
   * - none：不限制（两列表都空）
   * - allow：只写白名单
   * - exclude：只写排除列表
   * 切换模式时各自的文本保留在 state（数据永不丢），保存只写当前模式对应的列表。
   */
  const [wsMode, setWsMode] = useState<'none' | 'allow' | 'exclude'>('none')
  const [wt, setWt] = useState<WorktreeStatusInfo | null>(null)
  const [gcBusy, setGcBusy] = useState(false)

  const load = async () => {
    try {
      const p = await getEnginePrefs()
      setPrefs(p)
      setAllowedText(p.web_search_allowed.join('\n'))
      setExcludedText(p.web_search_excluded.join('\n'))
      setWsMode(
        p.web_search_allowed.length > 0 ? 'allow' : p.web_search_excluded.length > 0 ? 'exclude' : 'none',
      )
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
      // 互斥模式：只写当前激活模式的列表，另一个显式传空——不会出现官方丢弃 excluded 的情况。
      const next = await setEnginePrefs({
        ...prefs,
        web_search_allowed: wsMode === 'allow' ? parseDomainLines(allowedText) : [],
        web_search_excluded: wsMode === 'exclude' ? parseDomainLines(excludedText) : [],
      })
      setPrefs(next)
      setAllowedText(next.web_search_allowed.join('\n'))
      setExcludedText(next.web_search_excluded.join('\n'))
      setWsMode(
        next.web_search_allowed.length > 0 ? 'allow' : next.web_search_excluded.length > 0 ? 'exclude' : 'none',
      )
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
          <SettingsHelp text="给历史会话建本地全文索引，侧栏搜索会用到。多进程共用同一 GROK_HOME 时可关掉，避免抢索引。" />
        </label>
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">记忆系统</h3>
        <p className="settings-card-desc">
          官方跨会话记忆（<code>[memory] enabled</code>）：新会话自动注入相关记忆，
          会话结束时自动存摘要，agent 可用 memory_search / memory_get 主动检索。
          存储位置 <code>~/.vesprism/memory/</code>；未配置 embedding 时官方自动退化为
          FTS 关键词检索（无外部依赖）。
        </p>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={prefs.memory_enabled}
            onChange={(e) => setPrefs({ ...prefs, memory_enabled: e.target.checked })}
          />
          启用跨会话记忆（默认开）
          <SettingsHelp text="新对话会带上相关旧记忆，结束时存摘要。关掉后已有记忆文件不会删。" />
        </label>
        <p className="settings-hint">保存后新会话生效；关掉后已存的记忆文件不会被删除。</p>
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">输入排队</h3>
        <p className="settings-card-desc">
          官方 <code>[ui].combine_queued_prompts</code>：生成中连续排队的普通提问合并成一轮发给模型。
        </p>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={prefs.combine_queued_prompts}
            onChange={(e) =>
              setPrefs({ ...prefs, combine_queued_prompts: e.target.checked })
            }
          />
          合并连续排队提问
          <SettingsHelp text="只合并纯文本提问。改排队稿、带附件、斜杠命令不会并在一起。" />
        </label>
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">Web 搜索域名</h3>
        <p className="settings-card-desc">
          写入 <code>[toolset.web_search]</code>。官方语义：白名单与排除列表互斥（同时存在时只认白名单，
          fail-closed）。这里用单选从源头杜绝并存——切换模式时各自内容保留，不会丢。
        </p>
        <div className="settings-row" style={{ gap: 14 }}>
          <label className="settings-check">
            <input
              type="radio"
              name="ws-mode"
              checked={wsMode === 'none'}
              onChange={() => setWsMode('none')}
            />
            不限制
          </label>
          <label className="settings-check">
            <input
              type="radio"
              name="ws-mode"
              checked={wsMode === 'allow'}
              onChange={() => setWsMode('allow')}
            />
            白名单（只允许）
          </label>
          <label className="settings-check">
            <input
              type="radio"
              name="ws-mode"
              checked={wsMode === 'exclude'}
              onChange={() => setWsMode('exclude')}
            />
            排除列表（只禁止）
          </label>
        </div>
        {wsMode === 'allow' && (
          <>
            <SettingsLabel htmlFor="ws-allow" help="网页搜索只许访问这些域名。和排除列表不能同时用。">
              允许域名（每行一个）
            </SettingsLabel>
            <textarea
              id="ws-allow"
              className="settings-input settings-textarea"
              rows={4}
              value={allowedText}
              onChange={(e) => setAllowedText(e.target.value)}
              placeholder="docs.x.ai&#10;arxiv.org"
            />
            <p className="settings-hint">保存后新会话生效。</p>
          </>
        )}
        {wsMode === 'exclude' && (
          <>
            <SettingsLabel htmlFor="ws-deny" help="网页搜索不要去这些域名。和白名单不能同时用。">
              排除域名（每行一个）
            </SettingsLabel>
            <textarea
              id="ws-deny"
              className="settings-input settings-textarea"
              rows={3}
              value={excludedText}
              onChange={(e) => setExcludedText(e.target.value)}
              placeholder="reddit.com"
            />
            <p className="settings-hint">保存后新会话生效。</p>
          </>
        )}
        {wsMode === 'none' && (
          <p className="settings-hint">不限制搜索域名，官方不会启用域名过滤。</p>
        )}
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">图像 / 视频生成限流</h3>
        <p className="settings-card-desc">
          官方 <code>[tools.media_gen]</code>：模型单步最多能请求几次生成，避免刷爆。
        </p>
        <div className="settings-row">
          <SettingsLabel htmlFor="img-cap" help="模型一步里最多能同时点几次文生图，防止刷爆配额。">
            图像并行上限
          </SettingsLabel>
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
          <SettingsLabel htmlFor="vid-cap" help="模型一步里最多能同时点几次视频生成。">
            视频并行上限
          </SettingsLabel>
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
    </div>
  )
}
