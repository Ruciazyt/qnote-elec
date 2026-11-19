import { contentHash as tsContentHash } from "../../../shared/notes/noteHash";
import {
  detectNoteType as tsDetectNoteType,
  getExt as tsGetExt,
  getNoteTypeMeta as tsGetNoteTypeMeta,
  isCreatableNoteType as tsIsCreatableNoteType,
  isFolderNode as tsIsFolderNode,
  isNoteFile as tsIsNoteFile,
  stripExt as tsStripExt,
  withDefaultExt as tsWithDefaultExt,
} from "../../../shared/notes/noteTypes";
import type { NoteTreeNode, NoteType, NoteTypeMeta } from "../../../shared/notes/noteTypes";
import {
  loadNative,
  nativeCall,
  nativeMode,
  nativePath,
  type NativeMode,
} from "../system/nativeModules";

interface NativeNotes {
  contentHash(content: string): string;
  isCreatableNoteType(type: string): boolean;
  isFolderNode(node: unknown): boolean;
  getExt(fileName: string): string;
  detectNoteType(fileName: string): NoteType | null;
  isNoteFile(fileName: string): boolean;
  stripExt(fileName: string): string;
  getNoteTypeMeta(type: string): NoteTypeMeta;
  withDefaultExt(rawName: string, type: string): string;
}

const WRAPPER = "notes-rs.cjs";

export function nativeStatus(): { loaded: boolean; path: string | null; mode: NativeMode } {
  const module = loadNative<NativeNotes>(WRAPPER);
  return { loaded: module !== null, path: nativePath(WRAPPER), mode: nativeMode() };
}

function call<T>(
  name: string,
  args: unknown[],
  fallback: () => T,
  invoke: (module: NativeNotes) => T
): T {
  return nativeCall<T, NativeNotes>(WRAPPER, name, fallback, invoke);
}

export function contentHash(content: string): string {
  return call(
    "contentHash",
    [content],
    () => tsContentHash(content),
    (module) => module.contentHash(content)
  );
}

export function isCreatableNoteType(type: NoteType): boolean {
  return call(
    "isCreatableNoteType",
    [type],
    () => tsIsCreatableNoteType(type),
    (module) => module.isCreatableNoteType(type)
  );
}

export function isFolderNode(node: NoteTreeNode): boolean {
  return call(
    "isFolderNode",
    [node],
    () => tsIsFolderNode(node),
    (module) => module.isFolderNode(node)
  );
}

export function getExt(fileName: string): string {
  return call(
    "getExt",
    [fileName],
    () => tsGetExt(fileName),
    (module) => module.getExt(fileName)
  );
}

export function detectNoteType(fileName: string): NoteType | null {
  return call(
    "detectNoteType",
    [fileName],
    () => tsDetectNoteType(fileName),
    (module) => module.detectNoteType(fileName)
  );
}

export function isNoteFile(fileName: string): boolean {
  return call(
    "isNoteFile",
    [fileName],
    () => tsIsNoteFile(fileName),
    (module) => module.isNoteFile(fileName)
  );
}

export function stripExt(fileName: string): string {
  return call(
    "stripExt",
    [fileName],
    () => tsStripExt(fileName),
    (module) => module.stripExt(fileName)
  );
}

export function getNoteTypeMeta(type: NoteType): NoteTypeMeta {
  return call(
    "getNoteTypeMeta",
    [type],
    () => tsGetNoteTypeMeta(type),
    (module) => module.getNoteTypeMeta(type)
  );
}

export function withDefaultExt(rawName: string, type: NoteType): string {
  return call(
    "withDefaultExt",
    [rawName, type],
    () => tsWithDefaultExt(rawName, type),
    (module) => module.withDefaultExt(rawName, type)
  );
}
