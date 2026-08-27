/**
 * 引擎 / IPC 错误转成设置页、会话条能读的人话。
 * 不认识的中文原文原样保留；英文 Unknown error 等一律换成短句。
 */

export function formatEngineError(raw: unknown): string {
  let s = raw == null ? '' : String(raw)
  s = s.replace(/^Error:\s*/i, '').replace(/^error:\s*/i, '').trim()
  s = s.replace(/^Invoke error:\s*/i, '').trim()
  s = s.replace(/^打开历史会话失败[:：]?\s*/i, '').trim()
  if (!s || /^unknown error$/i.test(s)) return '出了点问题，请重试'

  const lower = s.toLowerCase()

  if (/api.?key|unauthor|401|鉴权|authentication|forbidden|403/.test(lower)) {
    return '鉴权失败，请到设置检查密钥'
  }
  if (/429|rate limit|too many requests|限流/.test(lower)) {
    return '请求过于频繁，请稍后再试'
  }
  if (
    /econnrefused|enotfound|fetch failed|network|timed? ?out|etimedout|dns|连接被拒绝/.test(
      lower,
    )
  ) {
    return '连不上模型服务，请检查网络和 Base URL'
  }
  if (/context.{0,12}(overflow|too long)|上下文/.test(lower) && /满|超|overflow/.test(lower)) {
    return '上下文已满，请压缩会话或新开对话'
  }
  if (/supervisor/.test(lower) || /无响应/.test(s)) {
    return '会话通道已断开，请点「重试」'
  }
  if (/会话未启动/.test(s)) {
    return '会话还没就绪，请稍等或点「重试」'
  }
  if (/cannot rewind to prompt/i.test(s)) {
    return '没法重试这一轮，请直接再发一条'
  }
  if (/会话已断开/.test(s) || /自动恢复失败/.test(s)) {
    return '会话已断开，自动恢复失败。请点「重试」或新建对话'
  }
  if (
    /恢复会话失败/.test(s) ||
    /FS_NOT_FOUND|path not found|找不到指定的路径|os error 3/i.test(s)
  ) {
    return '没能接上这条对话。聊天记录还在，请点「重试」。'
  }
  if (/sharing is not available/i.test(s) || /sharing is disabled/i.test(s)) {
    return '当前账号不能分享会话'
  }
  if (/data retention policy/i.test(s)) {
    return '团队数据保留策略禁止分享会话'
  }
  if (/feedback is disabled/i.test(s)) {
    return '反馈未开启。可在配置里打开 [features] feedback'
  }

  return s
}

/** 需要「重试」而不是只关掉的会话级故障 */
export function isSessionDeadError(msg: string): boolean {
  return /崩溃|断开|恢复失败|通道已断开|还没就绪|点「重试」|空壳|没能接上/.test(msg)
}

/** 工作区目录不存在（闲聊 scratch 被删、项目挪盘、副本 worktree 被清） */
export function isMissingWorkspacePathError(raw: unknown): boolean {
  const s = String(raw ?? '')
  return /FS_NOT_FOUND|path not found|找不到指定的路径|os error 3|文件夹找不到/i.test(s)
}
