export type TodoPriority = "high" | "medium" | "low";

export type TodoAttachmentType = "image";

export interface TodoAttachment {
  id: string;
  type: TodoAttachmentType;
  dataUrl: string;
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
  archived_at: string | null;
  remind_at: string | null;
  reminded_at: string | null;
  created_at: string;
  updated_at: string;
  attachments: TodoAttachment[];
}

export interface TodoInput {
  title: string;
  notes?: string;
  priority?: TodoPriority;
  due_date?: string | null;
  remind_at?: string | null;
  attachments?: TodoAttachment[];
}

export interface TodoUpdateInput {
  title?: string;
  notes?: string | null;
  priority?: TodoPriority;
  due_date?: string | null;
  remind_at?: string | null;
  attachments?: TodoAttachment[];
}

export interface TodoReminderPayload {
  id: number;
  title: string;
  notes: string | null;
  priority: string;
  remind_at: string;
}