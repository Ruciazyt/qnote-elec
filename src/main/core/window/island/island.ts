import { BrowserWindow, screen, app } from "electron";
import * as path from "node:path";
import { log } from "../../system/log";
import { getPreloadPath } from "../../../utils/paths";
import {
  ISLAND_COLLAPSED_HEIGHT,
  ISLAND_COLLAPSE_DURATION,
  ISLAND_EXPAND_DURATION,
  ISLAND_EXPANDED_HEIGHT,
  ISLAND_EXPANDED_WIDTH,
  ISLAND_SNAP_EDGE_DISTANCE,
  ISLAND_STRIP_WIDTH,
  type IslandAttachMode,
  type IslandDockEdge,
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
    width: ISLAND_EXPANDED_WIDTH,
    height: ISLAND_COLLAPSED_HEIGHT,
  };

  private expanded = false;
  private page: IslandPage = "clipboard";
  private attachMode: IslandAttachMode = "attached";
  private dockEdge: IslandDockEdge = "top";
  private cardPos: IslandPosition | null = null;
  private displayId: number | null = null;

  private dragging = false;
  private dragAnchor: { cardX: number; cardY: number; screenX: number; screenY: number } | null = null;
  private lastPointer: { x: number; y: number } | null = null;

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

  private collapsedSize(): IslandSize {
    if (this.dockEdge === "top") {
      return { width: ISLAND_EXPANDED_WIDTH, height: ISLAND_COLLAPSED_HEIGHT };
    }
    return { width: ISLAND_STRIP_WIDTH, height: ISLAND_EXPANDED_HEIGHT };
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
      width: ISLAND_EXPANDED_WIDTH,
      height: ISLAND_COLLAPSED_HEIGHT,
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
      dockEdge: this.dockEdge,
      size: { ...this.currentSize },
      position: this.getCardPos(),
    };
  }

  private getCardPos(): IslandPosition {
    const bounds = this.win?.getBounds();
    if (!bounds) return this.cardPos ? { ...this.cardPos } : { x: 0, y: 0 };
    return { x: bounds.x, y: bounds.y };
  }

  setPage(page: IslandPage): void {
    if (this.page === page) return;
    this.page = page;
    this.pushState();
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
    this.animateTo(this.collapsedSize(), ISLAND_COLLAPSE_DURATION, easeOutCubic);
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

    if (this.attachMode === "floating") {
      const base = this.cardPos ?? {
        x: area.x + (area.width - size.width) / 2,
        y: area.y,
      };
      return {
        x: clamp(base.x, area.x, maxX),
        y: clamp(base.y, area.y, maxY),
      };
    }

    if (this.dockEdge === "left") {
      const y = this.cardPos
        ? clamp(this.cardPos.y, area.y, maxY)
        : clamp(area.y + (area.height - size.height) / 2, area.y, maxY);
      return { x: area.x, y };
    }

    if (this.dockEdge === "right") {
      const y = this.cardPos
        ? clamp(this.cardPos.y, area.y, maxY)
        : clamp(area.y + (area.height - size.height) / 2, area.y, maxY);
      return { x: area.x + area.width - size.width, y };
    }

    const x = this.cardPos
      ? clamp(this.cardPos.x, area.x, maxX)
      : clamp(area.x + (area.width - size.width) / 2, area.x, maxX);
    return { x, y: area.y };
  }

  private windowBounds(card: IslandPosition, size: IslandSize): Electron.Rectangle {
    return {
      x: card.x,
      y: card.y,
      width: size.width,
      height: size.height,
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
    this.lastPointer = { x: screenX, y: screenY };
    this.dragAnchor = {
      cardX: bounds.x,
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
    this.lastPointer = { x: screenX, y: screenY };
    this.cardPos = { x: cardX, y: cardY };
    this.win.setPosition(Math.round(cardX), Math.round(cardY), false);
  }

  endDrag(): {
    attachMode: IslandAttachMode;
    dockEdge: IslandDockEdge;
    position: IslandPosition | null;
    displayId: number;
  } {
    this.dragging = false;
    if (this.pendingInteractive !== null) {
      const pending = this.pendingInteractive;
      this.pendingInteractive = null;
      this.applyInteractive(pending);
    }
    if (!this.win || this.win.isDestroyed()) {
      return {
        attachMode: this.attachMode,
        dockEdge: this.dockEdge,
        position: this.cardPos ? { ...this.cardPos } : null,
        displayId: this.displayId ?? screen.getPrimaryDisplay().id,
      };
    }
    const bounds = this.win.getBounds();
    const cardX = bounds.x;
    const cardY = bounds.y;

    const pointer = this.lastPointer ?? {
      x: cardX + this.currentSize.width / 2,
      y: cardY + this.currentSize.height / 2,
    };
    const display = screen.getDisplayNearestPoint(pointer);
    this.displayId = display.id;

    const area = display.workArea;
    const candidates: Array<{ edge: IslandDockEdge; distance: number }> = [
      { edge: "left", distance: cardX - area.x },
      { edge: "right", distance: area.x + area.width - (cardX + this.currentSize.width) },
      { edge: "top", distance: cardY - area.y },
    ];
    const snapped = candidates
      .filter((candidate) => candidate.distance <= ISLAND_SNAP_EDGE_DISTANCE)
      .sort((a, b) => a.distance - b.distance)[0];

    if (snapped) {
      this.attachMode = "attached";
      this.dockEdge = snapped.edge;
    } else {
      this.attachMode = "floating";
    }

    if (!this.expanded && !this.animTimer) {
      this.currentSize = this.collapsedSize();
    }

    this.cardPos = { x: cardX, y: cardY };
    this.applyBounds();
    const settled = this.getCardPos();
    this.cardPos = settled;
    this.pushState();
    return {
      attachMode: this.attachMode,
      dockEdge: this.dockEdge,
      position: { ...settled },
      displayId: this.displayId,
    };
  }

  isDragging(): boolean {
    return this.dragging;
  }

  resetPosition(): void {
    this.attachMode = "attached";
    this.dockEdge = "top";
    this.cardPos = null;
    this.displayId = null;
    if (!this.expanded && !this.animTimer) {
      this.currentSize = this.collapsedSize();
    }
    this.applyBounds();
  }

  applyDock(
    mode: IslandAttachMode,
    edge: IslandDockEdge,
    position: IslandPosition | null,
    displayId: number | null
  ): void {
    this.attachMode = mode;
    this.dockEdge = edge;
    this.cardPos = position ? { ...position } : null;
    if (displayId != null) this.displayId = displayId;
    if (!this.expanded && !this.animTimer) {
      this.currentSize = this.collapsedSize();
    }
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
