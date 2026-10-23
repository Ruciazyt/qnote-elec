import { Pencil, Trash2, ListChecks, Paperclip } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Todo, TodoPriority, TodoAttachment } from "./types";

interface TodoListProps {
  todos: Todo[];
  onToggle: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  /** 点击附件缩略图时回调（用于放大查看） */
  onAttachmentClick?: (attachment: TodoAttachment, todo: Todo) => void;
}

const PRIORITY_META: Record<TodoPriority, { label: string; className: string }> = {
  high: { label: "高", className: "bg-destructive/10 text-destructive border-destructive/30" },
  medium: { label: "中", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  low: { label: "低", className: "bg-muted text-muted-foreground border-border" },
};

function formatDueDate(dueDate: string | null, completed: 0 | 1): { text: string; className: string } | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (24 * 3600 * 1000));
  let text: string;
  if (diffDays === 0) text = "今天截止";
  else if (diffDays === 1) text = "明天截止";
  else if (diffDays === -1) text = "已过期 1 天";
  else if (diffDays < 0) text = `已过期 ${-diffDays} 天`;
  else if (diffDays <= 7) text = `${diffDays} 天后`;
  else text = `${due.getMonth() + 1}/${due.getDate()}`;
  let className = "bg-muted text-muted-foreground border-border";
  if (completed === 0) {
    if (diffDays < 0) className = "bg-destructive/10 text-destructive border-destructive/30";
    else if (diffDays === 0) className = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
  }
  return { text, className };
}

function formatCreated(date: string): string {
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true, locale: zhCN });
  } catch {
    return "";
  }
}

export function TodoList({ todos, onToggle, onEdit, onDelete, onAttachmentClick }: TodoListProps) {
  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
          <ListChecks className="h-7 w-7 text-primary/60" />
        </div>
        <p className="text-base font-medium text-foreground/70 mb-1">这里空空如也</p>
        <p className="text-sm text-muted-foreground/70">点右上角"+ 新建 Todo"创建一条任务</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {todos.map((todo) => {
        const priority = PRIORITY_META[todo.priority];
        const due = formatDueDate(todo.due_date, todo.completed);
        const completed = todo.completed === 1;
        const attachments = todo.attachments || [];
        const attachmentCount = attachments.length;
        return (
          <li
            key={todo.id}
            className={`rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/30 hover:bg-card/80 ${completed ? "opacity-65" : ""}`}>
            {/* 顶部 meta 行：优先级 / 截止日期 / 时间 / 操作按钮 */}
            <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-xs">
              <span className={`px-1.5 py-0.5 rounded border font-medium ${priority.className}`}>
                {priority.label}
              </span>
              {due && (
                <span className={`px-1.5 py-0.5 rounded border font-medium ${due.className}`}>
                  {due.text}
                </span>
              )}
              {attachmentCount > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-primary/5 text-primary border-primary/20">
                  <Paperclip className="h-3 w-3" />
                  {attachmentCount}
                </span>
              )}
              <span className="text-muted-foreground/60">{formatCreated(todo.created_at)}</span>
              <div className="ml-auto flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => onEdit(todo)}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
                      aria-label="编辑">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={4}>
                    <p className="text-xs">编辑</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => onDelete(todo)}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                      aria-label="删除">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={4}>
                    <p className="text-xs">删除</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            {/* 内容行：checkbox + 标题 + 备注 + 附件缩略图 */}
            <div className="flex items-start gap-3 px-3 pb-3">
              <input
                type="checkbox"
                checked={completed}
                onChange={() => onToggle(todo)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary flex-shrink-0"
                aria-label={completed ? "标记为未完成" : "标记为已完成"}
              />
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium leading-relaxed break-words ${completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                  {todo.title}
                </p>
                {todo.notes && (
                  <p className={`text-xs text-muted-foreground mt-1 whitespace-pre-wrap leading-relaxed break-words ${completed ? "line-through" : ""}`}>
                    {todo.notes}
                  </p>
                )}
                {/* 附件缩略图 */}
                {attachmentCount > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {attachments.map((att) => (
                      <button
                        key={att.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAttachmentClick?.(att, todo);
                        }}
                        className="group/att relative h-14 w-14 rounded-md overflow-hidden border border-border/70 bg-muted/40 hover:border-primary/50 hover:ring-2 hover:ring-primary/20 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
                        title={att.name || "点击查看"}>
                        <img
                          src={att.dataUrl}
                          alt={att.name || "附件"}
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                        <span className="absolute inset-0 bg-primary/0 group-hover/att:bg-primary/10 transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}