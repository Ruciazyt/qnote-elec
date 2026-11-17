import { ipcMain, dialog, BrowserWindow, shell } from "electron";
import { readClipboardImage } from "../../utils/clipboard";
import * as fs from "node:fs";
import * as path from "node:path";
import { FileWriter } from "../../core/notes/fileWriter";
import { NoteStore } from "../../core/notes/noteStore";
import { ExternalFolderStore } from "../../core/notes/externalFolderStore";
import { getMainWindow } from "../../core/window/mainWindow";
import { log } from "../../core/system/log";
import {
  ExternalFolder,
  NoteFileEntry,
  NoteTreeNode,
  NoteType,
  isNoteFile,
} from "../../../shared/notes/noteTypes";

const EXTERNAL_TREE_MAX_NODES = 3000;

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

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

export function registerFileHandlers(
  fileWriter: FileWriter,
  externalFolders: ExternalFolderStore
) {
  const noteStore = new NoteStore();

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


  ipcMain.handle("notes:tree", (_event, dirPath: string): NoteTreeNode[] => {
    return noteStore.tree(dirPath);
  });

  ipcMain.handle("notes:read", (_event, dirPath: string, relPath: string) => {
    try {
      return noteStore.read(dirPath, relPath);
    } catch (err) {
      log.error(`读取笔记失败: ${relPath}`, err);
      return null;
    }
  });

  ipcMain.handle("notes:write-text", (_event, dirPath: string, relPath: string, text: string) => {
    return noteStore.writeText(dirPath, relPath, text);
  });

  ipcMain.handle("notes:read-markdown", (_event, dirPath: string, relPath: string) => {
    try {
      return noteStore.readMarkdownWithAssets(dirPath, relPath);
    } catch (err) {
      log.error(`读取 Markdown 失败: ${relPath}`, err);
      return "";
    }
  });

  ipcMain.handle("notes:write-markdown", (_event, dirPath: string, relPath: string, md: string) => {
    return noteStore.writeMarkdownWithAssets(dirPath, relPath, md);
  });

  ipcMain.handle("notes:read-html", (_event, dirPath: string, relPath: string) => {
    try {
      return noteStore.readHtmlWithAssets(dirPath, relPath);
    } catch (err) {
      log.error(`读取 HTML 失败: ${relPath}`, err);
      return "";
    }
  });

  ipcMain.handle("notes:write-html", (_event, dirPath: string, relPath: string, html: string) => {
    return noteStore.writeHtmlWithAssets(dirPath, relPath, html);
  });

  ipcMain.handle("notes:save-asset", (_event, dirPath: string, dataUrl: string) => {
    return noteStore.saveAssetFromDataUrl(dirPath, dataUrl);
  });

  ipcMain.handle("notes:open-in-explorer", (_event, _dirPath: string, relPath: string) => {
    try {
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

  ipcMain.handle("notes:reveal-in-folder", (_event, _dirPath: string, relPath: string) => {
    try {
      if (!relPath) return false;
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

  ipcMain.handle(
    "notes:save-from-clipboard",
    (_event, dirPath: string, type: "text" | "image", content: string
  ): NoteFileEntry | null => {
    return noteStore.saveNoteFromClipboard(dirPath, type, content);
  });

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

  ipcMain.handle("notes:delete-folder", (_event, dirPath: string, relPath: string) => {
    return noteStore.deleteFolder(dirPath, relPath);
  });

  ipcMain.handle("notes:rename", (_event, dirPath: string, oldRel: string, newName: string) => {
    return noteStore.rename(dirPath, oldRel, newName);
  });

  ipcMain.handle("notes:create-folder", (_event, dirPath: string, parentRel: string, name: string) => {
    if (!noteStore.isValidFolderName(name)) return false;
    return noteStore.createFolder(dirPath, parentRel, name.trim());
  });

  ipcMain.handle(
    "notes:create-file",
    (_event, dirPath: string, parentRel: string, name: string, type: NoteType
    ) => noteStore.createNoteFile(dirPath, parentRel, name, type)
  );

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

  ipcMain.handle(
    "notes:move",
    (_event, dirPath: string, fromRel: string, toFolderRel: string
  ) => noteStore.move(dirPath, fromRel, toFolderRel));

  ipcMain.handle(
    "notes:save-clipboard-image",
    async (_event, dirPath: string, parentRel: string): Promise<NoteFileEntry | null> => {
      try {
        const image = await readClipboardImage();
        if (image.isEmpty()) return null;

        const relPath = noteStore.allocateImageName(dirPath, parentRel, ".png");
        if (!noteStore.writeBinary(dirPath, relPath, image.toPNG())) return null;

        return findEntry(noteStore.tree(dirPath), relPath) ?? null;
      } catch (err) {
        log.error("保存剪贴板图片失败", err);
        return null;
      }
    }
  );


  ipcMain.handle("notes:external-folders", async (): Promise<ExternalFolder[]> => {
    return externalFolders.list();
  });

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

  ipcMain.handle(
    "notes:remove-external-folder",
    async (_event, id: string): Promise<ExternalFolder[]> => {
      return externalFolders.remove(id);
    }
  );

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

  ipcMain.handle(
    "notes:external-reveal",
    async (
      _event,
      id: string,
      relPath: string,
      mode: "reveal" | "open" = "reveal"
    ): Promise<boolean> => {
      try {
        const folder = await externalFolders.get(id);
        if (!folder) return false;
        const rootAbs = path.resolve(folder.path);
        const abs = path.resolve(rootAbs, relPath || ".");
        const rel = path.relative(rootAbs, abs);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          throw new Error(`非法的路径: ${relPath}`);
        }
        if (mode === "open") {
          const failure = await shell.openPath(abs);
          if (failure) throw new Error(failure);
        } else {
          shell.showItemInFolder(abs);
        }
        return true;
      } catch (err) {
        log.error("定位外部文件夹条目失败", err);
        return false;
      }
    }
  );


  async function externalRoot(id: string): Promise<string | null> {
    const folder = await externalFolders.get(id);
    return folder?.path ?? null;
  }

  ipcMain.handle("notes:external-delete", async (_event, id: string, relPath: string) => {
    const root = await externalRoot(id);
    if (!root) return false;
    return noteStore.delete(root, relPath);
  });

  ipcMain.handle("notes:external-delete-folder", async (_event, id: string, relPath: string) => {
    const root = await externalRoot(id);
    if (!root) return false;
    return noteStore.deleteFolder(root, relPath);
  });

  ipcMain.handle(
    "notes:external-rename",
    async (_event, id: string, oldRel: string, newName: string) => {
      const root = await externalRoot(id);
      if (!root) return false;
      return noteStore.rename(root, oldRel, newName);
    }
  );

  ipcMain.handle(
    "notes:external-create-folder",
    async (_event, id: string, parentRel: string, name: string) => {
      const root = await externalRoot(id);
      if (!root) return false;
      if (!noteStore.isValidFolderName(name)) return false;
      return noteStore.createFolder(root, parentRel, name.trim());
    }
  );

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

async function importFilesInto(
  dirPath: string,
  srcPaths: string[],
  targetFolderRel: string
): Promise<{ imported: string[]; skipped: string[] }> {
  const imported: string[] = [];
  const skipped: string[] = [];

  const folder = (targetFolderRel || "").trim();
  if (folder.includes("..") || path.isAbsolute(folder)) {
    return { imported, skipped: [`非法目标目录：${targetFolderRel}`] };
  }

  for (const src of srcPaths || []) {
    const fileName = path.basename(src);
    if (!isNoteFile(fileName)) {
      skipped.push(fileName);
      continue;
    }
    try {
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

export function broadcastNotesChanged(root: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    w.webContents.send("notes:changed", root);
  }
}
