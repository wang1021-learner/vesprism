/**
 * 认图 / 落图单独挂订阅，避免 $messages 流式更新拖垮整棵 React Flow。
 *
 * 死循环防护（2026-08 修复）：
 * - 依赖解耦：draft 用 draftRef 读最新值，不进 useEffect 依赖数组。
 *   否则 applyDraft 更新父组件 draft → props.draft 引用变 → effect 重跑 →
 *   （生成中 pid 不消费）又 applyDraft → 无限循环触发 React "Maximum update depth exceeded"。
 * - 幂等指纹：appliedRef 记录每个 pid 已落图的「解析结果指纹」（graph/patch 序列化）。
 *   流式中同一 pid 的 m.text 会持续追加（全文一直变），按全文比较会重复落图；
 *   按解析结果指纹比较，同一内容只落图一次。
 */
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { useStore } from '@nanostores/react'
import { $activeTabId, $generating, $messages } from '../../store'
import { sendSessionPrompt } from '../../lib/sendSessionPrompt'
import { generateId } from '../../lib/generateId'
import {
  canHeal,
  consumeCanvasGraph,
  expectCanvasGraph,
  isCanvasHeal,
  markCanvasHeal,
  spendHeal,
} from '../generateWait'
import {
  AI_GRAPH_FAIL_MESSAGE,
  applyFlowPatch,
  buildHealPrompt,
  draftFromGraph,
  looksLikeCanvasGraphJson,
  parseCanvasModelOutput,
  type FlowDraft,
} from '../flow'
import { decideCanvasApply, pickCanvasApplyTargets } from './applyCanvasOutput'
import { pushToast } from '../../store'

export function CanvasGraphApplier({
  draft,
  applyDraft,
  flashDiff,
  setAiError,
}: {
  draft: FlowDraft
  applyDraft: (next: FlowDraft, markDirty?: boolean) => void
  flashDiff: (next: Record<string, 'add' | 'update'>) => void
  setAiError: Dispatch<SetStateAction<string>>
}) {
  const messages = useStore($messages)
  const generating = useStore($generating)
  const tabId = useStore($activeTabId)

  // 最新 draft 走 ref：effect 依赖数组不含 draft，切断「applyDraft → draft 变 → effect 重跑」回路。
  const draftRef = useRef(draft)
  draftRef.current = draft
  // 已落图指纹：pid → 解析结果序列化（graph/patch）。同内容不重复 apply。
  const appliedRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const current = draftRef.current
    const targets = pickCanvasApplyTargets(messages, generating, tabId)
    for (const { index, promptId: pid } of targets) {
      const m = messages[index]
      if (!m?.text) continue
      const action = decideCanvasApply(m.text, generating)
      if (action === 'wait') continue
      // 只有在整轮流式结束（!generating）或明确丢弃时才消费 PID，避免流式早期中间 JSON 误杀后续完整图谱
      if (!generating || action === 'drop') {
        consumeCanvasGraph(pid, tabId)
      }
      if (action === 'drop') continue
      const parsed = parseCanvasModelOutput(m.text)
      // 幂等拦截：同一 pid 已落过相同解析结果 → 跳过（生成中 pid 不消费，messages 流式
      // 每帧变化都会重跑本 effect，没有指纹拦截会重复落图/重建画布）。
      if (parsed.ok) {
        const fingerprint = JSON.stringify(parsed.kind === 'graph' ? parsed.graph : parsed.patch)
        const prevFp = appliedRef.current.get(pid)
        if (prevFp === fingerprint) continue
        // 流式中先落一次，结构继续变也不反复重建；整轮结束再收最终稿。
        if (generating && prevFp) continue
        appliedRef.current.set(pid, fingerprint)
      }
      const healed = isCanvasHeal(pid, tabId)
      const noteOk = (kind: 'graph' | 'patch') => {
        setAiError('')
        if (!generating) {
          pushToast(
            healed ? '已自动修正拓扑' : kind === 'patch' ? '已按补丁更新画布' : '已更新画布拓扑',
            'success',
          )
        }
      }
      const healOrToast = (err: string) => {
        if (healed || !canHeal(tabId)) {
          setAiError(err)
          pushToast(err, 'error')
          return
        }
        spendHeal(tabId)
        const hid = generateId('p_')
        markCanvasHeal(hid, tabId)
        expectCanvasGraph(hid, tabId)
        void sendSessionPrompt({
          hidden: true,
          promptId: hid,
          wireText: buildHealPrompt(err),
        }).then((sent) => {
          if (sent) return
          consumeCanvasGraph(hid, tabId)
          setAiError(err)
          pushToast(err, 'error')
        })
      }
      if (parsed.ok && parsed.kind === 'graph') {
        applyDraft(
          draftFromGraph(
            parsed.graph,
            {
              id: current.id,
              name: current.name,
              description: current.description,
              version: current.version,
            },
            current,
          ),
          true,
        )
        noteOk('graph')
        continue
      }
      if (parsed.ok && parsed.kind === 'patch') {
        const next = applyFlowPatch(current, parsed.patch)
        if (next.ok) {
          applyDraft(next.draft, true)
          const glow: Record<string, 'add' | 'update'> = {}
          for (const n of parsed.patch.add_nodes ?? []) glow[n.id] = 'add'
          for (const n of parsed.patch.update_nodes ?? []) glow[n.id] = 'update'
          if (Object.keys(glow).length) flashDiff(glow)
          noteOk('patch')
        } else {
          healOrToast(next.error)
        }
        continue
      }
      if (looksLikeCanvasGraphJson(m.text)) {
        healOrToast(parsed.ok ? AI_GRAPH_FAIL_MESSAGE : parsed.error || AI_GRAPH_FAIL_MESSAGE)
      }
    }
  }, [messages, generating, tabId, applyDraft, flashDiff, setAiError])

  return null
}
