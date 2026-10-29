export interface SplitThinkContent {
  answer: string;
  thought: string;
  hasThinkBlock: boolean;
  isThinking: boolean;
}

const THINK_OPEN_TAG = "<think>";
const THINK_CLOSE_TAG = "</think>";

function trailingPartialTagLength(value: string, tag: string): number {
  const normalizedValue = value.toLowerCase();
  const normalizedTag = tag.toLowerCase();

  for (let length = Math.min(normalizedValue.length, normalizedTag.length - 1); length > 0; length -= 1) {
    if (normalizedValue.endsWith(normalizedTag.slice(0, length))) return length;
  }

  return 0;
}

export function splitThinkContent(content: string): SplitThinkContent {
  const normalizedContent = content.toLowerCase();
  const thoughts: string[] = [];
  let answer = "";
  let position = 0;
  let isThinking = false;

  while (position < content.length) {
    const tag = isThinking ? THINK_CLOSE_TAG : THINK_OPEN_TAG;
    const tagIndex = normalizedContent.indexOf(tag, position);

    if (tagIndex === -1) {
      const remaining = content.slice(position);
      const partialTagLength = trailingPartialTagLength(remaining, tag);
      const visibleText = remaining.slice(0, remaining.length - partialTagLength);

      if (isThinking) thoughts[thoughts.length - 1] += visibleText;
      else answer += visibleText;
      break;
    }

    const visibleText = content.slice(position, tagIndex);
    if (isThinking) thoughts[thoughts.length - 1] += visibleText;
    else answer += visibleText;

    position = tagIndex + tag.length;
    isThinking = !isThinking;
    if (isThinking) thoughts.push("");
  }

  const hasThinkBlock = thoughts.length > 0;
  return {
    answer: hasThinkBlock ? answer.trim() : answer,
    thought: thoughts.map((part) => part.trim()).filter(Boolean).join("\n\n"),
    hasThinkBlock,
    isThinking,
  };
}