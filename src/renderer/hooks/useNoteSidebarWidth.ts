import { useCallback } from "react";
import {
  NOTE_SIDEBAR_DEFAULT_WIDTH,
  NOTE_SIDEBAR_MAX_WIDTH,
  NOTE_SIDEBAR_MIN_WIDTH,
} from "@/components/Note/layout";
import { usePanelWidth } from "@/hooks/usePanelWidth";

const WIDTH_KEY = "qnote-notes-sidebar-width";

/**
 * 笔记页文件树的宽度偏好
 *
 * 读写、钳制、兜底收缩这几件事已经由 usePanelWidth 统一处理，
 * 这里只提供笔记页自己的 key 与上下限。
 *
 * 为什么要持久化：笔记页是 keep-alive 的，切标签不会卸载，
 * 所以「切走再切回来」这一种情况靠组件 state 就够了；
 * 但应用重启后宽度回到 288、和用户上次调过的不一致，仍然会被当成 bug。
 * 落 localStorage 连重启也一并保持。
 */
export function useNoteSidebarWidth(): {
  width: number;
  /** 外部传入的当前上限（随窗口尺寸变化），内部再做一次钳制 */
  setWidth: (width: number, maxWidth?: number) => void;
  resetWidth: () => void;
} {
  const { width, setWidth, resetWidth } = usePanelWidth({
    storageKey: WIDTH_KEY,
    defaultWidth: NOTE_SIDEBAR_DEFAULT_WIDTH,
    minWidth: NOTE_SIDEBAR_MIN_WIDTH,
    maxWidth: NOTE_SIDEBAR_MAX_WIDTH,
  });

  const setWidthWithLimit = useCallback(
    (next: number, limitMax?: number) => setWidth(next, limitMax),
    [setWidth]
  );

  const resetWidthToDefault = useCallback(() => resetWidth(), [resetWidth]);

  return { width, setWidth: setWidthWithLimit, resetWidth: resetWidthToDefault };
}
