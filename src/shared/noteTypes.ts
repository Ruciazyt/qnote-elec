/**
 * 笔记类型系统 —— 主进程与渲染层共用的唯一真相源
 *
 * 设计要点：笔记是「纯文件制」，类型完全由扩展名决定。
 * 所以这里不做任何持久化，只提供扩展名 ⇄ 类型的双向路由，
 * 新增一种类型时只要往 EXT_TO_TYPE 和 NOTE_TYPES 里各加一行。
 *
 * 主进程用相对路径 import（见 src/main/core/noteStore.ts），
 * 渲染层同样走相对路径（见 src/renderer/components/Note/），
 * 与 AiChatSessionsPanel.tsx 引用 shared 的既有做法保持一致。
 */

/** 笔记内容类型 */
export type NoteType = "excalidraw" | "markdown" | "image" | "html" | "pdf";

/**
 * 富文本图片资源目录（相对笔记根目录）
 *
 * 正文里的图片存这里，.md 中以相对路径引用，笔记因此保持纯文本可读。
 * 这个目录不出现在笔记树里 —— 里面的图片是某篇笔记的附属资源，
 * 混进列表只会变成噪音。
 */
export const ASSET_DIR = "assets";

export interface NoteTypeMeta {
  type: NoteType;
  /** 界面上显示的名字，也是类型切换栏上的标签 */
  label: string;
  /** 该类型的默认扩展名 —— 另存为时用户不写后缀就用它 */
  defaultExt: string;
}

/** 类型切换栏的展示顺序即数组顺序 */
export const NOTE_TYPES: readonly NoteTypeMeta[] = [
  { type: "excalidraw", label: "绘图", defaultExt: ".excalidraw" },
  { type: "markdown", label: "文本", defaultExt: ".md" },
  { type: "html", label: "网页", defaultExt: ".html" },
  { type: "image", label: "图片", defaultExt: ".png" },
  { type: "pdf", label: "PDF", defaultExt: ".pdf" },
] as const;

/**
 * 可以「新建空白文件」的类型
 *
 * 图片和 PDF 没有空文件的形态：空白图片打开是一片灰，空白 PDF 打开是一张白纸，
 * 两者都没有可编辑的内容，只能由粘贴、拖入、截图产生。
 * 所以新建入口只提供这三种，其余类型走粘贴 / 拖拽 / 导入。
 */
export const CREATABLE_NOTE_TYPES: readonly NoteType[] = ["excalidraw", "markdown", "html"];

/** 该类型能否新建出空白文件 */
export function isCreatableNoteType(type: NoteType): boolean {
  return CREATABLE_NOTE_TYPES.includes(type);
}

/**
 * 扩展名 → 类型。键必须全小写。
 *
 * 未登记的扩展名一律视为「不是笔记」—— list 时会被过滤掉，
 * 这样用户把其它文件混放在同一个目录里也不会污染笔记列表。
 */
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

/**
 * 列表里展示的一条笔记（只含元数据，不含正文 —— 避免一次性把所有文件读进内存）
 *
 * 用 relPath 而不是文件名定位：笔记目录支持子文件夹后，同名文件
 * 可以出现在不同层级，光靠 name 根本分不清。
 */
export interface NoteFileEntry {
  /** 文件名，含扩展名 */
  name: string;
  /** 相对笔记根目录的路径，如 "工作/方案.md"；根目录下的文件没有分隔符 */
  relPath: string;
  /** 完整绝对路径 */
  path: string;
  type: NoteType;
  /** 小写扩展名，含点，如 ".md" */
  ext: string;
  /** 字节数 */
  size: number;
  /** 最后修改时间戳（毫秒） */
  mtime: number;
}

/** 一个子文件夹 */
export interface NoteFolderEntry {
  /** 文件夹名 */
  name: string;
  /** 相对笔记根目录的路径；根目录自身为 "" */
  relPath: string;
  /** 直属子项数量（不含后代），显示在文件夹行上 */
  childCount: number;
}

/** 树形列表的节点：文件夹或文件 */
export type NoteTreeNode =
  | ({ kind: "folder" } & NoteFolderEntry & { children: NoteTreeNode[] })
  | ({ kind: "file" } & NoteFileEntry);

export function isFolderNode(node: NoteTreeNode): node is Extract<NoteTreeNode, { kind: "folder" }> {
  return node.kind === "folder";
}


/**
 * 读取正文的结果。
 *
 * 文本类（绘图/文本/网页）给 text，图片和 PDF 给 dataUrl ——
 * 让渲染层不用关心怎么把二进制变成能塞进 <img> / <embed> 的东西。
 *
 * PDF 为什么也是 dataUrl 而不是 file:// 路径：
 * 开发环境渲染层跑在 http://localhost，而主窗口开着 webSecurity，
 * 那会把 file:// 子资源整个拦掉，表现为空白且不报错。
 * data: URL 在开发和生产（file://）下行为一致，不必为环境写分支。
 * 代价是 base64 膨胀约 1/3，对笔记体量来说可以接受。
 */
export type NoteContent =
  | { type: "excalidraw" | "markdown" | "html"; name: string; text: string }
  | { type: "image" | "pdf"; name: string; dataUrl: string };

/** 取小写扩展名，含点；无扩展名返回空串 */
export function getExt(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx <= 0) return "";
  return fileName.slice(idx).toLowerCase();
}

/** 按扩展名判定类型；不是笔记返回 null */
export function detectNoteType(fileName: string): NoteType | null {
  return EXT_TO_TYPE[getExt(fileName)] ?? null;
}

/** 是否是受笔记系统管理的文件 */
export function isNoteFile(fileName: string): boolean {
  return detectNoteType(fileName) !== null;
}

/** 去掉扩展名 */
export function stripExt(fileName: string): string {
  const ext = getExt(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

/** 取类型元信息 */
export function getNoteTypeMeta(type: NoteType): NoteTypeMeta {
  return NOTE_TYPES.find((t) => t.type === type) ?? NOTE_TYPES[0];
}

/**
 * 补全文件名：已有正确后缀就原样返回，否则按类型补默认后缀。
 * 另存为 / 重命名都走这里，保证类型切换后存出来的文件能被正确路由。
 */
export function withDefaultExt(rawName: string, type: NoteType): string {
  const trimmed = rawName.trim();
  if (!trimmed) return trimmed;
  const meta = getNoteTypeMeta(type);
  // 已经是笔记扩展名（含本类型以外的合法后缀，如 .excalidraw → .md）则不再追加
  if (isNoteFile(trimmed)) return trimmed;
  return trimmed + meta.defaultExt;
}
