/**
 * Vesprism 品牌标 — 官方暖色飞溅 / 鸟形 mark + 字标。
 */
import markSrc from '../assets/vesprism-mark.png'

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
  const cls = ['brand-logo-mark', className].filter(Boolean).join(' ')

  return (
    <img
      className={cls}
      src={markSrc}
      width={size}
      height={size}
      alt={title}
      draggable={false}
      decoding="async"
    />
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
