/** 写台给人看的话：这一步干什么、点下去会发生什么。 */

import type { ParsedNode, WorkMode } from '../model/nodes'

export const WORK_MODES: readonly {
  id: WorkMode
  label: string
  does: string
}[] = [
  { id: 'set', label: '设定', does: '卖点、规矩、人物、地点、规则' },
  { id: 'plan', label: '结构', does: '长线、卷、单元、章纲、切块' },
  { id: 'draft', label: '正文', does: '按切块写字，先试笔' },
  { id: 'check', label: '检查', does: '对照章纲，到期伏笔，入卷' },
]

export type StepJob = {
  title: string
  does: string
  you: string
}

export function stepJob(kind: ParsedNode['kind']): StepJob {
  switch (kind) {
    case 'engine':
      return {
        title: '百万字怎么拆',
        does: '100 万汉字靠章循环，不靠一次生成全书。写手每次只吃一章的切片。',
        you: '看契约。真写字去「正文」。',
      }
    case 'pitch':
      return {
        title: '开卷：这本书凭什么被点开',
        does: '先写卖点，再写正文。书名、平台、一句话是硬门槛，缺一项就不能写本章。',
        you: '自己填格子，或点右侧「补全开卷」让 AI 按格子补。',
      }
    case 'canon':
      return {
        title: '规矩：全书不能破的门',
        does: '视角、章字数、力量上限、禁区。写手每次只吃这里的切片，不吃总纲全文。',
        you: '填硬门槛。力量上限和叙事禁空着，后面的人设站不住。',
      }
    case 'bible':
      return {
        title: '设定集：人、规则、地点',
        does: '章纲只吃编号和当前态。这里不写场面。',
        you: '点一张卡进去填，或新建一张空卡。',
      }
    case 'person':
      return {
        title: '人物卡',
        does: '当前态给写手吃。秘密可以给读者，不能给场上人的，写在「不能知道」。',
        you: '先填当前态和不能知道的。主角这两栏空着，不准拆长线。',
      }
    case 'rule':
      return {
        title: '规则卡',
        does: '触发、次数、反噬、明确不能做什么。金手指没有代价，书会塌。',
        you: '把配额写成读者看得见的代价。',
      }
    case 'place':
      return {
        title: '地点卡',
        does: '这一章用它干什么、谁能进、藏着什么。不是旅游说明书。',
        you: '填这一场的用法。',
      }
    case 'outline':
      return {
        title: '长线：怎么升级，不写细场面',
        does: '三幕、因果、伏线。正文不吃这张卡的全文。',
        you: '先写一句话因果。伏线用下面的表记下。',
      }
    case 'volume':
      return {
        title: '这一卷要赢什么',
        does: '本卷问题、对手、必须兑现和禁止兑现。',
        you: '勾清本卷要给读者的爽，和故意不给的。',
      }
    case 'unit':
      return {
        title: '接下来几章打什么仗',
        does: '单元是战役，不是目录。胜负条件和单元末钩是硬门槛。',
        you: '写清胜负。没有胜负条件，不准拆章纲。',
      }
    case 'chapter':
      return {
        title: '这一章干什么',
        does: '开场钩、目标、阻力、章末钩。番茄开场必须是物理事件。',
        you: '章末钩类型空着，不准拆切块，更不准写正文。',
      }
    case 'beats':
      return {
        title: '把这一章切成可写的块',
        does: '一块只干一件事，大约 800 到 1200 字。写正文时模型只吃这些块。',
        you: '至少三块才能写本章。没有块就点「把这章切开」或自己加一块。',
      }
    case 'draft':
      return {
        title: '正文：先试笔，点进正史才作数',
        does: '按切块写。未采纳不进正史，也不入案卷。',
        you: '可直接改稿纸。要 AI 写，点「写这一章」。重写或洗套话，先点一块再点芯片。',
      }
    case 'review':
      return {
        title: '检查：对照章纲和设定，再入卷',
        does: '不是看写得美不美。未入卷，不准开下一章。',
        you: '先「检查这一章」，确认后点「入卷」。查设定用「查设定」，它只读。',
      }
  }
}

export const VERB_DOES: Record<string, string> = {
  'fill-pitch': '按你填的三问，补金手指、代价和不能写成的书。产出落开卷卡。',
  'write-canon': '起草全书不能破的规矩。写手之后只吃切片。',
  'fill-lead': '写一张有当前态和不能知道的主角卡。',
  'split-outline': '按设定拆长线、三幕和伏线。',
  'split-volume': '按长线拆这一卷要赢什么、兑现什么。',
  'split-unit': '把这一卷切成几场战役。',
  'split-chapter': '按单元写出这一章的钩子和目标。',
  'split-beats': '把章纲切成至少三块可写的场面。',
  'write-chapter': '按切块写这一章。先试笔，不进正史。',
  'rewrite-span': '只重写你点中的那一块，其余不动。',
  'wash-span': '只改这一块的套话。情节、对白要点、落点不动。',
  'fill-review': '对照章纲和设定检查这一章。先出检查单。',
  'adopt-ledger': '把检查结果写入人物当前态和伏线。入卷后不可撤销（演示标记）。',
  'split-next': '上一章已入卷，拆下一章纲。',
  'export-chapter': '把这一章正文存成 txt。',
  'export-book': '把已有正文按章拼成一份 txt。',
  ask: '只问设定和案卷。不写回人物卡，不改伏线。',
}
