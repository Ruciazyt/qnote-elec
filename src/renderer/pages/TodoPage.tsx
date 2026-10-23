import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { TodoEditDialog } from "@/components/todo/TodoEditDialog";
import { TodoList } from "@/components/todo/TodoList";
import type { Todo, TodoPriority, TodoAttachment } from "@/components/todo/types";

type Filter = "all" | "active" | "completed";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "active", label: "待办" },
  { key: "completed", label: "已完成" },
];

export default function TodoPage() {
  const { toast } = useToast();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);
  // 当前查看的附件（大图预览）
  const [previewAttachment, setPreviewAttachment] = useState<TodoAttachment | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await window.electron.todoList();
      setTodos(list);
    } catch (err) {
      console.error("加载 Todo 列表失败", err);
      toast({ title: "加载失败", description: "无法读取 Todo 列表", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "active") return todos.filter((t) => t.completed === 0);
    if (filter === "completed") return todos.filter((t) => t.completed === 1);
    return todos;
  }, [todos, filter]);

  const counts = useMemo(
    () => ({
      all: todos.length,
      active: todos.filter((t) => t.completed === 0).length,
      completed: todos.filter((t) => t.completed === 1).length,
    }),
    [todos]
  );

  const openCreate = () => {
    setEditing(null);
    setEditOpen(true);
  };

  const openEdit = (todo: Todo) => {
    setEditing(todo);
    setEditOpen(true);
  };

  const handleSave = async (input: {
    title: string;
    notes?: string;
    priority: TodoPriority;
    due_date: string | null;
    attachments?: TodoAttachment[];
  }) => {
    try {
      if (editing) {
        await window.electron.todoUpdate(editing.id, input);
        toast({ title: "Todo 已更新" });
      } else {
        await window.electron.todoCreate(input);
        toast({ title: "Todo 已创建" });
      }
      await load();
    } catch (err) {
      console.error("保存 Todo 失败", err);
      toast({ title: "保存失败", description: err instanceof Error ? err.message : "未知错误", variant: "destructive" });
    }
  };

  const handleAttachmentClick = (attachment: TodoAttachment) => {
    setPreviewAttachment(attachment);
  };

  const handleToggle = async (todo: Todo) => {
    try {
      await window.electron.todoToggle(todo.id);
      await load();
    } catch (err) {
      console.error("切换 Todo 状态失败", err);
      toast({ title: "操作失败", variant: "destructive" });
    }
  };

  const handleDelete = async (todo: Todo) => {
    try {
      const ok = await window.electron.todoDelete(todo.id);
      if (ok) {
        toast({ title: "Todo 已删除" });
        await load();
      } else {
        toast({ title: "删除失败", variant: "destructive" });
      }
    } catch (err) {
      console.error("删除 Todo 失败", err);
      toast({ title: "删除失败", variant: "destructive" });
    }
  };

  return (
    <div className="flex h-full flex-col px-6 py-4 overflow-hidden">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-primary" />
            Todo
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">轻量任务管理，支持优先级和截止日期</p>
        </div>
        <Button onClick={openCreate} size="sm" className="btn-hover">
          <Plus className="h-4 w-4 mr-1.5" />
          新建 Todo
        </Button>
      </div>

      <div className="flex items-center gap-1 mb-3 flex-shrink-0 border-b border-border/60">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = counts[f.key];
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors relative ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground/80"
              }`}>
              {f.label}
              <span className={`ml-1.5 text-xs ${active ? "text-primary" : "text-muted-foreground/60"}`}>
                {count}
              </span>
              {active && (
                <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-10">加载中...</div>
        ) : (
          <TodoList
          todos={filtered}
          onToggle={handleToggle}
          onEdit={openEdit}
          onDelete={handleDelete}
          onAttachmentClick={handleAttachmentClick}
        />
        )}
      </div>

      <TodoEditDialog
        open={editOpen}
        todo={editing}
        onClose={() => setEditOpen(false)}
        onSave={handleSave}
      />
      {/* 附件大图预览 */}
      {previewAttachment && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 cursor-zoom-out"
          onClick={() => setPreviewAttachment(null)}>
          <button
            type="button"
            className="absolute top-4 right-4 h-9 w-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewAttachment(null);
            }}
            aria-label="关闭预览">
            <X className="h-4 w-4" />
          </button>
          <img
            src={previewAttachment.dataUrl}
            alt={previewAttachment.name || "附件"}
            className="max-w-full max-h-full object-contain rounded-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}