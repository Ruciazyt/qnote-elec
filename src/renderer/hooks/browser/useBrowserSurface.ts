import { useCallback, useEffect, useRef, useState } from "react";

export interface BrowserSurfaceOverlay {
  readonly borrowed: boolean;
  readonly borrow: () => Promise<() => void>;
  readonly release: () => Promise<void>;
}

export function useBrowserSurface(): BrowserSurfaceOverlay {
  const [borrowed, setBorrowed] = useState(false);
  const tokensRef = useRef<Array<{ token: number; release: () => void }>>([]);
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

  useEffect(() => {
    return () => {
      void window.electron.browserReleaseAllSurfaces();
    };
  }, []);

  return { borrowed, borrow, release };
}
