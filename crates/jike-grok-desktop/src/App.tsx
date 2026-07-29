import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { MessageList } from './components/Chat/MessageList'
import { Composer } from './components/Composer'
import { SettingsModal } from './components/Modals/SettingsModal'
import { PermissionModal } from './components/Modals/PermissionModal'
import { SidePanelProvider } from './context/SidePanelContext'
import { SidePanel } from './components/SidePanel'
import {
  ErrorBoundary,
  MainViewportErrorFallback,
} from './components/ErrorBoundary'
import { ToastHost } from './components/Toast'
import { StreamDebugOverlay } from './components/StreamDebugOverlay'
import { useDesktopApp } from './hooks/useDesktopApp'

import './App.css'

/**
 * 桌面壳布局：状态与业务在 useDesktopApp / sessionLifecycle。
 */
export default function App() {
  const app = useDesktopApp()

  if (!app.inTauri) {
    return (
      <div className="browser-gate">
        <div className="browser-gate-card">
          <h1>请用桌面应用打开</h1>
          <p>当前运行在普通浏览器中，缺少 Tauri 原生桥接支持。</p>
          <pre className="browser-gate-cmd">
            {`cd crates/jike-grok-desktop\ncargo tauri dev`}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <SidePanelProvider workspaceRoot={app.workspaceCwd}>
      <div className="app-container">
        <ToastHost toasts={app.toasts} onDismiss={app.dismissToast} />
        <StreamDebugOverlay visible={app.streamDebugOpen} />
        <Sidebar
          collapsed={app.sidebarCollapsed}
          onToggleCollapse={() => app.setSidebarCollapsed((v) => !v)}
          onNewChat={app.handleNewChat}
          onOpenSettings={() => void app.openSettings()}
          recentChats={app.recentChats}
          activeChatId={app.activeChatId}
          currentWorkspaceCwd={app.workspaceCwd}
          onSelectChat={app.handleSelectChat}
          onDeleteChat={app.handleDeleteChat}
          onRenameChat={app.handleRenameChat}
        />

        {/* 主区单独边界：消息/Composer 崩了时侧栏仍可新建/切换会话 */}
        <ErrorBoundary
          name="主界面"
          fallback={(error, reset) => (
            <div className="main-viewport">
              <MainViewportErrorFallback error={error} onReset={reset} />
            </div>
          )}
        >
          <div className="main-viewport">
            <Header
              sidebarCollapsed={app.sidebarCollapsed}
              onToggleSidebar={() => app.setSidebarCollapsed((v) => !v)}
              chatTitle={app.chatTitle}
            />

            {app.error && <div className="banner error">{app.error}</div>}

            <MessageList
              messages={app.messages}
              permission={app.permission}
              loadingHistory={app.loadingHistory}
              sessionKey={app.activeChatId}
              streaming={app.engineGenerating}
            />

            <Composer
              ref={app.composerRef}
              input={app.input}
              setInput={app.setInput}
              canSend={app.canSend}
              engineGenerating={app.engineGenerating}
              shellReady={app.shellReady}
              sessionPhase={app.sessionPhase}
              models={app.models}
              selectedModelId={app.selectedModelId}
              reasoningEffort={app.reasoningEffort}
              workspaceCwd={app.workspaceCwd}
              workspaceOptions={app.workspaceOptions}
              contextUsedTokens={app.contextUsedTokens}
              usageDetail={app.usageDetail}
              usageDetailLoading={app.usageDetailLoading}
              onFetchUsageDetail={() => void app.fetchUsageDetail()}
              canSwitchWorkspace={app.canSwitchWorkspace}
              onSwitchModel={(id) => void app.switchCurrentModel(id)}
              onSwitchReasoningEffort={(e) => void app.switchReasoningEffort(e)}
              onSelectWorkspace={(cwd) => void app.applyWorkspaceCwd(cwd)}
              onBrowseWorkspace={() => void app.browseWorkspace()}
              onSend={(text) => void app.onSend(text)}
              onCancel={() => void app.onCancel()}
            />

            {app.permission && (
              <PermissionModal
                permission={app.permission}
                onRespond={(id) => void app.onPermission(id)}
              />
            )}

            {app.settingsOpen && (
              <SettingsModal
                settingsCwd={app.settingsCwd}
                setSettingsCwd={app.setSettingsCwd}
                pickDirectory={() => void app.pickDirectory()}
                models={app.models}
                selectedModelId={app.selectedModelId}
                selectModel={app.selectModel}
                draftModelIds={app.draftModelIds}
                startAddModel={app.startAddModel}
                discardSelectedDraft={app.discardSelectedDraft}
                removeSelectedModel={app.removeSelectedModel}
                updateSelectedModel={app.updateSelectedModel}
                modelConfigPath={app.modelConfigPath}
                keyStatus={app.keyStatus}
                keyInput={app.keyInput}
                setKeyInput={app.setKeyInput}
                keyVisible={app.keyVisible}
                setKeyVisible={app.setKeyVisible}
                envFilePath={app.envFilePath}
                savingSettings={app.savingSettings}
                canSwitchWorkspace={app.canSwitchWorkspace}
                onClose={() => app.setSettingsOpen(false)}
                onSave={app.saveSettings}
              />
            )}
          </div>
        </ErrorBoundary>

        <ErrorBoundary name="右侧栏">
          <SidePanel />
        </ErrorBoundary>
      </div>
    </SidePanelProvider>
  )
}
