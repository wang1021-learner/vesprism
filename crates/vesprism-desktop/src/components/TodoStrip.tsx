import { $messages } from '../store'
import { useStoreSelect } from '../lib/useStoreSelect'
import type { TodoSnapshotData } from '../types'

function latestTodo(
  messages: readonly { toolCall?: { todo?: TodoSnapshotData | null } }[],
) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = messages[i]?.toolCall?.todo
    if (t?.todos?.length) return t
  }
  return null
}

function todosEqual(a: TodoSnapshotData | null, b: TodoSnapshotData | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.summary !== b.summary || a.todos.length !== b.todos.length) return false
  return a.todos.every(
    (t, i) => t.content === b.todos[i].content && t.status === b.todos[i].status,
  )
}

export function TodoStrip() {
  const todo = useStoreSelect($messages, latestTodo, todosEqual)
  if (!todo) return null
  const done = todo.todos.filter((t) => t.status === 'completed').length
  return (
    <div className="session-pin" role="status">
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>
          待办 {done}/{todo.todos.length}
        </strong>
        {todo.summary ? (
          <span style={{ marginLeft: 8, fontSize: 12 }}>{todo.summary}</span>
        ) : null}
        <ul className="session-pin-list">
          {todo.todos.slice(0, 8).map((t, i) => (
            <li
              key={`${t.content}-${i}`}
              className={
                t.status === 'completed'
                  ? 'is-done'
                  : t.status === 'in_progress'
                    ? 'is-run'
                    : ''
              }
            >
              <span aria-hidden>
                {t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '□'}
              </span>
              <span>{t.content}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
