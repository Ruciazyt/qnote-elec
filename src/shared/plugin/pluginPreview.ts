import type { PluginPreviewSpec } from "./pluginTypes";

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

export function previewPortUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

export function parsePluginPreview(value: unknown): PluginPreviewSpec | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;

  if (source.type === "port") {
    const port = Number(source.port);
    if (!isValidPort(port)) return null;
    return { type: "port", port };
  }

  if (source.type === "url") {
    if (typeof source.url !== "string") return null;
    const url = source.url.trim();
    if (!url) return null;
    return { type: "url", url };
  }

  if (source.type === "path") {
    if (typeof source.path !== "string") return null;
    const path = source.path.trim();
    if (!path) return null;
    return { type: "path", path };
  }

  return null;
}

export function pluginPreviewAddress(spec: PluginPreviewSpec | undefined): string | undefined {
  if (!spec) return undefined;
  if (spec.type === "port") return previewPortUrl(spec.port);
  if (spec.type === "url") return spec.url;
  return undefined;
}

export function previewToDraftText(spec: PluginPreviewSpec | undefined): string {
  if (!spec) return "";
  if (spec.type === "port") return String(spec.port);
  if (spec.type === "url") return spec.url;
  return spec.path;
}

export function parseLegacyPreview(value: unknown): PluginPreviewSpec | null {
  if (typeof value === "number") {
    return isValidPort(value) ? { type: "port", port: value } : null;
  }
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (!text) return null;

  const port = parsePortText(text);
  if (port !== null) return { type: "port", port };

  if (/^https?:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      if (isLoopbackHost(parsed.hostname) && parsed.port) {
        const loopbackPort = parsePortText(parsed.port);
        if (loopbackPort !== null) return { type: "port", port: loopbackPort };
      }
    } catch {
      return { type: "url", url: text };
    }
    return { type: "url", url: text };
  }

  return { type: "path", path: text };
}

export function normalizePreviewValue(value: unknown): PluginPreviewSpec | undefined {
  return parsePluginPreview(value) ?? undefined;
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
  const runtime = source.runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return text;

  const runtimeSource = runtime as Record<string, unknown>;
  if (runtimeSource.preview === undefined) return text;

  const normalized = normalizePreviewValue(runtimeSource.preview);
  if (!normalized) return text;

  return JSON.stringify(
    { ...source, runtime: { ...runtimeSource, preview: normalized } },
    null,
    2
  );
}
