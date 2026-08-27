/**
 * 工具 / MCP 服务器 / 斜杠命令 的中文用途标注（面板展示用）。
 * 未知条目返回 undefined（不显示标签，保留原文），不会误标。
 */

/** 常见工具名 → 中文用途 */
const TOOL_LABELS: Record<string, string> = {
  execute: '终端执行',
  run_terminal_command: '终端执行',
  read_file: '读取文件',
  write_file: '写入文件',
  search_replace: '查找替换',
  edit_file: '编辑文件',
  grep: '内容搜索',
  list_dir: '列出目录',
  web_search: '联网搜索',
  fetch: '抓取网页',
  open_page: '打开页面',
  browse: '浏览网页',
  spawn_subagent: '派生子代理',
  ask_user_question: '向用户提问',
  enter_plan_mode: '进入计划模式',
  exit_plan_mode: '退出计划模式',
  workflow: '运行工作流',
  skill: '加载技能',
  glob: '按名查找文件',
  apply_patch: '应用补丁',
  write: '写入文件',
  codegraph_explore: '代码图谱查询',
  codegraph_search: '代码符号搜索',
  codegraph_callers: '调用方查询',
  codegraph_callees: '被调用方查询',
  codegraph_impact: '影响分析',
  codegraph_node: '符号详情',
  codegraph_files: '文件索引',
  codegraph_status: '索引状态',
  git_status: 'Git 状态',
  git_diff: 'Git 差异',
  git_log: '提交历史',
  git_commit: '提交代码',
  git_push: '推送代码',
  git_pull: '拉取代码',
  get_session_messages: '会话消息查询',
  todo_write: '任务清单',
  todo_read: '查看任务清单',
  session_snapshot: '会话快照',
  mcp_apply: 'MCP 变更应用',
  memory_store: '写入记忆',
  memory_recall: '检索记忆',
  screenshot: '屏幕截图',
  computer: '电脑操作',
  computer_screenshot: '屏幕截图',
  computer_click: '鼠标点击',
  computer_type: '键盘输入',
  computer_key: '发送按键',
  computer_screen_size: '屏幕尺寸',
  paste: '粘贴内容',
}

/** 常见 MCP 服务器名 → 中文用途 */
const SERVER_LABELS: Record<string, string> = {
  filesystem: '文件系统',
  memory: '记忆',
  github: 'GitHub',
  git: 'Git 仓库',
  context7: '上下文检索',
  'sequential-thinking': '分步思考',
  puppeteer: '浏览器自动化',
  playwright: '浏览器自动化',
  sqlite: 'SQLite 数据库',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  mongo: 'MongoDB',
  mongodb: 'MongoDB',
  redis: 'Redis',
  docker: 'Docker',
  'brave-search': '网络搜索',
  exa: '网络搜索',
  serper: '网络搜索',
  tavily: '网络搜索',
  fetch: '网络抓取',
  http: 'HTTP 请求',
  slack: 'Slack 消息',
  notion: 'Notion 笔记',
  linear: 'Linear 任务',
  jira: 'JIRA 任务',
  calendar: '日历',
  email: '邮件',
  time: '时间/时区',
  'web-scraper': '网页抓取',
  markdownify: '网页转文本',
  linkedin: 'LinkedIn',
  twitter: 'Twitter/X',
  discord: 'Discord',
  telegram: 'Telegram',
  'youtube-transcript': '视频字幕',
  arxiv: '论文检索',
  pubmed: '医学文献',
  weather: '天气',
}

/** 常见斜杠命令 → 中文用途 */
const COMMAND_LABELS: Record<string, string> = {
  review: '代码审查',
  commit: '提交代码',
  plan: '制定计划',
  goal: '长程规划',
  sandbox: '工作区副本',
  ask: '问答模式',
  'view-plan': '查看计划稿',
  'show-plan': '查看计划稿',
  'plan-view': '查看计划稿',
  todo: '任务清单',
  help: '帮助',
  compact: '压缩上下文',
  context: '上下文拆分',
  usage: '本会话用量',
  'session-info': '会话详情',
  memory: '记忆',
  flush: '写入记忆',
  dream: '整理记忆',
  plugins: '插件',
  marketplace: '插件',
  loop: '定时任务',
  recap: '回顾',
  summarize: '回顾',
  find: '在对话里找',
  clear: '清空会话',
  status: '会话状态',
  workflows: '自动化任务',
  'flow-canvas': '流程画布',
  'flow-run': '试跑详情',
  agents: 'Agent 编制',
  new: '新建会话',
  model: '切换模型',
  skills: '技能列表',
  tools: '工具列表',
  mcp: 'MCP 管理',
  rewind: '回滚会话',
  'always-approve': '本会话不再问审批',
  yolo: '本会话不再问审批',
  'hooks-trust': '信任本仓库 Hooks',
  'hooks-untrust': '取消 Hooks 信任',
  'hooks-list': '列出已加载 Hooks',
  'hooks-add': '添加 Hook',
  'hooks-remove': '移除 Hook',
  'reload-plugins': '重载插件',
  feedback: '发送反馈',
  'deep-research': '深度研究',
  resume: '恢复会话',
  reset: '重置会话',
  export: '导出',
  translate: '翻译',
  rewrite: '改写',
  explain: '解释代码',
  fix: '修复问题',
  test: '编写测试',
  debug: '调试',
  refactor: '重构',
}

/** 已知命令的中文用途（优先于英文 description 展示；未知命令回退原文） */
const COMMAND_PURPOSES: Record<string, string> = {
  review: '审查本次工作区改动，输出问题与改进建议',
  commit: '为当前改动生成提交并推送到远端',
  plan: '先制定实施计划，确认后再动手',
  goal: '长程规划：先拆目标再执行',
  sandbox: '本会话把文件改动写到 git 副本目录（不是进程沙箱）',
  ask: '只问不改文件',
  'view-plan': '打开最近一份计划稿预览',
  'show-plan': '打开最近一份计划稿预览',
  'plan-view': '打开最近一份计划稿预览',
  todo: '列出/更新任务清单，跟踪进度',
  help: '列出可用斜杠命令与用法',
  compact: '压缩对话历史，腾出上下文窗口；可附带要保留的重点',
  context: '打开上下文与用量：压缩、拆分、本会话费用',
  usage: '打开上下文与用量：压缩、拆分、本会话费用',
  'session-info': '打开上下文与用量：压缩、拆分、本会话费用',
  status: '打开上下文与用量：压缩、拆分、本会话费用',
  info: '打开上下文与用量：压缩、拆分、本会话费用',
  'compact-mode': '打开上下文与用量：压缩、拆分、本会话费用',
  memory: '打开记忆页，查看全局和本仓库笔记',
  flush: '立刻把当前对话写入记忆',
  dream: '把记忆日志整理成主题',
  plugins: '打开插件页，启停技能和 MCP',
  marketplace: '打开插件页，启停技能和 MCP',
  loop: '按间隔反复执行同一条指令',
  recap: '回顾这场对话进行到哪',
  summarize: '回顾这场对话进行到哪',
  find: '在当前对话里搜索',
  clear: '清空当前会话的消息记录',
  workflows: '打开自动化任务，浏览和运行工作流',
  'flow-canvas': '打开流程画布，编辑并发布可调用流程',
  'flow-run': '打开试跑详情，查看最近一次运行的全部子代理结果',
  agents: '打开 Agent 编制，管理岗位权限与人设',
  new: '新建一个会话',
  model: '切换当前会话的模型与思考强度',
  skills: '打开技能页，浏览和启停提示包',
  tools: '打开工具页，查看模型会调用的能力',
  mcp: '打开 MCP 页，管理外接服务器',
  rewind: '将会话回滚到某个历史节点',
  'always-approve': 'on=本会话工具不再弹出审批，off=恢复询问',
  yolo: 'on=本会话工具不再弹出审批，off=恢复询问',
  'hooks-trust': '允许本仓库的 Hooks 在工具前后执行',
  'hooks-untrust': '禁止本仓库 Hooks 执行',
  'hooks-list': '查看当前会话已加载的 Hooks',
  'hooks-add': '添加 Hook 文件或目录',
  'hooks-remove': '移除 Hook 文件或目录',
  'reload-plugins': '从磁盘重新加载插件',
  feedback: '把对本会话的意见发给引擎反馈通道',
  'deep-research': '多路检索并交叉核对，写出带引用的报告',
  resume: '恢复已结束/挂起的会话',
  reset: '重置当前会话（保留对话记录）',
  export: '导出当前会话或内容',
  translate: '翻译文本到目标语言',
  rewrite: '改写/润色文本',
  explain: '解释代码或概念的原理',
  fix: '诊断并修复问题',
  test: '为代码编写/运行测试',
  debug: '调试定位问题',
  refactor: '重构代码（不改变行为）',
}

/** 已知命令 → 中文用途；未知返回 undefined（保留英文 description） */
export function zhCommandPurpose(
  name: string,
): string | undefined {
  return COMMAND_PURPOSES[normalizeName(name)]
}

/** 归一化：小写 + 去 mcp__ 前缀 + 去 .exe / 路径 */
function normalizeName(name: string): string {
  let n = (name || '').trim().toLowerCase()
  if (n.startsWith('mcp__')) n = n.slice(5)
  // mcp__github__create_issue → github
  const parts = n.split('__')
  if (parts.length > 1) n = parts[0]
  n = n.replace(/\.exe$/, '').replace(/^\.\//, '')
  // 取最后一个路径段（如 tools/git_status → git_status）
  const slash = n.lastIndexOf('/')
  if (slash >= 0) n = n.slice(slash + 1)
  return n
}

export function zhToolLabel(name: string): string | undefined {
  return TOOL_LABELS[normalizeName(name)]
}

export function zhServerLabel(name: string): string | undefined {
  return SERVER_LABELS[normalizeName(name)]
}

export function zhCommandLabel(name: string): string | undefined {
  return COMMAND_LABELS[normalizeName(name)]
}
