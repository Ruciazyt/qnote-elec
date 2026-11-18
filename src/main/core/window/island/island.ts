import { BrowserWindow, screen, app } from "electron";
import * as path from "node:path";
import { log } from "../../system/log";
import { getPreloadPath } from "../../../utils/paths";
import {
  ISLAND_COLLAPSED_HEIGHT,
  ISLAND_COLLAPSED_MAX_WIDTH,
  ISLAND_COLLAPSED_MIN_WIDTH,
  ISLAND_COLLAPSE_DURATION,
  ISLAND_EXPAND_DURATION,
  ISLAND_EXPANDED_HEIGHT,
  ISLAND_EXPANDED_WIDTH,
  ISLAND_SHADOW_PAD_X,
  ISLAND_SHADOW_PAD_Y,
  ISLAND_SNAP_TOP_DISTANCE,
  type IslandAttachMode,
  type IslandPage,
  type IslandPosition,
  type IslandSize,
  type IslandSnapshot,
} from "../../../../shared/island/island";

const DEV_SERVER_URL = "http://localhost:5173";

const ISLAND_TOP_LEVEL = "screen-saver";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function findDisplay(displayId: number | null): Electron.Display {
  if (displayId == null) return screen.getPrimaryDisplay();
  return screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
}

function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class IslandWindow {
  private static instance: IslandWindow;

  private win: BrowserWindow | null = null;
  private ready = false;

  private currentSize: IslandSize = {
    width: ISLAND_COLLAPSED_MIN_WIDTH,
    height: ISLAND_COLLAPSED_HEIGHT,
  };

  private collapsedWidth = ISLAND_COLLAPSED_MIN_WIDTH;

  private expanded = false;
  private page: IslandPage = "todo";
  private attachMode: IslandAttachMode = "attached";
  private cardPos: IslandPosition | null = null;
  private displayId: number | null = null;

  private dragging = false;
  private dragAnchor: { cardX: number; cardY: number; screenX: number; screenY: number } | null = null;

  private animTimer: NodeJS.Timeout | null = null;
  private interactive = true;
  private pendingInteractive: boolean | null = null;

  private hadFocus = false;

  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  static getInstance(): IslandWindow {
    if (!IslandWindow.instance) {
      IslandWindow.instance = new IslandWindow();
    }
    return IslandWindow.instance;
  }


  show(): void {
    if (!this.win || this.win.isDestroyed()) {
      this.win = this.create();
    }
    const win = this.win;
    if (!win) return;

    this.applyBounds();
    this.applyInteractive(true);
    if (this.ready) {
      win.showInactive();
      this.raiseToTop();
    }
  }

  hide(): void {
    this.win?.hide();
  }

  isVisible(): boolean {
    return this.win?.isVisible() ?? false;
  }

  send(channel: string, payload?: unknown): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send(channel, payload);
  }

  destroy(): void {
    this.cancelAnimation();
    if (this.win) {
      this.win.removeAllListeners();
      this.win.destroy();
      this.win = null;
    }
    this.ready = false;
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: ISLAND_COLLAPSED_MIN_WIDTH + ISLAND_SHADOW_PAD_X * 2,
      height: ISLAND_COLLAPSED_HEIGHT + ISLAND_SHADOW_PAD_Y,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    if (process.platform === "darwin") {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    this.win = win;

    if (!app.isPackaged) {
      win.loadURL(`${DEV_SERVER_URL}/island.html`).catch((error) => {
        log.error("[island] 加载开发服务器页面失败:", error);
      });
    } else {
      const htmlPath = path.join(process.resourcesPath, "renderer", "dist", "island.html");
      log.info("[island] 加载 HTML:", htmlPath);
      win.loadFile(htmlPath).catch((error) => {
        log.error("[island] 加载 HTML 失败:", error);
      });
    }

    win.once("ready-to-show", () => {
      this.ready = true;
      if (win.isDestroyed()) return;
      this.applyBounds();
      win.showInactive();
      this.raiseToTop();
    });

    win.on("focus", () => {
      this.hadFocus = true;
    });
    win.on("blur", () => {
      const shouldCollapse = this.hadFocus && this.expanded;
      this.hadFocus = false;
      if (shouldCollapse) this.collapse();
    });

    win.on("closed", () => {
      this.win = null;
      this.ready = false;
    });

    log.info("[island] 窗口创建成功");
    return win;
  }


  getSnapshot(): IslandSnapshot {
    return {
      expanded: this.expanded,
      page: this.page,
      attachMode: this.attachMode,
      size: { ...this.currentSize },
      position: this.getCardPos(),
    };
  }

  private getCardPos(): IslandPosition {
    const bounds = this.win?.getBounds();
    if (!bounds) return this.cardPos ? { ...this.cardPos } : { x: 0, y: 0 };
    return { x: bounds.x + ISLAND_SHADOW_PAD_X, y: bounds.y };
  }

  setPage(page: IslandPage): void {
    if (this.page === page) return;
    this.page = page;
    this.pushState();
  }

  setCollapsedWidth(width: number): void {
    if (!Number.isFinite(width) || width <= 0) return;
    const clamped = Math.round(
      Math.min(ISLAND_COLLAPSED_MAX_WIDTH, Math.max(ISLAND_COLLAPSED_MIN_WIDTH, width))
    );
    if (clamped === this.collapsedWidth) return;
    this.collapsedWidth = clamped;
    if (!this.expanded && !this.animTimer) {
      this.currentSize = { width: clamped, height: ISLAND_COLLAPSED_HEIGHT };
      this.applyBounds();
    }
  }

  expand(): void {
    if (this.expanded) return;
    this.expanded = true;
    this.pushState();
    this.animateTo(
      { width: ISLAND_EXPANDED_WIDTH, height: ISLAND_EXPANDED_HEIGHT },
      ISLAND_EXPAND_DURATION,
      easeOutQuint
    );
  }

  collapse(): void {
    if (!this.expanded) return;
    this.expanded = false;
    this.pushState();
    this.animateTo(
      { width: this.collapsedWidth, height: ISLAND_COLLAPSED_HEIGHT },
      ISLAND_COLLAPSE_DURATION,
      easeOutCubic
    );
  }

  toggle(): void {
    if (this.expanded) this.collapse();
    else this.expand();
  }

  private pushState(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send("island:state", this.getSnapshot());
  }


  private getDisplay() {
    return findDisplay(this.displayId);
  }

  private computeCardPos(size: IslandSize): IslandPosition {
    const area = this.getDisplay().workArea;
    const maxX = area.x + area.width - size.width;
    const maxY = area.y + area.height - size.height;
    const clamp = (value: number, min: number, max: number) =>
      Math.round(Math.min(Math.max(value, min), Math.max(min, max)));

    if (this.attachMode === "attached") {
      const x = this.cardPos
        ? clamp(this.cardPos.x, area.x, maxX)
        : clamp(area.x + (area.width - size.width) / 2, area.x, maxX);
      return { x, y: area.y };
    }

    const base = this.cardPos ?? {
      x: area.x + (area.width - size.width) / 2,
      y: area.y,
    };
    return {
      x: clamp(base.x, area.x, maxX),
      y: clamp(base.y, area.y, maxY),
    };
  }

  private windowBounds(card: IslandPosition, size: IslandSize): Electron.Rectangle {
    return {
      x: card.x - ISLAND_SHADOW_PAD_X,
      y: card.y,
      width: size.width + ISLAND_SHADOW_PAD_X * 2,
      height: size.height + ISLAND_SHADOW_PAD_Y,
    };
  }

  private applyBounds(): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.dragging) return;
    const next = this.windowBounds(this.computeCardPos(this.currentSize), this.currentSize);
    const current = this.win.getBounds();
    if (
      current.x === next.x &&
      current.y === next.y &&
      current.width === next.width &&
      current.height === next.height
    ) {
      return;
    }
    this.win.setBounds(next, false);
  }

  private animateTo(target: IslandSize, duration: number, ease: (t: number) => number): void {
    this.cancelAnimation();
    const start = { ...this.currentSize };
    const startedAt = Date.now();

    const step = () => {
      const elapsed = Date.now() - startedAt;
      const raw = Math.min(1, elapsed / duration);
      const eased = ease(raw);
      this.currentSize = {
        width: Math.round(lerp(start.width, target.width, eased)),
        height: Math.round(lerp(start.height, target.height, eased)),
      };
      this.applyBounds();

      if (raw < 1) {
        this.animTimer = setTimeout(step, 16);
      } else {
        this.animTimer = null;
        this.currentSize = { ...target };
        this.applyBounds();
      }
    };
    step();
  }

  private cancelAnimation(): void {
    if (this.animTimer) {
      clearTimeout(this.animTimer);
      this.animTimer = null;
    }
  }


  beginDrag(screenX: number, screenY: number): void {
    if (!this.win || this.win.isDestroyed()) return;
    const bounds = this.win.getBounds();
    this.dragging = true;
    this.dragAnchor = {
      cardX: bounds.x + ISLAND_SHADOW_PAD_X,
      cardY: bounds.y,
      screenX,
      screenY,
    };
    this.cancelAnimation();
  }

  dragTo(screenX: number, screenY: number): void {
    if (!this.dragging || !this.dragAnchor || !this.win || this.win.isDestroyed()) return;
    const dx = screenX - this.dragAnchor.screenX;
    const dy = screenY - this.dragAnchor.screenY;
    const cardX = this.dragAnchor.cardX + dx;
    const cardY = this.dragAnchor.cardY + dy;
    this.cardPos = { x: cardX, y: cardY };
    this.win.setPosition(Math.round(cardX - ISLAND_SHADOW_PAD_X), Math.round(cardY), false);
  }

  endDrag(): { attachMode: IslandAttachMode; position: IslandPosition | null; displayId: number } {
    this.dragging = false;
    if (this.pendingInteractive !== null) {
      const pending = this.pendingInteractive;
      this.pendingInteractive = null;
      this.applyInteractive(pending);
    }
    if (!this.win || this.win.isDestroyed()) {
      return {
        attachMode: this.attachMode,
        position: this.cardPos ? { ...this.cardPos } : null,
        displayId: this.displayId ?? screen.getPrimaryDisplay().id,
      };
    }
    const bounds = this.win.getBounds();
    const cardX = bounds.x + ISLAND_SHADOW_PAD_X;
    const cardY = bounds.y;

    const display = screen.getDisplayNearestPoint({
      x: cardX + this.currentSize.width / 2,
      y: cardY + this.currentSize.height / 2,
    });
    this.displayId = display.id;

    const distanceToTop = cardY - display.workArea.y;
    this.attachMode = distanceToTop <= ISLAND_SNAP_TOP_DISTANCE ? "attached" : "floating";
    this.cardPos = { x: cardX, y: cardY };

    this.applyBounds();
    const settled = this.getCardPos();
    this.cardPos = settled;
    this.pushState();
    return { attachMode: this.attachMode, position: { ...settled }, displayId: this.displayId };
  }

  isDragging(): boolean {
    return this.dragging;
  }



  resetPosition(): void {
    this.attachMode = "attached";
    this.cardPos = null;
    this.displayId = null;
    this.applyBounds();
  }

  applyAttachMode(
    mode: IslandAttachMode,
    position: IslandPosition | null,
    displayId: number | null
  ): void {
    this.attachMode = mode;
    this.cardPos = position ? { ...position } : null;
    if (displayId != null) this.displayId = displayId;
    this.applyBounds();
  }

  private raiseToTop(): void {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.setAlwaysOnTop(true, ISLAND_TOP_LEVEL);
    } catch (err) {
      log.warn("[island] 设置置顶层级失败，退回普通置顶:", err);
      try {
        this.win.setAlwaysOnTop(true);
      } catch {
      }
    }
  }

  setInteractive(interactive: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.dragging) {
      this.pendingInteractive = interactive;
      return;
    }
    this.applyInteractive(interactive);
  }

  private applyInteractive(interactive: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.interactive === interactive) return;
    this.interactive = interactive;
    this.win.setIgnoreMouseEvents(!interactive, { forward: true });
  }
}
