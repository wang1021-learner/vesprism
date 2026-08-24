import { useStore } from '@nanostores/react'
import { $appShell } from '../store'
import { RightPanelToggle, TabBar } from './TabBar'

/** 系统标题栏下方的应用工具条：标签 + 右侧面板。 */
export function WindowChrome() {
  const shell = useStore($appShell)
  return (
    <div className="window-chrome">
      <TabBar />
      <div className="window-chrome-spacer" />
      {shell === 'coding' && (
        <div className="window-actions">
          <RightPanelToggle />
        </div>
      )}
    </div>
  )
}
