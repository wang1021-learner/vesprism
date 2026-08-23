import { describe, expect, it } from 'vitest'
import { writingToolLabel } from './writingToolLabel'

describe('writingToolLabel', () => {
  it('按官方 wire 名映射', () => {
    expect(writingToolLabel('write')).toBe('正在写文件')
    expect(writingToolLabel('search_replace')).toBe('正在写编辑')
    expect(writingToolLabel('run_terminal_command')).toBe('正在写命令')
    expect(writingToolLabel('todo_write')).toBe('正在更新任务清单')
    expect(writingToolLabel('ask_user_question')).toBe('正在准备问题')
    expect(writingToolLabel('exit_plan_mode')).toBe('正在准备计划稿')
    expect(writingToolLabel('skill')).toBe('正在加载技能')
  })

  it('wire 对不上时回退 kind', () => {
    expect(writingToolLabel('custom_edit', 'edit')).toBe('正在写编辑')
    expect(writingToolLabel('', 'execute')).toBe('正在写命令')
  })

  it('读类工具没有写作文案', () => {
    expect(writingToolLabel('read_file', 'read')).toBeUndefined()
    expect(writingToolLabel('grep', 'search')).toBeUndefined()
  })
})
