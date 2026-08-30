import { Field, FieldRow, Section } from '../fields/Field'
import { WRITE_JOBS } from '../framework/jobs'
import { assembleWriteChapter } from '../framework/prompt'
import { WRITER_ROLES } from '../framework/roles'
import { chapterCountFor, contextBudget, NOVEL_SCALE, volumeChapterAim } from '../framework/scale'
import type { BookDemo } from '../model/types'

export function EngineView({ book, chapterId }: { book: BookDemo; chapterId: string }) {
  const budget = contextBudget()
  const wire = assembleWriteChapter(book, chapterId)
  const ch = book.chapters.find((c) => c.id === chapterId)
  const written = book.drafts.filter((d) => d.accepted).length
  return (
    <Section
      lot="拆法"
      title="框架管案卷，写手每次只吃一章"
      lead="100 万汉字拆成可循环的章。不另起一套模型运行时。现在只展示契约，不发请求。"
      wide
    >
      <ol className="wd-start">
        <li>
          <strong>入口</strong>
          书库。新建只问书名、平台、一句话。没有这三句，不准写正文。
        </li>
        <li>
          <strong>四个工作面</strong>
          设定、结构、正文、检查。不是一个聊天框里什么都干。
        </li>
        <li>
          <strong>下令</strong>
          右侧大按钮是这一步的动作。生成先试笔，点采纳才是正史。
        </li>
      </ol>
      <FieldRow>
        <Field label="目标">{NOVEL_SCALE.targetChars.toLocaleString('zh-CN')} 字</Field>
        <Field label="章字数">
          {NOVEL_SCALE.chapterMin}～{NOVEL_SCALE.chapterMax}
        </Field>
        <Field label="约章数">{chapterCountFor()} 章</Field>
        <Field label="约每卷">{volumeChapterAim()} 章 · {NOVEL_SCALE.volumeAim} 卷</Field>
      </FieldRow>
      <Field label="这本书已进正史">{written} 章</Field>
      <Field label="写手吃">{budget.writerEats}</Field>
      <Field label="写手不吃" warn>
        {budget.writerNever}
      </Field>
      <Field label="记忆">{budget.memory}</Field>

      <ul className="wd-role-grid">
        {WRITER_ROLES.map((r) => (
          <li key={r.id} className="wd-role-card">
            <p className="wd-kicker">{r.id}</p>
            <h3>{r.name}</h3>
            <p>{r.job}</p>
            <p className="wd-ticket-sub">吃：{r.eats}</p>
            <p className="wd-ticket-sub">禁：{r.never}</p>
          </li>
        ))}
      </ul>

      <ol className="wd-job-list">
        {WRITE_JOBS.map((j) => (
          <li key={j.id}>
            <span className="wd-ticket-id">{j.role}</span>
            {j.label}
            <span className="wd-ticket-sub">
              {j.from} → {j.to}
            </span>
          </li>
        ))}
      </ol>

      <Field label="当前写手章">{ch ? `第${ch.no}章 ${ch.title || '未拟题'}` : '—'}</Field>
      {wire ? (
        <div className="wd-prompt" role="region" aria-label="写手将吃到的提示">
          <p className="wd-kicker">写手系统词</p>
          <pre>{wire.system}</pre>
          <p className="wd-kicker">写手用户词（切片）</p>
          <pre>{wire.user}</pre>
        </div>
      ) : (
        <p className="wd-lock-banner">{ch?.lockReason || '当前章不能写。'}</p>
      )}
    </Section>
  )
}
