import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

export interface DropdownPlacementOptions {
  /** 菜单与触发元素的间距（像素，默认 10） */
  gap?: number
  /** 距离视口上下边界的安全边距（像素，默认 16） */
  viewportMargin?: number
  /** 菜单最大限制高度上限（像素，默认 480） */
  maxHeightCap?: number
  /** 上方空间小于该阈值且下方空间更大时，自动翻转为向下展开（像素，默认 260） */
  flipThreshold?: number
  /** 强制方向：'auto' 自动计算，'top' 强制向上，'bottom' 强制向下 */
  direction?: 'top' | 'bottom' | 'auto'
}

export interface DropdownPlacementResult {
  placement: 'top' | 'bottom'
  maxHeight: number
  style: CSSProperties
}

/**
 * 纯函数计算弹窗菜单的最佳方向与最大高度，确保绝不超出视口顶部或底部
 */
export function computeDropdownPlacement(
  triggerRect: { top: number; bottom: number },
  viewportHeight: number,
  options: DropdownPlacementOptions = {},
): DropdownPlacementResult {
  const {
    gap = 10,
    viewportMargin = 16,
    maxHeightCap = 480,
    flipThreshold = 260,
    direction = 'auto',
  } = options

  // 触发元素上方留白空间
  const spaceAbove = Math.max(0, triggerRect.top - gap - viewportMargin)
  // 触发元素下方留白空间
  const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - gap - viewportMargin)

  let placement: 'top' | 'bottom' = 'top'

  if (direction === 'bottom') {
    placement = 'bottom'
  } else if (direction === 'top') {
    placement = 'top'
  } else {
    // 默认向上展开；若上方过窄且下方更宽敞，则翻转向下展开
    if (spaceAbove < flipThreshold && spaceBelow > spaceAbove) {
      placement = 'bottom'
    } else {
      placement = 'top'
    }
  }

  const availableSpace = placement === 'top' ? spaceAbove : spaceBelow
  // 最大高度限制在 [140px, maxHeightCap] 之间，且不超过可用空间
  const maxHeight = Math.max(140, Math.min(maxHeightCap, Math.floor(availableSpace)))

  const style: CSSProperties =
    placement === 'bottom'
      ? {
          top: `calc(100% + ${gap}px)`,
          bottom: 'auto',
          maxHeight: `${maxHeight}px`,
        }
      : {
          bottom: `calc(100% + ${gap}px)`,
          top: 'auto',
          maxHeight: `${maxHeight}px`,
        }

  return { placement, maxHeight, style }
}

/**
 * Hook: 在菜单展开时动态测量触发元素位置，计算出安全展开方向和最大高度，
 * 避免屏幕较小或空会话输入框居中时，菜单顶部超出视口被截断的问题。
 */
export function useDropdownPlacement(
  triggerRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  options?: DropdownPlacementOptions,
): DropdownPlacementResult {
  const [placementResult, setPlacementResult] = useState<DropdownPlacementResult>(() => {
    if (typeof window !== 'undefined' && triggerRef.current) {
      return computeDropdownPlacement(
        triggerRef.current.getBoundingClientRect(),
        window.innerHeight,
        options,
      )
    }
    const defaultCap = options?.maxHeightCap ?? 480
    const defaultGap = options?.gap ?? 10
    return {
      placement: 'top',
      maxHeight: defaultCap,
      style: {
        bottom: `calc(100% + ${defaultGap}px)`,
        top: 'auto',
        maxHeight: `${defaultCap}px`,
      },
    }
  })

  useLayoutEffect(() => {
    if (!isOpen) return

    const update = () => {
      const el = triggerRef.current
      if (!el || typeof window === 'undefined') return
      const next = computeDropdownPlacement(
        el.getBoundingClientRect(),
        window.innerHeight,
        options,
      )
      setPlacementResult((prev) => {
        if (
          prev.placement === next.placement &&
          prev.maxHeight === next.maxHeight &&
          prev.style.top === next.style.top &&
          prev.style.bottom === next.style.bottom &&
          prev.style.maxHeight === next.style.maxHeight
        ) {
          return prev
        }
        return next
      })
    }

    update()

    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [
    isOpen,
    triggerRef,
    options?.gap,
    options?.viewportMargin,
    options?.maxHeightCap,
    options?.flipThreshold,
    options?.direction,
  ])

  return placementResult
}
