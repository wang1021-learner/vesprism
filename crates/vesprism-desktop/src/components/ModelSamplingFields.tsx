import type { ModelInfo } from '../types'
import { SettingsLabel } from './SettingsHelp'

/** 温度 / top_p / max_completion_tokens（null = 不设置） */
export function ModelSamplingFields({
  selectedModel,
  updateSelectedModel,
}: {
  selectedModel: ModelInfo
  updateSelectedModel: (patch: Partial<ModelInfo>) => void
}) {
  return (
    <div className="settings-field-grid settings-field-grid-3">
      <div className="settings-field">
        <SettingsLabel help="越大输出越跳、越有变化；越小越死板。空着表示不改对方默认。范围大约 0–2。">
          温度
        </SettingsLabel>
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
        <SettingsLabel help="只从概率加起来靠前的词里抽。空着表示不设置。一般和温度只调一个。">
          核采样
        </SettingsLabel>
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
        <SettingsLabel help="单次回答最多生成多少 token。空着表示不限制（仍受上下文窗口约束）。">
          最大生成长度
        </SettingsLabel>
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
