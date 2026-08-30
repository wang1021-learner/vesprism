import type { WriterRoleId } from './roles'

export type WriteJobId =
  | 'start-book'
  | 'split-canon'
  | 'split-bible'
  | 'split-outline'
  | 'split-volume'
  | 'split-unit'
  | 'split-chapter'
  | 'split-beats'
  | 'write-chapter'
  | 'fill-review'
  | 'adopt-ledger'

export type WriteJob = {
  id: WriteJobId
  role: WriterRoleId
  label: string
  from: string
  to: string
}

/** 一层一席。百万字是这条链转 400～500 圈，不是一次生成。 */
export const WRITE_JOBS: readonly WriteJob[] = [
  { id: 'start-book', role: 'splitter', label: '开新书', from: '空', to: '卖点' },
  { id: 'split-canon', role: 'splitter', label: '起草规矩', from: '卖点', to: '规矩' },
  { id: 'split-bible', role: 'splitter', label: '写设定集', from: '规矩', to: '设定集' },
  { id: 'split-outline', role: 'splitter', label: '拆长线', from: '设定集', to: '长线' },
  { id: 'split-volume', role: 'splitter', label: '拆这一卷', from: '长线', to: '卷' },
  { id: 'split-unit', role: 'splitter', label: '拆这几章', from: '卷', to: '战役' },
  { id: 'split-chapter', role: 'splitter', label: '写章纲', from: '战役', to: '章纲' },
  { id: 'split-beats', role: 'splitter', label: '把这章切开', from: '章纲', to: '切块' },
  { id: 'write-chapter', role: 'writer', label: '写这一章', from: '切块', to: '正文' },
  { id: 'fill-review', role: 'reviewer', label: '检查这一章', from: '正文', to: '检查' },
  { id: 'adopt-ledger', role: 'reviewer', label: '入卷', from: '检查', to: '案卷 / 下一章' },
]

export function jobByLabel(label: string): WriteJob | undefined {
  return WRITE_JOBS.find((j) => j.label === label)
}
