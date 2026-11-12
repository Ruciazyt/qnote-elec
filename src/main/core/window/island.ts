import { BrowserWindow, screen, app } from "electron";
import * as path from "node:path";
import { log } from "../../utils/log";
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
} from "../../../shared/island";

const DEV_SERVER_URL = "http://localhost:5173";

/**
 * 岛的置顶层级
 *
 * 'screen-saver' 是 Windows 层级里最高的一档 —— 压在所有 topmost 窗口之上，
 * 也压在全屏应用之上。便签的「屏幕级置顶」用的就是它（见 stickyNote.ts）。
 *
 * 岛为什么也要这一档：默认的 alwaysOnTop 只给 'floating'，
 * 也就是 topmost 档。别的应用只要弹一个 topmost 窗口
 * （聊天气泡、输入法候选框、截图工具、剪贴板工具），就会压到岛上面；
 * 独占全屏的游戏更是连 topmost 都压得住。
 * 岛是「应用在屏幕上始终有个位置」的常驻存在，不该被这些挡住。
 */
const ISLAND_TOP_LEVEL = "screen-saver";

function getPreloadPath(): string {
  return path.join(__dirname, "..", "..", "preload.js");
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 按 id 找显示器
 *
 * Electron 的 screen 模块没有 getDisplayById，只能从 getAllDisplays 里挑。
 * 找不到就退回主显示器 —— 拔掉外接屏之后岛不能就此消失。
 */
function findDisplay(displayId: number | null): Electron.Display {
  if (displayId == null) return screen.getPrimaryDisplay();
  return screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
}

/**
 * 展开用 easeOutQuint，收起用 easeOutCubic
 *
 * 两条曲线分开是因为「进入某个状态」和「离开某个状态」的手感不该一样：
 * 展开是主动动作，可以慢一点；收起是收尾动作，快而稳。
 *
 * 展开**不能回弹**（早期用的 easeOutBack）：尺寸冲过目标再荡回来，
 * 那一下的边界抖动最刺眼 —— 抖一下比慢 100ms 难受得多。
 * easeOutQuint 约等于 DESIGN.md 里的 cubic-bezier(0.22, 1, 0.36, 1)。
 */
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * 灵动岛窗口
 *
 * 一个透明置顶的无边框窗口，贴在屏幕顶边：
 *   - 收起态是一颗胶囊，只显示一行摘要
 *   - 展开态是一块带页签的面板
 *
 * ## 尺寸动画为什么由主进程驱动
 *
 * 窗口尺寸一变，渲染层的视口就跟着变。与其让渲染层算好再回传，
 * 不如主进程直接逐帧 setBounds —— 窗口的物理尺寸和内容的视觉尺寸
 * 天然同步，不会出现「内容已经展开、窗口还是小的」这种中间态。
 *
 * 渲染层只负责两件事：画内容、报告「收起态该有多宽」。
 */
export class IslandWindow {
  private static instance: IslandWindow;

  private win: BrowserWindow | null = null;
  /** 页面是否已经渲染完成 */
  private ready = false;

  /** 当前物理尺寸（动画过程中是中间值） */
  private currentSize: IslandSize = {
    width: ISLAND_COLLAPSED_MIN_WIDTH,
    height: ISLAND_COLLAPSED_HEIGHT,
  };

  /** 收起态的宽度由内容决定，渲染层量了之后报上来 */
  private collapsedWidth = ISLAND_COLLAPSED_MIN_WIDTH;

  private expanded = false;
  private page: IslandPage = "todo";
  private attachMode: IslandAttachMode = "attached";
  /** 卡片左上角的屏幕坐标 —— null 表示「默认居中」 */
  private cardPos: IslandPosition | null = null;
  /** 岛所在的显示器 —— null 表示主显示器 */
  private displayId: number | null = null;

  /** 拖动会话 */
  private dragging = false;
  private dragAnchor: { cardX: number; cardY: number; screenX: number; screenY: number } | null = null;

  /** 动画定时器 */
  private animTimer: NodeJS.Timeout | null = null;
  /** 窗口当前是不是接收鼠标事件 */
  private interactive = true;
  /** 拖动期间收到的穿透请求 —— 拖完再生效（拖动中改会断掉拖动） */
  private pendingInteractive: boolean | null = null;

  /** 窗口是否曾经拿到过焦点 —— 用来判断 blur 是「用户点走了」还是「从没获得过焦点」 */
  private hadFocus = false;

  /**
   * 灵动岛是否启用
   *
   * 缓存一份在内存里：最小化事件是同步触发的，而配置在数据库里，
   * 每次最小化都去 await 一次读库既慢又会引入闪烁。
   * 设置变更时由 islandHandlers 同步进来。
   */
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

  // ── 生命周期 ─────────────────────────────────────────────────────────────

  /**
   * 显示灵动岛
   *
   * 用 showInactive 而不是 show：岛是在主窗口最小化后顶上来的，
   * 这时候用户多半正在别的窗口里干活，岛不该把焦点抢过去。
   * 用户主动点岛上的按钮时窗口自然会获得焦点。
   */
  show(): void {
    if (!this.win || this.win.isDestroyed()) {
      this.win = this.create();
    }
    const win = this.win;
    if (!win) return;

    this.applyBounds();
    // 刚露出来时先让窗口能点 —— 等渲染层报过「鼠标不在卡片上」再放行，
    // 否则用户第一下点击会打在穿透掉的窗口上，什么反应都没有
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

  /** 往岛的渲染层推一条消息 */
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
      // 初始尺寸就带上阴影留白 —— 不然窗口刚创建那一帧阴影会被裁掉
      width: ISLAND_COLLAPSED_MIN_WIDTH + ISLAND_SHADOW_PAD_X * 2,
      height: ISLAND_COLLAPSED_HEIGHT + ISLAND_SHADOW_PAD_Y,
      show: false,
      frame: false,
      resizable: false,
      // 岛自己管位置，不让用户用系统方式拖动
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: "#00000000",
      // 系统原生阴影是方的，跟岛的圆角对不上 —— 阴影交给 CSS 画
      hasShadow: false,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        // 用默认 session（不指定 partition），与主窗口共享 localStorage ——
        // island.html 要从 qnote-theme 读用户选好的主题档位。
      },
    });

    this.win = win;
    // 显示器不在这里定死 —— 配置里记着岛在哪块屏上，
    // 这儿覆盖掉等于把用户拖过去的那块屏忘了。

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

    /**
     * 失焦收起
     *
     * 只有「曾经拿到过焦点」才收 —— showInactive 显示的窗口压根没焦点，
     * 那时的 blur 不是「用户点走了」，而是窗口压根没被激活过。
     */
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

  // ── 状态 ────────────────────────────────────────────────────────────────

  getSnapshot(): IslandSnapshot {
    return {
      expanded: this.expanded,
      page: this.page,
      attachMode: this.attachMode,
      size: { ...this.currentSize },
      position: this.getCardPos(),
    };
  }

  /** 卡片当前的屏幕坐标 —— 窗口坐标减去那圈阴影留白 */
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

  /**
   * 渲染层报上来的收起态宽度
   *
   * 摘要文字长度不同，胶囊宽度也不同。渲染层量好之后报过来，
   * 主进程夹到上下限之间再落到窗口上。
   */
  setCollapsedWidth(width: number): void {
    if (!Number.isFinite(width) || width <= 0) return;
    const clamped = Math.round(
      Math.min(ISLAND_COLLAPSED_MAX_WIDTH, Math.max(ISLAND_COLLAPSED_MIN_WIDTH, width))
    );
    if (clamped === this.collapsedWidth) return;
    this.collapsedWidth = clamped;
    // 补间过程中不改窗口尺寸 —— 动画自己管几何，这里插手会把补间截断在半路。
    // 宽度照样记下来，下次收起时用它当目标。
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

  /** 把状态推给渲染层 —— 渲染层据此切页、播动画 */
  private pushState(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send("island:state", this.getSnapshot());
  }

  // ── 几何 ────────────────────────────────────────────────────────────────

  private getDisplay() {
    return findDisplay(this.displayId);
  }

  /**
   * 按当前模式算出**卡片**该在哪儿
   *
   * attached —— 贴着工作区上沿（任务栏在顶部时，工作区上沿本来就在任务栏下面）；
   *   横向保留用户放的位置，没放过就居中
   * floating —— 守住拖放时记下的坐标，只做「别跑出屏幕」的兜底
   *
   * 算的是卡片而不是窗口：窗口比卡片大一圈阴影，
   * 卡片的位置对了，窗口的位置照着推出来就行。
   */
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

  /**
   * 卡片坐标 + 卡片尺寸 → 窗口坐标
   *
   * 窗口四周多出来的那一圈是给阴影的：阴影画在卡片外面，
   * 窗口跟卡片一样大的话，阴影会被窗口矩形裁掉，底角变成两条硬边。
   */
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
    // 拖动中位置由指针说了算 —— 别的地方再调 applyBounds 会把岛拽回贴顶居中，
    // 表现为「拖到一半被弹回去」
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

  /**
   * 逐帧把窗口从当前尺寸补间到目标尺寸
   *
   * 用 setTimeout(16) 而不是 requestAnimationFrame —— 主进程没有 rAF。
   * 每帧只发一条 setBounds，Windows 上是一次 SetWindowPos，很便宜。
   */
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
        // 补间结束后精确落到目标值 —— 中间帧取整会留下一两像素的误差
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

  // ── 拖动 ────────────────────────────────────────────────────────────────

  /**
   * 开始拖动
   *
   * 屏幕坐标由渲染层给（DOM 的 MouseEvent 带 screenX/screenY），
   * 主进程据此算出窗口该跟到哪儿。
   */
  beginDrag(screenX: number, screenY: number): void {
    if (!this.win || this.win.isDestroyed()) return;
    const bounds = this.win.getBounds();
    this.dragging = true;
    this.dragAnchor = {
      // 记的是**卡片**的位置，不是窗口的 —— 窗口四周有阴影留白
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

  /**
   * 结束拖动 —— 决定是吸附回顶边还是浮在原地
   *
   * 吸附判定用「距工作区上沿 16px 以内」：贴顶时岛是挂在屏幕边上的，
   * 拖到那个高度附近就吸回去，拖远了就变成一颗浮着的药丸。
   */
  endDrag(): { attachMode: IslandAttachMode; position: IslandPosition | null; displayId: number } {
    this.dragging = false;
    // 拖动期间收到的穿透请求在这儿生效
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

    // 先按卡片中心找它落在哪块屏上
    const display = screen.getDisplayNearestPoint({
      x: cardX + this.currentSize.width / 2,
      y: cardY + this.currentSize.height / 2,
    });
    this.displayId = display.id;

    // 吸附判定用「距工作区上沿 16px 以内」：贴顶时岛是挂在屏幕边上的，
    // 拖到那个高度附近就吸回去，拖远了就变成一颗浮着的药丸。
    // 吸回去只改纵向 —— 横向留在用户放的地方，不弹回正中。
    const distanceToTop = cardY - display.workArea.y;
    this.attachMode = distanceToTop <= ISLAND_SNAP_TOP_DISTANCE ? "attached" : "floating";
    this.cardPos = { x: cardX, y: cardY };

    this.applyBounds();
    // applyBounds 会把位置夹回工作区以内，落库要夹完之后的那个坐标
    const settled = this.getCardPos();
    this.cardPos = settled;
    // 渲染层要按新的贴顶/浮动状态画角 —— 不推的话它还拿着旧的，
    // 岛浮着了、角还是贴顶态的直角
    this.pushState();
    return { attachMode: this.attachMode, position: { ...settled }, displayId: this.displayId };
  }

  isDragging(): boolean {
    return this.dragging;
  }

  // ── 位置与显示器 ────────────────────────────────────────────────────────

  /**
   * 岛留在哪块屏
   *
   * 早期版本会轮询鼠标位置：鼠标停在另一块屏上约 0.6 秒，就把岛挪过去。
   * 用户刚把它拖到某块屏上想让它待着，它自己跑掉了 —— 拖到哪都不算数。
   *
   * 现在不跟鼠标：放哪块屏就留在哪块屏（显示器 id 记在配置里），
   * 那块屏拔掉了才回主屏。
   */

  /** 恢复到贴顶居中的默认位置 */
  resetPosition(): void {
    this.attachMode = "attached";
    this.cardPos = null;
    this.displayId = null;
    this.applyBounds();
  }

  /** 外部改了配置（设置页 / 启动时读库）之后同步进来 */
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

  /**
   * 把窗口顶到最上层
   *
   * **每次显示都重新设一遍**，不是只在创建时设：
   *
   * Windows 上透明层窗口隐藏再显示之后，always-on-top 状态有时会掉
   * （Electron 的老毛病）。掉了之后岛就变回一个普通窗口 ——
   * 随便哪个应用盖上来，岛就没了，表现就是「有时候被别的窗口挡住」。
   * 重新设一次顺带把自己顶到 topmost 档的最前面，
   * 别的应用后来弹的 topmost 窗口也就压不到它了。
   */
  private raiseToTop(): void {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.setAlwaysOnTop(true, ISLAND_TOP_LEVEL);
    } catch (err) {
      // 个别 Windows / Electron 版本对层级支持不全，退回普通置顶
      log.warn("[island] 设置置顶层级失败，退回普通置顶:", err);
      try {
        this.win.setAlwaysOnTop(true);
      } catch {
        /* 忽略 */
      }
    }
  }

  /**
   * 窗口要不要接收鼠标事件
   *
   * 窗口比卡片大一圈（给阴影留地方），多出来的那圈是透明的 ——
   * 但窗口终归是矩形：不放行的话，那圈会把底下应用的点击吃掉。
   * 所以鼠标离开卡片时让窗口穿透，回到卡片时再放行。
   *
   * 穿透时仍然要 forward：渲染层靠转发过来的 mousemove
   * 判断鼠标有没有回到卡片上。
   *
   * **拖动中不能改**：窗口一旦放行鼠标，渲染层的指针捕获就丢了，
   * 拖动会当场断在原地。这个请求先记着，拖完再生效。
   */
  setInteractive(interactive: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.dragging) {
      this.pendingInteractive = interactive;
      return;
    }
    this.applyInteractive(interactive);
  }

  /** 真正把穿透状态落到窗口上 */
  private applyInteractive(interactive: boolean): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.interactive === interactive) return;
    this.interactive = interactive;
    this.win.setIgnoreMouseEvents(!interactive, { forward: true });
  }
}
