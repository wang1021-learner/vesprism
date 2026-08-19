/**
 * 对齐官方 `writing_tool_kind`：参数流式阶段显示「正在写…」，
 * 而不是原始工具名或泛化的「正在生成参数」。
 */

const WRITING_BY_WIRE: Record<string, string> = {
  write: '正在写文件',
  search_replace: '正在写编辑',
  edit: '正在写编辑',
  hashline_edit: '正在写编辑',
  apply_patch: '正在写编辑',
  run_terminal_command: '正在写命令',
  run_terminal_cmd: '正在写命令',
  bash: '正在写命令',
  todo_write: '正在更新任务清单',
  todowrite: '正在更新任务清单',
  workflow: '正在写流程',
  image_gen: '正在写图像提示',
  image_edit: '正在写图像提示',
  image_to_video: '正在写视频提示',
  reference_to_video: '正在写视频提示',
  ask_user_question: '正在准备问题',
}

const WRITING_BY_KIND: Record<string, string> = {
  write: '正在写文件',
  edit: '正在写编辑',
  execute: '正在写命令',
  plan: '正在更新任务清单',
  workflow: '正在写流程',
  image_gen: '正在写图像提示',
  image_to_video: '正在写视频提示',
  ask_user: '正在准备问题',
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/** 工具参数还在流式到达时的标题；对不上官方表则返回 undefined。 */
export function writingToolLabel(title?: string | null, kind?: string | null): string | undefined {
  const wire = title ? norm(title) : ''
  if (wire && WRITING_BY_WIRE[wire]) return WRITING_BY_WIRE[wire]
  const k = kind ? norm(kind) : ''
  if (k && WRITING_BY_KIND[k]) return WRITING_BY_KIND[k]
  return undefined
}
