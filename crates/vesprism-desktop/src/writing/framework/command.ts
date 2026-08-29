/** 命令条：斜杠点名工位，其余当这一句人话。不是聊天。 */

import { VERB_DOES } from './copy'
import { defaultVerb, type StationVerb } from './station'
import type { BookDemo, DeskNodeId } from '../model/types'

export type DeskCommand = {
  verb: StationVerb
  extra: string
  beatNo?: number
  raw: string
}

const SLASH: Record<string, string> = {
  '/补立项': 'fill-pitch',
  '/写宪法': 'write-canon',
  '/立主角卡': 'fill-lead',
  '/拆总纲': 'split-outline',
  '/拆卷纲': 'split-volume',
  '/拆单元': 'split-unit',
  '/拆章纲': 'split-chapter',
  '/拆节拍': 'split-beats',
  '/写本章': 'write-chapter',
  '/write': 'write-chapter',
  '/重写选区': 'rewrite-span',
  '/检查': 'fill-review',
  '/检查金手指': 'fill-review',
  '/回写': 'adopt-ledger',
  '/拆下一章': 'split-next',
  '/问': 'ask',
}

function verbById(verbs: StationVerb[], id: string): StationVerb | undefined {
  return verbs.find((v) => v.id === id)
}

export function parseDeskCommand(
  raw: string,
  verbs: StationVerb[],
  fallback: StationVerb,
): DeskCommand {
  const text = raw.trim()
  if (!text) return { verb: fallback, extra: '', raw }

  const rewrite = /^\/重写节拍\s*(\d+)(?:\s+(.*))?$/.exec(text)
  if (rewrite) {
    const verb = verbById(verbs, 'rewrite-span') ?? fallback
    return {
      verb,
      extra: (rewrite[2] || '').trim(),
      beatNo: Number(rewrite[1]),
      raw,
    }
  }

  const tokens = text.split(/\s+/)
  const head = tokens[0] ?? ''
  const mapped = SLASH[head]
  if (mapped) {
    const verb =
      verbById(verbs, mapped) ??
      ({
        id: mapped,
        label: head.replace(/^\//, ''),
        slash: head,
        kind: mapped === 'ask' ? 'read' : 'write',
        cluster: mapped === 'ask' ? 'ask' : mapped === 'fill-review' || mapped === 'adopt-ledger' ? 'check' : 'write',
        ok: false,
        hint: '当前这一步没有这个动作。',
        does: VERB_DOES[mapped] ?? '当前这一步没有这个动作。',
      } satisfies StationVerb)
    const extra = tokens.slice(1).join(' ').trim()
    return { verb, extra, raw }
  }

  const byLabel = verbs.find((v) => text.startsWith(v.label))
  if (byLabel) {
    return { verb: byLabel, extra: text.slice(byLabel.label.length).trim(), raw }
  }

  return { verb: fallback, extra: text, raw }
}

export function commandHint(verb: StationVerb): string {
  if (verb.id === 'ask') return '顾晚宁现在能知道什么（只读，不改设定）'
  if (verb.id === 'write-chapter') return '再冷一点，对白只留那一句，不许解释瞳术'
  if (verb.id === 'rewrite-span') return '可写 /重写节拍2，或先在稿纸上点一块'
  if (verb.id === 'fill-pitch') return '补代价、金手指、不能写成的书'
  return '这一次只要 AI 记住的一句，可空'
}

export function parseAtNode(raw: string, book: BookDemo, nodeId: DeskNodeId): DeskCommand {
  const fallback = defaultVerb(book, nodeId)
  return parseDeskCommand(raw, [fallback], fallback)
}
