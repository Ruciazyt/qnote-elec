/**
 * 「系统右键菜单 → 添加快捷方式」在渲染层内的中转站
 *
 * ## 为什么需要这一层，而不是让 HomePage 直接监听 IPC
 *
 * 系统右键菜单唤起时，主窗口可能正停在任意页面。而 App.tsx 用 keep-alive
 * 维护页面 —— **没访问过的页面根本没有挂载**，HomePage 的监听器不存在，
 * 这条请求就被静默丢弃，用户看到的是"点了右键菜单什么都没发生"。
 *
 * 所以做成「App 层永远监听 → 存进 pending → 页面挂载时补取」：
 *   - 已挂载（常见情况）：立即收到
 *   - 未挂载：先 navigate 到主页，页面挂载时 takeExternalAdd() 取走
 */
import { useEffect } from "react";

let pending: string | null = null;
const listeners = new Set<(target: string) => void>();

/** 外部唤起入口：App 收到 IPC 后调用 */
export function pushExternalAdd(target: string): void {
  if (!target) return;
  pending = target;
  listeners.forEach((listener) => listener(target));
}

/**
 * 取走并清空 pending
 *
 * 必须取走而不是读：同一条目标只该被消费一次，否则组件重渲染时会重复弹框
 */
export function takeExternalAdd(): string | null {
  const value = pending;
  pending = null;
  return value;
}

function subscribe(listener: (target: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 页面侧消费外部添加请求
 *
 * 挂载时先补取一次（覆盖"唤起时页面还没挂载"），再订阅后续事件。
 * effect 依赖留空是刻意的：handler 若随渲染变化，重跑 effect 会重复取一次。
 */
export function useExternalAddShortcut(handler: (target: string) => void): void {
  useEffect(() => {
    const initial = takeExternalAdd();
    if (initial) handler(initial);
    return subscribe(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
