import { RightPanelToggle, TabBar } from './TabBar'

/** 系统标题栏下方的应用工具条：标签 + 右侧面板。窗口拖拽 / 最小最大关闭交给原生边框。 */
export function WindowChrome() {
  return (
    <div className="window-chrome">
      <TabBar />
      <div className="window-chrome-spacer" />
      <div className="window-actions">
        <RightPanelToggle />
      </div>
    </div>
  )
}
