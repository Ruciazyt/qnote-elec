
const CJK_RANGE =
  /[぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯　-〿]/;

const PER_MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateTextTokens(text: string): number {
  if (!text) return 0;

  let cjkChars = 0;
  let otherChars = 0;
  let digitChars = 0;

  for (const ch of text) {
    if (CJK_RANGE.test(ch)) {
      cjkChars += 1;
    } else if (ch >= '0' && ch <= '9') {
      digitChars += 1;
    } else {
      otherChars += 1;
    }
  }

  const cjkTokens = cjkChars / 1.5;
  const otherTokens = otherChars / 4;
  const digitTokens = digitChars / 2;

  return Math.ceil(cjkTokens + otherTokens + digitTokens);
}

export function estimateMessagesTokens(
  messages: Array<{ role?: string; content: string }>
): number {
  let total = 0;
  for (const msg of messages) {
    total +=
      PER_MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(msg.content ?? '');
  }
  return total;
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const headChars = Math.floor(maxChars * 0.6);
  const tailChars = maxChars - headChars;
  const omitted = text.length - maxChars;

  return (
    text.slice(0, headChars) +
    `\n…（中间省略 ${omitted} 字）…\n` +
    text.slice(text.length - tailChars)
  );
}