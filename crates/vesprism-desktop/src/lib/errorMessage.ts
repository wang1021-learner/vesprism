/**
 * 引擎 / IPC 错误转成设置页、会话条能读的人话。
 * 不认识的中文原文原样保留；英文 Unknown error 等一律换成短句。
 */

export function formatEngineError(raw: unknown): string {
  let s = raw == null ? '' : String(raw)
  s = s.replace(/^Error:\s*/i, '').replace(/^error:\s*/i, '').trim()
  s = s.replace(/^Invoke error:\s*/i, '').trim()
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
  if (/会话已断开/.test(s) || /自动恢复失败/.test(s)) {
    return '会话已断开，自动恢复失败。请点「重试」或新建对话'
  }
  if (/恢复会话失败/.test(s)) {
    return `没能接上上次的对话：${stripPrefix(s, '恢复会话失败')}`
  }

  return s
}

function stripPrefix(s: string, prefix: string): string {
  const t = s.replace(new RegExp(`^${prefix}[:：]?\\s*`), '').trim()
  return t || s
}

/** 需要「重试」而不是只关掉的会话级故障 */
export function isSessionDeadError(msg: string): boolean {
  return /崩溃|断开|恢复失败|通道已断开|还没就绪|点「重试」|空壳/.test(msg)
}
