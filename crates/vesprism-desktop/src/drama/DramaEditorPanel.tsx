import { useStore } from '@nanostores/react'
import { $dramaEditor } from './store'
import { CharacterEditor, ScriptEditor, StoryboardEditor, TimelineEditor } from './editors'

const BODY = { script: ScriptEditor, storyboard: StoryboardEditor, timeline: TimelineEditor, character: CharacterEditor } as const

const TITLE = { script: '剧本', storyboard: '分镜表', timeline: '时间轴', character: '角色卡' } as const

/** 编辑器外壳：侧栏/全屏切换。 */
export function DramaEditorPanel() {
  const ed = useStore($dramaEditor)
  if (!ed) return null
  const full = ed.mode === 'full'
  const Body = BODY[ed.kind]
  return (
    <aside data-testid="drama-editor" data-mode={ed.mode} className={`drama-editor${full ? ' is-full' : ''}`}>
      <header>
        <span>{TITLE[ed.kind]} · {ed.nodeId}</span>
        <span>
          <button className="btn-inline" onClick={() => $dramaEditor.set({ ...ed, mode: full ? 'side' : 'full' })}>{full ? '侧栏' : '全屏'}</button>
          <button className="btn-inline" onClick={() => $dramaEditor.set(null)}>关闭</button>
        </span>
      </header>
      <div className="drama-editor-body"><Body /></div>
    </aside>
  )
}
