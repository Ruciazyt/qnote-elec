import { BrowserWindow, app, screen, nativeImage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { log } from "../../system/log";
import { getPreloadPath } from "../../../utils/paths";
import {
  StickyBounds,
  StickyHoldPayload,
  StickyNoteInit,
  StickyNotePatch,
  StickyNoteType,
} from "../../../../shared/sticky/stickyNote";


const DEV_SERVER_URL = "http://localhost:5173";

const STORE_FILE = "sticky-notes.json";
const IMAGE_DIR = "sticky-images";

const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 200;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 70;

const DRAG_POLL_INTERVAL = 16;
const HOLD_DURATION_MS = 1200;
const DRAG_MAX_LIFETIME = 60_000;

interface StickyNoteRecord {
  id: string;
  type: StickyNoteType;
  text: string;
  imageFile?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  autoSize: boolean;
  createdAt: number;
}

interface DragSession {
  mode: "hold" | "move";
  payload: StickyHoldPayload | null;
  timer: NodeJS.Timeout;
  startedAt: number;
  noteId: string | null;
  grabOffset: { x: number; y: number };
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const payload = match[3] ?? "";
  try {
    const buffer = match[2]
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { buffer, mime };
  } catch {
    return null;
  }
}

function mimeToExtension(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

function isPointOutsideBounds(
  point: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    point.x < bounds.x ||
    point.y < bounds.y ||
    point.x > bounds.x + bounds.width ||
    point.y > bounds.y + bounds.height
  );
}

class StickyNoteManager {
  private records = new Map<string, StickyNoteRecord>();
  private windows = new Map<string, BrowserWindow>();
  private noteIdByWebContents = new Map<number, string>();
  private session: DragSession | null = null;
  private loaded = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private tearingDown = false;
  private userClosedIds = new Set<string>();


  private getStorePath(): string {
    return path.join(app.getPath("userData"), STORE_FILE);
  }

  private getImageDir(): string {
    return path.join(app.getPath("userData"), IMAGE_DIR);
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = fs.readFileSync(this.getStorePath(), "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item.id !== "string") continue;
          const record: StickyNoteRecord = {
            id: item.id,
            type: item.type === "image" ? "image" : "text",
            text: typeof item.text === "string" ? item.text : "",
            imageFile: typeof item.imageFile === "string" ? item.imageFile : undefined,
            x: Number.isFinite(item.x) ? item.x : 100,
            y: Number.isFinite(item.y) ? item.y : 100,
            width: Number.isFinite(item.width) ? item.width : DEFAULT_WIDTH,
            height: Number.isFinite(item.height) ? item.height : DEFAULT_HEIGHT,
            alwaysOnTop: item.alwaysOnTop !== false,
            autoSize: item.autoSize !== false,
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
          };
          this.records.set(record.id, record);
        }
      }
    } catch {
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 300);
  }

  private saveNow(): void {
    try {
      const list = Array.from(this.records.values());
      fs.writeFileSync(this.getStorePath(), JSON.stringify(list, null, 2), "utf8");
    } catch (err) {
      log.error("[sticky] 保存便签状态失败:", err);
    }
  }


  private writeImageFile(id: string, dataUrl: string): string | null {
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) return null;
    try {
      const dir = this.getImageDir();
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const fileName = `${id}.${mimeToExtension(decoded.mime)}`;
      fs.writeFileSync(path.join(dir, fileName), decoded.buffer);
      return fileName;
    } catch (err) {
      log.error("[sticky] 便签图片落盘失败:", err);
      return null;
    }
  }

  private readImageDataUrl(record: StickyNoteRecord): string | undefined {
    if (!record.imageFile) return undefined;
    try {
      const filePath = path.join(this.getImageDir(), record.imageFile);
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(record.imageFile).replace(".", "").toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch (err) {
      log.error("[sticky] 读取便签图片失败:", err);
      return undefined;
    }
  }


  private createWindow(record: StickyNoteRecord): BrowserWindow {
    const win = new BrowserWindow({
      width: record.width,
      height: record.height,
      x: record.x,
      y: record.y,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.applyAlwaysOnTop(win, record.alwaysOnTop);

    const webContentsId = win.webContents.id;

    if (!app.isPackaged) {
      win.loadURL(`${DEV_SERVER_URL}/sticky-note.html`).catch((error) => {
        log.error("[stickyNote] 加载开发服务器页面失败:", error);
      });
    } else {
      win.loadFile(path.join(process.resourcesPath, "renderer", "dist", "sticky-note.html")).catch((error) => {
        log.error("[stickyNote] 加载 HTML 失败:", error);
      });
    }

    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) win.show();
    });

    const syncBounds = () => {
      if (win.isDestroyed()) return;
      const bounds = win.getBounds();
      const current = this.records.get(record.id);
      if (!current) return;
      current.x = bounds.x;
      current.y = bounds.y;
      current.width = bounds.width;
      current.height = bounds.height;
      this.scheduleSave();
    };
    win.on("move", syncBounds);
    win.on("resize", syncBounds);

    win.on("closed", () => {
      this.windows.delete(record.id);
      this.noteIdByWebContents.delete(webContentsId);
      if (this.tearingDown) return;
      if (!this.userClosedIds.has(record.id)) return;
      this.userClosedIds.delete(record.id);
      this.records.delete(record.id);
      if (record.imageFile) {
        try {
          fs.unlinkSync(path.join(this.getImageDir(), record.imageFile));
        } catch {
        }
      }
      this.scheduleSave();
    });

    this.windows.set(record.id, win);
    this.noteIdByWebContents.set(webContentsId, record.id);
    return win;
  }

  private applyAlwaysOnTop(win: BrowserWindow, alwaysOnTop: boolean): void {
    try {
      win.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? "screen-saver" : "floating");
    } catch (err) {
      log.warn("[sticky] 设置置顶层级失败，退回普通置顶:", err);
      try {
        win.setAlwaysOnTop(alwaysOnTop);
      } catch {
      }
    }
  }


  createFromPayload(payload: StickyHoldPayload, cursor: { x: number; y: number }): string {
    this.load();
    const id = `s${Date.now().toString(36)}${randomUUID().slice(0, 5)}`;

    const record: StickyNoteRecord = {
      id,
      type: payload.type === "image" ? "image" : "text",
      text: payload.type === "text" ? payload.content : "",
      x: Math.round(cursor.x - DEFAULT_WIDTH / 2),
      y: Math.round(cursor.y - DEFAULT_HEIGHT / 2),
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      alwaysOnTop: true,
      autoSize: true,
      createdAt: Date.now(),
    };

    if (payload.type === "image") {
      const fileName = this.writeImageFile(id, payload.content);
      if (fileName) {
        record.imageFile = fileName;
        const size = this.imageDisplaySize(fileName);
        record.width = size.width;
        record.height = size.height;
        record.x = Math.round(cursor.x - size.width / 2);
        record.y = Math.round(cursor.y - size.height / 2);
      } else {
        record.type = "text";
        record.text = "（这张图片没能变成便签）";
      }
    }

    this.records.set(id, record);
    this.avoidOverlap(record);
    const inside = this.clampIntoWorkArea(
      { x: record.x, y: record.y },
      { width: record.width, height: record.height },
      cursor
    );
    record.x = inside.x;
    record.y = inside.y;
    this.createWindow(record);
    this.scheduleSave();
    log.info("[sticky] 新建便签", {
      id,
      type: record.type,
      x: record.x,
      y: record.y,
      size: `${record.width}x${record.height}`,
    });
    return id;
  }

  private imageDisplaySize(fileName: string): { width: number; height: number } {
    try {
      const filePath = path.join(this.getImageDir(), fileName);
      const image = nativeImage.createFromPath(filePath);
      const { width, height } = image.getSize();
      if (width <= 0 || height <= 0) {
        return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
      }
      const area = screen.getPrimaryDisplay().workAreaSize;
      const scale = Math.min(
        1,
        (area.width * 0.9) / width,
        (area.height * 0.9) / height
      );
      return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      };
    } catch (err) {
      log.error("[sticky] 读取图片尺寸失败:", err);
      return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    }
  }

  private avoidOverlap(record: StickyNoteRecord): void {
    const STEP = 24;
    for (let i = 0; i < 20; i++) {
      const clash = Array.from(this.records.values()).some(
        (other) =>
          other.id !== record.id &&
          Math.abs(other.x - record.x) < 8 &&
          Math.abs(other.y - record.y) < 8
      );
      if (!clash) return;
      record.x += STEP;
      record.y += STEP;
    }
  }

  restoreAll(): void {
    this.load();
    if (this.records.size === 0) return;
    for (const record of this.records.values()) {
      try {
        this.createWindow(record);
      } catch (err) {
        log.error("[sticky] 恢复便签失败:", err);
      }
    }
    log.info("[sticky] 已恢复便签", { count: this.records.size });
  }

  getNoteIdByWebContents(webContentsId: number): string | undefined {
    return this.noteIdByWebContents.get(webContentsId);
  }

  getInit(webContentsId: number): StickyNoteInit | null {
    this.load();
    const noteId = this.noteIdByWebContents.get(webContentsId);
    if (!noteId) return null;
    const record = this.records.get(noteId);
    if (!record) return null;
    return {
      id: record.id,
      type: record.type,
      text: record.text,
      imageDataUrl: record.type === "image" ? this.readImageDataUrl(record) : undefined,
      alwaysOnTop: record.alwaysOnTop,
      autoSize: record.autoSize,
      width: record.width,
      height: record.height,
      createdAt: record.createdAt,
    };
  }

  update(patch: StickyNotePatch): { ok: boolean; error?: string } {
    this.load();
    const id = patch.id;
    if (!id) return { ok: false, error: "缺少便签 id" };
    const record = this.records.get(id);
    if (!record) return { ok: false, error: "便签不存在" };
    const win = this.windows.get(id);

    if (typeof patch.text === "string") {
      record.text = patch.text;
    }
    if (typeof patch.alwaysOnTop === "boolean") {
      record.alwaysOnTop = patch.alwaysOnTop;
      if (win && !win.isDestroyed()) {
        this.applyAlwaysOnTop(win, record.alwaysOnTop);
      }
    }
    if (typeof patch.autoSize === "boolean") {
      record.autoSize = patch.autoSize;
    }
    this.scheduleSave();
    return { ok: true };
  }

  setBounds(bounds: StickyBounds): { ok: boolean; error?: string } {
    this.load();
    const id = bounds.id;
    if (!id) return { ok: false, error: "缺少便签 id" };
    const record = this.records.get(id);
    const win = this.windows.get(id);
    if (!record || !win || win.isDestroyed()) return { ok: false, error: "便签不存在" };

    const nextWidth = Math.max(
      MIN_WIDTH,
      Math.round(bounds.width ?? record.width)
    );
    const nextHeight = Math.max(
      MIN_HEIGHT,
      Math.round(bounds.height ?? record.height)
    );
    const nextX = Math.round(bounds.x ?? record.x);
    const nextY = Math.round(bounds.y ?? record.y);

    if (typeof bounds.autoSize === "boolean") {
      record.autoSize = bounds.autoSize;
    }

    win.setBounds({ x: nextX, y: nextY, width: nextWidth, height: nextHeight });
    record.x = nextX;
    record.y = nextY;

    if (this.session?.noteId === id && record.width > 0 && record.height > 0) {
      this.session.grabOffset = {
        x: (this.session.grabOffset.x / record.width) * nextWidth,
        y: (this.session.grabOffset.y / record.height) * nextHeight,
      };
    }

    record.width = nextWidth;
    record.height = nextHeight;
    this.scheduleSave();
    return { ok: true };
  }

  close(id?: string): { ok: boolean } {
    this.load();
    if (!id) return { ok: false };
    const win = this.windows.get(id);
    if (win && !win.isDestroyed()) {
      this.userClosedIds.add(id);
      win.close();
      return { ok: true };
    }
    const record = this.records.get(id);
    this.records.delete(id);
    if (record?.imageFile) {
      try {
        fs.unlinkSync(path.join(this.getImageDir(), record.imageFile));
      } catch {
      }
    }
    this.scheduleSave();
    return { ok: true };
  }

  list(): StickyNoteInit[] {
    this.load();
    const result: StickyNoteInit[] = [];
    for (const record of this.records.values()) {
      result.push({
        id: record.id,
        type: record.type,
        text: record.text,
        imageDataUrl: record.type === "image" ? this.readImageDataUrl(record) : undefined,
        alwaysOnTop: record.alwaysOnTop,
        autoSize: record.autoSize,
        width: record.width,
        height: record.height,
        createdAt: record.createdAt,
      });
    }
    return result;
  }


  beginHold(payload: StickyHoldPayload): void {
    this.endDrag();
    if (!payload || (payload.type !== "text" && payload.type !== "image")) return;
    if (typeof payload.content !== "string" || payload.content.length === 0) return;

    const session: DragSession = {
      mode: "hold",
      payload,
      timer: setInterval(() => this.tickDrag(), DRAG_POLL_INTERVAL),
      startedAt: Date.now(),
      noteId: null,
      grabOffset: { x: 0, y: 0 },
    };
    this.session = session;
    log.info("[sticky] 开始长按会话", { type: payload.type });
  }

  beginMove(id: string, anchor?: { x: number; y: number }): { ok: boolean } {
    this.load();
    const record = this.records.get(id);
    const win = this.windows.get(id);
    if (!record || !win || win.isDestroyed()) return { ok: false };

    this.endDrag();

    let cursor: { x: number; y: number };
    try {
      cursor = screen.getCursorScreenPoint();
    } catch {
      return { ok: false };
    }
    const bounds = win.getBounds();

    let grab = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
      if (anchor.x >= 0 && anchor.x <= bounds.width && anchor.y >= 0 && anchor.y <= bounds.height) {
        grab = { x: anchor.x, y: anchor.y };
      }
    }

    this.session = {
      mode: "move",
      payload: null,
      timer: setInterval(() => this.tickDrag(), DRAG_POLL_INTERVAL),
      startedAt: Date.now(),
      noteId: id,
      grabOffset: grab,
    };
    log.info("[sticky] 开始移动便签", { id, grab });
    return { ok: true };
  }

  endDrag(): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    clearInterval(session.timer);
    log.info("[sticky] 结束会话", { noteId: session.noteId, mode: session.mode });
  }

  isDragActive(): boolean {
    return this.session !== null && this.session.mode === "hold";
  }

  private tickDrag(): void {
    const session = this.session;
    if (!session) return;

    if (Date.now() - session.startedAt > DRAG_MAX_LIFETIME) {
      this.endDrag();
      return;
    }

    let cursor: { x: number; y: number };
    try {
      cursor = screen.getCursorScreenPoint();
    } catch {
      return;
    }

    if (!session.noteId) {
      if (Date.now() - session.startedAt < HOLD_DURATION_MS) return;
      if (!session.payload) return;

      const id = this.createFromPayload(session.payload, cursor);
      session.noteId = id;
      const record = this.records.get(id);
      session.grabOffset = {
        x: record ? record.width / 2 : DEFAULT_WIDTH / 2,
        y: record ? record.height / 2 : DEFAULT_HEIGHT / 2,
      };
      return;
    }

    const win = this.windows.get(session.noteId);
    if (!win || win.isDestroyed()) {
      this.endDrag();
      return;
    }
    const bounds = win.getBounds();

    if (session.mode === "move" && isPointOutsideBounds(cursor, bounds)) {
      this.endDrag();
      return;
    }

    const position = this.clampToWorkArea(
      { x: cursor.x - session.grabOffset.x, y: cursor.y - session.grabOffset.y },
      { width: bounds.width, height: bounds.height },
      cursor
    );
    win.setPosition(position.x, position.y);
  }

  private clampIntoWorkArea(
    position: { x: number; y: number },
    size: { width: number; height: number },
    cursor: { x: number; y: number }
  ): { x: number; y: number } {
    try {
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      const maxX = Math.max(area.x, area.x + area.width - size.width);
      const maxY = Math.max(area.y, area.y + area.height - size.height);
      return {
        x: Math.round(Math.min(Math.max(position.x, area.x), maxX)),
        y: Math.round(Math.min(Math.max(position.y, area.y), maxY)),
      };
    } catch {
      return { x: Math.round(position.x), y: Math.round(position.y) };
    }
  }

  private clampToWorkArea(
    position: { x: number; y: number },
    size: { width: number; height: number },
    cursor: { x: number; y: number }
  ): { x: number; y: number } {
    try {
      const display = screen.getDisplayNearestPoint(cursor);
      const area = display.workArea;
      const minX = area.x - Math.floor(size.width / 2);
      const maxX = area.x + area.width - Math.ceil(size.width / 2);
      const minY = area.y;
      const maxY = area.y + area.height - Math.ceil(size.height / 2);
      return {
        x: Math.round(Math.min(Math.max(position.x, minX), Math.max(minX, maxX))),
        y: Math.round(Math.min(Math.max(position.y, minY), Math.max(minY, maxY))),
      };
    } catch {
      return { x: Math.round(position.x), y: Math.round(position.y) };
    }
  }


  destroyAll(): void {
    this.tearingDown = true;
    this.endDrag();
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.windows.clear();
    this.noteIdByWebContents.clear();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();
    this.tearingDown = false;
  }
}

export const stickyNoteManager = new StickyNoteManager();
