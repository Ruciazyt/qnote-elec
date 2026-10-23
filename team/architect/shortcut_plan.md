# QNote Elec 快捷功能技术方案

**版本：** v1.0  
**日期：** 2026-03-27  
**状态：** 待评审  
**基于：** `shortcut_spec.md`（需求规格）+ `shortcut_design.md`（UI/UX 设计）

---

## 1. 技术决策

### 1.1 Electron 窗口方案

两个小窗均使用独立的 `BrowserWindow` 实例，遵循既有的 `circleWidget.ts` 模式（已验证可行）。

#### BrowserWindow 参数

```typescript
// 通用参数（ClipboardPopup + AiPopup 共用）
const COMMON_WINDOW_OPTIONS = {
  frame: false,           // 无边框，由渲染进程渲染自定义标题栏
  resizable: false,       // 固定尺寸
  skipTaskbar: true,      // 不显示在任务栏
  alwaysOnTop: true,      // 始终在最前
  show: false,            // 先创建后手动 show()，避免闪烁
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    // 与主窗口共用同一 partition，实现主题共享
    partition: "persist:main",
  },
};

// ClipboardPopup 专属
const CLIPBOARD_POPUP_OPTIONS = {
  width: 360,
  height: 480,
  ...COMMON_WINDOW_OPTIONS,
};

// AiPopup 专属
const AI_POPUP_OPTIONS = {
  width: 360,
  height: 400,
  ...COMMON_WINDOW_OPTIONS,
};
```

**关键设计点：**

- `frame: false`：无原生边框，渲染进程自行实现标题栏（含关闭按钮）和拖拽区域
- `show: false` → 手动 `win.show()` + `win.focus()`：避免窗口创建过程中闪现白边
- `partition: "persist:main"`：与主窗口共享 session，确保主题（light/dark）跟随主窗口
- 复用主窗口的 `preload.js`：所有 IPC channel 已在 preload 中暴露，无需额外 preload

#### 窗口复用策略

两个小窗均采用**单例隐藏模式**：

```
首次创建 → BrowserWindow 实例持久化 → hide()（窗口销毁时不自动释放）
后续唤起 → 直接 show() + focus()
窗口关闭 → hide() 而非 destroy()
```

优势：避免重复创建窗口的 DOM/CSS 解析开销，冷启动时间 ≤ 100ms（仅 show）。

### 1.2 全局快捷键实现

使用 Electron 原生 `globalShortcut` API，在**主进程**注册。

```typescript
// src/main/core/shortcuts.ts
import { globalShortcut, BrowserWindow } from "electron";
import { log } from "../utils/log";

type ShortcutHandler = () => void;

export function registerGlobalShortcuts(
  showClipboard: ShortcutHandler,
  showAi: ShortcutHandler
): void {
  const shortcuts: Array<{ key: string; handler: ShortcutHandler; name: string }> = [
    {
      key: process.platform === "darwin" ? "Command+Shift+V" : "CommandOrControl+Shift+V",
      handler: showClipboard,
      name: "剪贴板小窗",
    },
    {
      key: process.platform === "darwin" ? "Command+Shift+A" : "CommandOrControl+Shift+A",
      handler: showAi,
      name: "AI对话小窗",
    },
  ];

  for (const { key, handler, name } of shortcuts) {
    const registered = globalShortcut.register(key, handler);
    if (registered) {
      log.info(`✓ 全局快捷键注册成功: ${key} → ${name}`);
    } else {
      log.warn(`✗ 全局快捷键注册失败（可能被占用）: ${key} → ${name}`);
    }
  }
}

export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll();
  log.info("所有全局快捷键已注销");
}
```

**注册/注销时机：**

```
主窗口 ready-to-show  →  registerGlobalShortcuts()
主窗口 close（退出）   →  unregisterAllShortcuts()
```

> ⚠️ macOS 用户需在系统偏好设置 → 隐私 → 辅助功能 中授予 Electron 权限，否则全局快捷键无效。日志应给出引导提示。

### 1.3 IPC Channel 设计

扩展 `src/shared/types/electron.ts`，新增 popup 专用 channel。

```typescript
// ==================== Popup 专用 Channel 常量 ====================
// 文件：src/shared/types/electron.ts

// --- ClipboardPopup ---
POPUP_GET_CLIPBOARD_HISTORY: "popup-get-clipboard-history",
//  handler: (event, limit: number = 20) => ClipboardItem[]
POPUP_COPY_CLIPBOARD_ITEM: "popup-copy-clipboard-item",
//  handler: (event, itemId: number) => { success: boolean }

// --- AiPopup ---
POPUP_SEND_AI_MESSAGE: "popup-send-ai-message",
//  handler: (event, message: string) => AiMessage | { error: string }
//  复用现有 AI service，不新建 session
POPUP_GET_AI_HISTORY: "popup-get-ai-history",
//  handler: () => AiMessage[]
POPUP_CLEAR_AI_CHAT: "popup-clear-ai-chat",
//  handler: () => { success: boolean }

// --- 窗口控制（popup → main）---
POPUP_CLOSE: "popup-close",
//  main process: 隐藏对应 popup 窗口
POPUP_SHOW_MAIN_WINDOW: "popup-show-main-window",
//  main process: 显示主窗口并聚焦
```

**Channel 命名规范：** `popup-<action>` 前缀明确区分于主窗口 channel。

#### IPC Handler 新增文件

```typescript
// src/main/handlers/clipboardPopupHandlers.ts
import { ipcMain } from "electron";
import { getDB } from "../../database";

export function registerClipboardPopupHandlers() {
  ipcMain.handle("popup-get-clipboard-history", async (_event, limit = 20) => {
    const db = getDB();
    const rows = db.prepare(`
      SELECT id, content, type, timestamp as time, vector_indexed
      FROM notes
      WHERE type IN ('text', 'image')
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit);
    return rows;
  });

  ipcMain.handle("popup-copy-clipboard-item", async (_event, itemId: number) => {
    const db = getDB();
    const item = db.prepare("SELECT * FROM notes WHERE id = ?").get(itemId);
    if (!item) return { success: false, error: "Item not found" };

    const { clipboard } = await import("electron");
    if (item.type === "text") {
      clipboard.writeText(item.content);
    } else if (item.type === "image") {
      // image content stored as base64 or file path
      const imagePath = item.content;
      const { nativeImage } = await import("electron");
      const img = nativeImage.createFromPath(imagePath);
      clipboard.writeImage(img);
    }
    return { success: true };
  });
}

// src/main/handlers/aiPopupHandlers.ts
import { ipcMain } from "electron";
import { getDB } from "../../database";
import { aiService } from "../utils/aiService";
import { configManager } from "../utils/config";
import { log } from "../utils/log";

export function registerAiPopupHandlers() {
  // AiPopup 复用已有的 aiService.send() 和 DB 查询
  // 这里只注册 popup 专用的轻量 wrapper

  ipcMain.handle("popup-send-ai-message", async (_event, message: string) => {
    try {
      const aiConfig = await configManager.getAiConfig();
      if (!aiConfig.apiKey) {
        return { error: "请先在设置中配置 AI API Key" };
      }
      // 复用 aiService，不新建 session
      const result = await aiService.send(message, []);
      return result;
    } catch (err: any) {
      log.error("popup-send-ai-message error:", err);
      return { error: err.message };
    }
  });

  ipcMain.handle("popup-get-ai-history", async (_event) => {
    const db = getDB();
    const rows = db.prepare(
      "SELECT * FROM ai_chat ORDER BY created_at DESC LIMIT 20"
    ).all();
    return rows.reverse(); // 按时间正序返回
  });

  ipcMain.handle("popup-clear-ai-chat", async (_event) => {
    const db = getDB();
    await db("ai_chat").delete();
    return { success: true };
  });
}
```

### 1.4 状态管理

**结论：复用现有 store，不新建独立状态管理库。**

理由：
- 现有项目未使用 Redux/Zustand 等状态管理，组件通过 props + React local state 通信
- ClipboardPopup 和 AiPopup 均为独立小窗，无跨组件状态共享需求
- AI 对话历史存储在 SQLite `ai_chat` 表，Popup 直接查库，不走主窗口状态

Popup 内部状态使用 React `useState` / `useReducer`：

```typescript
// ClipboardPopup.tsx
const [items, setItems] = useState<ClipboardItem[]>([]);
const [selectedIndex, setSelectedIndex] = useState(0);
const [searchQuery, setSearchQuery] = useState("");
const [isLoading, setIsLoading] = useState(false);

// AiPopup.tsx
const [messages, setMessages] = useState<AiMessage[]>([]);
const [inputValue, setInputValue] = useState("");
const [isLoading, setIsLoading] = useState(false);
```

---

## 2. 文件结构

### 2.1 主进程新增文件

```
src/main/
├── core/
│   ├── shortcuts.ts                      # [NEW] 全局快捷键注册/注销
│   └── window/
│       ├── clipboardPopup.ts             # [NEW] ClipboardPopupWindow 类
│       └── aiPopup.ts                    # [NEW] AiPopupWindow 类
├── handlers/
│   ├── clipboardPopupHandlers.ts        # [NEW] ClipboardPopup IPC handlers
│   └── aiPopupHandlers.ts               # [NEW] AiPopup IPC handlers
```

### 2.2 渲染进程新增文件

```
src/renderer/
├── components/
│   ├── clipboard/
│   │   ├── ClipboardPopup.tsx           # [NEW] 剪贴板小窗主组件
│   │   └── ClipboardPopup.css           # [NEW] 动画 CSS
│   └── ai/
│       ├── AiPopup.tsx                  # [NEW] AI对话小窗主组件
│       ├── AiPopup.css                  # [NEW] 动画 CSS
│       ├── AiMessageBubble.tsx          # [NEW] 消息气泡组件
│       └── AiInputArea.tsx              # [NEW] 输入区组件
```

### 2.3 现有文件修改点

| 文件 | 修改内容 |
|------|---------|
| `src/main/index.ts` | 导入并调用 `registerGlobalShortcuts()`，`registerClipboardPopupHandlers()`，`registerAiPopupHandlers()`；创建 `ClipboardPopupWindow` / `AiPopupWindow` 实例；导出实例给快捷键回调 |
| `src/main/core/window/index.ts` | 导出 `ClipboardPopupWindow` / `AiPopupWindow` 类 |
| `src/main/core/window/clipboardPopup.ts` | 新建窗口类（同 circleWidget 模式） |
| `src/main/core/window/aiPopup.ts` | 新建窗口类 |
| `src/main/core/shortcuts.ts` | 新建快捷键管理模块 |
| `src/main/handlers/index.ts` | 注册 `clipboardPopupHandlers` 和 `aiPopupHandlers` |
| `src/main/handlers/clipboardPopupHandlers.ts` | 新建 |
| `src/main/handlers/aiPopupHandlers.ts` | 新建 |
| `src/shared/types/electron.ts` | 新增 popup IPC channel 常量 |
| `src/renderer/styles/index.css` | 新增 popup 专用 CSS 变量（design.md §3.2） |
| `src/renderer/tailwind.config.js` | 新增 popup 动画 keyframes |

---

## 3. 实现步骤

### Phase 1：基础架构（P0）

#### Step 1.1：新增 IPC channel 常量
**文件：** `src/shared/types/electron.ts`  
**操作：** 在 `IPC_CHANNELS` 对象末尾追加 popup channel 常量（见 §1.3）  
**验证：** `grep -n "POPUP_" src/shared/types/electron.ts` 确认 10 条新增

#### Step 1.2：实现全局快捷键管理模块
**文件：** `src/main/core/shortcuts.ts`  
**操作：** 创建 `registerGlobalShortcuts()` 和 `unregisterAllShortcuts()` 函数  
**关键点：** 使用 `process.platform` 区分 macOS 和 Windows 快捷键格式

#### Step 1.3：实现 ClipboardPopupWindow 类
**文件：** `src/main/core/window/clipboardPopup.ts`  
**操作：** 参照 `circleWidget.ts` 模式创建 BrowserWindow 单例类  
**参数：** `width=360, height=480, frame=false, alwaysOnTop=true, skipTaskbar=true`  
**位置计算：** 调用 `getPopupPosition(360, 480)`（屏幕右下角 80px 边距）

```typescript
// 伪代码骨架
export class ClipboardPopupWindow {
  private win: BrowserWindow | null = null;
  private static instance: ClipboardPopupWindow;

  static getInstance(): ClipboardPopupWindow {
    if (!ClipboardPopupWindow.instance) {
      ClipboardPopupWindow.instance = new ClipboardPopupWindow();
    }
    return ClipboardPopupWindow.instance;
  }

  show(): void {
    if (!this.win) this.win = this.create();
    this.win.show();
    this.win.focus();
  }

  hide(): void {
    this.win?.hide();
  }

  toggle(): void {
    if (this.win?.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  private create(): BrowserWindow {
    const pos = getPopupPosition(360, 480);
    return new BrowserWindow({
      width: 360,
      height: 480,
      x: pos.x,
      y: pos.y,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:main",
      },
    });
  }
}
```

#### Step 1.4：实现 AiPopupWindow 类
**文件：** `src/main/core/window/aiPopup.ts`  
**操作：** 同 Step 1.3，参数调整为 `width=360, height=400`  
**互斥逻辑：** 在 `show()` 中主动调用 `ClipboardPopupWindow.getInstance().hide()`

#### Step 1.5：集成到主进程入口
**文件：** `src/main/index.ts`  
**修改点：**
```typescript
import { registerGlobalShortcuts, unregisterAllShortcuts } from "./core/shortcuts";
import { ClipboardPopupWindow } from "./core/window/clipboardPopup";
import { AiPopupWindow } from "./core/window/aiPopup";

// 在主窗口 ready-to-show 后：
const clipboardPopup = ClipboardPopupWindow.getInstance();
const aiPopup = AiPopupWindow.getInstance();

registerGlobalShortcuts(
  () => {
    // 互斥：先关闭 AI 窗口
    aiPopup.hide();
    clipboardPopup.toggle();
  },
  () => {
    clipboardPopup.hide();
    aiPopup.toggle();
  }
);

// 在 app quit 前：
unregisterAllShortcuts();
```

### Phase 2：IPC 数据层（P1）

#### Step 2.1：注册 ClipboardPopup IPC Handlers
**文件：** `src/main/handlers/clipboardPopupHandlers.ts`  
**内容：** `popup-get-clipboard-history` 和 `popup-copy-clipboard-item` 两个 handle  
**数据源：** SQLite `notes` 表，`type IN ('text', 'image')`，按 `timestamp DESC` 限制 20 条

#### Step 2.2：注册 AiPopup IPC Handlers
**文件：** `src/main/handlers/aiPopupHandlers.ts`  
**内容：** `popup-send-ai-message`、`popup-get-ai-history`、`popup-clear-ai-chat` 三个 handle  
**关键：** `popup-send-ai-message` 内部调用 `aiService.send()`，不新建独立 session

#### Step 2.3：在 handlers/index.ts 中注册新 handlers
```typescript
import { registerClipboardPopupHandlers } from "./clipboardPopupHandlers";
import { registerAiPopupHandlers } from "./aiPopupHandlers";

export function registerAllHandlers(deps) {
  // ... 现有代码 ...
  registerClipboardPopupHandlers();
  registerAiPopupHandlers();
}
```

### Phase 3：渲染进程 UI 组件（P0）

#### Step 3.1：TailwindCSS 配置扩展
**文件：** `src/renderer/tailwind.config.js`  
**操作：** 新增 4 个 animation + 4 个 keyframes（详见 §4 代码骨架）

#### Step 3.2：Popup 专用 CSS 变量
**文件：** `src/renderer/styles/index.css`  
**操作：** 在文件末尾追加 popup 专用 `--popup-*` 变量（来自 design.md §3.2）

#### Step 3.3：ClipboardPopup 主组件
**文件：** `src/renderer/components/clipboard/ClipboardPopup.tsx`  
**功能：**
- 窗口拖拽区（标题栏）
- 搜索框（实时过滤）
- 条目列表（键盘导航支持）
- 空/加载/无结果状态
- 点击关闭按钮 → IPC `popup-close` → 主进程 hide()

```tsx
// 关键交互逻辑
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") ipcRenderer.send("popup-close");
    if (e.key === "Enter") copySelected();
    if (e.key === "ArrowDown" || e.key === "Tab") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, items.length - 1));
    }
    if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [items, selectedIndex]);
```

#### Step 3.4：AiPopup 主组件
**文件：** `src/renderer/components/ai/AiPopup.tsx`  
**功能：**
- 消息列表（flex-col-reverse 滚动到底部）
- AI/用户消息气泡（区分样式）
- 思考中 dot-wave 动画
- 输入框（Enter 发送，Shift+Enter 换行）
- 错误状态气泡

### Phase 4：窗口 HTML 入口（P0）

#### Step 3.5：创建 popup 专用 HTML 入口
每个 popup 需要一个独立的 HTML 文件加载对应的 React 组件：

```
resources/
├── popup-clipboard.html   # [NEW] ClipboardPopup 入口
└── popup-ai.html          # [NEW] AiPopup 入口
```

```html
<!-- popup-clipboard.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>QNote Clipboard</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/renderer/components/clipboard/main.tsx"></script>
</body>
</html>
```

> **注意：** 由于 Electron 加载 `file://` 协议，生产环境路径需要调整为 `renderer/dist/`。建议在 `clipboardPopup.ts` / `aiPopup.ts` 中使用与 `circleWidget.ts` 相同的 `resolveAssetPath()` 模式。

```typescript
// clipboardPopup.ts 中加载 popup HTML
const popupHtmlPath = resolveAssetPath("popup-clipboard.html");
win.loadFile(popupHtmlPath);
```

### Phase 5：完善与测试（P1-P2）

#### Step 5.1：窗口失去焦点自动隐藏
在 `clipboardPopup.ts` / `aiPopup.ts` 的 `create()` 中注册 `blur` 事件：
```typescript
win.on("blur", () => {
  // 小窗失去焦点时自动隐藏
  this.hide();
});
```

#### Step 5.2：快捷键冲突检测日志
`registerGlobalShortcuts()` 已包含注册失败日志（见 §1.2）。建议在设置页面增加「快捷键冲突检测」入口，提示用户。

#### Step 5.3：多显示器支持
使用 `screen.getDisplayNearestPoint(screen.getCursorScreenPoint())` 替代 `getPrimaryDisplay()`，使 popup 出现在当前鼠标所在显示器右下角。

```typescript
function getPopupPosition(popupWidth: number, popupHeight: number) {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { width, height } = display.workAreaSize;
  const { x: displayX, y: displayY } = display.bounds;
  const margin = 80;

  let x = displayX + width - popupWidth - margin;
  let y = displayY + height - popupHeight - margin;

  if (x < displayX) x = displayX + margin;
  if (y < displayY) y = displayY + margin;

  return { x, y };
}
```

#### Step 5.4：macOS 辅助功能权限引导
在 `shortcuts.ts` 注册失败时，通过 `log.warn()` 输出引导文字：
```
[QNote] 全局快捷键注册失败。请在系统偏好设置 → 隐私 → 辅助功能 中添加 QNote 后重试。
```

---

## 4. 代码骨架

### 4.1 IPC Channel 常量定义

```typescript
// src/shared/types/electron.ts

export const IPC_CHANNELS = {
  // ... 现有 channels ...

  // ==================== Popup 专用 ====================
  // ClipboardPopup
  POPUP_GET_CLIPBOARD_HISTORY: "popup-get-clipboard-history",
  POPUP_COPY_CLIPBOARD_ITEM: "popup-copy-clipboard-item",

  // AiPopup
  POPUP_SEND_AI_MESSAGE: "popup-send-ai-message",
  POPUP_GET_AI_HISTORY: "popup-get-ai-history",
  POPUP_CLEAR_AI_CHAT: "popup-clear-ai-chat",

  // 窗口控制
  POPUP_CLOSE: "popup-close",
  POPUP_SHOW_MAIN_WINDOW: "popup-show-main-window",
} as const;

export type PopupChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
```

### 4.2 全局快捷键管理

```typescript
// src/main/core/shortcuts.ts
import { globalShortcut } from "electron";
import { log } from "../../utils/log";

type VoidFn = () => void;

export function registerGlobalShortcuts(
  onClipboard: VoidFn,
  onAi: VoidFn
): void {
  const isMac = process.platform === "darwin";
  const clipboardKey = isMac ? "Command+Shift+V" : "CommandOrControl+Shift+V";
  const aiKey = isMac ? "Command+Shift+A" : "CommandOrControl+Shift+A";

  const pairs: Array<[string, VoidFn, string]> = [
    [clipboardKey, onClipboard, "剪贴板小窗"],
    [aiKey, onAi, "AI 对话小窗"],
  ];

  for (const [key, handler, name] of pairs) {
    if (globalShortcut.register(key, handler)) {
      log.info(`✓ [shortcuts] 注册成功: ${key} → ${name}`);
    } else {
      log.warn(`✗ [shortcuts] 注册失败: ${key}（已被占用）→ ${name}`);
      if (!isMac) {
        log.warn("[shortcuts] macOS 用户请在系统偏好设置 → 隐私 → 辅助功能 中授权 QNote");
      }
    }
  }
}

export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll();
  log.info("[shortcuts] 所有快捷键已注销");
}
```

### 4.3 ClipboardPopupWindow 类

```typescript
// src/main/core/window/clipboardPopup.ts
import { BrowserWindow, screen, ipcMain } from "electron";
import * as path from "node:path";
import { app } from "electron";
import { log } from "../../utils/log";

function getAssetsDir() {
  return !app.isPackaged
    ? path.join(__dirname, "..", "..", "..", "resources")
    : path.join(process.resourcesPath, "resources");
}

function getPopupPosition(w: number, h: number) {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { width, height } = display.workAreaSize;
  const { x: dx, y: dy } = display.bounds;
  const margin = 80;
  return {
    x: Math.max(dx, Math.min(dx + width - w - margin, dx + width - w - margin)),
    y: Math.max(dy, dy + height - h - margin),
  };
}

export class ClipboardPopupWindow {
  private static instance: ClipboardPopupWindow;
  private win: BrowserWindow | null = null;

  static getInstance(): ClipboardPopupWindow {
    if (!ClipboardPopupWindow.instance) {
      ClipboardPopupWindow.instance = new ClipboardPopupWindow();
    }
    return ClipboardPopupWindow.instance;
  }

  show(): void {
    if (!this.win) this.win = this.create();
    this.win.show();
    this.win.focus();
  }

  hide(): void {
    this.win?.hide();
  }

  isVisible(): boolean {
    return this.win?.isVisible() ?? false;
  }

  private create(): BrowserWindow {
    const pos = getPopupPosition(360, 480);
    const win = new BrowserWindow({
      width: 360,
      height: 480,
      x: pos.x,
      y: pos.y,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:main",
      },
    });

    // 加载 popup HTML
    const htmlPath = path.join(getAssetsDir(), "popup-clipboard.html");
    win.loadFile(htmlPath);

    // 失去焦点自动隐藏
    win.on("blur", () => this.hide());

    // 注册 popup-close IPC
    ipcMain.on("popup-close", () => this.hide());
    ipcMain.on("popup-show-main-window", () => {
      const { getMainWindow } = require("./mainWindow");
      const main = getMainWindow();
      if (main) {
        main.setSkipTaskbar(false);
        main.show();
        main.focus();
      }
    });

    log.info("[clipboardPopup] 窗口创建成功");
    return win;
  }
}
```

### 4.4 TailwindCSS 动画扩展

```javascript
// src/renderer/tailwind.config.js
module.exports = {
  theme: {
    extend: {
      animation: {
        "slide-in-up": "slideInUp 300ms ease-out forwards",
        "dot-wave": "dotWave 1.2s ease-in-out infinite",
        "popup-appear": "popupAppear 200ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        "popup-disappear": "popupDisappear 150ms ease-in forwards",
      },
      keyframes: {
        slideInUp: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        dotWave: {
          "0%, 60%, 100%": { transform: "translateY(0)" },
          "30%": { transform: "translateY(-4px)" },
        },
        popupAppear: {
          from: { opacity: "0", transform: "scale(0.95) translateY(10px)" },
          to: { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        popupDisappear: {
          from: { opacity: "1", transform: "scale(1) translateY(0)" },
          to: { opacity: "0", transform: "scale(0.95) translateY(10px)" },
        },
      },
    },
  },
};
```

### 4.5 渲染进程 Popup HTML 入口

```html
<!-- resources/popup-clipboard.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>快捷剪贴板</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/renderer/components/clipboard/main.tsx"></script>
</body>
</html>
```

```html
<!-- resources/popup-ai.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>快捷 AI</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/renderer/components/ai/main.tsx"></script>
</body>
</html>
```

> ⚠️ **开发 vs 生产路径问题：** `circleWidget.ts` 使用 `resolveAssetPath()` 加载 `circle.html`（从 `resources/` 目录），这对 `file://` 协议有效。但 Vite dev server (`localhost:5173`) 无法直接 serve `resources/` 下的 HTML。建议 popup HTML 使用与主窗口相同的 URL 加载逻辑：开发环境 `http://localhost:5173/src/renderer/components/clipboard/main.tsx`，生产环境 `file://{resourcesPath}/renderer/dist/...`。可以在 `create()` 中根据 `app.isPackaged` 切换。

---

## 5. 测试计划

### 5.1 单元测试

| 测试目标 | 测试方法 | 验证点 |
|---------|---------|--------|
| `getPopupPosition()` 边界计算 |  Jest / Vitest mock `screen` | 屏幕右上/左下角偏移结果正确 |
| `ClipboardPopupWindow` 单例 | 多次调用 `getInstance()` 返回同一引用 | `instanceA === instanceB` |
| IPC `popup-get-clipboard-history` |  mock DB，直接调用 handler 函数 | 返回数组，字段完整 |
| IPC `popup-copy-clipboard-item` |  mock DB + `clipboard.writeText` spy | text 类型调用 `writeText`，image 类型调用 `writeImage` |
| 快捷键注册/注销 |  `globalShortcut.register` spy | 成功调用两次 `register`，`unregisterAll` 清理 |

### 5.2 集成测试

| 测试 ID | 场景 | 验证方法 |
|---------|------|---------|
| AC-S-01 | `Ctrl+Shift+V` 唤起剪贴板小窗 | 切换到其他 App（主窗口失焦），按快捷键，小窗出现 |
| AC-S-02 | 剪贴板条目按时间倒序显示 | 复制 3 条不同内容，按快捷键，顺序验证 |
| AC-S-03 | `Enter` 复制选中条目并关闭 | 在其他 App 按快捷键，选中条目，按 Enter，粘贴到目标 App |
| AC-S-04 | `Ctrl+Shift+A` 唤起 AI 小窗 | 同 AC-S-01 快捷键切换 |
| AC-S-05 | AI 对话正常收发 | AI 小窗发送 "你好"，收到 AI 回复气泡 |
| AC-S-06 | `Escape` 关闭小窗 | 小窗激活时按 Escape，小窗消失 |
| AC-S-07 | 失焦自动隐藏 | 小窗显示时点击其他 App，小窗自动 hide() |
| AC-S-08 | 两窗互斥 | 先 `Ctrl+Shift+V`，再 `Ctrl+Shift+A`，确认前者被关闭 |
| AC-S-09 | 快捷键冲突降级 | 手动注册冲突快捷键，确认应用正常启动 + WARN 日志 |
| AC-S-10 | 主题跟随 | 主窗口切深色模式，小窗刷新后颜色同步变化 |

### 5.3 手动验证 Checklist

```
□ Windows: Ctrl+Shift+V / Ctrl+Shift+A 正常工作
□ macOS: Cmd+Shift+V / Cmd+Shift+A 正常工作（需辅助功能权限）
□ Linux: Ctrl+Shift+V / Ctrl+Shift+A 正常工作
□ 剪贴板小窗最多显示 20 条，超出滚动
□ 图片条目显示缩略图（max-height: 80px）
□ AI 小窗消息气泡区分 AI/用户样式
□ 发送空消息时按钮禁用
□ 思考中 dot-wave 动画显示
□ 窗口阴影和圆角符合设计规范
□ 100ms 内响应快捷键（小窗 show()）
```

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解方案 |
|------|------|---------|
| macOS 全局快捷键需辅助功能权限 | 中 | 日志引导 + 设置页面说明；降级提示 |
| 多显示器位置不正确 | 低 | `screen.getDisplayNearestPoint` 替代 `getPrimaryDisplay` |
| popup HTML 在 dev/prod 环境路径差异 | 中 | `app.isPackaged` 条件判断，开发用 `http://localhost:5173` |
| 窗口失去焦点 hide() 与点击条目冲突 | 低 | blur 事件延迟 100ms 执行，或使用 `webContents.isFocused()` 判断 |
| 主题跟随 partition 共享不生效 | 低 | 备选方案：popup 渲染进程主动查询主窗口主题（IPC `get-theme`） |
| globalShortcut 在 Electron 新版本行为变化 | 低 | 锁定 Electron 版本，升级前回归测试 |

---

## 7. 依赖关系图

```
src/main/index.ts（入口）
    │
    ├── registerGlobalShortcuts()  ←  src/main/core/shortcuts.ts
    │       │
    │       └── globalShortcut.register()
    │
    ├── ClipboardPopupWindow.getInstance()
    │       └── show() / hide()  ←  src/main/core/window/clipboardPopup.ts
    │               │
    │               └── win.loadFile(popup-clipboard.html)
    │
