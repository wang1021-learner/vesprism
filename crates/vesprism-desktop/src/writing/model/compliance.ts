/**
 * 平台审核红线：作者自填词表（分号分隔）。写手提示词与入卷门禁共用。
 * 不内置敏感词——红线因平台/题材而异，交给作者按番茄/起点审核规则粘贴。
 * 起点可单独配 complianceBanQidian，空则回落到 complianceBan。
 */
import type { PlatformId } from './types'

export function complianceTokens(raw: string | undefined): string[] {
  return (raw || '')
    .split(/[；;。\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

export function effectiveComplianceBanFor(
  book: { canon: { complianceBan?: string; complianceBanQidian?: string } },
  platform?: PlatformId,
): string[] {
  const base = complianceTokens(book.canon.complianceBan)
  if (platform === 'qidian') {
    const q = complianceTokens(book.canon.complianceBanQidian)
    return q.length > 0 ? q : base
  }
  return base
}

export function effectiveComplianceBan(book: {
  canon: { complianceBan?: string; complianceBanQidian?: string }
}): string[] {
  return effectiveComplianceBanFor(book)
}

/** 命中红线的项（正文包含该词）。空列表 = 通过（或没配词表）。 */
export function complianceHits(
  book: { canon: { complianceBan?: string; complianceBanQidian?: string } },
  text: string,
  platform?: PlatformId,
): string[] {
  const tokens = effectiveComplianceBanFor(book, platform)
  if (tokens.length === 0) return []
  const body = text || ''
  return [...new Set(tokens.filter((tok) => body.includes(tok)))]
}
