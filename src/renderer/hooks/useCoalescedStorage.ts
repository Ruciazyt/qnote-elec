import { useCallback, useEffect, useRef } from "react";

/**
 * 合并写盘：连续变化只落盘一次
 *
 * ## 为什么需要它
 *
 * localStorage.setItem 是**同步**调用 —— 在 Chromium 里它要走一次到浏览器进程的
 * 同步 IPC，写在主线程上。拖一次分割线会连着来几十上百次「值变了」，
 * 每次都同步写一次盘，就是在拖拽的每一帧里插一段阻塞 IO。
 *
 * 拖拽结束时写一次就够了，中间那些值用户根本看不见。
 *
 * ## 口径
 *
 * | 情形 | 行为 |
 * | --- | --- |
 * | 首次挂载 | 立刻写（保证 key 一开始就存在） |
 * | 距上次**变化**写盘超过 150ms | 立刻写（这是一次性改动，比如按一下方向键） |
 * | 距上次写盘不到 150ms | 推迟到这一轮变化结束（150ms 窗口的尾巴）写一次 |
 * | 组件卸载 / 页面退出 | 把待写的那一次补上，值不丢 |
 *
 * 「距上次**变化**写盘」而不是「距上次写盘」：挂载时那一次写盘不算数，
 * 否则页面刚打开就按方向键，写盘会被推迟 150ms 才落下去。
 */

/** 合并窗口：小于这个间隔的变化视为「同一轮连续变化」 */
const COALESCE_MS = 150;

export function useCoalescedStorage(key: string, value: string): void {
  /** 最新值 —— 写盘时读它，保证写出去的一定是最后那个值 */
  const valueRef = useRef(value);
  valueRef.current = value;

  /** 这个 key 写过一次没有 —— 决定要不要立刻写 */
  const writtenRef = useRef(false);
  /** 上一次「因变化而写盘」的时刻；0 = 还没有过 */
  const lastChangeWriteAtRef = useRef(0);
  /** 待执行的写盘定时器 */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 当前写入的 key —— 换 key 时要立刻写一次，不能沿用上一轮的节流窗口 */
  const keyRef = useRef(key);

  const write = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    writtenRef.current = true;
    try {
      localStorage.setItem(keyRef.current, valueRef.current);
    } catch {
      // localStorage 不可用时静默降级为「仅本次会话有效」
    }
  }, []);

  useEffect(() => {
    // 换 key 了：上一次写的不是这个 key，节流窗口也不该继续沿用
    if (keyRef.current !== key) {
      keyRef.current = key;
      writtenRef.current = false;
      lastChangeWriteAtRef.current = 0;
    }

    // 首次挂载：直接写，保证 key 一开始就存在
    if (!writtenRef.current) {
      write();
      return;
    }

    // 还没有过一次「因变化而写盘」：这次就是第一次变化，直接写
    // （页面刚打开就按方向键时走的就是这条，值立刻落盘）
    if (lastChangeWriteAtRef.current === 0) {
      lastChangeWriteAtRef.current = Date.now();
      write();
      return;
    }

    const elapsed = Date.now() - lastChangeWriteAtRef.current;
    if (elapsed >= COALESCE_MS) {
      // 距上次写盘够久了 —— 这次是一次性改动，直接写
      lastChangeWriteAtRef.current = Date.now();
      write();
      return;
    }

    // 还在同一轮连续变化里（拖拽）：推迟到这一轮结束时写一次。
    //
    // 这里**故意不**在 effect 的清理函数里清定时器 ——
    // 组件卸载时让定时器照常触发，正好把最后那个值补写上去。
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastChangeWriteAtRef.current = Date.now();
      write();
    }, COALESCE_MS - elapsed);
  }, [key, value, write]);

  // 页面退出 / 窗口关闭：把待写的那一次立刻补上
  //
  // 定时器本身也够用（它会照常触发），但进程被杀时定时器可能来不及跑 ——
  // 这两个事件是给「用户刚拖完就关掉应用」兜底的。
  useEffect(() => {
    const flush = () => {
      if (timerRef.current === null) return;
      lastChangeWriteAtRef.current = Date.now();
      write();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [write]);
}
