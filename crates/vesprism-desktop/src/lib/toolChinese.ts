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
  loop: '定时任务',
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
  resume: '恢复会话',
  reset: '重置会话',
  export: '导出',
  summarize: '总结',
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
  'view-plan': '打开最近一份计划稿预览',
  'show-plan': '打开最近一份计划稿预览',
  'plan-view': '打开最近一份计划稿预览',
  todo: '列出/更新任务清单，跟踪进度',
  help: '列出可用斜杠命令与用法',
  compact: '压缩会话上下文，腾出空间继续对话',
  context: '查看系统提示、消息和空闲各占多少',
  usage: '查看本会话 token 与调用次数',
  'session-info': '查看会话 id、模型、轮次',
  memory: '浏览跨会话记忆文件',
  flush: '立刻把当前对话写入记忆',
  dream: '把记忆日志整理成主题',
  plugins: '安装和管理插件',
  loop: '按间隔反复执行同一条指令',
  clear: '清空当前会话的消息记录',
  status: '查看会话状态、正在运行的任务',
  workflows: '打开自动化任务面板，浏览/运行工作流',
  'flow-canvas': '打开流程画布，编辑并发布可调用流程',
  'flow-run': '打开试跑详情，查看最近一次运行的全部子代理结果',
  agents: '打开 Agent 编制，管理岗位权限与人设',
  new: '新建一个会话',
  model: '切换当前会话的模型与思考强度',
  skills: '查看可用技能列表',
  tools: '查看当前可用工具',
  mcp: '管理 MCP 服务器（列表/启停/增删）',
  rewind: '将会话回滚到某个历史节点',
  resume: '恢复已结束/挂起的会话',
  reset: '重置当前会话（保留对话记录）',
  export: '导出当前会话或内容',
  summarize: '总结当前会话或指定内容',
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
