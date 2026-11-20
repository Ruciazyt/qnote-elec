import { useEffect, useState } from "react";

const EVENT_NAME = "qnote-native-view-cover";

interface CoverDetail {
  covered: boolean;
}

const coverOwners = new Set<string>();

function notify(): void {
  try {
    window.dispatchEvent(
      new CustomEvent<CoverDetail>(EVENT_NAME, { detail: { covered: coverOwners.size > 0 } })
    );
  } catch {
  }
}

export function setNativeViewCover(covered: boolean, owner = "default"): void {
  const before = coverOwners.size;
  if (covered) {
    coverOwners.add(owner);
  } else {
    coverOwners.delete(owner);
  }
  if (coverOwners.size !== before) notify();
}

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
