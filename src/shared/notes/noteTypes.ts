
export type NoteType = "excalidraw" | "markdown" | "image" | "html" | "pdf";

export const ASSET_DIR = "assets";

export interface NoteTypeMeta {
  type: NoteType;
  label: string;
  defaultExt: string;
}

export const NOTE_TYPES: readonly NoteTypeMeta[] = [
  { type: "excalidraw", label: "绘图", defaultExt: ".excalidraw" },
  { type: "markdown", label: "文本", defaultExt: ".md" },
  { type: "html", label: "网页", defaultExt: ".html" },
  { type: "image", label: "图片", defaultExt: ".png" },
  { type: "pdf", label: "PDF", defaultExt: ".pdf" },
] as const;

export const CREATABLE_NOTE_TYPES: readonly NoteType[] = ["excalidraw", "markdown", "html"];

export function isCreatableNoteType(type: NoteType): boolean {
  return CREATABLE_NOTE_TYPES.includes(type);
}

const EXT_TO_TYPE: Readonly<Record<string, NoteType>> = {
  ".excalidraw": "excalidraw",

  ".md": "markdown",
  ".markdown": "markdown",

  ".html": "html",
  ".htm": "html",

  ".pdf": "pdf",

  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".bmp": "image",
  ".svg": "image",
};

export interface NoteFileEntry {
  name: string;
  relPath: string;
  path: string;
  type: NoteType;
  ext: string;
  size: number;
  mtime: number;
}

export interface NoteFolderEntry {
  name: string;
  relPath: string;
  childCount: number;
}

export type NoteTreeNode =
  | ({ kind: "folder" } & NoteFolderEntry & { children: NoteTreeNode[] })
  | ({ kind: "file" } & NoteFileEntry);

export interface ExternalFolder {
  id: string;
  path: string;
  name: string;
}

export function isFolderNode(node: NoteTreeNode): node is Extract<NoteTreeNode, { kind: "folder" }> {
  return node.kind === "folder";
}


export type NoteContent =
  | { type: "excalidraw" | "markdown" | "html"; name: string; text: string }
  | { type: "image"; name: string; dataUrl: string };

export function getExt(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx <= 0) return "";
  return fileName.slice(idx).toLowerCase();
}

export function detectNoteType(fileName: string): NoteType | null {
  return EXT_TO_TYPE[getExt(fileName)] ?? null;
}

export function isNoteFile(fileName: string): boolean {
  return detectNoteType(fileName) !== null;
}

export function stripExt(fileName: string): string {
  const ext = getExt(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

export function getNoteTypeMeta(type: NoteType): NoteTypeMeta {
  return NOTE_TYPES.find((t) => t.type === type) ?? NOTE_TYPES[0];
}

export function withDefaultExt(rawName: string, type: NoteType): string {
  const trimmed = rawName.trim();
  if (!trimmed) return trimmed;
  const meta = getNoteTypeMeta(type);
  if (isNoteFile(trimmed)) return trimmed;
  return trimmed + meta.defaultExt;
}
