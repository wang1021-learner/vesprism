const iconProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
}

export function BoltIcon() {
  return (
    <svg {...iconProps}>
      <path d="M13 3 6 13h5l-1 8 8-11h-5l0-7Z" />
    </svg>
  )
}

export function BookIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5Z" />
      <path d="M5 5.5h3A2.5 2.5 0 0 1 10.5 8v13" />
    </svg>
  )
}

export function PlugIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 7V3M15 7V3" />
      <path d="M8 7h8v4.5a4 4 0 0 1-8 0Z" />
      <path d="M12 16v4" />
    </svg>
  )
}

export function ArchiveIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3.5" y="4" width="17" height="4" rx="1" />
      <path d="M5.5 8v10.5h13V8M9.5 12h5" />
    </svg>
  )
}
