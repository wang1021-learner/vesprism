import { openChatTab } from '../lib/openChatTab'

const CARDS: { kind: 'flow-canvas' | 'agents' | 'workflows'; title: string; hint: string }[] = [
  { kind: 'flow-canvas', title: '流程画布', hint: '编排节点、发布可调用流程' },
  { kind: 'agents', title: 'Agent 编制', hint: '岗位、权限与人设' },
  { kind: 'workflows', title: '自动化任务', hint: '已发布流程与定时任务脚本' },
]

/** 工作台还没打开画布/编制 Tab 时的入口页。 */
export function WorkbenchHome() {
  return (
    <div className="workbench-home" role="main" aria-label="工作台">
      <div className="workbench-home-inner">
        <p className="workbench-home-kicker">工作台</p>
        <h1 className="workbench-home-title">画布、编制、自动化任务</h1>
        <p className="workbench-home-lead">编码对话还在另一边。这里只放流程和岗位。</p>
        <div className="workbench-home-cards">
          {CARDS.map((c) => (
            <button
              key={c.kind}
              type="button"
              className="workbench-home-card"
              onClick={() => void openChatTab({ title: c.title, utilityKind: c.kind })}
            >
              <span className="workbench-home-card-title">{c.title}</span>
              <span className="workbench-home-card-hint">{c.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
