/** 网文句式硬名单。卡面清空时提示词回填，不回写卡。 */

export const DEFAULT_SENTENCE_BAN_LINES = [
  '「不是 A，而是 B」以及「不仅…更…」',
  '「仿佛 / 犹如 / 宛若……一般」',
  '「眼中闪过一丝…」「嘴角勾起一抹…」',
  '「不禁 / 不由得 / 心中暗道」',
  '「与此同时」当场景胶水',
  '「带着一丝 / 一抹…」万能状语',
  '章末升华（「真正的考验才刚刚开始」「这一切只是开始」）',
  '「深吸一口气 / 倒吸一口凉气」当情绪开关',
] as const

export const DEFAULT_SENTENCE_BAN = DEFAULT_SENTENCE_BAN_LINES.join('；')

export function effectiveSentenceBan(raw: string | undefined): string {
  const t = (raw || '').trim()
  return t || DEFAULT_SENTENCE_BAN
}
