import { ipcMain, IpcMainInvokeEvent, dialog, BrowserWindow, clipboard, shell } from "electron";
import * as fs from "fs";
import * as path from "node:path";
import { FileWriter } from "../core/fileWriter";
import { NoteStore } from "../core/noteStore";
import { getMainWindow } from "../core/window/mainWindow";
import { log } from "../utils/log";
import { NoteFileEntry, NoteTreeNode, NoteType, isNoteFile } from "../../shared/noteTypes";

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
export function registerFileHandlers(fileWriter: FileWriter) {
  const noteStore = new NoteStore();

  ipcMain.handle("writeToFile", (event: IpcMainInvokeEvent, data: string) =>
    fileWriter.writeToFileSync(event, data)
  );

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

  /** 各类型文件数，供类型切换栏显示 */
  ipcMain.handle("notes:counts", (_event, dirPath: string) => {
    return noteStore.countByType(dirPath);
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
  ipcMain.handle("notes:open-in-explorer", (_event, dirPath: string, relPath: string) => {
    try {
      const abs = noteStore.resolveForShell(dirPath, relPath);
      // 打开前独立再校验一次：目标必须仍在笔记根之内。
      // 校验和调用必须写在同一个函数里 —— 抽出去的 resolveSafe 挡不住污点分析：
      // shell.openPath 能打开任意路径（含 UNC 共享），不能成为越界检查的旁路。
      const rel = path.relative(path.resolve(dirPath), abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return "路径不合法";
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
  ipcMain.handle("notes:reveal-in-folder", (_event, dirPath: string, relPath: string) => {
    try {
      if (!relPath) return false;
      shell.showItemInFolder(noteStore.resolveForShell(dirPath, relPath));
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

  /** 文件夹直属子项数量，用于删除前的确认文案 */
  ipcMain.handle("notes:count-children", (_event, dirPath: string, relPath: string) => {
    return noteStore.countChildren(dirPath, relPath);
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
      const imported: string[] = [];
      const skipped: string[] = [];

      // targetFolderRel 来自渲染层，挡一下路径穿越（写入前校验，不是事后补救）
      const folder = (targetFolderRel || "").trim();
      if (folder.includes("..") || path.isAbsolute(folder)) {
        return { imported, skipped: [`非法目标目录：${targetFolderRel}`] };
      }

      for (const src of srcPaths) {
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

      if (imported.length > 0) broadcastNotesChanged(dirPath);
      log.info(`[notes] 导入完成：成功 ${imported.length}，跳过 ${skipped.length}`);
      return { imported, skipped };
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
    (_event, dirPath: string, parentRel: string): NoteFileEntry | null => {
      try {
        const image = clipboard.readImage();
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
