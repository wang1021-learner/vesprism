import { Component, type ErrorInfo, type ReactNode } from 'react'

export type ErrorBoundaryProps = {
  children: ReactNode
  /** 区块名，用于标题与日志（如「主界面」「消息区」） */
  name?: string
  /** 自定义回退；不传则用默认 UI */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  /** 捕获后回调（可接本地 log） */
  onError?: (error: Error, info: ErrorInfo) => void
}

type State = {
  error: Error | null
}

/**
 * 类组件 Error Boundary：捕获子树渲染期错误，避免整页白屏。
 * （事件处理器 / 异步里的 throw 不会被边界捕获，仍需 try/catch。）
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const label = this.props.name || 'App'
    console.error(`[ErrorBoundary:${label}]`, error, info.componentStack)
    this.props.onError?.(error, info)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const { fallback, name } = this.props
    if (typeof fallback === 'function') {
      return fallback(error, this.reset)
    }
    if (fallback != null) return fallback

    return (
      <ErrorFallback
        title={name ? `${name}出错了` : '出了点问题'}
        error={error}
        onReset={this.reset}
      />
    )
  }
}

function ErrorFallback({
  title,
  error,
  onReset,
  compact,
}: {
  title: string
  error: Error
  onReset: () => void
  compact?: boolean
}) {
  const detail = [error.name, error.message].filter(Boolean).join(': ')

  return (
    <div
      className={`error-boundary-fallback${compact ? ' is-compact' : ''}`}
      role="alert"
    >
      <div className="error-boundary-card">
        <div className="error-boundary-icon" aria-hidden>
          ⚠
        </div>
        <h2 className="error-boundary-title">{title}</h2>
        <p className="error-boundary-desc">
          界面渲染时发生错误。可先点重试；若反复出现，请新建对话或重启应用。
        </p>
        {detail && (
          <pre className="error-boundary-detail" title={detail}>
            {detail}
          </pre>
        )}
        <div className="error-boundary-actions">
          <button type="button" className="error-boundary-btn primary" onClick={onReset}>
            重试
          </button>
          <button
            type="button"
            className="error-boundary-btn"
            onClick={() => window.location.reload()}
          >
            刷新应用
          </button>
        </div>
      </div>
    </div>
  )
}

/** 主内容区紧凑回退（侧栏仍可操作） */
export function MainViewportErrorFallback({
  error,
  onReset,
}: {
  error: Error
  onReset: () => void
}) {
  return (
    <ErrorFallback title="主界面出错了" error={error} onReset={onReset} />
  )
}

/** 消息列表区回退 */
export function MessagesErrorFallback({
  error,
  onReset,
}: {
  error: Error
  onReset: () => void
}) {
  return (
    <ErrorFallback title="消息区出错了" error={error} onReset={onReset} compact />
  )
}
