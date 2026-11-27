const DEFAULT_TRIGGER_WORDS = ["@qnote"];

let words: string[] = [...DEFAULT_TRIGGER_WORDS];

export function setGitlabTriggerWords(next: string[]): void {
  const cleaned = (next ?? [])
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  words = cleaned.length ? cleaned : [...DEFAULT_TRIGGER_WORDS];
}

export function getGitlabTriggerWords(): string[] {
  return [...words];
}
