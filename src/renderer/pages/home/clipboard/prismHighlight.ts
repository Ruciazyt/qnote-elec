import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";

interface HighlightState {
  lang: string;
  source: string;
}

const highlightStates = new WeakMap<HTMLElement, HighlightState>();

export function highlightClipboardCodes(container: HTMLElement | null): void {
  if (!container) return;
  const codes = container.querySelectorAll<HTMLElement>("code[data-prism-lang]");
  codes.forEach((code) => {
    const lang = code.dataset.prismLang ?? "";
    if (!lang) return;
    const source = code.textContent ?? "";
    const previous = highlightStates.get(code);
    if (previous && previous.lang === lang && previous.source === source) return;
    highlightStates.set(code, { lang, source });
    Prism.highlightElement(code, false);
  });
}
