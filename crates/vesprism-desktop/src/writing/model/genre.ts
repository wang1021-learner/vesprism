/**
 * 类型套路契约 + 平台冷启动节奏。
 * 每个类型有读者高度固化的套路契约；前 30 章是算法冷启动期，钩子要更激进。
 */
import type { BookDemo } from './types'

export const COLD_START_CHAPTERS = 30

export type GenreContract = { label: string; rules: string[] }

export const GENRE_CONTRACTS: Record<string, GenreContract> = {
  都市爽文: {
    label: '都市爽文',
    rules: [
      '前 5 章必须完成一次「被看低→当众反打」，让主角先立威。',
      '金手指的代价与限制要在第 1 章就落地，不能只爽不痛。',
      '配角要有脸谱化爽点（捧哏 / 被打脸者），给读者情绪出口。',
    ],
  },
  玄幻修真: {
    label: '玄幻修真',
    rules: [
      '前 5 章必须确立资质/气运/根骨，给升级一个自洽的起点。',
      '境界体系要可循环：每一级有瓶颈与突破条件，供百万字重复使用。',
      '第一次越级战斗要在前 10 章出现，但必须付出代价。',
    ],
  },
  末世: {
    label: '末世',
    rules: [
      '前 3 章交代末世降临或觉醒时机，不能拖。',
      '生存压力（物资/丧尸/人性）要成为贯穿主线，而非背景板。',
      '异能/系统觉醒必须在合理节点，不能凭空给。',
    ],
  },
  系统文: {
    label: '系统文',
    rules: [
      '第 1 章必须交代系统面板规则（任务/奖励/惩罚）。',
      '系统奖励要有上限与代价，防止金手指无限膨胀。',
      '系统不能替主角解决所有冲突，否则矛盾塌掉。',
    ],
  },
  穿书文: {
    label: '穿书文',
    rules: [
      '前 3 章交代原书剧情与原主身份，给「改命」一个锚点。',
      '穿越者必须带「先知」信息差，且要持续变现。',
      '原书反派/剧情惯性要成为阻力，不能一路顺。',
    ],
  },
}

export function genreContractOf(genre: string | undefined): GenreContract | null {
  const g = (genre || '').trim()
  if (!g) return null
  const g2 = g.slice(0, 2)
  for (const key of Object.keys(GENRE_CONTRACTS)) {
    const k2 = key.slice(0, 2)
    if (g.includes(key) || key.includes(g) || g2 === k2) return GENRE_CONTRACTS[key]
  }
  return null
}

/** 类型套路契约行（无类型则空）。 */
export function genreContractLines(book: BookDemo): string[] {
  const c = genreContractOf(book.pitch.genre)
  if (!c) return []
  return [`类型契约（${c.label}）：`, ...c.rules.map((r) => `· ${r}`)]
}

/** 冷启动期（前 N 章）节奏提示：钩子更激进、更新更稳。 */
export function coldStartLine(chapterNo: number): string | null {
  if (chapterNo <= 0 || chapterNo > COLD_START_CHAPTERS) return null
  return `冷启动期（前 ${COLD_START_CHAPTERS} 章）：本章结尾必须留能勾读者点下一章的钩子，节奏比中段更快。`
}
