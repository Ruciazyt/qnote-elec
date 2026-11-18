export interface McpContentItem {
  type: string;
  text?: string;
  resource?: unknown;
  mimeType?: string;
  data?: string;
  uri?: string;
  name?: string;
}

export interface McpToolResult {
  content?: McpContentItem[];
  isError?: boolean;
  structuredContent?: unknown;
}

export function formatToolResult(result: McpToolResult): string {
  const parts: string[] = [];
  for (const item of result.content ?? []) {
    const rendered = renderContentItem(item);
    if (rendered) parts.push(rendered);
  }
  if (parts.length === 0 && result.structuredContent !== undefined) {
    parts.push(safeJson(result.structuredContent));
  }
  const body = parts.join("\n");
  if (result.isError) {
    return `调用失败：${body || "（无输出）"}`;
  }
  return body || "（无输出）";
}

function renderContentItem(item: McpContentItem): string {
  if (item.type === "text" && item.text) return item.text;
  if (item.type === "resource" && item.resource !== undefined) {
    return safeJson(item.resource);
  }
  if (item.type === "image") {
    const size = item.data ? Math.floor((item.data.length * 3) / 4) : 0;
    return `[图片 ${item.mimeType || "未知类型"}${size ? `，约 ${size} 字节` : ""}]`;
  }
  if (item.type === "audio") {
    const size = item.data ? Math.floor((item.data.length * 3) / 4) : 0;
    return `[音频 ${item.mimeType || "未知类型"}${size ? `，约 ${size} 字节` : ""}]`;
  }
  if (item.type === "resource_link") {
    const label = item.name || item.uri || "资源";
    return `[资源链接：${label}${item.uri && item.name ? ` (${item.uri})` : ""}]`;
  }
  return "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}
