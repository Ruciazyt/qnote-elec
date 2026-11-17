
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function parseExternalUrl(raw: string): URL | null {
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;

  return parsed;
}

export function isAllowedExternalUrl(raw: string): boolean {
  return parseExternalUrl(raw) !== null;
}
