import { describe, expect, it } from 'vitest'
import { computeDropdownPlacement } from './useDropdownPlacement'

describe('computeDropdownPlacement', () => {
  it('defaults to top placement when ample space exists above', () => {
    // Normal chat at bottom of 800px viewport: trigger at Y: 700 to 730
    const result = computeDropdownPlacement({ top: 700, bottom: 730 }, 800, {
      gap: 10,
      viewportMargin: 16,
      maxHeightCap: 480,
    })

    expect(result.placement).toBe('top')
    // spaceAbove = 700 - 10 - 16 = 674 >= 480
    expect(result.maxHeight).toBe(480)
    expect(result.style.bottom).toBe('calc(100% + 10px)')
    expect(result.style.top).toBe('auto')
    expect(result.style.maxHeight).toBe('480px')
  })

  it('caps maxHeight so top of menu does not overflow viewport in empty session', () => {
    // Empty session: composer is centered around Y: 350 to 380 in 800px window
    const result = computeDropdownPlacement({ top: 350, bottom: 380 }, 800, {
      gap: 10,
      viewportMargin: 16,
      maxHeightCap: 480,
      flipThreshold: 260,
    })

    expect(result.placement).toBe('top')
    // spaceAbove = 350 - 10 - 16 = 324px (< 480px cap)
    // Top of menu will be at 350 - 10 - 324 = 16px (safely within viewport!)
    expect(result.maxHeight).toBe(324)
    expect(result.style.maxHeight).toBe('324px')
    expect(result.style.bottom).toBe('calc(100% + 10px)')
  })

  it('flips to bottom when space above is too cramped and space below is larger', () => {
    // Composer near top of screen: trigger at Y: 180 to 210 in 800px window
    const result = computeDropdownPlacement({ top: 180, bottom: 210 }, 800, {
      gap: 10,
      viewportMargin: 16,
      flipThreshold: 260,
    })

    expect(result.placement).toBe('bottom')
    // spaceBelow = 800 - 210 - 10 - 16 = 564px -> capped at 480px
    expect(result.maxHeight).toBe(480)
    expect(result.style.top).toBe('calc(100% + 10px)')
    expect(result.style.bottom).toBe('auto')
  })

  it('respects direction override when explicitly requested', () => {
    const forcedTop = computeDropdownPlacement({ top: 180, bottom: 210 }, 800, {
      direction: 'top',
    })
    expect(forcedTop.placement).toBe('top')

    const forcedBottom = computeDropdownPlacement({ top: 700, bottom: 730 }, 800, {
      direction: 'bottom',
    })
    expect(forcedBottom.placement).toBe('bottom')
  })
})
