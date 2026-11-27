const CJK_PATTERN = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_PATTERN) || []).length;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

export function truncateByTokens(
  text: string,
  maxTokens: number
): { text: string; truncated: boolean; estimatedTokens: number } {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) {
    return { text, truncated: false, estimatedTokens: estimated };
  }
  const ratio = maxTokens / estimated;
  const keep = Math.max(200, Math.floor(text.length * ratio));
  return { text: text.slice(0, keep), truncated: true, estimatedTokens: estimated };
}

export function pickKeywordLines(
  lines: string[],
  keywords: string[],
  limit: number
): string[] {
  const picked: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (keywords.some((keyword) => lower.includes(keyword.toLowerCase()))) {
      picked.push(line);
      if (picked.length >= limit) break;
    }
  }
  return picked;
}
