import { useState } from "react";
import { Check } from "lucide-react";
import type { Todo } from "@/components/todo/types";
import { dueDateLabel } from "../format";

interface TodoPanelProps {
  todos: Todo[];
  onOpenMain: () => void;
}

/**
 * 待办页
 *
 * 岛能直接勾选完成 —— 这是最常用的一步，不该让用户回主窗口。
 * 点标题则是回到主窗口的待办页看全貌。
 */
export function TodoPanel({ todos, onOpenMain }: TodoPanelProps) {
  const [pending, setPending] = useState<number | null>(null);

  const active = todos.filter((todo) => !todo.completed && !todo.archived_at);
  const done = todos.filter((todo) => todo.completed && !todo.archived_at).slice(0, 5);

  const handleToggle = async (todo: Todo) => {
    setPending(todo.id);
    try {
      await window.electron.todoToggle(todo.id);
    } finally {
      setPending(null);
    }
  };

  if (active.length === 0 && done.length === 0) {
    return (
      <div className="island-empty">
        <Check size={22} strokeWidth={1.5} className="island-icon-muted" />
        <div className="island-empty-title">还没有待办</div>
      </div>
    );
  }

  return (
    <div>
      {active.length > 0 ? (
        <>
          <div className="island-section-title">进行中 · {active.length}</div>
          {active.map((todo) => (
            <div key={todo.id} className="island-row">
              <button
                type="button"
                className="island-checkbox"
                data-checked={false}
                disabled={pending === todo.id}
                aria-label={`完成「${todo.title}」`}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleToggle(todo);
                }}
              >
                <Check size={11} strokeWidth={3} />
              </button>
              <button
                type="button"
                className="flex-1 min-w-0 text-left"
                onClick={onOpenMain}
                title={todo.title}
              >
                <div className="island-row-title">{todo.title}</div>
                {(todo.due_date || todo.priority !== "medium") && (
                  <div className="island-row-meta">
                    {todo.due_date ? `截止 ${dueDateLabel(todo.due_date)}` : ""}
                    {todo.due_date && todo.priority !== "medium" ? " · " : ""}
                    {todo.priority === "high" ? "高优先级" : todo.priority === "low" ? "低优先级" : ""}
                  </div>
                )}
              </button>
              <span
                className={`island-priority-dot island-priority-${todo.priority}`}
                aria-hidden="true"
              />
            </div>
          ))}
        </>
      ) : null}

      {done.length > 0 ? (
        <>
          <div className="island-section-title">最近完成</div>
          {done.map((todo) => (
            <div key={todo.id} className="island-row" data-done="true">
              <button
                type="button"
                className="island-checkbox"
                data-checked="true"
                disabled={pending === todo.id}
                aria-label={`取消完成「${todo.title}」`}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleToggle(todo);
                }}
              >
                <Check size={11} strokeWidth={3} />
              </button>
              <button type="button" className="flex-1 min-w-0 text-left" onClick={onOpenMain}>
                <div className="island-row-title">{todo.title}</div>
              </button>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
