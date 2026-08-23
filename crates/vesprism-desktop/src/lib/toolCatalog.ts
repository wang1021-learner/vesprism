/**
 * 内置工具展示元数据（名称对齐官方 grok_build toolset）。
 * 会话实际可用集合以 x.ai/commands/list 的 tools 为准。
 */

export type ToolCategory =
  | 'file'
  | 'search'
  | 'shell'
  | 'web'
  | 'agent'
  | 'plan'
  | 'media'
  | 'mcp'
  | 'other'

export type ToolMeta = {
  name: string
  label: string
  category: ToolCategory
  description: string
  readOnly?: boolean
}

const META: ToolMeta[] = [
  {
    name: 'read_file',
    label: '读取文件',
    category: 'file',
    description: '读取工作区内文件内容',
    readOnly: true,
  },
  {
    name: 'search_replace',
    label: '编辑文件',
    category: 'file',
    description: '精确替换文件中的文本片段',
  },
  {
    name: 'write',
    label: '写入文件',
    category: 'file',
    description: '创建或覆写文件',
  },
  {
    name: 'list_dir',
    label: '列出目录',
    category: 'file',
    description: '浏览目录结构',
    readOnly: true,
  },
  {
    name: 'glob',
    label: '按名查找文件',
    category: 'file',
    description: '按 glob 匹配工作区文件路径',
    readOnly: true,
  },
  {
    name: 'apply_patch',
    label: '应用补丁',
    category: 'file',
    description: '把补丁应用到工作区文件',
  },
  {
    name: 'delete_file',
    label: '删除文件',
    category: 'file',
    description: '删除工作区文件',
  },
  {
    name: 'grep',
    label: '内容搜索',
    category: 'search',
    description: '在代码库中按正则搜索',
    readOnly: true,
  },
  {
    name: 'codegraph_explore',
    label: '代码图探索',
    category: 'search',
    description: '基于知识图谱查找符号与调用关系',
    readOnly: true,
  },
  {
    name: 'run_terminal_command',
    label: '运行终端',
    category: 'shell',
    description: '执行 shell / 终端命令',
  },
  {
    name: 'run_terminal_cmd',
    label: '运行终端',
    category: 'shell',
    description: '执行 shell / 终端命令',
  },
  {
    name: 'web_search',
    label: '网页搜索',
    category: 'web',
    description: '搜索互联网公开信息',
    readOnly: true,
  },
  {
    name: 'web_fetch',
    label: '抓取网页',
    category: 'web',
    description: '抓取 URL 正文',
    readOnly: true,
  },
  {
    name: 'open_page',
    label: '打开页面',
    category: 'web',
    description: '读取网页内容',
    readOnly: true,
  },
  {
    name: 'skill',
    label: '加载技能',
    category: 'plan',
    description: '按名称读取 SKILL.md 全文，注入本轮指令',
  },
  {
    name: 'spawn_subagent',
    label: '启动子代理',
    category: 'agent',
    description: '并行派生子 agent 完成子任务',
  },
  {
    name: 'ask_user_question',
    label: '向用户提问',
    category: 'agent',
    description: '结构化问卷，等待用户选择',
    readOnly: true,
  },
  {
    name: 'search_tool',
    label: '搜索工具',
    category: 'mcp',
    description: '发现可用 MCP / 远程工具',
    readOnly: true,
  },
  {
    name: 'use_tool',
    label: '调用工具',
    category: 'mcp',
    description: '调用 search_tool 找到的 MCP 工具',
  },
  {
    name: 'enter_plan_mode',
    label: '进入计划模式',
    category: 'plan',
    description: '切换为只读规划，不直接改代码',
    readOnly: true,
  },
  {
    name: 'exit_plan_mode',
    label: '退出计划模式',
    category: 'plan',
    description: '结束计划模式并继续执行',
  },
  {
    name: 'todo_write',
    label: '待办清单',
    category: 'plan',
    description: '创建与更新任务列表',
  },
  {
    name: 'update_goal',
    label: '更新目标',
    category: 'plan',
    description: '维护当前会话目标',
  },
  {
    name: 'workflow',
    label: '工作流',
    category: 'agent',
    description: '编排多阶段子 agent 工作流',
  },
  {
    name: 'monitor',
    label: '监视任务',
    category: 'agent',
    description: '后台监视长任务输出',
  },
  {
    name: 'image_gen',
    label: '生成图片',
    category: 'media',
    description: '文生图',
  },
  {
    name: 'image_edit',
    label: '编辑图片',
    category: 'media',
    description: '图生图 / 编辑',
  },
  {
    name: 'video_gen',
    label: '生成视频',
    category: 'media',
    description: '文生视频或图生视频',
  },
  {
    name: 'image_to_video',
    label: '图生视频',
    category: 'media',
    description: '把一张图做成短视频',
  },
  {
    name: 'reference_to_video',
    label: '参考生视频',
    category: 'media',
    description: '按参考图 / 音色生成视频',
  },
  {
    name: 'kill_task',
    label: '终止任务',
    category: 'shell',
    description: '终止后台任务 / 进程',
  },
  {
    name: 'task_output',
    label: '任务输出',
    category: 'shell',
    description: '读取后台任务输出',
    readOnly: true,
  },
  {
    name: 'lsp',
    label: '代码智能',
    category: 'search',
    description: '语言服务（跳转、符号等）',
    readOnly: true,
  },
]

const BY_NAME = new Map(META.map((m) => [m.name, m]))

export const CATEGORY_LABEL: Record<ToolCategory, string> = {
  file: '文件',
  search: '搜索 / 代码智能',
  shell: '终端 / 任务',
  web: '网络',
  agent: '多代理 / 编排',
  plan: '计划 / 待办',
  media: '媒体生成',
  mcp: 'MCP 调用',
  other: '其他',
}

export function enrichToolName(name: string): ToolMeta {
  const known = BY_NAME.get(name)
  if (known) return known
  // MCP 工具常见 server__tool 形态
  if (name.includes('__')) {
    const [server, ...rest] = name.split('__')
    const tool = rest.join('__') || name
    return {
      name,
      label: tool,
      category: 'mcp',
      description: `MCP 工具 · 来自 ${server}`,
    }
  }
  return {
    name,
    label: name,
    category: 'other',
    description: '当前会话可用工具',
  }
}

export function categoryOrder(): ToolCategory[] {
  return [
    'file',
    'search',
    'shell',
    'web',
    'agent',
    'plan',
    'media',
    'mcp',
    'other',
  ]
}
