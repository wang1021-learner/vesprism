/**
 * AIAcong Agent 品牌标。
 *
 * 分层 SVG，便于后期动效（每层独立 class，可用 CSS / JS 控制）：
 * - brand-logo-orbit     外环：旋转
 * - brand-logo-orbit-inner 内弧：反向旋转 / 描边动画
 * - brand-logo-core      中心菱形节点：呼吸缩放、发光
 * - brand-logo-nodes     卫星点：错峰闪烁
 * - brand-logo-beam      连接光束：透明度脉冲
 *
 * 默认静态展示。需要动效时传 `animated`（分层 class 仍保留，便于以后加）。
 */

interface BrandLogoProps {
  /** 外接正方形边长，默认 22 */
  size?: number
  /** 仅图标、无字 */
  className?: string
  /** 开启 idle 动效（默认关） */
  animated?: boolean
  title?: string
}

export function BrandLogo({
  size = 22,
  className = '',
  animated = false,
  title = 'AIAcong Agent',
}: BrandLogoProps) {
  const classes = [
    'brand-logo-mark',
    animated ? 'brand-logo--live' : 'brand-logo--static',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>

      {/* Plate: soft charcoal on white UI (not neon gradient) */}
      <rect
        className="brand-logo-plate"
        x="1"
        y="1"
        width="30"
        height="30"
        rx="9"
        fill="#1d1d1f"
      />

      {/* 外环轨道 — 后期 rotate 360 */}
      <g className="brand-logo-orbit">
        <circle
          cx="16"
          cy="16"
          r="9.2"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="1.2"
          strokeDasharray="36 22"
          strokeLinecap="round"
        />
      </g>

      {/* 内弧 — 反向旋转 / dashoffset */}
      <g className="brand-logo-orbit-inner">
        <path
          d="M16 8.2a7.8 7.8 0 1 1-6.5 3.5"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      </g>

      {/* 连接光束 — 从中心到节点，可脉冲 */}
      <g className="brand-logo-beam" opacity="0.35">
        <path d="M16 16 L22.4 10.2" stroke="#fff" strokeWidth="0.9" strokeLinecap="round" />
        <path d="M16 16 L10.8 21.6" stroke="#fff" strokeWidth="0.9" strokeLinecap="round" />
        <path d="M16 16 L22.2 20.8" stroke="#fff" strokeWidth="0.9" strokeLinecap="round" />
      </g>

      {/* 中心核心：菱形 agent 节点 — scale 呼吸 */}
      <g className="brand-logo-core">
        <path d="M16 11.2 L20.2 16 L16 20.8 L11.8 16 Z" fill="#f5f5f7" />
        <circle cx="16" cy="16" r="1.35" fill="#1d1d1f" />
      </g>

      <g className="brand-logo-nodes">
        <circle className="brand-logo-node n1" cx="22.4" cy="10.2" r="1.55" fill="#f5f5f7" />
        <circle className="brand-logo-node n2" cx="10.8" cy="21.6" r="1.35" fill="rgba(245,245,247,0.88)" />
        <circle className="brand-logo-node n3" cx="22.2" cy="20.8" r="1.2" fill="rgba(245,245,247,0.72)" />
      </g>
    </svg>
  )
}

/** 侧栏完整品牌：图标 + 字标 */
export function BrandWordmark({
  size = 22,
  animated = false,
}: {
  size?: number
  animated?: boolean
}) {
  return (
    <div className="sidebar-brand">
      <BrandLogo size={size} animated={animated} />
      <span className="brand-name">
        <span className="brand-name-primary">AIAcong</span>
        <span className="brand-name-secondary"> Agent</span>
      </span>
    </div>
  )
}
