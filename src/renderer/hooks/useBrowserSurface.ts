import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 借出内嵌浏览器表层
 *
 * 背景：网页由主进程的 WebContentsView 承载，它是 OS 合成器上的独立图层，
 * 永远画在 workbench DOM 之上 —— z-index 对它无效（和 VS Code 的 browserView
 * 面临同一个物理限制）。所以渲染层要显示自己的弹窗/下拉时，
 * 只能让原生层暂时不参与合成，也就是「借出」。
 *
 * 借出期间：网页不卸载、webContents 存活、JS 继续跑、页面状态完整保留。
 * 代价：这段时间网页看不见，浮层关闭后有一帧切换感。
 *
 * 典型用法：
 *   const overlay = useBrowserSurface();
 *   ...
 *   {overlay.borrowed && <Scrim />}
 *   <Dialog onClose={() => overlay.release()} />
 *
 * 为什么需要 scrim：view 藏起来后那块区域是透明的，鼠标事件会直接落到
 * 下面的 DOM 上。没有 scrim 的话，用户点「弹窗之外」会打到浏览器页的壳子上。
 * scrim 本身在 DOM 里，正好落在被借出的区域上，两者不冲突。
 */
export interface BrowserSurfaceOverlay {
  /** 表层当前是否被借出（用于挂载 scrim） */
  readonly borrowed: boolean;
  /** 借出表层。返回的 release 幂等，可重复调用 */
  readonly borrow: () => Promise<() => void>;
  /** 归还。传 release 得到的函数即可；不传则归还最近一次借出 */
  readonly release: () => Promise<void>;
}

export function useBrowserSurface(): BrowserSurfaceOverlay {
  const [borrowed, setBorrowed] = useState(false);
  /** 借出 token → 归还函数，保证精确配对 */
  const tokensRef = useRef<Array<{ token: number; release: () => void }>>([]);
  /** 是否已经归还过（避免 StrictMode 双调用下重复计数） */
  const releaseRef = useRef(false);

  const release = useCallback(async () => {
    if (releaseRef.current) return;
    releaseRef.current = true;

    const last = tokensRef.current.pop();
    tokensRef.current = [];
    if (last) {
      await window.electron.browserReleaseSurface(last.token);
    }
    setBorrowed(false);
  }, []);

  const borrow = useCallback(async () => {
    releaseRef.current = false;
    setBorrowed(true);
    const token = await window.electron.browserBorrowSurface();
    tokensRef.current.push({ token, release: () => void window.electron.browserReleaseSurface(token) });
    return release;
  }, [release]);

  /**
   * 兜底：组件卸载 / 路由切走时必须归还。
   * 这里不能只依赖 release()，因为组件可能在借出成功前就卸载了
   * （token 还没拿到），或者借出后没走正常关闭路径。
   * 交给主进程一次性清干净最稳妥。
   */
  useEffect(() => {
    return () => {
      void window.electron.browserReleaseAllSurfaces();
    };
  }, []);

  return { borrowed, borrow, release };
}
