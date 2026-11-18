import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface HeadingAnchor {
  id: string;
  pos: number;
}

export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

export function normalizeAnchorId(raw: string): string {
  const trimmed = raw.trim();
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  try {
    return decodeURIComponent(withoutHash);
  } catch {
    return withoutHash;
  }
}

export function collectHeadingAnchors(doc: ProseMirrorNode): HeadingAnchor[] {
  const anchors: HeadingAnchor[] = [];
  const counters = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    const base = slugifyHeading(node.textContent);
    if (!base) return true;
    const seen = counters.get(base) ?? 0;
    counters.set(base, seen + 1);
    anchors.push({ id: seen === 0 ? base : `${base}-${seen}`, pos });
    return true;
  });
  return anchors;
}

export function findHeadingAnchor(doc: ProseMirrorNode, rawAnchor: string): HeadingAnchor | null {
  const wanted = normalizeAnchorId(rawAnchor).toLowerCase();
  if (!wanted) return null;
  for (const anchor of collectHeadingAnchors(doc)) {
    if (anchor.id.toLowerCase() === wanted) return anchor;
  }
  return null;
}
