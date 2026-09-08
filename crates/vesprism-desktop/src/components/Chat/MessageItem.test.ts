import { describe, expect, it } from 'vitest'
import { toolIconKind, toolHeadline } from './MessageItem'
import type { ToolCallData } from '../../types'

function makeTool(partial: Partial<ToolCallData>): ToolCallData {
  return {
    toolCallId: 'call_1',
    kind: 'other',
    status: 'completed',
    title: 'tool',
    detail: '',
    preview: '',
    ...partial,
  }
}

describe('toolIconKind', () => {
  it('正确识别思考类型', () => {
    expect(toolIconKind(makeTool({ kind: 'think' }))).toBe('thought')
    expect(toolIconKind(makeTool({ kind: 'thought' }))).toBe('thought')
    expect(toolIconKind(makeTool({ kind: 'THINK' }))).toBe('thought')
  })

  it('正确识别子任务类型', () => {
    expect(toolIconKind(makeTool({ kind: 'subagent' }))).toBe('agent')
  })

  it('正确识别用户问询类型', () => {
    expect(toolIconKind(makeTool({ kind: 'ask_user' }))).toBe('ask')
  })

  it('正确识别计划稿与任务清单类型', () => {
    expect(toolIconKind(makeTool({ kind: 'plan_mode' }))).toBe('plan')
    expect(toolIconKind(makeTool({ kind: 'plan' }))).toBe('plan')
    expect(toolIconKind(makeTool({ title: 'todo_write' }))).toBe('plan')
    expect(toolIconKind(makeTool({ title: 'todowrite' }))).toBe('plan')
    expect(
      toolIconKind(
        makeTool({
          todo: { summary: 'Plan', todos: [{ content: 't1', status: 'completed' }] },
        }),
      ),
    ).toBe('plan')
    expect(toolIconKind(makeTool({ title: 'enter_plan_mode' }))).toBe('plan')
    expect(toolIconKind(makeTool({ title: 'exit_plan_mode' }))).toBe('plan')
  })

  it('正确识别终端与命令行类型', () => {
    expect(toolIconKind(makeTool({ kind: 'execute' }))).toBe('terminal')
    expect(toolIconKind(makeTool({ title: 'run_terminal_command', detail: 'cargo test' }))).toBe(
      'terminal',
    )
    expect(toolIconKind(makeTool({ detail: 'git status' }))).toBe('terminal')
    expect(toolIconKind(makeTool({ detail: 'npm test' }))).toBe('terminal')
    expect(toolIconKind(makeTool({ detail: 'powershell -c ls' }))).toBe('terminal')
    expect(toolIconKind(makeTool({ detail: 'curl https://api.example.com' }))).toBe('terminal')
  })

  it('正确识别网络/网页检索类型', () => {
    expect(toolIconKind(makeTool({ kind: 'fetch' }))).toBe('web')
    expect(toolIconKind(makeTool({ title: 'web_search' }))).toBe('web')
    expect(toolIconKind(makeTool({ detail: 'https://docs.rs' }))).toBe('web')
  })

  it('正确识别代码搜索类型', () => {
    expect(toolIconKind(makeTool({ kind: 'search' }))).toBe('search')
    expect(toolIconKind(makeTool({ title: 'grep_search', detail: 'find text' }))).toBe('search')
    expect(toolIconKind(makeTool({ detail: 'ripgrep query' }))).toBe('search')
  })

  it('正确识别文件读写与修改类型', () => {
    expect(toolIconKind(makeTool({ kind: 'read' }))).toBe('read')
    expect(toolIconKind(makeTool({ kind: 'edit' }))).toBe('edit')
    expect(toolIconKind(makeTool({ kind: 'write' }))).toBe('edit')
    expect(toolIconKind(makeTool({ kind: 'delete' }))).toBe('edit')
    expect(toolIconKind(makeTool({ kind: 'move' }))).toBe('edit')
  })

  it('正确识别常见文件读取与编辑工具名称', () => {
    expect(toolIconKind(makeTool({ title: 'view_file' }))).toBe('read')
    expect(toolIconKind(makeTool({ title: 'read_file' }))).toBe('read')
    expect(toolIconKind(makeTool({ title: 'list_dir' }))).toBe('read')
    expect(toolIconKind(makeTool({ title: 'replace_file_content' }))).toBe('edit')
    expect(toolIconKind(makeTool({ title: 'write_to_file' }))).toBe('edit')
    expect(toolIconKind(makeTool({ title: 'write_file' }))).toBe('edit')
    expect(toolIconKind(makeTool({ title: 'edit_file' }))).toBe('edit')
    expect(toolIconKind(makeTool({ title: 'create_file' }))).toBe('edit')
    expect(toolIconKind(makeTool({ title: 'apply_patch' }))).toBe('edit')
    expect(toolIconKind(makeTool({ title: 'default_api:view_file' }))).toBe('read')
    expect(toolIconKind(makeTool({ title: 'default_api:replace_file_content' }))).toBe('edit')
  })

  it('正确识别 run_command、node 脚本与终端任务工具', () => {
    expect(
      toolIconKind(
        makeTool({
          title: 'run_command',
          detail: 'node scripts/with-node.cjs vitest run src/writing',
        }),
      ),
    ).toBe('terminal')
    expect(
      toolIconKind(
        makeTool({
          title: 'get_command_or_subagent_output',
        }),
      ),
    ).toBe('terminal')
    expect(
      toolIconKind(
        makeTool({
          title: 'manage_task',
        }),
      ),
    ).toBe('terminal')
  })

  it('正确识别搜索与网络工具', () => {
    expect(toolIconKind(makeTool({ title: 'find_by_name', detail: '*.ts' }))).toBe('search')
    expect(toolIconKind(makeTool({ title: 'grep_search', detail: 'Pattern' }))).toBe('search')
    expect(
      toolIconKind(
        makeTool({ title: 'read_url_content', detail: 'https://docs.anthropic.com' }),
      ),
    ).toBe('web')
    expect(toolIconKind(makeTool({ title: 'search_web', detail: 'rust documentation' }))).toBe(
      'web',
    )
  })

  it('通用回退为普通工具类型', () => {
    expect(toolIconKind(makeTool({ kind: 'custom', title: 'random_calc' }))).toBe('tool')
  })
})

describe('toolHeadline', () => {
  it('正确生成各类动作前缀', () => {
    expect(toolHeadline(makeTool({ kind: 'read', detail: 'src/main.rs' }))).toBe(
      'Read src/main.rs',
    )
    expect(toolHeadline(makeTool({ kind: 'edit', detail: 'src/main.rs' }))).toBe(
      'Edit src/main.rs',
    )
    expect(toolHeadline(makeTool({ kind: 'write', detail: 'src/new.rs' }))).toBe(
      'Write src/new.rs',
    )
    expect(toolHeadline(makeTool({ kind: 'move', detail: 'src/a.rs -> src/b.rs' }))).toBe(
      'Move src/a.rs -> src/b.rs',
    )
    expect(toolHeadline(makeTool({ kind: 'execute', detail: 'npm test' }))).toBe('Run npm test')
    expect(toolHeadline(makeTool({ kind: 'search', detail: 'query' }))).toBe('Search query')
    expect(toolHeadline(makeTool({ kind: 'fetch', detail: 'https://example.com' }))).toBe(
      'Fetch https://example.com',
    )
    expect(toolHeadline(makeTool({ kind: 'delete', detail: 'temp.txt' }))).toBe('Delete temp.txt')
    expect(toolHeadline(makeTool({ kind: 'ask_user', detail: '确认操作？' }))).toBe(
      'Ask · 确认操作？',
    )
    expect(toolHeadline(makeTool({ kind: 'plan_mode', detail: '重构规划' }))).toBe(
      'Plan · 重构规划',
    )
    expect(toolHeadline(makeTool({ kind: 'think', detail: '分析问题' }))).toBe(
      'Thought · 分析问题',
    )
  })

  it('子任务保持自身 title', () => {
    expect(toolHeadline(makeTool({ kind: 'subagent', title: '子任务 · 编写单元测试' }))).toBe(
      '子任务 · 编写单元测试',
    )
  })

  it('正确为常见文件工具添加 Read 和 Edit 动作前缀', () => {
    expect(toolHeadline(makeTool({ title: 'view_file', detail: 'src/main.rs' }))).toBe(
      'Read src/main.rs',
    )
    expect(toolHeadline(makeTool({ title: 'read_file', detail: 'src/main.rs' }))).toBe(
      'Read src/main.rs',
    )
    expect(toolHeadline(makeTool({ title: 'list_dir', detail: 'crates/vesprism-desktop' }))).toBe(
      'Read crates/vesprism-desktop',
    )
    expect(
      toolHeadline(
        makeTool({
          title: 'replace_file_content',
          detail: 'src/components/Chat/MessageItem.tsx',
        }),
      ),
    ).toBe('Edit src/components/Chat/MessageItem.tsx')
    expect(toolHeadline(makeTool({ title: 'write_to_file', detail: 'src/new.rs' }))).toBe(
      'Edit src/new.rs',
    )
    expect(toolHeadline(makeTool({ title: 'write_file', detail: 'src/new.rs' }))).toBe(
      'Edit src/new.rs',
    )
    expect(toolHeadline(makeTool({ title: 'edit_file', detail: 'src/new.rs' }))).toBe(
      'Edit src/new.rs',
    )
    expect(
      toolHeadline(makeTool({ title: 'default_api:view_file', detail: 'src/main.rs' })),
    ).toBe('Read src/main.rs')
    expect(toolHeadline(makeTool({ title: 'find_by_name', detail: '*.ts' }))).toBe('Search *.ts')
    expect(toolHeadline(makeTool({ title: 'grep_search', detail: 'pattern' }))).toBe(
      'Search pattern',
    )
    expect(
      toolHeadline(
        makeTool({ title: 'read_url_content', detail: 'https://docs.anthropic.com' }),
      ),
    ).toBe('Fetch https://docs.anthropic.com')
    expect(
      toolHeadline(
        makeTool({
          title: 'run_command',
          detail: 'node scripts/with-node.cjs vitest run src/writing',
        }),
      ),
    ).toBe('Run node scripts/with-node.cjs vitest run src/writing')
  })

  it('流式无参数阶段显示友好等待文案', () => {
    expect(toolHeadline(makeTool({ title: 'todo_write', detail: '', preview: '' }), true)).toBe(
      '正在更新任务清单',
    )
    expect(
      toolHeadline(makeTool({ title: 'run_terminal_command', detail: '', preview: '' }), true),
    ).toBe('正在写命令')
    expect(
      toolHeadline(makeTool({ title: 'unknown_custom_tool', detail: '', preview: '' }), true),
    ).toBe('正在生成参数…')
  })

  it('超长 detail 截断', () => {
    const long = 'a'.repeat(100)
    const hl = toolHeadline(makeTool({ kind: 'execute', detail: long }))
    expect(hl).toContain('…')
    expect(hl.length).toBeLessThan(80)
  })
})
