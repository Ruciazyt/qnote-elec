import { BrowserWindow, app, screen, nativeImage } from "electron";
import * as fs from "fs";
import * as path from "path";
import { log } from "../../utils/log";
import {
  StickyBounds,
  StickyHoldPayload,
  StickyNoteInit,
  StickyNotePatch,
  StickyNoteType,
} from "../../../shared/stickyNote";

/**
 * 屏幕便签 —— 把一条剪贴板记录变成压在桌面上的小纸条。
 *
 * ## 整体流程
 *
 *   1. 渲染层（剪贴板列表 / 剪贴板弹窗）鼠标按下一条记录，
 *      立刻发 `sticky:hold-begin`，主进程起一个长按会话
 *   2. 主进程每 16ms 读一次光标位置；**按住满 1.2 秒**，
 *      就在光标处开一张便签窗口，并让便签跟着光标走
 *   3. 渲染层发 `sticky:hold-end`（松手），会话结束，便签留在松手的位置
 *
 * 原来是"把记录拖出程序窗口"才生成便签，那条路太难被发现 ——
 * 现在改成按住 1.2 秒，按在哪就在哪生成。
 *
 * ## 为什么计时与光标都要在主进程做
 *
 * 渲染层拿到的 `MouseEvent.screenX/screenY` 是 CSS 像素，
 * 而 `BrowserWindow.getBounds()` 是 DIP（设备无关像素）。
 * Windows 缩放 125% / 150% 时两者对不上，用渲染层的坐标判断
 * 会让便签跟手不准。主进程的
 * `screen.getCursorScreenPoint()` 与 `getBounds()` 用的都是 DIP，
 * 天然对齐。
 *
 * 另一个原因：便签生成之后，光标就落在便签窗口上了，源窗口
 * （剪贴板弹窗失焦即隐藏）再也收不到事件。只有主进程的轮询
 * 不依赖源窗口是否还活着。
 */

const DEV_SERVER_URL = "http://localhost:5173";

/** 便签状态文件（相对 userData） */
const STORE_FILE = "sticky-notes.json";
/** 便签图片目录（相对 userData） */
const IMAGE_DIR = "sticky-images";

const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 200;
/**
 * 窗口尺寸下限
 *
 * 这两个值比"默认尺寸"小得多：文本便签的窗口大小是**按内容量出来的**，
 * 一句短话就该是一张小纸片（内容区 92px + 内边距 40px + 留白 32px ≈ 164px），
 * 用 180/120 卡着的话，短内容会被撑出一大片空白，就不是"正好包住内容"了。
 */
const MIN_WIDTH = 120;
const MIN_HEIGHT = 70;

/** 会话轮询间隔（毫秒）—— 16ms ≈ 60fps，肉眼看不出便签在"跳" */
const DRAG_POLL_INTERVAL = 16;
/**
 * 按住多久才生成便签（毫秒）
 *
 * 生成方式从"把记录拖出程序窗口"改成"按住不动"：按住满 1.2 秒，
 * 光标所在处就出现一张便签，之后便签跟着光标走，松手停在原地。
 */
const HOLD_DURATION_MS = 1200;
/**
 * 单次会话的最长存活时间
 *
 * 兜底：万一渲染层没发出结束通知（窗口在过程中被销毁），
 * 会话会永远挂着并一直轮询光标。60 秒足够一次，也足够让会话自己收摊。
 */
const DRAG_MAX_LIFETIME = 60_000;

interface StickyNoteRecord {
  id: string;
  type: StickyNoteType;
  text: string;
  /** 图片便签的落盘文件名（相对 IMAGE_DIR）；文本便签没有这一项 */
  imageFile?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  /**
   * 尺寸是否随内容自适应
   *
   * 默认 true —— 文本便签的窗口由渲染层量出正文占位后申请；
   * 用户拖过缩放手柄就转 false，把尺寸让给用户。
   */
  autoSize: boolean;
  createdAt: number;
}

interface DragSession {
  /**
   * 会话类型
   *
   * - "hold"：按住一条记录，满 1.2 秒生成一张新便签
   * - "move"：移动一张已经存在的便签
   */
  mode: "hold" | "move";
  /** hold 模式下的载荷；move 模式不用 */
  payload: StickyHoldPayload | null;
  timer: NodeJS.Timeout;
  startedAt: number;
  /** hold 模式下：便签还没生成时为 null */
  noteId: string | null;
  /** 光标相对便签左上角的偏移 */
  grabOffset: { x: number; y: number };
}

function getPreloadPath(): string {
  return path.join(__dirname, "..", "..", "preload.js");
}

/** data URL → Buffer（只取 base64 部分） */
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
  /** webContents.id → 便签 id，用来回答"这张便签窗口要显示什么" */
  private noteIdByWebContents = new Map<number, string>();
  private session: DragSession | null = null;
  private loaded = false;
  private saveTimer: NodeJS.Timeout | null = null;
  /** 正在整体销毁（应用退出）：此时窗口的 closed 事件不该删掉记录 */
  private tearingDown = false;
  /** 用户主动关掉的便签 id —— 只有这些才从状态文件里除名 */
  private userClosedIds = new Set<string>();

  /* ───────────────────── 持久化 ───────────────────── */

  private getStorePath(): string {
    return path.join(app.getPath("userData"), STORE_FILE);
  }

  private getImageDir(): string {
    return path.join(app.getPath("userData"), IMAGE_DIR);
  }

  /** 读一次状态文件；记录缺失或损坏时按"没有便签"处理 */
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
            // 老记录里没有这个字段，一律当"自适应"——
            // 便签尺寸本来就该跟着内容走，让旧便签也回到这个状态
            autoSize: item.autoSize !== false,
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
          };
          this.records.set(record.id, record);
        }
      }
    } catch {
      // 文件不存在 / 解析失败 —— 当作没有便签，不打扰用户
    }
  }

  /** 防抖写盘：拖动、缩放时高频触发，直接写会把磁盘打满 */
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

  /* ───────────────────── 图片 ───────────────────── */

  /** 把图片 data URL 落成文件，返回文件名；失败返回 null */
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

  /** 读回图片并转成 data URL —— 见 StickyNoteInit.imageDataUrl 的注释 */
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

  /* ───────────────────── 窗口 ───────────────────── */

  private createWindow(record: StickyNoteRecord): BrowserWindow {
    const win = new BrowserWindow({
      width: record.width,
      height: record.height,
      x: record.x,
      y: record.y,
      frame: false,
      // 便签要"浮在桌面上"，透明 + 无边框 + 无任务栏图标
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
        // 不指定 partition —— 用**默认 session**，与主窗口同一个存储。
        //
        // 之前写的是 `persist:main`，那是另一个独立 session：localStorage
        // 与主窗口不互通，用户在设置里选的主题便签根本读不到（读出来是 null，
        // 于是退化成跟随系统，看着就像"便签颜色和 App 对不上"）。
        // 便签的配色要跟 App 一致，主题存储就必须同源。
      },
    });

    this.applyAlwaysOnTop(win, record.alwaysOnTop);

    // 先把 webContents.id 存下来：
    // 窗口销毁之后再取 win.webContents 会抛 "Object has been destroyed"，
    // 而 closed 事件恰恰是在销毁之后才触发的。
    const webContentsId = win.webContents.id;

    if (!app.isPackaged) {
      win.loadURL(`${DEV_SERVER_URL}/sticky-note.html`);
    } else {
      win.loadFile(path.join(process.resourcesPath, "renderer", "dist", "sticky-note.html"));
    }

    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) win.show();
    });

    // 位置 / 尺寸变化 → 回写记录并持久化（用户手动拖动、改过大小都靠这条）
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
      // 应用整体退出时不算"用户关掉了便签"，记录要留着下次启动恢复
      if (this.tearingDown) return;
      // 只有用户点了便签上的关闭按钮，才算"这张便签不要了"。
      //
      // 别的关闭路径（应用退出、崩溃、进程被结束）一律**保留记录** ——
      // 窗口没了不代表便签没了，下次启动还应该把它摆回桌面。
      if (!this.userClosedIds.has(record.id)) return;
      this.userClosedIds.delete(record.id);
      this.records.delete(record.id);
      if (record.imageFile) {
        try {
          fs.unlinkSync(path.join(this.getImageDir(), record.imageFile));
        } catch {
          // 文件可能已经不在了，忽略
        }
      }
      this.scheduleSave();
    });

    this.windows.set(record.id, win);
    this.noteIdByWebContents.set(webContentsId, record.id);
    return win;
  }

  /**
   * 设置置顶层级
   *
   * "屏幕级"用 `screen-saver`：它压在所有普通窗口（含全屏应用）之上，
   * 这正是"屏幕级别的便签"该有的样子。切回"普通"时用 `floating`，
   * 只压在普通窗口之上，不会挡住全屏程序。
   */
  private applyAlwaysOnTop(win: BrowserWindow, alwaysOnTop: boolean): void {
    try {
      win.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? "screen-saver" : "floating");
    } catch (err) {
      log.warn("[sticky] 设置置顶层级失败，退回普通置顶:", err);
      try {
        win.setAlwaysOnTop(alwaysOnTop);
      } catch {
        /* 忽略 */
      }
    }
  }

  /* ───────────────────── 对外接口 ───────────────────── */

  /** 从一条剪贴板记录撕下一张便签 */
  createFromPayload(payload: StickyHoldPayload, cursor: { x: number; y: number }): string {
    this.load();
    const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

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
        // 图片便签的窗口就等于图片本身的大小 —— 不套卡片、不留内衬，
        // 贴到桌面上就是"截图本身"的样子。尺寸得在主进程算：
        // 渲染层拿不到图片的原始像素，只能拿到 data URL。
        const size = this.imageDisplaySize(fileName);
        record.width = size.width;
        record.height = size.height;
        record.x = Math.round(cursor.x - size.width / 2);
        record.y = Math.round(cursor.y - size.height / 2);
      } else {
        // 图片存不下来就退化成一张提示便签，别让用户什么都看不到
        record.type = "text";
        record.text = "（这张图片没能变成便签）";
      }
    }

    this.records.set(id, record);
    this.avoidOverlap(record);
    // 初始落点必须整张都在屏幕内 ——
    // 光标贴着屏幕边缘（甚至在多显示器的负坐标区）时，不夹一下便签就贴出去了。
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

  /**
   * 图片便签的显示尺寸
   *
   * 原则上就是图片的原始像素大小（1:1），贴到桌面上一像素不差。
   * 但 4K 截图按原尺寸贴上去会盖满整块屏幕，反而没法用 ——
   * 所以超出一屏的按比例缩到屏幕的 90%，长宽比保持不变。
   */
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

  /**
   * 新便签不要和已有便签**完全重叠**
   *
   * 连续在同一处撕下几张便签时，它们的落点会一模一样，于是叠成一摞 ——
   * 只看得见最上面一张，下面的既点不到也拖不动（窗口被完全遮挡时，
   * Chromium 会把页面标记为不可见并丢弃输入事件）。
   *
   * 这里按"扑克牌扇开"的方式逐张错开一点，落点就都能看得见、点得着。
   */
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

  /** 应用启动时把上次的便签重新摆出来 */
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

  /** 由 webContents 反查便签 id（渲染层没带 id 时的兜底） */
  getNoteIdByWebContents(webContentsId: number): string | undefined {
    return this.noteIdByWebContents.get(webContentsId);
  }

  /** 渲染层问"我这张便签该显示什么" */
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

  /** 修改便签（正文 / 置顶层级） */
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

  /** 设置便签位置 / 尺寸（渲染层自定义缩放手柄用） */
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

    // 尺寸模式与尺寸在同一次调用里改，避免中间态：
    // 窗口已经按手动尺寸变了、模式却还停在自适应，下一次内容变化
    // 就把用户刚拖出来的尺寸又缩回去。
    if (typeof bounds.autoSize === "boolean") {
      record.autoSize = bounds.autoSize;
    }

    win.setBounds({ x: nextX, y: nextY, width: nextWidth, height: nextHeight });
    record.x = nextX;
    record.y = nextY;

    /*
     * 拖拽过程中便签跟着光标走，靠的是"光标相对便签左上角的偏移"。
     * 尺寸一变，这个偏移就得跟着等比缩放 —— 否则偏移还是按旧尺寸算的，
     * 便签会在光标旁边偏出去一截（宽从 300 缩到 200，偏 50px）。
     */
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

  /** 关掉一张便签 */
  close(id?: string): { ok: boolean } {
    this.load();
    if (!id) return { ok: false };
    const win = this.windows.get(id);
    if (win && !win.isDestroyed()) {
      // 标记成"用户主动关的"，closed 事件据此决定要不要删记录
      this.userClosedIds.add(id);
      win.close();
      return { ok: true };
    }
    // 窗口已经不在了，把残留记录一并清掉
    const record = this.records.get(id);
    this.records.delete(id);
    if (record?.imageFile) {
      try {
        fs.unlinkSync(path.join(this.getImageDir(), record.imageFile));
      } catch {
        // 文件可能已经不在了，忽略
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

  /* ───────────────────── 会话（长按生成 / 移动便签） ───────────────────── */

  /**
   * 开始一次长按
   *
   * 渲染层在鼠标按下的瞬间就发过来 —— 1.2 秒的计时必须从"按下"起算，
   * 早一点发早一点开始计时。
   *
   * 会话在渲染层发出结束通知（松手）时结束；期间若按住满 1.2 秒，
   * 便签就在光标处生成，并跟着光标走直到松手。
   */
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

  /**
   * 移动一张已经存在的便签
   *
   * 渲染层负责判断"用户是在点击还是在拖动"，一旦确定是拖动就调这里，
   * 之后的移动由**主进程轮询光标**完成 ——
   * 渲染层的 clientX/clientY 是 CSS 像素，窗口坐标是 DIP，
   * Windows 缩放不是 100% 时两者对不上，用渲染层的坐标会让便签跟手不准。
   *
   * `anchor` 是按下鼠标时那一点在窗口内的位置。抓住哪儿就贴哪儿 ——
   * 若改用"此刻光标的位置"来算，等判定出拖动时鼠标已经挪了几像素，
   * 便签会在起手时往回跳一下。
   */
  beginMove(id: string, anchor?: { x: number; y: number }): { ok: boolean } {
    this.load();
    const record = this.records.get(id);
    const win = this.windows.get(id);
    if (!record || !win || win.isDestroyed()) return { ok: false };

    // 同一时间只允许一个移动会话
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
      // 锚点必须落在窗口内，否则说明两个坐标系没对上，退回用光标位置算
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
      // 抓住的是便签的哪个位置，就一直保持那个位置在光标下
      grabOffset: grab,
    };
    log.info("[sticky] 开始移动便签", { id, grab });
    return { ok: true };
  }

  /** 渲染层结束会话（松手） */
  endDrag(): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    clearInterval(session.timer);
    log.info("[sticky] 结束会话", { noteId: session.noteId, mode: session.mode });
  }

  /**
   * 会话里有没有正在进行的长按
   *
   * 剪贴板弹窗失焦就隐藏 —— 而长按到生成便签的过程中，弹窗随时可能失焦，
   * 一藏窗口，用户按着的那张卡就没了，1.2 秒也白按。
   * 所以弹窗要靠这个标志判断"现在正在长按，别急着藏"。
   *
   * 只认"长按生成"这一种：移动已有便签跟弹窗没关系，
   * 把它算进去会让弹窗在无关的时候赖着不走。
   */
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
      // 还没生成便签：按住满 1.2 秒才生成
      if (Date.now() - session.startedAt < HOLD_DURATION_MS) return;
      if (!session.payload) return;

      const id = this.createFromPayload(session.payload, cursor);
      session.noteId = id;
      const record = this.records.get(id);
      // 光标落在便签正中，往后便签就跟着光标走
      session.grabOffset = {
        x: record ? record.width / 2 : DEFAULT_WIDTH / 2,
        y: record ? record.height / 2 : DEFAULT_HEIGHT / 2,
      };
      return;
    }

    // 便签已经生成：它跟着光标走
    const win = this.windows.get(session.noteId);
    if (!win || win.isDestroyed()) {
      this.endDrag();
      return;
    }
    const bounds = win.getBounds();

    /*
     * 移动会话的兜底：光标跑出便签窗口就收摊。
     *
     * 便签是跟着光标走的，正常情况下光标始终落在便签上（抓哪儿就贴哪儿），
     * 渲染层一定收得到 pointerup，会话也会正常结束。
     * 只有便签被夹到屏幕边缘、夹得光标落到便签之外时，渲染层才收不到
     * pointerup —— 这时若不收摊，便签会一直跟着光标跑，停不下来。
     */
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

  /**
   * 把便签整张夹进屏幕工作区内
   *
   * 与 clampToWorkArea 的区别：那个是**拖拽过程中**用的，允许便签有一半
   * 挂在屏幕外（跟手）；这个是**落点**用的，保证便签整张都在屏幕里 ——
   * 光标在屏幕边缘、甚至多显示器的负坐标区时，便签不能贴出去找不着。
   */
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

  /** 便签别被拖出屏幕 —— 至少留一半在可视区里 */
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

  /* ───────────────────── 收尾 ───────────────────── */

  /** 应用退出：关掉所有便签窗口，但**保留记录**供下次启动恢复 */
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
