import { useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

interface ArtifactViewProps {
  language: 'html' | 'svg'
  code: string
  title?: string
}

export function ArtifactView({ language, code, title }: ArtifactViewProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const frameId = `${language}-${code.length}-${code.slice(0, 32)}`

  const handleDownload = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const defaultName = title?.includes('.')
        ? title
        : `artifact.${language}`
      const targetPath = await save({
        defaultPath: defaultName,
        filters: [{ name: language.toUpperCase(), extensions: [language] }],
      })
      if (targetPath) {
        await invoke('save_artifact_file', { path: targetPath, content: code })
      }
    } catch (e) {
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="side-panel-artifact">
      <div className="side-panel-toolbar">
        <div className="artifact-panel-tabs">
          <button
            type="button"
            className={`artifact-panel-tab${viewMode === 'preview' ? ' active' : ''}`}
            onClick={() => setViewMode('preview')}
          >
            预览
          </button>
          <button
            type="button"
            className={`artifact-panel-tab${viewMode === 'code' ? ' active' : ''}`}
            onClick={() => setViewMode('code')}
          >
            代码
          </button>
        </div>
        <button
          type="button"
          className="artifact-panel-download"
          onClick={() => void handleDownload()}
          disabled={saving}
          title="下载到本地"
        >
          {saving ? '保存中…' : '下载'}
        </button>
      </div>
      {saveError && <div className="artifact-panel-save-error">{saveError}</div>}
      <div className="side-panel-artifact-body">
        {viewMode === 'preview' ? (
          <iframe
            key={frameId}
            className="artifact-preview-frame"
            sandbox="allow-scripts"
            srcDoc={
              language === 'svg'
                ? `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;">${code}</body></html>`
                : code
            }
            title="Artifact 预览"
          />
        ) : (
          <pre className="artifact-panel-placeholder">{code}</pre>
        )}
      </div>
    </div>
  )
}
