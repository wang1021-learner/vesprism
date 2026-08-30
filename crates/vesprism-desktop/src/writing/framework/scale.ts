/** 百万字怎么拆成可循环的章。字 = 汉字，不是英文 word。 */

export const NOVEL_SCALE = {
  targetChars: 1_000_000,
  chapterMin: 2000,
  chapterMax: 2500,
  chapterAim: 2200,
  volumeAim: 4,
  unitChapters: 8,
} as const

export function chapterCountFor(
  target = NOVEL_SCALE.targetChars,
  aim = NOVEL_SCALE.chapterAim,
): number {
  return Math.ceil(target / aim)
}

export function volumeChapterAim(
  target = NOVEL_SCALE.targetChars,
  volumes = NOVEL_SCALE.volumeAim,
  aim = NOVEL_SCALE.chapterAim,
): number {
  return Math.ceil(chapterCountFor(target, aim) / volumes)
}

export type ContextBudget = {
  writerEats: string
  writerNever: string
  memory: string
}

/** 写手上下文预算：百万字靠案卷循环，不靠一次塞进模型。 */
export function contextBudget(): ContextBudget {
  return {
    writerEats: '尺规切片 + 出场当前态 + 到期伏笔 + 节拍 + 上章 80 字摘要和章末钩',
    writerNever: '总纲全文、已写各章正文、未出场人物档案、未到期伏笔的回收方案',
    memory: '案卷只在入卷采纳后改。未采纳不准开下一章。',
  }
}
