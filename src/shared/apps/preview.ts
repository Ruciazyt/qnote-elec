export type PreviewSpec =
  | { kind: "port"; port: number }
  | { kind: "url"; url: string }
  | { kind: "path"; path: string };

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

export function parsePortText(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const port = Number(trimmed);
  return isValidPort(port) ? port : null;
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

export function parsePreviewSpec(value: unknown): PreviewSpec | null {
  if (typeof value === "number") {
    return isValidPort(value) ? { kind: "port", port: value } : null;
  }
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (!text) return null;

  const port = parsePortText(text);
  if (port !== null) return { kind: "port", port };

  if (/^https?:\/\//i.test(text)) {
    let parsed: URL;
    try {
      parsed = new URL(text);
    } catch {
      return { kind: "url", url: text };
    }
    if (isLoopbackHost(parsed.hostname) && parsed.port) {
      const loopbackPort = parsePortText(parsed.port);
      if (loopbackPort !== null) return { kind: "port", port: loopbackPort };
    }
    return { kind: "url", url: text };
  }

  return { kind: "path", path: text };
}

export function previewPortUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

export function normalizePreviewValue(value: unknown): number | string | undefined {
  const spec = parsePreviewSpec(value);
  if (!spec) return undefined;
  if (spec.kind === "port") return spec.port;
  if (spec.kind === "url") return spec.url;
  return spec.path;
}

export function previewAddressOf(value: unknown): string | undefined {
  const spec = parsePreviewSpec(value);
  if (!spec) return undefined;
  if (spec.kind === "port") return previewPortUrl(spec.port);
  if (spec.kind === "url") return spec.url;
  return undefined;
}

export function previewToDraftText(value: unknown): string {
  const spec = parsePreviewSpec(value);
  if (!spec) return "";
  if (spec.kind === "port") return String(spec.port);
  if (spec.kind === "url") return spec.url;
  return spec.path;
}

export function normalizeManifestPreview(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return text;

  const source = parsed as Record<string, unknown>;
  if (source.preview === undefined) return text;

  const normalized = normalizePreviewValue(source.preview);
  if (normalized === undefined || normalized === source.preview) return text;

  return JSON.stringify({ ...source, preview: normalized }, null, 2);
}
