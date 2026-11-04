import { useEffect, useState } from "react";

/**
 * 原生视图遮挡信号
 *
 * 内嵌浏览器的网页内容、以及应用管理的预览页，都由主进程 WebContentsView 承载。
 * 它作为原生视图永远盖在渲染进程之上，浏览器页面挂载期间，任何 fixed 定位的
 * 浮层（全局 AI 助手）都会被盖住、且无法通过 z-index 解决，只能让它主动隐藏。
 *
 * 沿用 useSidebarTabs 的同窗口 CustomEvent 广播模式，避免为此引入全局状态容器。
 */
const EVENT_NAME = "qnote-native-view-cover";

interface CoverDetail {
  covered: boolean;
}

/**
 * 当前正在遮挡的持有者
 *
 * 用集合而不是单个布尔值：持有原生视图的页面不止一个（浏览器页、应用管理页），
 * 各自只知道自己显不显示。用单一布尔值的话，两个页面的 effect 谁后跑谁说了算 ——
 * 从应用管理切到浏览器时，浏览器的"隐藏浮层"可能被应用管理页的"取消隐藏"覆盖掉，
 * 结果是网页把 AI 助手压在下面。
 *
 * 集合让每个页面只管自己那份，浮层只要在"还有人在遮挡"时保持隐藏即可。
 */
const coverOwners = new Set<string>();

function notify(): void {
  try {
    window.dispatchEvent(
      new CustomEvent<CoverDetail>(EVENT_NAME, { detail: { covered: coverOwners.size > 0 } })
    );
  } catch {
    // ignore
  }
}

/**
 * 声明某个持有者是否正在遮挡浮层
 *
 * @param covered 是否遮挡
 * @param owner 持有者标识。同一个持有者重复调用只会覆盖自己那一份，
 *               不会影响到别人。不传则用 "default"。
 */
export function setNativeViewCover(covered: boolean, owner = "default"): void {
  const before = coverOwners.size;
  if (covered) {
    coverOwners.add(owner);
  } else {
    coverOwners.delete(owner);
  }
  if (coverOwners.size !== before) notify();
}

/** 由持有原生视图的页面（浏览器页、应用管理页）在挂载/卸载时调用 */
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
