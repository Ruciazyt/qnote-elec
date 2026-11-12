import { useCallback, useEffect, useRef, useState } from "react";
import type { IslandAiActivity, IslandRecentNote } from "@shared/island";
import type { Todo } from "@/components/todo/types";

/** 剪贴板条目 —— 与主进程 popup-get-clipboard-history 的返回结构一致 */
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

/** 最近笔记多久拉一次 —— 笔记的改动没有广播给岛，只能轮询 */
const NOTES_POLL_INTERVAL = 5000;

/** 剪贴板轮询间隔 —— 与主进程监听器的 2 秒节奏对齐 */
const CLIPBOARD_POLL_INTERVAL = 3000;

export interface IslandData {
  todos: Todo[];
  clipboard: IslandClipboardItem[];
  notes: IslandRecentNote[];
  ai: IslandAiActivity;
  /** 未完成的待办数 */
  pendingTodoCount: number;
  reloadTodos: () => Promise<void>;
  reloadClipboard: () => Promise<void>;
  reloadNotes: () => Promise<void>;
}

/**
 * 岛上的数据
 *
 * 待办走广播（主进程的 todo:changed 会发给所有窗口），剪贴板同理
 * （clipboard-changed 已经改成广播）。只有笔记没有广播 —— 笔记是磁盘上的
 * 文件，主进程不知道谁改了什么，只能轮询。
 */
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
      /* 读不到就保持上一次的 */
    }
  }, []);

  const reloadClipboard = useCallback(async () => {
    try {
      const list = await window.electron.popupGetClipboardHistory(20);
      setClipboard(Array.isArray(list) ? (list as IslandClipboardItem[]) : []);
    } catch {
      /* 同上 */
    }
  }, []);

  const reloadNotes = useCallback(async () => {
    try {
      const list = await window.electron.islandGetRecentNotes();
      setNotes(Array.isArray(list) ? list : []);
    } catch {
      /* 同上 */
    }
  }, []);

  /**
   * AI 任务状态
   *
   * 主进程只在状态**变化**时推 —— 岛刚创建时不会收到任何推送，
   * 不主动拉一次的话，岛上会一直显示「AI 空闲」，
   * 直到下一次任务开始才知道之前其实有任务在跑。
   */
  const reloadAiActivity = useCallback(async () => {
    try {
      const activity = await window.electron.islandGetAiActivity();
      if (activity) setAi(activity);
    } catch {
      /* 读不到就保持「空闲」 */
    }
  }, []);

  // 首屏拉一次
  useEffect(() => {
    void reloadTodos();
    void reloadClipboard();
    void reloadNotes();
    void reloadAiActivity();
  }, [reloadTodos, reloadClipboard, reloadNotes, reloadAiActivity]);

  // 待办变化：主进程广播给所有窗口，收到就重拉
  useEffect(() => {
    return window.electron.onTodosChanged(() => {
      void reloadTodos();
    });
  }, [reloadTodos]);

  // 剪贴板变化：同样是广播
  useEffect(() => {
    return window.electron.onClipboardChanged(() => {
      void reloadClipboard();
    });
  }, [reloadClipboard]);

  // AI 任务状态：主进程推
  useEffect(() => {
    return window.electron.onIslandAiActivity((activity) => {
      setAi(activity);
    });
  }, []);

  // 剪贴板轮询兜底 —— 广播漏了（比如写入时应用内自写被跳过）时仍能刷新
  useEffect(() => {
    const timer = setInterval(() => {
      void reloadClipboard();
    }, CLIPBOARD_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [reloadClipboard]);

  // 笔记轮询 —— 磁盘上的文件没有变更广播
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
