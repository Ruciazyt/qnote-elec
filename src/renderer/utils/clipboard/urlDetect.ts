
const WRAPPERS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
  ["<", ">"],
  ["【", "】"],
];

function stripWrapping(text: string): string {
  let out = text;
  for (const [open, close] of WRAPPERS) {
    if (out.length >= 2 && out.startsWith(open) && out.endsWith(close)) {
      out = out.slice(open.length, out.length - close.length).trim();
    }
  }
  return out;
}

const BARE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

export function detectUrl(raw: string): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/[\r\n]/.test(trimmed)) return null;

  const candidate = stripWrapping(trimmed);
  if (!candidate) return null;

  const withScheme = /^https?:\/\//i.test(candidate)
    ? candidate
    : BARE_HOST.test(candidate)
      ? `https://${candidate}`
      : null;
  if (!withScheme) return null;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") return null;

  return parsed.toString();
}

export function isWebUrl(raw: string): boolean {
  return detectUrl(raw) !== null;
}
