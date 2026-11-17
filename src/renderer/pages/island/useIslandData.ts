import { useCallback, useEffect, useRef, useState } from "react";
import type { IslandAiActivity, IslandRecentNote } from "@shared/island/island";
import type { Todo } from "@/pages/todo/types";

export interface IslandClipboardItem {
  id: number;
  type: "text" | "image";
  content: string;
  time: string;
}

const EMPTY_AI: IslandAiActivity = {
  running: false,
  title: "",
  sessionId: null,
  startedAt: null,
  tool: null,
};

const NOTES_POLL_INTERVAL = 5000;

const CLIPBOARD_POLL_INTERVAL = 3000;

export interface IslandData {
  todos: Todo[];
  clipboard: IslandClipboardItem[];
  notes: IslandRecentNote[];
  ai: IslandAiActivity;
  pendingTodoCount: number;
  reloadTodos: () => Promise<void>;
  reloadClipboard: () => Promise<void>;
  reloadNotes: () => Promise<void>;
}

export function useIslandData(): IslandData {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [clipboard, setClipboard] = useState<IslandClipboardItem[]>([]);
  const [notes, setNotes] = useState<IslandRecentNote[]>([]);
  const [ai, setAi] = useState<IslandAiActivity>(EMPTY_AI);

  const reloadTodos = useCallback(async () => {
    try {
      const list = (await window.electron.todoList()) as Todo[];
      setTodos(Array.isArray(list) ? list : []);
    } catch {
    }
  }, []);

  const reloadClipboard = useCallback(async () => {
    try {
      const list = await window.electron.popupGetClipboardHistory(20);
      setClipboard(Array.isArray(list) ? (list as IslandClipboardItem[]) : []);
    } catch {
    }
  }, []);

  const reloadNotes = useCallback(async () => {
    try {
      const list = await window.electron.islandGetRecentNotes();
      setNotes(Array.isArray(list) ? list : []);
    } catch {
    }
  }, []);

  const reloadAiActivity = useCallback(async () => {
    try {
      const activity = await window.electron.islandGetAiActivity();
      if (activity) setAi(activity);
    } catch {
    }
  }, []);

  useEffect(() => {
    void reloadTodos();
    void reloadClipboard();
    void reloadNotes();
    void reloadAiActivity();
  }, [reloadTodos, reloadClipboard, reloadNotes, reloadAiActivity]);

  useEffect(() => {
    return window.electron.onTodosChanged(() => {
      void reloadTodos();
    });
  }, [reloadTodos]);

  useEffect(() => {
    return window.electron.onClipboardChanged(() => {
      void reloadClipboard();
    });
  }, [reloadClipboard]);

  useEffect(() => {
    return window.electron.onIslandAiActivity((activity) => {
      setAi(activity);
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void reloadClipboard();
    }, CLIPBOARD_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [reloadClipboard]);

  const reloadNotesRef = useRef(reloadNotes);
  reloadNotesRef.current = reloadNotes;
  useEffect(() => {
    const timer = setInterval(() => {
      void reloadNotesRef.current();
    }, NOTES_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  const pendingTodoCount = todos.filter((todo) => !todo.completed && !todo.archived_at).length;

  return {
    todos,
    clipboard,
    notes,
    ai,
    pendingTodoCount,
    reloadTodos,
    reloadClipboard,
    reloadNotes,
  };
}
