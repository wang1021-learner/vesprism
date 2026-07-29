interface ToolOutputViewProps {
  text: string
  title?: string
  kind?: string
}

export function ToolOutputView({ text, title, kind }: ToolOutputViewProps) {
  return (
    <div className="side-panel-tool-output">
      {(title || kind) && (
        <div className="side-panel-subhead">
          {kind && <span className="side-panel-kind-tag">{kind}</span>}
          {title && <span className="side-panel-subhead-title">{title}</span>}
        </div>
      )}
      <pre className="side-panel-output-body">{text || '（无输出）'}</pre>
    </div>
  )
}
