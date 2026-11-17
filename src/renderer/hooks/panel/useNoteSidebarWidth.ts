import { useCallback } from "react";
import {
  NOTE_SIDEBAR_DEFAULT_WIDTH,
  NOTE_SIDEBAR_MAX_WIDTH,
  NOTE_SIDEBAR_MIN_WIDTH,
} from "@/pages/notes/layout";
import { usePanelWidth } from "@/hooks/panel/usePanelWidth";

const WIDTH_KEY = "qnote-notes-sidebar-width";

export function useNoteSidebarWidth(): {
  width: number;
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
