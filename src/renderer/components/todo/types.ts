export type TodoPriority = "high" | "medium" | "low";

export type TodoAttachmentType = "image";

/** Todo 附件 — 当前仅支持 image */
export interface TodoAttachment {
  id: string;
  type: TodoAttachmentType;
  /** base64 dataUrl，形如 `data:image/png;base64,...` */
  dataUrl: string;
  /** 可选原文件名 */
  name?: string;
}

export interface Todo {
  id: number;
  title: string;
  notes: string | null;
  priority: TodoPriority;
  due_date: string | null;
  completed: 0 | 1;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** 附件列表 */
  attachments: TodoAttachment[];
}

export interface TodoInput {
  title: string;
  notes?: string;
  priority?: TodoPriority;
  due_date?: string | null;
  attachments?: TodoAttachment[];
}

export interface TodoUpdateInput {
  title?: string;
  notes?: string | null;
  priority?: TodoPriority;
  due_date?: string | null;
  attachments?: TodoAttachment[];
}