import type { PublishedAppDependency } from "../../../../shared/cloud/cloudTypes";
import { parseDependencySpec as parseStrictDependencySpec } from "../dependencies/pluginDependencies";

export interface DependencySpec {
  id: string;
  range: string;
}

export interface PublishMetadata {
  version: string;
  dependencies: PublishedAppDependency[];
}

export function parseManifestJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseDependencySpec(spec: string): DependencySpec | null {
  const parsed = parseStrictDependencySpec(spec);
  if (!parsed) return null;
  return { id: parsed.id, range: parsed.range ?? "" };
}

export function formatDependencySpec(spec: DependencySpec): string {
  return spec.range ? `${spec.id}@${spec.range}` : spec.id;
}

export function parseDependencySpecs(specs: string[]): PublishedAppDependency[] {
  const result: PublishedAppDependency[] = [];
  const seen = new Set<string>();
  for (const raw of specs ?? []) {
    const parsed = parseDependencySpec(raw);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    result.push(
      parsed.range ? { id: parsed.id, range: parsed.range } : { id: parsed.id }
    );
  }
  return result;
}

export function serializeDependencies(
  dependencies: PublishedAppDependency[]
): string {
  const list = (dependencies ?? []).filter(
    (item) => item && typeof item.id === "string" && item.id.trim()
  );
  return JSON.stringify(
    list.map((item) =>
      item.range ? { id: item.id, range: item.range } : { id: item.id }
    )
  );
}

export function parseDependencies(raw: unknown): PublishedAppDependency[] {
  if (raw === null || raw === undefined || raw === "") return [];

  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  const result: PublishedAppDependency[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const parsed = parseDependencySpec(item);
      if (parsed) {
        result.push(
          parsed.range
            ? { id: parsed.id, range: parsed.range }
            : { id: parsed.id }
        );
      }
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) continue;
    const range =
      typeof record.range === "string" ? record.range.trim() : "";
    const parsed = parseDependencySpec(range ? `${id}@${range}` : id);
    if (!parsed) continue;
    result.push(
      parsed.range ? { id: parsed.id, range: parsed.range } : { id: parsed.id }
    );
  }
  return result;
}

export function readPublishMetadata(manifestText: string): PublishMetadata {
  const manifest = parseManifestJson(manifestText);
  if (!manifest) return { version: "", dependencies: [] };

  const version =
    typeof manifest.version === "string" ? manifest.version.trim() : "";

  const declared = Array.isArray(manifest.extensionDependencies)
    ? manifest.extensionDependencies.filter(
        (item): item is string => typeof item === "string"
      )
    : [];

  return { version, dependencies: parseDependencySpecs(declared) };
}
