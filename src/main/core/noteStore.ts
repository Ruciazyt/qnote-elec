import * as fs from "fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  ASSET_DIR,
  NOTE_TYPES,
  NoteContent,
  NoteFileEntry,
  NoteTreeNode,
  NoteType,
  detectNoteType,
  getExt,
  getNoteTypeMeta,
  isCreatableNoteType,
  isNoteFile,
} from "../../shared/noteTypes";
import { log } from "../utils/log";

/** 文件名里不能出现的字符（Windows 保留符号 + 路径分隔符） */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/;

/**
 * 空白笔记的初始内容。
 *
 * 各类型的「空」并不一样：
 *   - 文本（.md）：空串，编辑器会显示占位提示
 *   - 网页（.html）：给一份最小骨架，源码模式下不至于对着白屏发呆
 *   - 绘图（.excalidraw）：必须是合法的场景 JSON —— 空文件会让 loadFromBlob
 *     直接抛错，画布就停在上一篇的内容上，看起来像「新建后打开的还是旧笔记」
 */
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

/**
 * 匹配 Markdown 图片语法：`![alt](src)` 或 `![alt](src "title")`
 *
 * 只替换 src，保留 alt 和 title，这样手写标题的笔记也不会被破坏。
 * src 里不含空格和右括号 —— 带空格的路径在 Markdown 里本就该写成 <尖括号> 形式，
 * 那种写法这里不覆盖（编辑器自己插入的始终是标准形式）。
 */
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;

/** 图片扩展名 → MIME，用于拼 dataUrl */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/** MIME → 扩展名，资源文件落盘时用 */
const MIME_TO_EXT: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
};

/**
 * 匹配 HTML 里的 src 属性：`src="path"` 或 `src='path'`
 *
 * 与 Markdown 的差别：HTML 属性可以用单引号，且路径里可能带空格
 * （`src="my photo.png"` 在 HTML 里完全合法），所以这里不排除空格。
 * 只做本地相对路径的替换，http(s) / data: 原样保留。
 */
const HTML_SRC_RE = /\bsrc\s*=\s*(["'])([^"']*)\1/gi;

/** 单次递归的最大深度，防止符号链接之类的意外导致无限递归 */
const MAX_DEPTH = 12;

/**
 * 笔记文件存储层
 *
 * 笔记是纯文件制：所有类型共用一个用户自选目录，靠扩展名区分类型。
 * 这个类是该目录的唯一写入口，主进程其他模块不要直接碰 fs 操作笔记文件。
 *
 * 与旧实现的关键差别：list() 只读元数据，不读正文。
 * 旧的 read-excalidraw-files 会把目录下每个文件的完整 Buffer 一次性返回，
 * 混入图片后内存会直接被撑爆。
 *
 * 所有对外方法用 relPath（相对笔记根目录）定位条目，而不是文件名 ——
 * 支持子文件夹后同名文件可以出现在不同层级。
 */
export class NoteStore {
  /**
   * 把 relPath 解析成绝对路径，并确保结果仍在 root 之内。
   *
   * relPath 来自渲染层（IPC 可被任意内容触发），不做校验就等于
   * 允许 `../../../../Windows/System32/config` 这类路径穿越。
   */
  private resolveSafe(root: string, relPath: string): string {
    const base = path.resolve(root);
    const target = path.resolve(base, relPath);
    const rel = path.relative(base, target);
    // rel 以 ".." 开头、或是绝对路径（跨盘符）时都视为越界
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`非法的笔记路径: ${relPath}`);
    }
    return target;
  }

  /** 拼接父目录与名称，产出规范的 relPath */
  static joinRel(parentRel: string, name: string): string {
    return parentRel ? `${parentRel}/${name}` : name;
  }

  /** relPath 的最后一段（文件名或文件夹名） */
  static baseName(relPath: string): string {
    const idx = relPath.lastIndexOf("/");
    return idx === -1 ? relPath : relPath.slice(idx + 1);
  }

  /** 构造单个文件节点；不是笔记类型返回 null */
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

  /**
   * 递归列出目录树。
   *
   * 排序规则：文件夹在前按名称排，文件在后按修改时间倒序（新的在前）。
   * 单个条目读取失败（权限、被占用、读取中被删）只跳过它，不影响其余内容。
   */
  tree(root: string): NoteTreeNode[] {
    return this.readDirInto(root, "", 0);
  }

  private readDirInto(root: string, relDir: string, depth: number): NoteTreeNode[] {
    if (depth > MAX_DEPTH) return [];

    let dirents: fs.Dirent[];
    try {
      // relDir 是递归拼出来的，必须逐层过越界检查 ——
      // 直接 path.join 的话，渲染层传来的 root 就能把目录树指到任意位置
      const abs = this.resolveSafe(root, relDir || ".");
      if (!fs.existsSync(abs)) return [];
      dirents = fs.readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      log.error(`读取笔记目录失败: ${relDir || "/"}`, err);
      return [];
    }

    const folders: NoteTreeNode[] = [];
    const files: Extract<NoteTreeNode, { kind: "file" }>[] = [];

    for (const dirent of dirents) {
      // 隐藏文件/目录（.DS_Store、.git 等）不进笔记树
      if (dirent.name.startsWith(".")) continue;
      // 资源目录是笔记的附属产物，不作为笔记条目展示
      if (relDir === "" && dirent.name === ASSET_DIR) continue;
      const relPath = NoteStore.joinRel(relDir, dirent.name);

      try {
        if (dirent.isDirectory()) {
          const children = this.readDirInto(root, relPath, depth + 1);
          folders.push({
            kind: "folder",
            name: dirent.name,
            relPath,
            childCount: children.length,
            children,
          });
          continue;
        }
        if (!dirent.isFile()) continue;

        const stat = fs.statSync(path.join(root, relPath));
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

  /** 遍历整棵树，收集所有文件节点 */
  static collectFiles(nodes: NoteTreeNode[]): Extract<NoteTreeNode, { kind: "file" }>[] {
    const out: Extract<NoteTreeNode, { kind: "file" }>[] = [];
    const walk = (list: NoteTreeNode[]) => {
      for (const n of list) {
        if (n.kind === "file") out.push(n);
        else walk(n.children);
      }
    };
    walk(nodes);
    return out;
  }

  /**
   * 读取单个笔记的正文。
   * 文本类返回 utf-8 文本，图片和 PDF 返回可直接嵌进 <img src> / <embed src> 的 dataUrl。
   *
   * PDF 为什么不用 file:// 路径：开发环境渲染层跑在 http://localhost，
   * 而主窗口开着 webSecurity —— 那会把 file:// 子资源整个拦掉，表现为空白且不报错。
   * data: URL 在开发和生产（file://）下行为一致，不用为环境写分支。
   * 代价是 base64 膨胀约 1/3，对笔记体量来说可以接受。
   */
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
      const base64 = fs.readFileSync(abs).toString("base64");
      return { type, name, dataUrl: `data:application/pdf;base64,${base64}` };
    }

    return { type, name, text: fs.readFileSync(abs, "utf-8") };
  }

  /** 写入文本类笔记（绘图 / 文本），自动创建父目录 */
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

  /** 写入二进制笔记（图片） */
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

  /**
   * 在指定目录下生成一个不冲突的图片文件名。
   * 形如 `图片-20260929-134521.png`，重名则追加 -2 / -3 …
   */
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

  /** 新建文件夹；已存在同名则失败 */
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

  /**
   * 同级目录下找一个不冲突的路径（同名追加 -2 / -3 …）
   *
   * 与导入文件、save_note 用的是同一套策略：不覆盖已有文件。
   */
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

  /**
   * 新建一篇空白笔记。
   *
   * 只有「能空着画出来」的类型才允许创建（绘图 / 文本 / 网页）——
   * 图片和 PDF 只能由粘贴、拖入产生，空文件对它们没有意义。
   *
   * 后缀由类型决定，不听用户输入的：选了「文本」就存 .md，
   * 哪怕他填的是「笔记.excalidraw」也照样存成 .md ——
   * 否则文件类型和用户点的类型对不上，编辑器会按错的方式打开它。
   *
   * 同名不覆盖，追加 -2 / -3 …。
   */
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
    // Windows 会悄悄丢掉结尾的点和空格，导致回读的路径和实际文件对不上
    //
    // 正则写成 ^ 锚住 + 捕获前缀，而不是 /[. ]+$/：
    // 后者未锚定，引擎会在每个起始位置重试，尾串很长时退化成 O(n²)
    // （SonarCloud S8786 记为超线性回溯安全热点）
    const safeName = name.replace(/^((?:[\s\S]*[^. ])?)[. ]+$/, "$1");
    if (!safeName) return { ok: false, reason: "文件名不能为空" };

    // 去掉用户写的笔记后缀，再补上本次类型的后缀
    const typedExt = getExt(safeName);
    const stem = typedExt && isNoteFile(safeName) ? safeName.slice(0, -typedExt.length) : safeName;
    const fileName = stem + getNoteTypeMeta(type).defaultExt;

    const rel = NoteStore.joinRel(parentRel, fileName);
    try {
      // allocateUniqueRel 内部也会走 resolveSafe，越界路径在这里就抛出来了
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

  /** 文件夹内的直属子项数量，供确认删除时提示 */
  countChildren(root: string, relPath: string): number {
    try {
      const abs = this.resolveSafe(root, relPath);
      if (!fs.existsSync(abs)) return 0;
      return fs.readdirSync(abs).length;
    } catch {
      return 0;
    }
  }

  /** 删除单个文件 */
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

  /**
   * 删除文件夹及其全部内容。
   * 二次确认由界面负责，这里只管执行。
   */
  deleteFolder(root: string, relPath: string): boolean {
    try {
      const abs = this.resolveSafe(root, relPath);
      if (!fs.existsSync(abs)) return false;
      // 先确认它确实是目录 —— 防止界面传错参数把文件当目录删
      if (!fs.statSync(abs).isDirectory()) return false;
      fs.rmSync(abs, { recursive: true, force: true });
      return true;
    } catch (err) {
      log.error(`删除文件夹失败: ${relPath}`, err);
      return false;
    }
  }

  /**
   * 重命名文件或文件夹。
   * 文件校验新名字合法（受支持的笔记类型）且未与同级现有条目重名；
   * 文件夹保持原样，名称任意。
   */
  rename(root: string, oldRel: string, newName: string): boolean {
    try {
      const oldAbs = this.resolveSafe(root, oldRel);
      if (!fs.existsSync(oldAbs)) return false;

      const parentRel = oldRel.includes("/") ? oldRel.slice(0, oldRel.lastIndexOf("/")) : "";
      const newRel = NoteStore.joinRel(parentRel, newName);
      const newAbs = this.resolveSafe(root, newRel);
      if (newAbs === oldAbs) return true;
      if (fs.existsSync(newAbs)) throw new Error(`已存在同名条目: ${newName}`);

      // 只有文件才受笔记类型约束
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

  /** 文件夹合法性校验，供界面在新建前先挡一次 */
  isValidFolderName(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    // 禁止路径分隔符和 Windows 保留字符，否则会建出用户点不进去的目录
    return !/[\\/:*?"<>|]/.test(trimmed) && trimmed !== "." && trimmed !== "..";
  }

  /**
   * 读取单个文件的元数据（不读正文）。
   * 保存完文件后回读一条，好让调用方立刻把新条目显示出来。
   */
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

  /** 列出某个类型下的全部文件（递归） */
  listByType(root: string, type: NoteType): NoteFileEntry[] {
    return NoteStore.collectFiles(this.tree(root))
      .filter((n) => n.type === type)
      .map((n) => ({
        name: n.name,
        relPath: n.relPath,
        path: n.path,
        type: n.type,
        ext: n.ext,
        size: n.size,
        mtime: n.mtime,
      }));
  }

  /**
   * 各类型文件数。
   * 类型切换栏上的数字直接用它，省得再遍历一次。
   *
   * 计数对象按 NOTE_TYPES 派生，而不是手写字面量 ——
   * 手写的话每加一种类型都会漏掉这里，表现为「文件存在但标签上不显示数量」。
   */
  countByType(root: string): Record<NoteType, number> {
    const byType = {} as Record<NoteType, number>;
    for (const { type } of NOTE_TYPES) byType[type] = 0;
    for (const node of NoteStore.collectFiles(this.tree(root))) {
      if (node.kind === "file" && node.type in byType) byType[node.type] += 1;
    }
    return byType;
  }

  // ────────────────────────── 富文本图片资源 ──────────────────────────

  /**
   * 计算从某篇笔记所在目录到目标条目的相对路径（正斜杠，Markdown 用）。
   * 笔记在根目录时直接是 "assets/x.png"，在子目录里是 "../assets/x.png"。
   */
  static relativeFrom(noteRelPath: string, targetRel: string): string {
    const noteDir = noteRelPath.includes("/")
      ? noteRelPath.slice(0, noteRelPath.lastIndexOf("/"))
      : "";
    return path.posix.relative(noteDir || ".", targetRel);
  }

  /**
   * 把 dataUrl 落盘成资源文件，返回资源根相对路径。
   *
   * 文件名用内容哈希而不是时间戳：同一张图在反复保存、跨多篇笔记引用时
   * 只会占一份空间，也避免了每次保存都产生一份副本。
   */
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

  /** 读取资源文件为 dataUrl；不存在或越界返回 null */
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

  // ────────────────────────── 剪贴板转笔记 ──────────────────────────

  /**
   * 用剪贴板内容推导笔记文件名。
   * 取第一段非空文本，清掉行首结构记号和文件名非法字符，压到 40 字以内。
   */
  static deriveNoteName(content: string): string {
    const firstLine =
      content.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
    let base = firstLine
      // 行首的 markdown 结构记号（标题、列表、引用）
      .replace(/^[\s>#*\-+\d.、)】\]}]+/, "")
      // 文件系统非法字符，以及散落在正文的强调记号 —— 这些进文件名只会变成噪音
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/[*_~`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // 收尾：可能又暴露出新的非法字符或尾随空格
    base = base.replace(/[\\/:*?"<>|]/g, "").trim();
    if (base.length > 40) base = base.slice(0, 40).trim();
    return `${base || "剪贴板"}.md`;
  }

  /**
   * 把一条剪贴板记录直接存成笔记：文本落成 .md，图片落成 .png。
   * 成功返回该笔记的元数据，失败返回 null。
   */
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
        // 走 markdown 通道：万一正文里内嵌了图片，也会被正确抽成资源
        if (!this.writeMarkdownWithAssets(root, rel, raw)) return null;
      }

      return this.stat(root, rel);
    } catch (err) {
      log.error("剪贴板存为笔记失败", err);
      return null;
    }
  }

  /**
   * 移动富文本笔记时重写正文里的本地图片引用。
   *
   * .md 里存的是相对路径（"../assets/x.png"），笔记一换层级这些引用就指错了：
   * 把 工作/方案.md 拖到根目录后，../assets/x.png 会指向笔记目录之外。
   * 这里按「旧位置解析成根相对 → 再按新位置重算相对」改写一遍。
   */
  private rewriteAssetRefs(oldRel: string, newRel: string, markdown: string): string {
    const oldDir = oldRel.includes("/") ? oldRel.slice(0, oldRel.lastIndexOf("/")) : "";
    return markdown.replace(MD_IMAGE_RE, (whole, alt: string, src: string, title?: string) => {
      if (/^(https?:|data:)/i.test(src)) return whole;
      try {
        const rootRelative = path.posix.normalize(path.posix.join(oldDir || ".", src));
        if (rootRelative.startsWith("..")) return whole; // 越界引用保持原样
        return `![${alt}](${NoteStore.relativeFrom(newRel, rootRelative)}${title ?? ""})`;
      } catch {
        return whole;
      }
    });
  }

  /**
   * 把条目移动到另一个文件夹（拖拽用）。
   *
   * 返回具体失败原因而不是裸 boolean —— 界面上要把原因告诉用户，
   * 「不能把文件夹拖进它自己」和「目标已有同名文件」需要不同的措辞。
   */
  move(
    root: string,
    fromRel: string,
    toFolderRel: string
  ): { ok: true } | { ok: false; reason: string } {
    try {
      if (!fromRel) return { ok: false, reason: "没有可移动的条目" };
      // 拖到自己身上 = 无操作，不是错误。界面层已经提前拦掉了，
      // 这里再兜一次底：移动到自身没有任何意义，不该报失败。
      if (fromRel === toFolderRel) return { ok: true };

      const fromAbs = this.resolveSafe(root, fromRel);
      if (!fs.existsSync(fromAbs)) return { ok: false, reason: "源条目已不存在" };

      const isDir = fs.statSync(fromAbs).isDirectory();

      // 目标必须是已存在的目录（空串表示根目录，必然存在）
      // 空串分支同样要过越界检查 —— 退化成裸的 path.resolve(root) 就等于放开了任意目录
      const toAbs = this.resolveSafe(root, toFolderRel || ".");
      if (toFolderRel && !fs.existsSync(toAbs)) {
        return { ok: false, reason: "目标文件夹已不存在" };
      }
      if (!fs.statSync(toAbs).isDirectory()) {
        return { ok: false, reason: "目标不是文件夹" };
      }

      // 关键防护：文件夹不能进自己或自己的后代，否则会造出无限嵌套的循环
      if (isDir && (toFolderRel === fromRel || toFolderRel.startsWith(`${fromRel}/`))) {
        return { ok: false, reason: "不能把文件夹移动到它自己或它的子文件夹中" };
      }

      const name = NoteStore.baseName(fromRel);
      const destRel = NoteStore.joinRel(toFolderRel, name);
      if (destRel === fromRel) return { ok: true }; // 已在目标位置

      if (fs.existsSync(this.resolveSafe(root, destRel))) {
        return { ok: false, reason: `目标文件夹下已存在「${name}」` };
      }

      // 跨层级移动富文本笔记时，先备好重写过的正文
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

  /**
   * 解析一个供 shell 打开/定位的绝对路径。
   *
   * relPath 传空串表示笔记根目录。越界一律拒绝 —— shell.openPath 能打开
   * 任意路径，这里不能成为绕过 resolveSafe 的旁路。
   */
  resolveForShell(root: string, relPath: string): string {
    // 空 relPath 表示笔记根目录本身，但同样要走一遍越界检查 ——
    // 直接 path.resolve(root) 等于给 shell.openPath 开了一个任意路径的口子：
    // shell.openPath 能打开任何路径（含 UNC 共享），不能成为绕过 resolveSafe 的旁路。
    return this.resolveSafe(root, relPath || ".");
  }

  /**
   * 读 .md 正文，并把其中指向本地资源的相对路径换成 dataUrl。
   * 渲染层拿不到文件系统，相对路径在 <img src> 里是解析不出来的
   * （开发环境走 http://localhost，file:// 会被浏览器拦掉）。
   * 远程 http(s) 图片原样保留 —— 那类图本来就能直接显示。
   */
  readMarkdownWithAssets(root: string, relPath: string): string {
    const abs = this.resolveSafe(root, relPath);
    const raw = fs.readFileSync(abs, "utf-8");

    const noteDir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";

    return raw.replace(MD_IMAGE_RE, (whole, alt: string, src: string, title?: string) => {
      if (/^(https?:|data:)/i.test(src)) return whole;
      try {
        // 以笔记所在目录为基准解析；越界（指向笔记根之外）直接放弃替换
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

  /**
   * 写 .md 正文：先把内嵌的 dataUrl 抽出来存进资源目录，再落成相对路径。
   * 这样磁盘上的笔记始终是纯文本 + 相对路径，可读、可 diff、可随目录整体搬走。
   */
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

  // ────────────────────────── HTML 笔记 ──────────────────────────

  /**
   * 读 .html 正文，并把指向本地资源的相对路径换成 dataUrl。
   *
   * 与 Markdown 同理：渲染层拿不到文件系统，相对路径在 <img src> 里解析不出来。
   * 只替换 src 属性，href（超链接）和 <script src> 不动 —— 后者引 JS 而不是图片，
   * 换成 dataUrl 没有意义且会破坏脚本行为。
   */
  readHtmlWithAssets(root: string, relPath: string): string {
    const abs = this.resolveSafe(root, relPath);
    const raw = fs.readFileSync(abs, "utf-8");
    const noteDir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";

    return raw.replace(HTML_SRC_RE, (whole, quote: string, src: string) => {
      const value = src.trim();
      if (!value || /^(https?:|data:|file:|blob:|#|\/)/i.test(value)) return whole;
      try {
        // 以笔记所在目录为基准解析；越界（指向笔记根之外）直接放弃替换
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

  /**
   * 写 .html 正文：内嵌的 dataUrl 图片抽出来存进 assets/，正文里只留相对路径。
   * 保证磁盘上的 HTML 仍是纯文本 + 相对引用，可读、可整体搬走。
   */
  writeHtmlWithAssets(root: string, relPath: string, html: string): boolean {
    const cleaned = html.replace(HTML_SRC_RE, (whole, quote: string, src: string) => {
      if (!src.startsWith("data:image/")) return whole;
      const assetRel = this.saveAssetFromDataUrl(root, src);
      if (!assetRel) return whole;
      return `src=${quote}${NoteStore.relativeFrom(relPath, assetRel)}${quote}`;
    });

    return this.writeText(root, relPath, cleaned);
  }

  /** 按扩展名判断是不是纯文本类笔记（可写） */
  static isTextNote(name: string): boolean {
    const type = detectNoteType(name);
    return type === "excalidraw" || type === "markdown" || type === "html";
  }
}
