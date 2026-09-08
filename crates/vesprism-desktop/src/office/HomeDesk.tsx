import { useEffect, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from '@nanostores/react'
import {
  $officeDraftSeed,
} from './store'
import { OfficeComposer } from './OfficeComposer'

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
  const seed = useStore($officeDraftSeed)

  useEffect(() => {
    if (seed) {
      setDraft(seed)
      $officeDraftSeed.set(null)
      // 焦点到底栏输入框（不自动开跑）
      requestAnimationFrame(() => {
        const el = document.getElementById('office-composer-input') as HTMLTextAreaElement | null
        el?.focus()
      })
    }
  }, [seed, setDraft])

  return (
    <div className="session-chat is-blank" role="main" aria-label="办公工作台">
      <div className="composer-container is-empty">
        <h1 className="composer-hello">有什么要做的？</h1>

        <OfficeComposer
          draft={draft}
          setDraft={setDraft}
          onKey={onKey}
          onSubmit={onSubmit}
          isTaskView={false}
        />

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            AI 可能会出错，请核对重要信息
          </span>
        </div>
      </div>
    </div>
  )
}
