export type EnvLookup = (name: string) => string | undefined;

export interface ExpandResult<T> {
  ok: boolean;
  value: T;
  missing: string;
}

const VARIABLE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export function expandTemplate(
  text: string,
  lookup: EnvLookup
): ExpandResult<string> {
  const source = text ?? "";
  if (!source.includes("${")) return { ok: true, value: source, missing: "" };
  const missing: string[] = [];
  const value = source.replace(
    VARIABLE_PATTERN,
    (_match, name: string, fallback?: string) => {
      const found = lookup(name);
      if (found !== undefined && found !== "") return found;
      if (fallback !== undefined) return fallback;
      missing.push(name);
      return "";
    }
  );
  if (missing.length > 0) return { ok: false, value: "", missing: missing[0] };
  return { ok: true, value, missing: "" };
}

export function expandRecord(
  record: Record<string, string> | undefined,
  lookup: EnvLookup
): ExpandResult<Record<string, string>> {
  if (!record) return { ok: true, value: {}, missing: "" };
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    const result = expandTemplate(raw, lookup);
    if (!result.ok) return { ok: false, value: {}, missing: result.missing };
    out[key] = result.value;
  }
  return { ok: true, value: out, missing: "" };
}

export function expandArgs(
  args: string[] | undefined,
  lookup: EnvLookup
): ExpandResult<string[]> {
  if (!args || args.length === 0) return { ok: true, value: [], missing: "" };
  const out: string[] = [];
  for (const arg of args) {
    const result = expandTemplate(arg, lookup);
    if (!result.ok) return { ok: false, value: [], missing: result.missing };
    out.push(result.value);
  }
  return { ok: true, value: out, missing: "" };
}

export function createProcessEnvLookup(): EnvLookup {
  return (name: string) => process.env[name];
}
