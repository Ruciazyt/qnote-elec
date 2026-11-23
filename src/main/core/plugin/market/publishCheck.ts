import { parseManifestJson } from "./marketVersion";

export type PublishIssueField = "preview" | "env" | "network";

export interface PublishIssue {
  field: PublishIssueField;
  key: string;
  value: string;
  message: string;
}

export interface PublishCheckResult {
  ok: boolean;
  issues: PublishIssue[];
  message: string;
}

const SCHEME_CHAR = /[a-z0-9+.-]/i;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/i;
const URL_DELIMITER = /[\s"'`<>]/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_BRACKETED = /^\[[0-9a-f:.]+\]$/i;

export function isIpLiteralHost(host: string): boolean {
  const text = String(host ?? "").trim().toLowerCase();
  if (!text) return false;

  if (text.startsWith("[")) {
    if (!IPV6_BRACKETED.test(text)) return false;
    return text.slice(1, -1).includes(":");
  }

  if (!IPV4.test(text)) return false;
  return text.split(".").every((part) => Number(part) <= 255);
}

function hostOfAuthority(authority: string): string {
  const at = authority.lastIndexOf("@");
  const hostAndPort = (at === -1 ? authority : authority.slice(at + 1)).split(
    /[/?#]/
  )[0];
  if (hostAndPort.startsWith("[")) {
    const end = hostAndPort.indexOf("]");
    return end === -1 ? hostAndPort : hostAndPort.slice(0, end + 1);
  }
  const colon = hostAndPort.indexOf(":");
  return colon === -1 ? hostAndPort : hostAndPort.slice(0, colon);
}

export function findIpLiteralUrl(text: string): string | null {
  if (!text) return null;

  let cursor = text.indexOf("://");
  while (cursor !== -1) {
    let start = cursor;
    while (start > 0 && SCHEME_CHAR.test(text[start - 1])) start -= 1;
    const scheme = text.slice(start, cursor);

    if (SCHEME_PATTERN.test(scheme)) {
      const rest = text.slice(cursor + 3);
      const end = rest.search(URL_DELIMITER);
      const authority = end === -1 ? rest : rest.slice(0, end);
      if (isIpLiteralHost(hostOfAuthority(authority))) {
        return `${scheme}://${authority}`;
      }
    }

    cursor = text.indexOf("://", cursor + 3);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function findIpLiteralIssues(manifestText: string): PublishIssue[] {
  const manifest = parseManifestJson(manifestText);
  if (!manifest) return [];

  const issues: PublishIssue[] = [];
  const runtime = isRecord(manifest.runtime) ? manifest.runtime : manifest;

  const preview = runtime.preview;
  const previewUrl = isRecord(preview)
    ? preview.type === "url" && typeof preview.url === "string"
      ? preview.url
      : ""
    : typeof preview === "string" && /^https?:\/\//i.test(preview)
      ? preview
      : "";
  if (previewUrl) {
    const bad = findIpLiteralUrl(previewUrl);
    if (bad) {
      issues.push({
        field: "preview",
        key: "runtime.preview.url",
        value: bad,
        message: `runtime.preview.url 指向具体 IP（${bad}）—— 公共目录前面的网关会把它拦成 403。改成 { "type": "port", "port": 端口号 } 就行。`,
      });
    }
  }

  const env = runtime.env;
  if (isRecord(env)) {
    for (const [key, value] of Object.entries(env)) {
      const text = typeof value === "string" ? value : String(value ?? "");
      const bad = findIpLiteralUrl(text);
      if (!bad) continue;
      issues.push({
        field: "env",
        key,
        value: bad,
        message: `runtime.env.${key} 指向具体 IP（${bad}）—— 公共目录前面的网关会把它拦成 403。改成主机名或端口号。`,
      });
    }
  }

  const capabilities = manifest.capabilities;
  const network =
    isRecord(capabilities) && Array.isArray(capabilities.network)
      ? capabilities.network
      : [];
  network.forEach((pattern, index) => {
    const text = typeof pattern === "string" ? pattern : String(pattern ?? "");
    const bad = findIpLiteralUrl(text);
    if (!bad) return;
    issues.push({
      field: "network",
      key: `capabilities.network[${index}]`,
      value: bad,
      message: `capabilities.network 第 ${index + 1} 项指向具体 IP（${bad}）—— 公共目录前面的网关会把它拦成 403。改成主机名。`,
    });
  });

  return issues;
}

export function formatPublishIssues(issues: PublishIssue[]): string {
  return issues.map((issue) => issue.message).join("\n");
}

export function checkPublishCompatibility(
  manifestText: string
): PublishCheckResult {
  const issues = findIpLiteralIssues(manifestText);
  return {
    ok: issues.length === 0,
    issues,
    message: formatPublishIssues(issues),
  };
}
