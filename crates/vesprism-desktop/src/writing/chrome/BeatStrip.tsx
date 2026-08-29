import type { BeatCard } from '../model/types'

/** 节拍条：把这一章的切块横排在主卡上方，一眼看到叙事流。 */
export function BeatStrip({
  beats,
  selectedBeatId,
  onSelect,
}: {
  beats: BeatCard[]
  selectedBeatId?: string
  onSelect?: (id: string) => void
}) {
  if (beats.length === 0) return null
  return (
    <div className="wd-bstrip" role="list" aria-label="本章切块">
      {beats.map((b, i) => (
        <button
          key={b.id}
          type="button"
          role="listitem"
          className={`wd-bcell${selectedBeatId === b.id ? ' is-on' : ''}`}
          onClick={() => onSelect?.(b.id)}
        >
          <span className="wd-bnum">{'①②③④⑤⑥⑦⑧⑨⑩'[i] ?? i + 1}</span>
          <span className="wd-bt">{b.title || `切块 ${i + 1}`}</span>
          <span className="wd-bs">{b.job || b.scene || b.land || '还没有任务'}</span>
        </button>
      ))}
    </div>
  )
}
