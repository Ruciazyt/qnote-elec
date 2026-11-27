import { getGitlabTriggerWords } from "../runtime/triggerWords";

export interface StripResult {
  text: string;
  removed: string[];
}

export interface GuardedContent {
  text: string;
  removed: string[];
  blocked: boolean;
  message?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripTriggerWords(text: string, words: string[]): StripResult {
  const removed: string[] = [];
  let out = typeof text === "string" ? text : "";
  for (const word of words ?? []) {
    const trimmed = typeof word === "string" ? word.trim() : "";
    if (!trimmed) continue;
    const pattern = new RegExp(`[ \\t]*${escapeRegExp(trimmed)}[ \\t]*`, "gi");
    if (!pattern.test(out)) continue;
    pattern.lastIndex = 0;
    out = out.replace(pattern, " ");
    removed.push(trimmed);
  }
  return { text: out.trim(), removed };
}

export function guardBotContent(text: string, label: string): GuardedContent {
  const result = stripTriggerWords(text, getGitlabTriggerWords());
  if (!result.removed.length) {
    return { text: typeof text === "string" ? text : "", removed: [], blocked: false };
  }
  if (!result.text.trim()) {
    return {
      text: "",
      removed: result.removed,
      blocked: true,
      message: `${label}内容只包含触发词（${result.removed.join("、")}），发送前检查已拦截`,
    };
  }
  return { text: result.text, removed: result.removed, blocked: false };
}
