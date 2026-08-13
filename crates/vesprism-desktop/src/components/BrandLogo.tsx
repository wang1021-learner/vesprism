/**
 * Vesprism 品牌标 — 墨环 + 红针（透明底；浅色主题深墨 / 深色主题浅墨）。
 */
import markOnLight from '../assets/vesprism-mark.png'
import markOnDark from '../assets/vesprism-mark-on-dark.png'

interface BrandLogoProps {
  size?: number
  className?: string
  /** 兼容旧调用 */
  animated?: boolean
  title?: string
}

/** 侧栏 / 空态用的符号图标（已去底、去字标） */
export function BrandLogo({
  size = 22,
  className = '',
  title = 'Vesprism',
}: BrandLogoProps) {
  const wrapCls = ['brand-logo-mark-wrap', className].filter(Boolean).join(' ')

  return (
    <span className={wrapCls} style={{ width: size, height: size }} role="img" aria-label={title}>
      <img
        className="brand-logo-mark brand-logo-mark--on-light"
        src={markOnLight}
        width={size}
        height={size}
        alt=""
        draggable={false}
        decoding="async"
      />
      <img
        className="brand-logo-mark brand-logo-mark--on-dark"
        src={markOnDark}
        width={size}
        height={size}
        alt=""
        draggable={false}
        decoding="async"
      />
    </span>
  )
}

/** 侧栏完整品牌：图标 + 字标 */
export function BrandWordmark({
  size = 22,
  className = '',
}: {
  size?: number
  animated?: boolean
  className?: string
}) {
  return (
    <div className={['sidebar-brand', className].filter(Boolean).join(' ')}>
      <BrandLogo size={size} />
      <span className="brand-name">
        <span className="brand-name-primary">Vesprism</span>
      </span>
    </div>
  )
}
