export interface McpCallErrorRaw {
  code?: number;
  codeText?: string;
  message?: string;
  data?: unknown;
  name?: string;
}

const MAX_CAUSE_DEPTH = 4;

export function describeMcpCallError(error: unknown): McpCallErrorRaw {
  const chain = errorChain(error);
  const innermost = chain[chain.length - 1];
  if (!innermost) return {};
  const rpc = chain.find((entry) => Number.isInteger(Reflect.get(entry, "code")));
  if (rpc) {
    const code = Reflect.get(rpc, "code") as number;
    const raw = stringField(rpc, "message") ?? "";
    const prefix = "MCP error " + code + ": ";
    return {
      code,
      message: raw.startsWith(prefix) ? raw.slice(prefix.length) : raw,
      data: Reflect.get(rpc, "data"),
    };
  }
  const codeText = chain
    .map((entry) => stringField(entry, "code"))
    .find((value) => value !== undefined);
  return {
    name: stringField(innermost, "name"),
    message: stringField(innermost, "message"),
    codeText,
  };
}

export function describeMcpCallErrorText(error: unknown): string {
  const described = describeMcpCallError(error);
  if (described.code !== undefined) {
    const suffix =
      described.data === undefined ? "" : "（数据：" + safeJson(described.data) + "）";
    return "MCP 错误 " + described.code + "：" + (described.message ?? "") + suffix;
  }
  const name = described.name ? described.name + "：" : "";
  return name + (described.message ?? "调用失败");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function errorChain(error: unknown): object[] {
  const chain: object[] = [];
  let current: unknown = error;
  while (
    current !== null &&
    typeof current === "object" &&
    chain.length < MAX_CAUSE_DEPTH
  ) {
    if (chain.includes(current)) break;
    chain.push(current);
    current = Reflect.get(current, "cause");
  }
  return chain;
}

function stringField(value: object, key: string): string | undefined {
  const field = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
}
