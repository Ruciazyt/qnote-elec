/**
 * Token 近似估算
 *
 * 为什么不用真 tokenizer：
 *   - 真正的 tokenizer（tiktoken / gpt-tokenizer）要么加依赖，要么要按 provider 分
 *   - 我们的用途只是「判断要不要压缩」，不需要精确计数
 *   - 估算偏差 20% 对压缩决策完全可接受
 *
 * 估算规则（基于 BPE 的经验值）：
 *   - 英文：约 4 字符 = 1 token
 *   - 中文/日文/韩文：约 1.5 字符 = 1 token（汉字通常 1~2 token/字）
 *   - 数字和常见符号：约 2 字符 = 1 token
 *
 * 保守起见宁可高估（宁可多压缩，也不要撑爆 context）。
 */

const CJK_RANGE =
  /[぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯　-〿]/;

/** 消息的固定结构开销（role / 分隔符 / tool_call 包装），按每条计 */
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * 估算一段文本的 token 数
 */
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

  // CJK 约 1.5 字/token，其余按类别折算
  const cjkTokens = cjkChars / 1.5;
  const otherTokens = otherChars / 4;
  const digitTokens = digitChars / 2;

  return Math.ceil(cjkTokens + otherTokens + digitTokens);
}

/**
 * 估算一组消息的 token 总数（含每条消息的结构开销）
 */
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

/**
 * 从内容里挑出最值得保留的片段（用于超长单条消息的内联截断）
 *
 * 策略：保留首尾两段（首段通常是问题、尾段通常是结论），中间省略。
 */
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