import type { ModelEntry } from '../../types'

/** 温度 / top_p / max_completion_tokens（null = 不设置） */
export function ModelSamplingFields({
  selectedModel,
  updateSelectedModel,
}: {
  selectedModel: ModelEntry
  updateSelectedModel: (patch: Partial<ModelEntry>) => void
}) {
  return (
    <div className="settings-field-grid settings-field-grid-3">
      <div className="settings-field">
        <label className="settings-label">温度 (temperature)</label>
        <input
          type="number"
          min={0}
          max={2}
          step={0.1}
          className="settings-input"
          value={selectedModel.temperature == null ? '' : selectedModel.temperature}
          placeholder="不设置"
          onChange={(e) => {
            const raw = e.target.value.trim()
            if (raw === '') {
              updateSelectedModel({ temperature: null })
              return
            }
            const n = Number(raw)
            updateSelectedModel({ temperature: Number.isFinite(n) ? n : null })
          }}
        />
      </div>
      <div className="settings-field">
        <label className="settings-label">核采样 (top_p)</label>
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          className="settings-input"
          value={selectedModel.top_p == null ? '' : selectedModel.top_p}
          placeholder="不设置"
          onChange={(e) => {
            const raw = e.target.value.trim()
            if (raw === '') {
              updateSelectedModel({ top_p: null })
              return
            }
            const n = Number(raw)
            updateSelectedModel({ top_p: Number.isFinite(n) ? n : null })
          }}
        />
      </div>
      <div className="settings-field">
        <label className="settings-label">最大生成长度 (max_completion_tokens)</label>
        <input
          type="number"
          min={0}
          step={1}
          className="settings-input"
          value={
            selectedModel.max_completion_tokens == null
              ? ''
              : selectedModel.max_completion_tokens
          }
          placeholder="不设置"
          onChange={(e) => {
            const raw = e.target.value.trim()
            if (raw === '') {
              updateSelectedModel({ max_completion_tokens: null })
              return
            }
            const n = Math.floor(Number(raw))
            updateSelectedModel({
              max_completion_tokens: Number.isFinite(n) && n >= 0 ? n : null,
            })
          }}
        />
      </div>
    </div>
  )
}
