import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  ASSET_DIR,
  NOTE_TYPES,
  NoteContent,
  NoteFileEntry,
  NoteTreeNode,
  NoteType,
} from "../../../shared/notes/noteTypes";
import {
  detectNoteType,
  getExt,
  getNoteTypeMeta,
  isCreatableNoteType,
  isNoteFile,
} from "./nativeNotes";
import { log } from "../system/log";

const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/;

function emptyNoteContent(type: NoteType): string {
  switch (type) {
    case "excalidraw":
      return JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "qnote",
        elements: [],
        appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
        files: {},
      });
    case "html":
      return '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8" />\n</head>\n<body></body>\n</html>\n';
    default:
      return "";
  }
}

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const MIME_TO_EXT: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
};

const HTML_SRC_RE = /\bsrc\s*=\s*(["'])([^"']*)\1/gi;

const CHILDREN_LIMIT = 2000;

export interface ScanBudget {
  maxDirs?: number;
  maxFiles?: number;
  deadlineMs?: number;
}

export class NoteStore {
  private resolveSafe(root: string, relPath: string): string {
    const base = path.resolve(root);
    const target = path.resolve(base, relPath);
    const rel = path.relative(base, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`非法的笔记路径: ${relPath}`);
    }
    return target;
  }

  static joinRel(parentRel: string, name: string): string {
    return parentRel ? `${parentRel}/${name}` : name;
  }

  static baseName(relPath: string): string {
    const idx = relPath.lastIndexOf("/");
    return idx === -1 ? relPath : relPath.slice(idx + 1);
  }

  private makeFileNode(
    root: string,
    relPath: string,
    stat: fs.Stats
  ): Extract<NoteTreeNode, { kind: "file" }> | null {
    const name = NoteStore.baseName(relPath);
    const type = detectNoteType(name);
    if (!type) return null;
    return {
      kind: "file",
      name,
      relPath,
      path: path.join(root, relPath),
      type,
      ext: getExt(name),
      size: stat.size,
      mtime: stat.mtimeMs,
    };
  }

  async listChildren(
    root: string,
    relDir: string,
    limit = CHILDREN_LIMIT
  ): Promise<NoteTreeNode[]> {
    let dirents: fs.Dirent[];
    try {
      const abs = this.resolveSafe(root, relDir || ".");
      dirents = await fs.promises.readdir(abs, { withFileTypes: true });
    } catch (err) {
      log.error(`读取笔记目录失败: ${relDir || "/"}`, err);
      return [];
    }

    const folders: NoteTreeNode[] = [];
    const files: Extract<NoteTreeNode, { kind: "file" }>[] = [];

    for (const dirent of dirents) {
      if (limit > 0 && folders.length + files.length >= limit) break;
      if (dirent.name.startsWith(".")) continue;
      if (!relDir && dirent.name === ASSET_DIR) continue;

      const relPath = NoteStore.joinRel(relDir, dirent.name);

      try {
        if (dirent.isDirectory()) {
          folders.push({ kind: "folder", name: dirent.name, relPath, children: [] });
          continue;
        }
        if (!dirent.isFile()) continue;
        if (!detectNoteType(dirent.name)) continue;

        const stat = await fs.promises.stat(path.join(root, relPath));
        const node = this.makeFileNode(root, relPath, stat);
        if (node) files.push(node);
      } catch (err) {
        log.warn?.(`跳过无法读取的条目: ${relPath}`, err);
      }
    }

    folders.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    files.sort((a, b) => b.mtime - a.mtime);
    return [...folders, ...files];
  }

  async scanFiles(
    root: string,
    budget: ScanBudget = {}
  ): Promise<Extract<NoteTreeNode, { kind: "file" }>[]> {
    const maxDirs = budget.maxDirs ?? 500;
    const maxFiles = budget.maxFiles ?? 2000;
    const deadline = Date.now() + (budget.deadlineMs ?? 2000);

    const out: Extract<NoteTreeNode, { kind: "file" }>[] = [];
    const queue: string[] = [""];
    let visited = 0;

    while (queue.length > 0 && visited < maxDirs && out.length < maxFiles) {
      if (Date.now() >= deadline) break;
      const relDir = queue.shift() as string;
      visited += 1;

      let dirents: fs.Dirent[];
      try {
        dirents = await fs.promises.readdir(this.resolveSafe(root, relDir || "."), {
          withFileTypes: true,
        });
      } catch {
        continue;
      }

      for (const dirent of dirents) {
        if (out.length >= maxFiles || Date.now() >= deadline) break;
        if (dirent.name.startsWith(".")) continue;
        if (!relDir && dirent.name === ASSET_DIR) continue;

        const relPath = NoteStore.joinRel(relDir, dirent.name);
        try {
          if (dirent.isDirectory()) {
            queue.push(relPath);
            continue;
          }
          if (!dirent.isFile()) continue;
          if (!detectNoteType(dirent.name)) continue;

          const stat = await fs.promises.stat(path.join(root, relPath));
          const node = this.makeFileNode(root, relPath, stat);
          if (node) out.push(node);
        } catch {
          continue;
        }
      }
    }

    return out;
  }

  async countByType(root: string, budget: ScanBudget = {}): Promise<Record<NoteType, number>> {
    const maxDirs = budget.maxDirs ?? 5000;
    const maxFiles = budget.maxFiles ?? 50000;
    const deadline = Date.now() + (budget.deadlineMs ?? 3000);

    const byType = {} as Record<NoteType, number>;
    for (const { type } of NOTE_TYPES) byType[type] = 0;

    const queue: string[] = [""];
    let visited = 0;
    let counted = 0;

    while (queue.length > 0 && visited < maxDirs && counted < maxFiles) {
      if (Date.now() >= deadline) break;
      const relDir = queue.shift() as string;
      visited += 1;

      let dirents: fs.Dirent[];
      try {
        dirents = await fs.promises.readdir(this.resolveSafe(root, relDir || "."), {
          withFileTypes: true,
        });
      } catch {
        continue;
      }

      for (const dirent of dirents) {
        if (counted >= maxFiles || Date.now() >= deadline) break;
        if (dirent.name.startsWith(".")) continue;
        if (!relDir && dirent.name === ASSET_DIR) continue;

        if (dirent.isDirectory()) {
          queue.push(NoteStore.joinRel(relDir, dirent.name));
          continue;
        }
        if (!dirent.isFile()) continue;

        const type = detectNoteType(dirent.name);
        if (!type) continue;
        byType[type] += 1;
        counted += 1;
      }
    }

    return byType;
  }

  read(root: string, relPath: string): NoteContent {
    const abs = this.resolveSafe(root, relPath);
    const name = NoteStore.baseName(relPath);
    const type = detectNoteType(name);
    if (!type) throw new Error(`不支持的笔记类型: ${relPath}`);

    if (type === "image") {
      const mime = MIME_BY_EXT[getExt(name)] ?? "image/png";
      const base64 = fs.readFileSync(abs).toString("base64");
      return { type, name, dataUrl: `data:${mime};base64,${base64}` };
    }

    if (type === "pdf") {
      throw new Error(`PDF 不通过正文通道读取: ${relPath}`);
    }

    return { type, name, text: fs.readFileSync(abs, "utf-8") };
  }

  writeText(root: string, relPath: string, text: string): boolean {
    try {
      const abs = this.resolveSafe(root, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text, "utf-8");
      return true;
    } catch (err) {
      log.error(`保存笔记失败: ${relPath}`, err);
      return false;
    }
  }

  writeBinary(root: string, relPath: string, data: Buffer): boolean {
    try {
      const abs = this.resolveSafe(root, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, data);
      return true;
    } catch (err) {
      log.error(`保存图片笔记失败: ${relPath}`, err);
      return false;
    }
  }

  allocateImageName(root: string, parentRel: string, ext: string, now = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    let candidate = NoteStore.joinRel(parentRel, `图片-${stamp}${ext}`);
    let n = 2;
    while (fs.existsSync(this.resolveSafe(root, candidate))) {
      candidate = NoteStore.joinRel(parentRel, `图片-${stamp}-${n}${ext}`);
      n += 1;
    }
    return candidate;
  }

  createFolder(root: string, parentRel: string, name: string): boolean {
    try {
      const rel = NoteStore.joinRel(parentRel, name);
      const abs = this.resolveSafe(root, rel);
      if (fs.existsSync(abs)) return false;
      fs.mkdirSync(abs, { recursive: true });
      return true;
    } catch (err) {
      log.error(`新建文件夹失败: ${parentRel}/${name}`, err);
      return false;
    }
  }

  private allocateUniqueRel(root: string, relPath: string): string {
    if (!fs.existsSync(this.resolveSafe(root, relPath))) return relPath;

    const dir = path.posix.dirname(relPath);
    const base = path.posix.basename(relPath);
    const ext = path.posix.extname(base);
    const stem = base.slice(0, base.length - ext.length);

    for (let n = 2; n < 200; n += 1) {
      const candidate = path.posix.join(dir === "." ? "" : dir, `${stem}-${n}${ext}`);
      if (!fs.existsSync(this.resolveSafe(root, candidate))) return candidate;
    }
    return relPath;
  }

  createNoteFile(
    root: string,
    parentRel: string,
    rawName: string,
    type: NoteType
  ): { ok: true; relPath: string } | { ok: false; reason: string } {
    const name = rawName.trim();
    if (!name) return { ok: false, reason: "文件名不能为空" };
    if (!isCreatableNoteType(type)) {
      return { ok: false, reason: `${getNoteTypeMeta(type).label}类型不支持新建空白文件` };
    }
    if (ILLEGAL_NAME_CHARS.test(name)) {
      return { ok: false, reason: "文件名含有非法字符（/ \\ : * ? \" < > |）" };
    }
    const safeName = name.replace(/^((?:[\s\S]*[^. ])?)[. ]+$/, "$1");
    if (!safeName) return { ok: false, reason: "文件名不能为空" };

    const typedExt = getExt(safeName);
    const stem = typedExt && isNoteFile(safeName) ? safeName.slice(0, -typedExt.length) : safeName;
    const fileName = stem + getNoteTypeMeta(type).defaultExt;

    const rel = NoteStore.joinRel(parentRel, fileName);
    try {
      const uniqueRel = this.allocateUniqueRel(root, rel);
      const abs = this.resolveSafe(root, uniqueRel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, emptyNoteContent(type), "utf-8");
      return { ok: true, relPath: uniqueRel };
    } catch (err) {
      log.error(`新建笔记失败: ${parentRel}/${fileName}`, err);
      return { ok: false, reason: "写入失败，请检查笔记目录权限" };
    }
  }

  countChildren(root: string, relPath: string): number {
    try {
      const abs = this.resolveSafe(root, relPath);
      if (!fs.existsSync(abs)) return 0;
      return fs.readdirSync(abs).length;
    } catch {
      return 0;
    }
  }

  delete(root: string, relPath: string): boolean {
    try {
      const abs = this.resolveSafe(root, relPath);
      if (!fs.existsSync(abs)) return false;
      fs.unlinkSync(abs);
      return true;
    } catch (err) {
      log.error(`删除笔记失败: ${relPath}`, err);
      return false;
    }
  }

  deleteFolder(root: string, relPath: string): boolean {
    try {
      const abs = this.resolveSafe(root, relPath);
      if (!fs.existsSync(abs)) return false;
      if (!fs.statSync(abs).isDirectory()) return false;
      fs.rmSync(abs, { recursive: true, force: true });
      return true;
    } catch (err) {
      log.error(`删除文件夹失败: ${relPath}`, err);
      return false;
    }
  }

  rename(root: string, oldRel: string, newName: string): boolean {
    try {
      const oldAbs = this.resolveSafe(root, oldRel);
      if (!fs.existsSync(oldAbs)) return false;

      const parentRel = oldRel.includes("/") ? oldRel.slice(0, oldRel.lastIndexOf("/")) : "";
      const newRel = NoteStore.joinRel(parentRel, newName);
      const newAbs = this.resolveSafe(root, newRel);
      if (newAbs === oldAbs) return true;
      if (fs.existsSync(newAbs)) throw new Error(`已存在同名条目: ${newName}`);

      if (fs.statSync(oldAbs).isFile() && !detectNoteType(newName)) {
        throw new Error(`不支持的笔记类型: ${newName}`);
      }

      fs.renameSync(oldAbs, newAbs);
      return true;
    } catch (err) {
      log.error(`重命名失败: ${oldRel} → ${newName}`, err);
      return false;
    }
  }

  isValidFolderName(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    return !/[\\/:*?"<>|]/.test(trimmed) && trimmed !== "." && trimmed !== "..";
  }

  stat(root: string, relPath: string): NoteFileEntry | null {
    try {
      const name = NoteStore.baseName(relPath);
      const type = detectNoteType(name);
      if (!type) return null;
      const abs = this.resolveSafe(root, relPath);
      if (!fs.existsSync(abs)) return null;
      const st = fs.statSync(abs);
      if (!st.isFile()) return null;
      return {
        name,
        relPath,
        path: abs,
        type,
        ext: getExt(name),
        size: st.size,
        mtime: st.mtimeMs,
      };
    } catch (err) {
      log.error(`读取笔记信息失败: ${relPath}`, err);
      return null;
    }
  }

  listByType(root: string, type: NoteType): Promise<NoteFileEntry[]> {
    return this.scanFiles(root).then((files) =>
      files
        .filter((n) => n.type === type)
        .map((n) => ({
          name: n.name,
          relPath: n.relPath,
          path: n.path,
          type: n.type,
          ext: n.ext,
          size: n.size,
          mtime: n.mtime,
        }))
    );
  }


  static relativeFrom(noteRelPath: string, targetRel: string): string {
    const noteDir = noteRelPath.includes("/")
      ? noteRelPath.slice(0, noteRelPath.lastIndexOf("/"))
      : "";
    return path.posix.relative(noteDir || ".", targetRel);
  }

  saveAssetFromDataUrl(root: string, dataUrl: string): string | null {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl.trim());
    if (!match) return null;

    const mime = match[1];
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0) return null;

    const ext = MIME_TO_EXT[mime] ?? ".png";
    const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    const rel = NoteStore.joinRel(ASSET_DIR, `${hash}${ext}`);

    try {
      const abs = this.resolveSafe(root, rel);
      if (!fs.existsSync(abs)) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, buffer);
      }
      return rel;
    } catch (err) {
      log.error("保存图片资源失败", err);
      return null;
    }
  }

  private readAssetAsDataUrl(root: string, relPath: string): string | null {
    try {
      const abs = this.resolveSafe(root, relPath);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
      const mime = MIME_BY_EXT[getExt(relPath)] ?? "image/png";
      return `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
    } catch {
      return null;
    }
  }


  static deriveNoteName(content: string): string {
    const firstLine =
      content.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
    let base = firstLine
      .replace(/^[\s>#*\-+\d.、)】\]}]+/, "")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/[*_~`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    base = base.replace(/[\\/:*?"<>|]/g, "").trim();
    if (base.length > 40) base = base.slice(0, 40).trim();
    return `${base || "剪贴板"}.md`;
  }

  saveNoteFromClipboard(
    root: string,
    type: "text" | "image",
    content: string
  ): NoteFileEntry | null {
    const raw = (content ?? "").trim();
    if (!raw) return null;

    try {
      let rel: string;

      if (type === "image") {
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(raw);
        if (!match) return null;
        const ext = MIME_TO_EXT[match[1]] ?? ".png";
        rel = this.allocateImageName(root, "", ext);
        if (!this.writeBinary(root, rel, Buffer.from(match[2], "base64"))) return null;
      } else {
        rel = NoteStore.deriveNoteName(raw);
        if (!this.writeMarkdownWithAssets(root, rel, raw)) return null;
      }

      return this.stat(root, rel);
    } catch (err) {
      log.error("剪贴板存为笔记失败", err);
      return null;
    }
  }

  private rewriteAssetRefs(oldRel: string, newRel: string, markdown: string): string {
    const oldDir = oldRel.includes("/") ? oldRel.slice(0, oldRel.lastIndexOf("/")) : "";
    return markdown.replace(MD_IMAGE_RE, (whole, alt: string, src: string, title?: string) => {
      if (/^(https?:|data:)/i.test(src)) return whole;
      try {
        const rootRelative = path.posix.normalize(path.posix.join(oldDir || ".", src));
        if (rootRelative.startsWith("..")) return whole;
        return `![${alt}](${NoteStore.relativeFrom(newRel, rootRelative)}${title ?? ""})`;
      } catch {
        return whole;
      }
    });
  }

  move(
    root: string,
    fromRel: string,
    toFolderRel: string
  ): { ok: true } | { ok: false; reason: string } {
    try {
      if (!fromRel) return { ok: false, reason: "没有可移动的条目" };
      if (fromRel === toFolderRel) return { ok: true };

      const fromAbs = this.resolveSafe(root, fromRel);
      if (!fs.existsSync(fromAbs)) return { ok: false, reason: "源条目已不存在" };

      const isDir = fs.statSync(fromAbs).isDirectory();

      const toAbs = this.resolveSafe(root, toFolderRel || ".");
      if (toFolderRel && !fs.existsSync(toAbs)) {
        return { ok: false, reason: "目标文件夹已不存在" };
      }
      if (!fs.statSync(toAbs).isDirectory()) {
        return { ok: false, reason: "目标不是文件夹" };
      }

      if (isDir && (toFolderRel === fromRel || toFolderRel.startsWith(`${fromRel}/`))) {
        return { ok: false, reason: "不能把文件夹移动到它自己或它的子文件夹中" };
      }

      const name = NoteStore.baseName(fromRel);
      const destRel = NoteStore.joinRel(toFolderRel, name);
      if (destRel === fromRel) return { ok: true };

      if (fs.existsSync(this.resolveSafe(root, destRel))) {
        return { ok: false, reason: `目标文件夹下已存在「${name}」` };
      }

      const isMarkdownFile = !isDir && /\.md(own)?$/i.test(name);
      const rewritten = isMarkdownFile
        ? this.rewriteAssetRefs(fromRel, destRel, fs.readFileSync(fromAbs, "utf-8"))
        : null;

      const destAbs = this.resolveSafe(root, destRel);
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.renameSync(fromAbs, destAbs);

      if (rewritten !== null) {
        try {
          fs.writeFileSync(destAbs, rewritten, "utf-8");
        } catch (err) {
          log.error(`移动后重写图片引用失败: ${destRel}`, err);
        }
      }
      return { ok: true };
    } catch (err) {
      log.error(`移动失败: ${fromRel} → ${toFolderRel}`, err);
      return { ok: false, reason: "移动失败，可能是权限或文件被占用" };
    }
  }

  resolveForShell(root: string, relPath: string): string {
    return this.resolveSafe(root, relPath || ".");
  }

  readMarkdownWithAssets(root: string, relPath: string): string {
    const abs = this.resolveSafe(root, relPath);
    const raw = fs.readFileSync(abs, "utf-8");

    const noteDir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";

    return raw.replace(MD_IMAGE_RE, (whole, alt: string, src: string, title?: string) => {
      if (/^(https?:|data:)/i.test(src)) return whole;
      try {
        const resolved = path.posix.normalize(path.posix.join(noteDir || ".", src));
        if (resolved.startsWith("..")) return whole;
        const dataUrl = this.readAssetAsDataUrl(root, resolved);
        if (!dataUrl) return whole;
        return `![${alt}](${dataUrl}${title ?? ""})`;
      } catch {
        return whole;
      }
    });
  }

  writeMarkdownWithAssets(root: string, relPath: string, markdown: string): boolean {
    const cleaned = markdown.replace(MD_IMAGE_RE, (whole, alt: string, src: string, title?: string) => {
      if (!src.startsWith("data:image/")) return whole;
      const assetRel = this.saveAssetFromDataUrl(root, src);
      if (!assetRel) return whole;
      const rel = NoteStore.relativeFrom(relPath, assetRel);
      return `![${alt}](${rel}${title ?? ""})`;
    });

    return this.writeText(root, relPath, cleaned);
  }


  readHtmlWithAssets(root: string, relPath: string): string {
    const abs = this.resolveSafe(root, relPath);
    const raw = fs.readFileSync(abs, "utf-8");
    const noteDir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";

    return raw.replace(HTML_SRC_RE, (whole, quote: string, src: string) => {
      const value = src.trim();
      if (!value || /^(https?:|data:|file:|blob:|#|\/)/i.test(value)) return whole;
      try {
        const resolved = path.posix.normalize(path.posix.join(noteDir || ".", value));
        if (resolved.startsWith("..")) return whole;
        const dataUrl = this.readAssetAsDataUrl(root, resolved);
        if (!dataUrl) return whole;
        return `src=${quote}${dataUrl}${quote}`;
      } catch {
        return whole;
      }
    });
  }

  writeHtmlWithAssets(root: string, relPath: string, html: string): boolean {
    const cleaned = html.replace(HTML_SRC_RE, (whole, quote: string, src: string) => {
      if (!src.startsWith("data:image/")) return whole;
      const assetRel = this.saveAssetFromDataUrl(root, src);
      if (!assetRel) return whole;
      return `src=${quote}${NoteStore.relativeFrom(relPath, assetRel)}${quote}`;
    });

    return this.writeText(root, relPath, cleaned);
  }

  static isTextNote(name: string): boolean {
    const type = detectNoteType(name);
    return type === "excalidraw" || type === "markdown" || type === "html";
  }
}
