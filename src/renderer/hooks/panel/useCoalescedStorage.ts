import { useCallback, useEffect, useRef } from "react";


const COALESCE_MS = 150;

export function useCoalescedStorage(key: string, value: string): void {
  const valueRef = useRef(value);
  valueRef.current = value;

  const writtenRef = useRef(false);
  const lastChangeWriteAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    }
  }, []);

  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      writtenRef.current = false;
      lastChangeWriteAtRef.current = 0;
    }

    if (!writtenRef.current) {
      write();
      return;
    }

    if (lastChangeWriteAtRef.current === 0) {
      lastChangeWriteAtRef.current = Date.now();
      write();
      return;
    }

    const elapsed = Date.now() - lastChangeWriteAtRef.current;
    if (elapsed >= COALESCE_MS) {
      lastChangeWriteAtRef.current = Date.now();
      write();
      return;
    }

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastChangeWriteAtRef.current = Date.now();
      write();
    }, COALESCE_MS - elapsed);
  }, [key, value, write]);

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
