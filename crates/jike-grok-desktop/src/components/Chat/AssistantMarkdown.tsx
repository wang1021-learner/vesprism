import { memo, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import {
  tailBoundedRemend,
  parseMarkdownIntoBlocks,
} from '@assistant-ui/react-streamdown'
import { createMathPlugin } from '@streamdown/math'

// ── 预处理 ──

function preprocessMarkdown(text: string): string {
  let processed = text
  processed = processed.replace(/<preview>[\s\S]*?<\/preview>/g, '')
  processed = processed.replace(/\\\(((?:[^\\]|\\[^)])*?)\\\)/g, '$$$1$$')
  return processed
}

function preprocessWithTailRepair(text: string): string {
  return tailBoundedRemend(preprocessMarkdown(text))
}

// ── 懒加载插件 ──

let codePluginCache: import('@streamdown/code').CodeHighlighterPlugin | null = null
let mermaidPluginCache: import('@streamdown/mermaid').DiagramPlugin | null = null

function useCodePlugin() {
  const [plugin, setPlugin] = useState(codePluginCache)
  useEffect(() => {
    if (plugin) return
    let cancelled = false
    void import('@streamdown/code').then(({ code }) => {
      codePluginCache = code
      if (!cancelled) setPlugin(code)
    })
    return () => { cancelled = true }
  }, [plugin])
  return plugin
}

function useMermaidPlugin() {
  const [plugin, setPlugin] = useState(mermaidPluginCache)
  useEffect(() => {
    if (plugin) return
    let cancelled = false
    void import('@streamdown/mermaid').then(({ mermaid: m }) => {
      mermaidPluginCache = m
      if (!cancelled) setPlugin(m)
    })
    return () => { cancelled = true }
  }, [plugin])
  return plugin
}

// ── GFM Alert 解析 ──

type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution'

const ALERT_META: Record<AlertType, { label: string; icon: string }> = {
  note: { label: 'Note', icon: 'ℹ' },
  tip: { label: 'Tip', icon: '💡' },
  important: { label: 'Important', icon: '❗' },
  warning: { label: 'Warning', icon: '⚠' },
  caution: { label: 'Caution', icon: '🔥' },
}

function extractTextContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractTextContent).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractTextContent((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

/** 从 blockquote children 首段检测 GFM alert 标记 */
function detectAlert(children: ReactNode): { type: AlertType; body: ReactNode } | null {
  const text = extractTextContent(children).trimStart()
  const m = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i)
  if (!m) return null
  const type = m[1].toLowerCase() as AlertType

  // 去掉首段中的 [!TYPE] 标记
  if (Array.isArray(children) && children.length > 0) {
    const first = children[0] as { props?: { children?: ReactNode } } | string
    if (typeof first === 'object' && first.props?.children) {
      const inner = first.props.children
      if (typeof inner === 'string') {
        const stripped = inner.replace(/^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '')
        const newFirst = { ...first, props: { ...first.props, children: stripped || undefined } }
        return { type, body: [newFirst, ...children.slice(1)] }
      }
    }
  }
  return { type, body: children }
}

// ── 组件 ──

interface Props { text: string }

export const AssistantMarkdown = memo(function AssistantMarkdown({ text }: Props) {
  const code = useCodePlugin()
  const mermaid = useMermaidPlugin()

  const plugins = useMemo(() => {
    const p: Record<string, unknown> = {
      math: createMathPlugin({ singleDollarTextMath: true }),
    }
    if (code) p.code = code
    if (mermaid) p.mermaid = mermaid
    return p
  }, [code, mermaid])

  const components = useMemo(() => ({
    // ── 标题层级 ──
    h1: ({ className, ...props }: ComponentProps<'h1'>) => (
      <h1 className={`md-h1${className ? ` ${className}` : ''}`} {...props} />
    ),
    h2: ({ className, ...props }: ComponentProps<'h2'>) => (
      <h2 className={`md-h2${className ? ` ${className}` : ''}`} {...props} />
    ),
    h3: ({ className, ...props }: ComponentProps<'h3'>) => (
      <h3 className={`md-h3${className ? ` ${className}` : ''}`} {...props} />
    ),
    h4: ({ className, ...props }: ComponentProps<'h4'>) => (
      <h4 className={`md-h4${className ? ` ${className}` : ''}`} {...props} />
    ),

    // ── 表格：可横向滚动包裹 ──
    table: ({ children, ...props }: ComponentProps<'table'>) => (
      <div className="md-table-wrapper">
        <table className="md-table" {...props}>{children}</table>
      </div>
    ),

    // ── 引用 / GFM Alert ──
    blockquote: ({ children, className, ...props }: ComponentProps<'blockquote'>) => {
      const alert = detectAlert(children)
      if (alert) {
        const meta = ALERT_META[alert.type]
        return (
          <div className={`md-alert md-alert-${alert.type}`} {...props as Record<string, unknown>}>
            <p className="md-alert-title">
              <span className="md-alert-icon">{meta.icon}</span>
              {meta.label}
            </p>
            {alert.body}
          </div>
        )
      }
      return (
        <blockquote className={`md-blockquote${className ? ` ${className}` : ''}`} {...props}>
          {children}
        </blockquote>
      )
    },

    // ── 链接 ──
    a: ({ href, children, ...props }: ComponentProps<'a'>) => {
      const isExternal = href && /^https?:\/\//i.test(href)
      return (
        <a
          className="md-link"
          href={href}
          {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          {...props}
        >
          {children}
        </a>
      )
    },

    // ── 图片 ──
    img: ({ alt, ...props }: ComponentProps<'img'>) => (
      <img className="md-image" alt={alt || 'image'} loading="lazy" {...props} />
    ),

    // ── 分隔线 ──
    hr: (_props: ComponentProps<'hr'>) => <hr className="md-hr" />,

    // ── 列表 ──
    ul: ({ className, ...props }: ComponentProps<'ul'>) => (
      <ul className={`md-ul${className ? ` ${className}` : ''}`} {...props} />
    ),
    ol: ({ className, ...props }: ComponentProps<'ol'>) => (
      <ol className={`md-ol${className ? ` ${className}` : ''}`} {...props} />
    ),
    li: ({ className, ...props }: ComponentProps<'li'>) => (
      <li className={`md-li${className ? ` ${className}` : ''}`} {...props} />
    ),
  }), [])

  const processedText = useMemo(() => preprocessWithTailRepair(text), [text])

  if (!text) return null

  return (
    <Streamdown
      parseIncompleteMarkdown={false}
      parseMarkdownIntoBlocksFn={parseMarkdownIntoBlocks}
      plugins={plugins}
      components={components}
      /* 不显示行号；关闭下载，仅保留复制（样式见 markdown.css） */
      lineNumbers={false}
      controls={{
        code: { copy: true, download: false },
        table: { copy: false, download: false, fullscreen: false },
        mermaid: { copy: false, download: false, fullscreen: false, panZoom: false },
      }}
    >
      {processedText}
    </Streamdown>
  )
})
