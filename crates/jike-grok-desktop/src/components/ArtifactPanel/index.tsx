import { useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useArtifact } from '../../context/ArtifactContext'

export function ArtifactPanel() {
  const { activeArtifact, closeArtifact } = useArtifact()
  const isOpen = activeArtifact !== null
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')

  const handleDownload = async () => {
    if (!activeArtifact || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const ext = activeArtifact.language
      const defaultName = `artifact.${ext}`
      const targetPath = await save({
        defaultPath: defaultName,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      })
      if (targetPath) {
        await invoke('save_artifact_file', { path: targetPath, content: activeArtifact.code })
      }
    } catch (e) {
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`artifact-panel${isOpen ? ' open' : ''}`}>
      {isOpen && (
        <>
          <div className="artifact-panel-header">
            <span className="artifact-panel-title">
              {activeArtifact.language.toUpperCase()}
            </span>
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
            <div className="artifact-panel-header-actions">
              <button
                type="button"
                className="artifact-panel-download"
                onClick={() => void handleDownload()}
                disabled={saving}
                title="下载到本地"
              >
                {saving ? '保存中…' : '下载'}
              </button>
              <button
                type="button"
                className="artifact-panel-close"
                onClick={closeArtifact}
                aria-label="关闭预览"
              >
                ×
              </button>
            </div>
          </div>
          {saveError && <div className="artifact-panel-save-error">{saveError}</div>}
          <div className="artifact-panel-body">
            {viewMode === 'preview' ? (
              <iframe
                key={activeArtifact.id}
                className="artifact-preview-frame"
                sandbox="allow-scripts"
                srcDoc={
                  activeArtifact.language === 'svg'
                    ? `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;">${activeArtifact.code}</body></html>`
                    : activeArtifact.code
                }
                title="Artifact 预览"
              />
            ) : (
              <pre className="artifact-panel-placeholder">{activeArtifact.code}</pre>
            )}
          </div>
        </>
      )}
    </div>
  )
}
