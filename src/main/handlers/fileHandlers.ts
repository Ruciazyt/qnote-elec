import { ipcMain, IpcMainInvokeEvent, dialog, BrowserWindow, shell } from "electron";
import { readClipboardImage } from "../utils/clipboard";
import * as fs from "fs";
import * as path from "node:path";
import { FileWriter } from "../core/fileWriter";
import { NoteStore } from "../core/noteStore";
import { ExternalFolderStore } from "../core/externalFolderStore";
import { getMainWindow } from "../core/window/mainWindow";
import { log } from "../utils/log";
import {
  ExternalFolder,
  NoteFileEntry,
  NoteTreeNode,
  NoteType,
  isNoteFile,
} from "../../shared/noteTypes";

/**
 * 外部文件夹的目录树最多返回多少个节点
 *
 * 外部文件夹是用户随手指的目录 —— 可能是整个盘符或一个大仓库，
 * 一次全量扫描会卡住主进程。超限时截断，界面提示用户。
 */
const EXTERNAL_TREE_MAX_NODES = 3000;

/**
 * 在同级目录下找一个不冲突的路径（同名追加 -2 / -3 …）
 *
 * 与 saveNote.ts 里那份同名函数重复，但那边是工具侧、这边是文件导入侧，
 * 各写各的会漂。共用的话要把 NoteStore 里的这个私有方法提上去 —— 先不动，
 * 复制一份并各自维护，出现分歧时再合并。
 */
function allocateUniquePath(root: string, relPath: string): string {
  const abs = path.resolve(root, relPath);
  if (!fs.existsSync(abs)) return relPath;

  const dir = path.posix.dirname(relPath);
  const base = path.posix.basename(relPath);
  const ext = path.posix.extname(base);
  const stem = base.slice(0, base.length - ext.length);

  for (let n = 2; n < 200; n += 1) {
    const candidate = path.posix.join(dir === "." ? "" : dir, `${stem}-${n}${ext}`);
    if (!fs.existsSync(path.resolve(root, candidate))) return candidate;
  }
  return relPath;
}

/** 选图对话框用的扩展名 → MIME */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/**
 * 不接收 win 参数 —— 窗口句柄在调用时才解析。
 *
 * 曾经写成 registerFileHandlers(fileWriter, getMainWindow())，而这行是从
 * registerIpcHandlers() 里调的，它按设计跑在 createMainWindow() **之前**
 * （为了避免渲染层启动瞬间报 "No handler registered"）。于是 win 在注册
 * 那一刻就是 null，被按值捕获下来。
 *
 * 后果是 select-dirs 和 notes:pick-image 两个对话框永远走不到
 * `if (!win) return`：点「切换笔记目录」「插入图片」毫无反应，也不报错。
 * 窗口句柄是会变的东西（有热重载重建、有销毁），不能在建 handler 时快照，
 * 必须在用的时候现取。
 */
export function registerFileHandlers(
  fileWriter: FileWriter,
  externalFolders: ExternalFolderStore
) {
  const noteStore = new NoteStore();

  // 笔记根目录只由用户通过系统目录选择框确定（见 select-dirs），主进程自己存着。
  // 这里刻意不提供「渲染层设置根目录」的通道 —— 渲染层属于可能被攻陷的一端，
  // 给了它写根目录的能力，就等于让它把后续所有文件操作指到任意位置。
  ipcMain.handle("getFilePath", () => fileWriter.getFilePath());

  ipcMain.handle("select-dirs", async () => {
    const win = getMainWindow();
    if (!win) {
      log.error("select-dirs 调用时主窗口不存在，无法打开目录选择框");
      return;
    }
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    if (result.filePaths[0]) {
      await fileWriter.setFilePath(result.filePaths[0]);
      return result.filePaths[0];
    }
  });

  // ── 笔记：所有类型共用一套通道，类型由扩展名决定 ──
  // 定位一律用 relPath（相对笔记根目录），文件名在子文件夹里不唯一。

  /** 递归列出整个目录树（文件夹 + 笔记文件），只含元数据不读正文 */
  ipcMain.handle("notes:tree", (_event, dirPath: string): NoteTreeNode[] => {
    return noteStore.tree(dirPath);
  });

  /** 读取单个笔记正文：文本类给 text，图片给 dataUrl */
  ipcMain.handle("notes:read", (_event, dirPath: string, relPath: string) => {
    try {
      return noteStore.read(dirPath, relPath);
    } catch (err) {
      log.error(`读取笔记失败: ${relPath}`, err);
      return null;
    }
  });

  /** 保存文本类笔记（绘图 / 文本） */
  ipcMain.handle("notes:write-text", (_event, dirPath: string, relPath: string, text: string) => {
    return noteStore.writeText(dirPath, relPath, text);
  });

  /**
   * 读 .md 正文：其中的本地图片相对路径会被换成 dataUrl，
   * 渲染层才能把图显示出来。
   */
  ipcMain.handle("notes:read-markdown", (_event, dirPath: string, relPath: string) => {
    try {
      return noteStore.readMarkdownWithAssets(dirPath, relPath);
    } catch (err) {
      log.error(`读取 Markdown 失败: ${relPath}`, err);
      return "";
    }
  });

  /** 写 .md 正文：内嵌的 dataUrl 会被抽出来存进 assets/，正文里只留相对路径 */
  ipcMain.handle("notes:write-markdown", (_event, dirPath: string, relPath: string, md: string) => {
    return noteStore.writeMarkdownWithAssets(dirPath, relPath, md);
  });

  /**
   * 读 .html 正文：其中指向本地资源的相对路径会被换成 dataUrl，
   * 否则 iframe 里的 <img src="assets/x.png"> 是空图。
   */
  ipcMain.handle("notes:read-html", (_event, dirPath: string, relPath: string) => {
    try {
      return noteStore.readHtmlWithAssets(dirPath, relPath);
    } catch (err) {
      log.error(`读取 HTML 失败: ${relPath}`, err);
      return "";
    }
  });

  /** 写 .html 正文：内嵌的 dataUrl 图片抽出来存进 assets/，正文里只留相对路径 */
  ipcMain.handle("notes:write-html", (_event, dirPath: string, relPath: string, html: string) => {
    return noteStore.writeHtmlWithAssets(dirPath, relPath, html);
  });

  /** 把一张 dataUrl 图片存进资源目录，返回资源根相对路径 */
  ipcMain.handle("notes:save-asset", (_event, dirPath: string, dataUrl: string) => {
    return noteStore.saveAssetFromDataUrl(dirPath, dataUrl);
  });

  /**
   * 在系统文件管理器中打开一个目录。
   * 返回空串表示成功，Electron 的 shell.openPath 约定如此。
   */
  ipcMain.handle("notes:open-in-explorer", (_event, _dirPath: string, relPath: string) => {
    try {
      // 笔记根目录以主进程记录的为准，渲染层传过来的 dirPath 不用 ——
      // 渲染层属于可能被攻陷的一端，不能让它决定要打开哪个目录。
      // 目标路径在同一个函数里从根目录解析并做包含性校验：
      // shell.openPath 能打开任意路径（含 UNC 共享），越界必须在这里挡住。
      const rootAbs = path.resolve(fileWriter.getRootPath());
      const abs = path.resolve(rootAbs, relPath || ".");
      const rel = path.relative(rootAbs, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`非法的笔记路径: ${relPath}`);
      }
      return shell.openPath(abs);
    } catch (err) {
      log.error("打开目录失败", err);
      return "路径不合法";
    }
  });

  /**
   * 在系统文件管理器中定位某个条目（打开所在目录并高亮选中）。
   * 用于「打开当前笔记所在文件夹」——比只打开目录多一步高亮，更省一次点击。
   */
  ipcMain.handle("notes:reveal-in-folder", (_event, _dirPath: string, relPath: string) => {
    try {
      if (!relPath) return false;
      // 同样以主进程记录的根目录为准，不用渲染层传来的 dirPath
      const rootAbs = path.resolve(fileWriter.getRootPath());
      const abs = path.resolve(rootAbs, relPath);
      const rel = path.relative(rootAbs, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`非法的笔记路径: ${relPath}`);
      }
      shell.showItemInFolder(abs);
      return true;
    } catch (err) {
      log.error("定位文件失败", err);
      return false;
    }
  });

  /**
   * 把一条剪贴板记录直接存成笔记（文本→.md，图片→.png）。
   * 存到笔记根目录：剪贴板面板和笔记页是彼此独立的，这里不共享笔记页的「当前文件夹」。
   */
  ipcMain.handle(
    "notes:save-from-clipboard",
    (_event, dirPath: string, type: "text" | "image", content: string
  ): NoteFileEntry | null => {
    return noteStore.saveNoteFromClipboard(dirPath, type, content);
  });

  /**
   * 打开系统文件选择框选图片，直接存进资源目录。
   * 返回 dataUrl 供编辑器立即显示，资源路径仅用于确认落盘成功。
   */
  ipcMain.handle("notes:pick-image", async (_event, dirPath: string) => {
    const win = getMainWindow();
    if (!win) {
      log.error("notes:pick-image 调用时主窗口不存在，无法打开图片选择框");
      return null;
    }
    const result = await dialog.showOpenDialog(win, {
      title: "插入图片",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }],
    });
    const picked = result.filePaths[0];
    if (!picked) return null;

    try {
      const buffer = fs.readFileSync(picked);
      const ext = path.extname(picked).toLowerCase();
      const mime = MIME_BY_EXT[ext] ?? "image/png";
      const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
      const assetRel = noteStore.saveAssetFromDataUrl(dirPath, dataUrl);
      if (!assetRel) return null;
      return { dataUrl, assetRel };
    } catch (err) {
      log.error("插入图片失败", err);
      return null;
    }
  });

  ipcMain.handle("notes:delete", (_event, dirPath: string, relPath: string) => {
    return noteStore.delete(dirPath, relPath);
  });

  /** 删除文件夹及全部内容 */
  ipcMain.handle("notes:delete-folder", (_event, dirPath: string, relPath: string) => {
    return noteStore.deleteFolder(dirPath, relPath);
  });

  /** 重命名文件或文件夹 */
  ipcMain.handle("notes:rename", (_event, dirPath: string, oldRel: string, newName: string) => {
    return noteStore.rename(dirPath, oldRel, newName);
  });

  /** 新建文件夹 */
  ipcMain.handle("notes:create-folder", (_event, dirPath: string, parentRel: string, name: string) => {
    if (!noteStore.isValidFolderName(name)) return false;
    return noteStore.createFolder(dirPath, parentRel, name.trim());
  });

  /**
   * 新建一篇空白笔记。
   *
   * 失败要带回原因，界面才能区分「名字非法」和「写入失败」，
   * 而不是笼统一句「新建失败」。
   */
  ipcMain.handle(
    "notes:create-file",
    (_event, dirPath: string, parentRel: string, name: string, type: NoteType
    ) => noteStore.createNoteFile(dirPath, parentRel, name, type)
  );

  /**
   * 从系统拖进来的文件 —— 复制进笔记目录
   *
   * 只收笔记系统认识的类型（detectNoteType 有返回的）：拖进来一个 .zip 或 .txt
   * 在笔记列表里根本不会显示，用户会以为没导入成功，静默丢弃反而是帮忙 ——
   * 所以这里明确跳过，并在返回值里告诉界面跳过了几个。
   *
   * 同名不覆盖，沿用 NoteStore.allocateImageName 那套追加后缀的思路。
   */
  ipcMain.handle(
    "notes:import-files",
    async (
      _event,
      dirPath: string,
      srcPaths: string[],
      targetFolderRel = ""
    ): Promise<{ imported: string[]; skipped: string[] }> => {
      const result = await importFilesInto(dirPath, srcPaths, targetFolderRel);

      if (result.imported.length > 0) broadcastNotesChanged(dirPath);
      return result;
    }
  );

  /**
   * 拖拽移动条目到另一个文件夹。
   * 失败时带回原因，界面据此给出可操作的提示，而不是笼统的"移动失败"。
   */
  ipcMain.handle(
    "notes:move",
    (_event, dirPath: string, fromRel: string, toFolderRel: string
  ) => noteStore.move(dirPath, fromRel, toFolderRel));

  /**
   * 把系统剪贴板里的图片存成一条图片笔记。
   * 图片笔记只有这一个来源 —— 界面上不提供新建/上传入口。
   * 剪贴板里没有图片时返回 null，渲染层据此静默忽略这次粘贴。
   */
  ipcMain.handle(
    "notes:save-clipboard-image",
    async (_event, dirPath: string, parentRel: string): Promise<NoteFileEntry | null> => {
      try {
        const image = await readClipboardImage();
        if (image.isEmpty()) return null;

        const relPath = noteStore.allocateImageName(dirPath, parentRel, ".png");
        if (!noteStore.writeBinary(dirPath, relPath, image.toPNG())) return null;

        // 回读一条元数据，列表能立刻显示新条目，不用等下一次全量刷新
        return findEntry(noteStore.tree(dirPath), relPath) ?? null;
      } catch (err) {
        log.error("保存剪贴板图片失败", err);
        return null;
      }
    }
  );

  // ────────────────────────── 外部文件夹 ──────────────────────────
  //
  // 用户从磁盘任意路径添加进来的文件夹。渲染层只认 id，
  // 路径一律由主进程从注册表里查 —— 渲染层不能指定操作目标目录。

  /** 已登记的外部文件夹清单 */
  ipcMain.handle("notes:external-folders", async (): Promise<ExternalFolder[]> => {
    return externalFolders.list();
  });

  /**
   * 弹系统目录选择框，把选中的文件夹登记进来
   *
   * 取消选择时返回 null（与「选中了但一个都没加进去」区分开：
   * 后者返回清单本身，界面能提示"没有可添加的目录"）。
   */
  ipcMain.handle("notes:add-external-folders", async (): Promise<ExternalFolder[] | null> => {
    const win = getMainWindow();
    if (!win) {
      log.error("notes:add-external-folders 调用时主窗口不存在，无法打开目录选择框");
      return null;
    }
    const result = await dialog.showOpenDialog(win, {
      title: "添加现有文件夹",
      properties: ["openDirectory", "multiSelections"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return externalFolders.add(result.filePaths);
  });

  /** 从清单里移除（不动磁盘上的文件） */
  ipcMain.handle(
    "notes:remove-external-folder",
    async (_event, id: string): Promise<ExternalFolder[]> => {
      return externalFolders.remove(id);
    }
  );

  /**
   * 列出某个外部文件夹里的目录树
   *
   * 只返回应用能预览的类型（.md / .html / .pdf / 图片 / .excalidraw），
   * 其余文件在树里直接不出现 —— 与笔记根目录的规则一致。
   */
  ipcMain.handle("notes:external-tree", async (_event, id: string): Promise<NoteTreeNode[]> => {
    const folder = await externalFolders.get(id);
    if (!folder) return [];
    try {
      return noteStore.tree(folder.path, EXTERNAL_TREE_MAX_NODES);
    } catch (err) {
      log.error(`读取外部文件夹失败: ${folder.path}`, err);
      return [];
    }
  });

  /**
   * 在文件管理器里定位外部文件夹里的某个条目
   *
   * 路径由主进程从 id + relPath 解析，并做包含性校验 ——
   * 渲染层不能借这条通道打开注册表以外的位置。
   */
  ipcMain.handle(
    "notes:external-reveal",
    async (_event, id: string, relPath: string): Promise<boolean> => {
      try {
        const folder = await externalFolders.get(id);
        if (!folder) return false;
        const rootAbs = path.resolve(folder.path);
        const abs = path.resolve(rootAbs, relPath || ".");
        const rel = path.relative(rootAbs, abs);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          throw new Error(`非法的路径: ${relPath}`);
        }
        if (relPath) shell.showItemInFolder(abs);
        else await shell.openPath(abs);
        return true;
      } catch (err) {
        log.error("定位外部文件夹条目失败", err);
        return false;
      }
    }
  );

  // ── 外部文件夹的文件管理（增删改） ──
  //
  // 下面这些通道都只接受 id + 相对路径：目录由注册表解析，
  // 渲染层没有机会把操作指向注册表以外的位置。

  /** 外部文件夹的删改操作统一走这里取根目录 */
  async function externalRoot(id: string): Promise<string | null> {
    const folder = await externalFolders.get(id);
    return folder?.path ?? null;
  }

  /** 删除一个文件 */
  ipcMain.handle("notes:external-delete", async (_event, id: string, relPath: string) => {
    const root = await externalRoot(id);
    if (!root) return false;
    return noteStore.delete(root, relPath);
  });

  /** 删除文件夹及其全部内容 */
  ipcMain.handle("notes:external-delete-folder", async (_event, id: string, relPath: string) => {
    const root = await externalRoot(id);
    if (!root) return false;
    return noteStore.deleteFolder(root, relPath);
  });

  /** 重命名文件或文件夹 */
  ipcMain.handle(
    "notes:external-rename",
    async (_event, id: string, oldRel: string, newName: string) => {
      const root = await externalRoot(id);
      if (!root) return false;
      return noteStore.rename(root, oldRel, newName);
    }
  );

  /** 新建文件夹 */
  ipcMain.handle(
    "notes:external-create-folder",
    async (_event, id: string, parentRel: string, name: string) => {
      const root = await externalRoot(id);
      if (!root) return false;
      if (!noteStore.isValidFolderName(name)) return false;
      return noteStore.createFolder(root, parentRel, name.trim());
    }
  );

  /** 新建一篇空白笔记 */
  ipcMain.handle(
    "notes:external-create-file",
    async (
      _event,
      id: string,
      parentRel: string,
      name: string,
      type: NoteType
    ): Promise<{ ok: true; relPath: string } | { ok: false; reason: string }> => {
      const root = await externalRoot(id);
      if (!root) return { ok: false, reason: "外部文件夹不存在" };
      return noteStore.createNoteFile(root, parentRel, name, type);
    }
  );

  /** 拖拽移动条目到另一个文件夹 */
  ipcMain.handle(
    "notes:external-move",
    async (
      _event,
      id: string,
      fromRel: string,
      toFolderRel: string
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const root = await externalRoot(id);
      if (!root) return { ok: false, reason: "外部文件夹不存在" };
      return noteStore.move(root, fromRel, toFolderRel);
    }
  );

  /** 从系统拖入文件 —— 复制进外部文件夹 */
  ipcMain.handle(
    "notes:external-import-files",
    async (
      _event,
      id: string,
      srcPaths: string[],
      targetFolderRel = ""
    ): Promise<{ imported: string[]; skipped: string[] }> => {
      const root = await externalRoot(id);
      if (!root) return { imported: [], skipped: [] };
      const result = await importFilesInto(root, srcPaths, targetFolderRel);
      if (result.imported.length > 0) broadcastNotesChanged(root);
      return result;
    }
  );
}

/**
 * 从系统拖进来的文件 —— 复制进目标目录
 *
 * 只收笔记系统认识的类型（detectNoteType 有返回的）：拖进来一个 .zip 或 .txt
 * 在笔记列表里根本不会显示，用户会以为没导入成功，静默丢弃反而是帮忙 ——
 * 所以这里明确跳过，并在返回值里告诉界面跳过了几个。
 *
 * 同名不覆盖，沿用 NoteStore.allocateImageName 那套追加后缀的思路。
 */
async function importFilesInto(
  dirPath: string,
  srcPaths: string[],
  targetFolderRel: string
): Promise<{ imported: string[]; skipped: string[] }> {
  const imported: string[] = [];
  const skipped: string[] = [];

  // targetFolderRel 来自渲染层，挡一下路径穿越（写入前校验，不是事后补救）
  const folder = (targetFolderRel || "").trim();
  if (folder.includes("..") || path.isAbsolute(folder)) {
    return { imported, skipped: [`非法目标目录：${targetFolderRel}`] };
  }

  for (const src of srcPaths || []) {
    const fileName = path.basename(src);
    // 不是笔记类型的直接跳过，不去猜用户的意图
    if (!isNoteFile(fileName)) {
      skipped.push(fileName);
      continue;
    }
    try {
      // allocateUniquePath 保证不覆盖同名已有文件（追加 -2/-3）
      const relPath = allocateUniquePath(dirPath, folder ? `${folder}/${fileName}` : fileName);
      await fs.promises.copyFile(src, path.resolve(dirPath, relPath));
      imported.push(relPath);
    } catch (err) {
      log.error("导入文件失败:", src, err);
      skipped.push(fileName);
    }
  }

  log.info(`[notes] 导入完成：成功 ${imported.length}，跳过 ${skipped.length}`);
  return { imported, skipped };
}

/** 在树里按 relPath 找到文件节点 */
function findEntry(nodes: NoteTreeNode[], relPath: string): NoteFileEntry | null {
  for (const node of nodes) {
    if (node.kind === "file") {
      if (node.relPath === relPath) return node;
    } else {
      const hit = findEntry(node.children, relPath);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 通知所有窗口「笔记目录变了」
 *
 * 存在的理由：AI 可以在用户不打开笔记页的情况下写入文件。
 * 笔记页只在挂载时拉一次目录树，不广播的话，新文件要等用户切走再切回来才出现，
 * 表现为「AI 说存好了但列表里没有」。
 */
export function broadcastNotesChanged(root: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    w.webContents.send("notes:changed", root);
  }
}
