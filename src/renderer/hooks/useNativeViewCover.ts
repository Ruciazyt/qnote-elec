import { useEffect, useState } from "react";

/**
 * 原生视图遮挡信号
 *
 * 内嵌浏览器的网页内容由主进程 WebContentsView 承载，它作为原生视图永远盖在
 * 渲染进程之上。浏览器页面挂载期间，任何 fixed 定位的浮层（全局 AI 助手）都会被盖住、
 * 且无法通过 z-index 解决，只能让它主动隐藏。
 *
 * 沿用 useSidebarTabs 的同窗口 CustomEvent 广播模式，避免为此引入全局状态容器。
 */
const EVENT_NAME = "qnote-native-view-cover";

interface CoverDetail {
  covered: boolean;
}

/** 由持有原生视图的页面（当前为浏览器页）在挂载/卸载时调用 */
export function setNativeViewCover(covered: boolean): void {
  try {
    window.dispatchEvent(new CustomEvent<CoverDetail>(EVENT_NAME, { detail: { covered } }));
  } catch {
    // ignore
  }
}

/** 被遮挡的浮层用它来决定是否隐藏自身 */
export function useNativeViewCover(): boolean {
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    const onCover = (e: Event) => {
      const detail = (e as CustomEvent<CoverDetail>).detail;
      setCovered(!!detail?.covered);
    };
    window.addEventListener(EVENT_NAME, onCover);
    return () => {
      window.removeEventListener(EVENT_NAME, onCover);
    };
  }, []);

  return covered;
}
