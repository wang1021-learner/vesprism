import { useRef, type KeyboardEvent } from 'react'
import type { ModelEntry } from '../../types'

interface ComposerProps {
  input: string
  setInput: (v: string) => void
  canSend: boolean
  isGenerating: boolean
  ready: boolean
  models: ModelEntry[]
  selectedModelId: string
  onSwitchModel: (id: string) => void
  onSend: () => void
  onCancel: () => void
}

export function Composer({
  input,
  setInput,
  canSend,
  isGenerating,
  ready,
  models,
  selectedModelId,
  onSwitchModel,
  onSend,
  onCancel,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend && input.trim()) {
        onSend()
      }
    }
  }

  return (
    <footer className="composer-container">
      <div className="composer-card">
        <textarea
          ref={textareaRef}
          value={input}
          rows={2}
          placeholder={ready ? 'Message...' : '请先启动会话…'}
          disabled={!canSend && !isGenerating}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="composer-toolbar">
          <div className="toolbar-left">
            <button
              type="button"
              className="composer-icon-btn"
              title="添加附件"
              disabled={!ready}
            >
              📎
            </button>
          </div>
          <div className="toolbar-right">
            {models.length > 0 && (
              <select
                className="composer-model-select"
                value={selectedModelId}
                disabled={!ready}
                title="切换当前会话使用的模型"
                onChange={(e) => onSwitchModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.model || m.id}
                  </option>
                ))}
              </select>
            )}
            {isGenerating ? (
              <button
                type="button"
                className="btn-circle btn-stop"
                title="停止生成"
                onClick={onCancel}
              >
                ■
              </button>
            ) : (
              <button
                type="button"
                className="btn-circle btn-send"
                disabled={!canSend || !input.trim()}
                title="发送消息 (Enter)"
                onClick={onSend}
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="disclaimer-text">
        AI can make mistakes. Verify important information.
      </div>
    </footer>
  )
}
