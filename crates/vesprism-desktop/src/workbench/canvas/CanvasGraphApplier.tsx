/**
 * 认图 / 落图单独挂订阅，避免 $messages 流式更新拖垮整棵 React Flow。
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { useStore } from '@nanostores/react'
import { $generating, $messages } from '../../store'
import { sendSessionPrompt } from '../../lib/sendSessionPrompt'
import { generateId } from '../../lib/generateId'
import {
  consumeCanvasGraph,
  expectCanvasGraph,
  isCanvasHeal,
  markCanvasHeal,
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

  useEffect(() => {
    const targets = pickCanvasApplyTargets(messages, generating)
    for (const { index, promptId: pid } of targets) {
      const m = messages[index]
      if (!m?.text) continue
      const action = decideCanvasApply(m.text, generating)
      if (action === 'wait') continue
      consumeCanvasGraph(pid)
      if (action === 'drop') continue
      const parsed = parseCanvasModelOutput(m.text)
      const healed = isCanvasHeal(pid)
      const noteOk = (kind: 'graph' | 'patch') => {
        setAiError('')
        pushToast(
          healed ? '已自动修正拓扑' : kind === 'patch' ? '已按补丁更新画布' : '已更新画布拓扑',
          'success',
        )
      }
      const healOrToast = (err: string) => {
        if (healed) {
          setAiError(err)
          pushToast(err, 'error')
          return
        }
        const hid = generateId('p_')
        markCanvasHeal(hid)
        expectCanvasGraph(hid)
        void sendSessionPrompt({
          hidden: true,
          promptId: hid,
          wireText: buildHealPrompt(err),
        }).then((sent) => {
          if (sent) return
          consumeCanvasGraph(hid)
          setAiError(err)
          pushToast(err, 'error')
        })
      }
      if (parsed.ok && parsed.kind === 'graph') {
        applyDraft(
          draftFromGraph(parsed.graph, {
            id: draft.id,
            name: draft.name,
            description: draft.description,
            version: draft.version,
          }),
          true,
        )
        noteOk('graph')
        continue
      }
      if (parsed.ok && parsed.kind === 'patch') {
        const next = applyFlowPatch(draft, parsed.patch)
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
  }, [messages, generating, applyDraft, flashDiff, draft, setAiError])

  return null
}
