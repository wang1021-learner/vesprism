/** 百万字三岗。不另起运行时：将来走写台会话，不走流程画布。 */

export type WriterRoleId = 'splitter' | 'writer' | 'reviewer'

export type WriterRole = {
  id: WriterRoleId
  name: string
  job: string
  eats: string
  never: string
}

export const WRITER_ROLES: readonly WriterRole[] = [
  {
    id: 'splitter',
    name: '拆卡',
    job: '把上一层填空卡拆成下一层填空卡。不写场面，不发明规则。',
    eats: '上一层已填字段 + 门禁缺口',
    never: '正文、对白、新金手指',
  },
  {
    id: 'writer',
    name: '写手',
    job: '按切块写这一章。一块只干一件事。',
    eats: '写这一章的切片',
    never: '长线全文、未出场档案、解释自己的写法',
  },
  {
    id: 'reviewer',
    name: '检查',
    job: '对照章纲和设定填检查单。未写入账本不准改当前态。',
    eats: '正文 + 章纲 + 出场当前态 + 到期伏笔',
    never: '文笔评价、改设定、开下一章',
  },
]
