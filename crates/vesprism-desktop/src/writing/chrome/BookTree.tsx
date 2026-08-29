import {
  beatsNode,
  chapterHasStack,
  draftNode,
  parseNode,
  personNode,
  placeNode,
  reviewNode,
  ruleNode,
  type WorkMode,
} from '../model/nodes'
import type { BookDemo, DeskNodeId } from '../model/types'

type Props = {
  book: BookDemo
  selected: DeskNodeId
  mode: WorkMode
  onSelect: (id: DeskNodeId) => void
  onAddPerson?: () => void
  onAddRule?: () => void
  onAddPlace?: () => void
  onAddVolume?: () => void
  onAddUnit?: () => void
  onAddChapter?: () => void
}

function Leaf({
  id,
  label,
  selected,
  onSelect,
  locked,
  indent,
}: {
  id: DeskNodeId
  label: string
  selected: DeskNodeId
  onSelect: (id: DeskNodeId) => void
  locked?: boolean
  indent?: number
}) {
  return (
    <button
      type="button"
      className={`wd-tree-item${selected === id ? ' is-on' : ''}${locked ? ' is-lock' : ''}`}
      style={{ paddingLeft: 10 + (indent ?? 0) * 12 }}
      aria-current={selected === id ? 'page' : undefined}
      aria-disabled={locked || undefined}
      onClick={() => onSelect(id)}
    >
      {locked ? <span className="wd-tree-lock" aria-label="已锁" /> : null}
      {label}
    </button>
  )
}

function Add({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null
  return (
    <button type="button" className="wd-btn wd-btn-ghost wd-tree-add" onClick={onClick}>
      {label}
    </button>
  )
}

export function BookTree({
  book,
  selected,
  mode,
  onSelect,
  onAddPerson,
  onAddRule,
  onAddPlace,
  onAddVolume,
  onAddUnit,
  onAddChapter,
}: Props) {
  if (mode === 'set') {
    return (
      <nav className="wd-tree" aria-label="设定目录">
        <p className="wd-tree-book">{book.title}</p>
        <Leaf id="engine" label="百万字怎么拆" selected={selected} onSelect={onSelect} />
        <Leaf id="pitch" label="卖点" selected={selected} onSelect={onSelect} />
        <Leaf id="canon" label="规矩" selected={selected} onSelect={onSelect} />
        <Leaf id="bible" label="设定集" selected={selected} onSelect={onSelect} />
        <p className="wd-tree-book">人物</p>
        {book.people.map((p) => (
          <Leaf
            key={p.id}
            id={personNode(p.id)}
            label={`${p.role} · ${p.name}`}
            selected={selected}
            onSelect={onSelect}
            indent={1}
          />
        ))}
        <Add label="新建人物" onClick={onAddPerson} />
        <p className="wd-tree-book">规则</p>
        {book.rules.map((r) => (
          <Leaf
            key={r.id}
            id={ruleNode(r.id)}
            label={r.name}
            selected={selected}
            onSelect={onSelect}
            indent={1}
          />
        ))}
        <Add label="新建规则" onClick={onAddRule} />
        <p className="wd-tree-book">地点</p>
        {book.places.map((p) => (
          <Leaf
            key={p.id}
            id={placeNode(p.id)}
            label={p.name}
            selected={selected}
            onSelect={onSelect}
            indent={1}
          />
        ))}
        <Add label="新建地点" onClick={onAddPlace} />
      </nav>
    )
  }

  if (mode === 'draft') {
    return (
      <nav className="wd-tree" aria-label="稿纸目录">
        <p className="wd-tree-book">候选和正史</p>
        {book.chapters.map((c) => {
          const stack = chapterHasStack(book, c.id)
          if (!stack.draft && !stack.beats) return null
          return (
            <Leaf
              key={c.id}
              id={draftNode(c.id)}
              label={`第${c.no}章 ${c.title || '未拟题'}${stack.draft ? '' : ' · 还没写'}`}
              selected={selected}
              onSelect={onSelect}
              locked={c.locked}
            />
          )
        })}
      </nav>
    )
  }

  if (mode === 'check') {
    return (
      <nav className="wd-tree" aria-label="检查目录">
        <p className="wd-tree-book">对照单</p>
        {book.chapters.map((c) => {
          const stack = chapterHasStack(book, c.id)
          if (!stack.review && !stack.draft) return null
          return (
            <Leaf
              key={c.id}
              id={reviewNode(c.id)}
              label={`第${c.no}章 ${c.title || '未拟题'}`}
              selected={selected}
              onSelect={onSelect}
              locked={c.locked}
            />
          )
        })}
      </nav>
    )
  }

  return (
    <nav className="wd-tree" aria-label="结构目录">
      <p className="wd-tree-book">{book.title}</p>
      <Leaf id="outline" label="长线" selected={selected} onSelect={onSelect} />
      {book.volumes.map((vol) => (
        <div key={vol.id}>
          <Leaf id={vol.id} label={vol.title} selected={selected} onSelect={onSelect} />
          {book.units
            .filter((u) => u.volumeId === vol.id)
            .map((u) => (
              <div key={u.id}>
                <Leaf
                  id={u.id}
                  label={u.name}
                  selected={selected}
                  onSelect={onSelect}
                  indent={1}
                />
                {book.chapters
                  .filter((c) => c.unitId === u.id)
                  .map((c) => {
                    const stack = chapterHasStack(book, c.id)
                    const selectedKind = parseNode(selected)
                    const onChapter =
                      selectedKind.kind === 'chapter' ||
                      selectedKind.kind === 'beats' ||
                      selectedKind.kind === 'draft' ||
                      selectedKind.kind === 'review'
                    const showKids =
                      onChapter &&
                      (selectedKind.kind === 'chapter'
                        ? selectedKind.id === c.id
                        : selectedKind.chapterId === c.id)
                    return (
                      <div key={c.id}>
                        <Leaf
                          id={c.id}
                          label={`第${c.no}章 ${c.title || '未拟题'}`}
                          selected={selected}
                          onSelect={onSelect}
                          indent={2}
                          locked={c.locked}
                        />
                        {stack.beats || showKids ? (
                          <Leaf
                            id={beatsNode(c.id)}
                            label="切块"
                            selected={selected}
                            onSelect={onSelect}
                            indent={3}
                          />
                        ) : null}
                      </div>
                    )
                  })}
              </div>
            ))}
        </div>
      ))}
      <Add label="加一卷" onClick={onAddVolume} />
      <Add label="加一场战役" onClick={onAddUnit} />
      <Add label="加一章" onClick={onAddChapter} />
    </nav>
  )
}
