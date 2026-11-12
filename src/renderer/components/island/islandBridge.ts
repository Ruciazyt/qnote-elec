import { useEffect } from "react";

/**
 * 灵动岛 → 主窗口的中转站
 *
 * ## 为什么需要这一层
 *
 * 主窗口的页面是 keep-alive 的 —— **没访问过的页面根本没有挂载**，
 * 监听器不存在，主进程那条消息就被静默丢弃，用户看到的是
 * 「在岛上点了一条笔记，回主窗口什么也没发生」。
 *
 * 所以做成「App 层永远监听 → 存进 pending → 页面挂载时补取」：
 *   - 已挂载（常见情况）：立即收到
 *   - 未挂载：先 navigate 过去，页面挂载时 takeIslandOpenNote() 取走
 */
let pendingRelPath: string | null = null;
const listeners = new Set<(relPath: string) => void>();

/** App 收到 IPC 后调用：记下要打开哪一篇，并立刻通知已挂载的页面 */
export function pushIslandOpenNote(relPath: string): void {
  if (!relPath) return;
  pendingRelPath = relPath;
  listeners.forEach((listener) => listener(relPath));
}

/**
 * 取走并清空 pending
 *
 * 必须取走而不是读：同一篇只该被消费一次，否则组件重渲染时会重复打开
 */
export function takeIslandOpenNote(): string | null {
  const value = pendingRelPath;
  pendingRelPath = null;
  return value;
}

/**
 * 页面侧消费「打开某篇笔记」的请求
 *
 * 挂载时先补取一次（覆盖「唤起时页面还没挂载」），再订阅后续事件。
 * effect 依赖留空是刻意的：handler 若随渲染变化，重跑 effect 会重复取一次。
 */
export function useIslandOpenNote(handler: (relPath: string) => void): void {
  useEffect(() => {
    const initial = takeIslandOpenNote();
    if (initial) handler(initial);
    const listener = (relPath: string) => handler(relPath);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
