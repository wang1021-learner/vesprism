/**
 * 每章引擎调用预算：写/重写/洗/检查按章计数，超限停手，
 * 防止「多候选 + 多轮质检 + 自愈循环」把 token 烧穿。
 * fill-card（拆卡补卡）不按章计数，因为它不是写正文的高频循环。
 */
import type { BookDemo } from './types'

export const WRITE_BUDGET = { perChapterCalls: 6 } as const

export function chapterSpend(
  book: { chapterSpend?: Record<string, number> },
  chapterId: string,
): number {
  return book.chapterSpend?.[chapterId] ?? 0
}

export function canSpendTask(
  book: { chapterSpend?: Record<string, number> },
  chapterId: string | undefined,
  kind: string,
): boolean {
  if (!chapterId || kind === 'fill-card') return true
  return chapterSpend(book, chapterId) < WRITE_BUDGET.perChapterCalls
}

export function budgetLeft(
  book: { chapterSpend?: Record<string, number> },
  chapterId: string,
): number {
  return Math.max(0, WRITE_BUDGET.perChapterCalls - chapterSpend(book, chapterId))
}

export function recordSpend(book: BookDemo, chapterId: string): BookDemo {
  const cur = book.chapterSpend?.[chapterId] ?? 0
  return {
    ...book,
    chapterSpend: { ...book.chapterSpend, [chapterId]: cur + 1 },
  }
}
