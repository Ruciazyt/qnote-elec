# QNote Elec 快捷功能需求规格说明书

**版本：** v1.0  
**日期：** 2026-03-27  
**状态：** 草稿  

---

## 1. 功能概述

为 QNote Elec 添加快捷唤起机制，通过全局快捷键弹出轻量浮动小窗，快速访问剪贴板历史和 AI 对话功能，减少用户操作路径。

### 解决的问题

- 用户无需切换窗口、在侧边栏寻找入口，即可快速查看最近剪贴板条目或快速向 AI 提问
- 主窗口保持最小化时，快捷功能仍可通过全局快捷键唤起
- 与现有圆形悬浮控件（circleWin）互补，提供更完整的快捷操作体验

---

## 2. 用户故事

| ID | 角色 | 场景 | 期望 |
|----|------|------|------|
| US-S-01 | 剪贴板重度用户 | 刚复制了一段文字，想快速查看是否记录成功 | 按快捷键，浮动小窗立即显示最新条目 |
| US-S-02 | 笔记用户 | 写笔记时需要引用刚复制的内容 | 快捷键唤起，选中条目直接粘贴到当前应用 |
| US-S-03 | AI 助手用户 | 看到一段文字想立刻问 AI | 选中文字，呼出 AI 小窗，粘贴并发送 |
| US-S-04 | 多任务用户 | 在其他应用工作时不想切换到 QNote 主窗口 | 全局快捷键随时呼起 QNote 快捷功能 |
| US-S-05 | 深色模式用户 | 使用深色主题时，快捷小窗视觉一致 | 小窗自动跟随主窗口主题色 |

---

## 3. 功能点详细说明

### 3.1 全局快捷键设计

#### 快捷键分配

| 功能 | Windows/Linux 建议快捷键 | macOS 建议快捷键 | 说明 |
|------|--------------------------|-----------------|------|
| 唤起剪贴板小窗 | `Ctrl + Shift + V` | `Cmd + Shift + V` | 显示最近剪贴板条目列表 |
| 唤起 AI 对话小窗 | `Ctrl + Shift + A` | `Cmd + Shift + A` | 显示 AI 快速对话输入框 |
| 关闭小窗 | `Escape` | `Escape` | 关闭当前打开的小窗 |
| 选中条目复制 | `Enter` | `Enter` | 将选中的剪贴板条目复制到系统剪贴板并关闭小窗 |
| 下一条 | `↓` / `Tab` | `↓` / `Tab` | 选中下一条剪贴板记录 |
| 上一条 | `↑` / `Shift + Tab` | `↑` / `Shift + Tab` | 选中上一条剪贴板记录 |

#### 技术实现

- 使用 Electron `globalShortcut` API 在主进程注册全局快捷键
- 快捷键在应用未聚焦时仍可响应（后台运行）
- 快捷键注册/注销跟随主窗口生命周期（主窗口显示时注册，关闭时注销）
- 支持快捷键冲突检测：注册失败时记录日志，不阻塞应用启动

```typescript
// src/main/core/shortcuts.ts（新建）
import { globalShortcut, BrowserWindow } from 'electron';
import { log } from '../utils/log';

export function registerGlobalShortcuts(
  showClipboardPopup: () => void,
  showAiPopup: () => void
): void {
  const shortcuts: Array<{ key: string; handler: () => void; name: string }> = [
    { key: 'CommandOrControl+Shift+V', handler: showClipboardPopup, name: '剪贴板小窗' },
    { key: 'CommandOrControl+Shift+A', handler: showAiPopup, name: 'AI对话小窗' },
  ];

  for (const { key, handler, name } of shortcuts) {
    const success = globalShortcut.register(key, handler);
    if (success) {
      log.info(`全局快捷键注册成功: ${key} -> ${name}`);
    } else {
      log.warn(`全局快捷键注册失败（可能被占用）: ${key}`);
    }
  }
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
  log.info('全局快捷键已注销');
}
```

### 3.2 浮动小窗口类型

#### 窗口类型总览

| 窗口 | 尺寸 | 位置 | 行为 |
|------|------|------|------|
| 剪贴板小窗（ClipboardPopup） | 360×480 px | 屏幕右下角，距边缘 80px | `alwaysOnTop`, `frame: false`, `skipTaskbar` |
| AI 对话小窗（AiPopup） | 360×400 px | 屏幕右下角，距边缘 80px | `alwaysOnTop`, `frame: false`, `skipTaskbar` |

两个小窗**互斥**：打开一个时自动关闭另一个。

#### 小窗通用属性

- `frame: false`：无边框
- `transparent: false`：不透明白底（避免视觉歧义）
- `resizable: false`：固定尺寸
- `skipTaskbar: true`：不显示在任务栏
- `alwaysOnTop: true`：始终在最前
- 关闭按钮在窗口内，小窗关闭时窗口隐藏而非销毁（复用）

### 3.3 剪贴板小窗（ClipboardPopup）UI 设计

```
┌─────────────────────────────┐
│  📋 最近剪贴板         [×]  │  ← 标题栏（24px，内置关闭按钮）
├─────────────────────────────┤
│  🔍 搜索...                 │  ← 搜索框（36px，可选）
├─────────────────────────────┤
│  ○ text content here...    │  ← 选中条目（高亮背景）
│    3 秒前          [复制]  │
│  ● previous text...        │  ← 普通条目
│    10 秒前         [复制]  │
│  ○ <img src="..."/>       │  ← 图片条目（显示缩略图）
│    1 分钟前         [复制]  │
│  ...                       │
│  （最多显示最近 20 条）      │
└─────────────────────────────┘
```

#### 设计规范

| 属性 | 值 |
|------|-----|
| 窗口尺寸 | 360 × 480 px |
| 圆角 | 12px |
| 背景色 | 跟随主题（light: `#ffffff`, dark: `#1a1a1f`） |
| 边框 | 1px `border` 色 |
| 阴影 | `0 8px 32px rgba(0,0,0,0.15)` |
| 标题栏高度 | 40px |
| 关闭按钮 | 右上角，24×24，hover 变红 |
| 条目间距 | 4px |
| 条目内边距 | 12px |
| 最大显示条目 | 20 条（超出滚动） |
| 图片最大高度 | 80px，保持比例 |

#### 条目交互

| 交互 | 行为 |
|------|------|
| 点击条目 | 选中（高亮） |
| 双击条目 | 复制到系统剪贴板，关闭小窗 |
| 按 `Enter` | 复制选中条目，关闭小窗 |
| 按 `↑/↓` | 上下切换选中 |
| 搜索框输入 | 实时过滤列表（匹配 content 内容） |
| 窗口失去焦点 | 自动隐藏小窗（不销毁窗口） |

#### 数据来源

与主窗口 `ClipboardList` 共享同一数据源（SQLite `notes` 表，`type = 'text' or 'image'`），通过 IPC `get-clipboard-history` 获取最近 20 条，不经过主窗口渲染进程直接查询数据库。

```typescript
// src/main/handlers/clipboardPopupHandlers.ts（新建）
ipcMain.handle('popup-get-clipboard-history', async (_event, limit: number = 20) => {
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
```

### 3.4 AI 对话小窗（AiPopup）UI 设计

```
┌─────────────────────────────┐
│  🤖 AI 助手            [×]  │  ← 标题栏（40px）
├─────────────────────────────┤
│  [你好，可以问我任何问题]    │  ← AI 回复气泡
│                             │
│  [这是我的问题内容...]       │  ← 用户气泡
│                             │
├─────────────────────────────┤
│  [输入框...]          [发送]│  ← 输入区（48px）
└─────────────────────────────┘
```

#### 设计规范

| 属性 | 值 |
|------|-----|
| 窗口尺寸 | 360 × 400 px |
| 圆角 | 12px |
| 背景色 | 跟随主题 |
| 消息气泡最大宽度 | 85% |
| 消息区内边距 | 12px |
| 消息间距 | 8px |
| 输入框高度 | 36px |
| 发送按钮 | 36×36，圆角 8px |
| 最多显示历史消息 | 最近 10 条（超出滚动） |

#### 交互设计

| 交互 | 行为 |
|------|------|
| 按 `Enter` | 发送消息 |
| 按 `Shift + Enter` | 换行 |
| 按 `Escape` | 关闭小窗 |
| 输入框为空时点击发送 | 无操作（按钮禁用） |
| 窗口失去焦点 | 自动隐藏小窗 |
| AI 响应中 | 输入框禁用，显示 spinner |

#### 技术实现

- AI 对话数据通过已有 IPC `send-ai-message`、`get-ai-chat-history` 管理
- 小窗复用自己的精简消息历史状态，不影响主窗口 AI 面板的历史

### 3.5 弹出位置与屏幕边缘处理

- 默认弹出位置：**屏幕右下角**，距边缘 80px
- 屏幕边界检测：若弹出后超出屏幕，自动向左/上偏移
- 多显示器支持：优先在主窗口所在显示器弹出

```typescript
function getPopupPosition(popupWidth: number, popupHeight: number) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const margin = 80;
  return {
    x: width - popupWidth - margin,
    y: height - popupHeight - margin,
  };
}
```

---

## 4. 技术约束

### 4.1 Electron 全局快捷键

| 约束 | 说明 |
|------|------|
| 必须在主进程注册 | `globalShortcut.register()` 仅在主进程可用 |
| 后台运行支持 | 应用未聚焦时 `globalShortcut` 仍有效（需开启 `accessibilitySupport` 时注意） |
| macOS 权限 | macOS 可能需要用户授权辅助功能权限（系统偏好设置 → 隐私 → 辅助功能） |
| 快捷键冲突 | 注册失败时降级处理，记录日志，不阻塞应用 |
| 注销时机 | 应用退出前或主窗口销毁时注销所有全局快捷键 |

### 4.2 窗口管理

| 约束 | 说明 |
|------|------|
| BrowserWindow 实例复用 | 首次创建后隐藏而非销毁，后续直接 `show()` |
| 窗口层级 | `z-index` 由 OS 管理，`alwaysOnTop: true` 确保在最前 |
| contextIsolation | 小窗渲染进程必须 `contextIsolation: true` |
| preload 脚本 | 所有小窗共用主进程的 `preload.ts`（已有 IPC 列表足够） |
| IPC channel | 小窗专用 channel 前缀：`popup-*` |

### 4.3 窗口复用架构

```
src/main/core/window/
├── mainWindow.ts          # 主窗口
├── circleWidget.ts        # 圆形悬浮控件
├── clipboardPopup.ts      # 剪贴板小窗（新建）
├── aiPopup.ts             # AI对话小窗（新建）
├── tray.ts                # 系统托盘
└── index.ts               # 统一导出
```

```typescript
// src/main/core/window/clipboardPopup.ts（新建）
export class ClipboardPopupWindow {
  private win: BrowserWindow | null = null;

  show() {
    if (!this.win) this.win = this.create();
    this.win.show();
    this.win.focus();
  }

  hide() {
    this.win?.hide();
  }

  private create(): BrowserWindow {
    return new BrowserWindow({
      width: 360, height: 480,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
      ...this.getPosition(),
    });
  }
}
```

### 4.4 IPC Channel 扩展

在 `src/shared/types/electron.ts` 中新增：

```typescript
// Clipboard Popup
POPUP_GET_CLIPBOARD_HISTORY: 'popup-get-clipboard-history',
POPUP_COPY_CLIPBOARD_ITEM: 'popup-copy-clipboard-item',

// AI Popup
POPUP_SEND_AI_MESSAGE: 'popup-send-ai-message',
POPUP_GET_AI_HISTORY: 'popup-get-ai-history',
POPUP_CLEAR_AI_CHAT: 'popup-clear-ai-chat',

// Window control
POPUP_CLOSE: 'popup-close',
POPUP_SHOW_MAIN_WINDOW: 'popup-show-main-window',
```

### 4.5 性能要求

| 指标 | 目标 |
|------|------|
| 快捷键响应时间 | ≤ 100ms（小窗从隐藏到可见） |
| 剪贴板历史加载 | ≤ 200ms（20 条数据） |
| AI 消息发送 | 与主窗口 AI 面板一致（网络依赖） |
| 内存占用 | 小窗单独渲染进程，每个 ≤ 30MB |
| CPU 空闲占用 | 小窗隐藏状态下 CPU ≤ 0.1% |

---

## 5. 非功能需求

### 5.1 性能

- 小窗弹出到可见 ≤ 100ms（窗口已创建，仅 `show()`）
- 连续快速按快捷键不产生多个小窗实例（单例模式）
- 剪贴板历史数据按时间倒序，优先显示最新

### 5.2 兼容性

- 与现有 `circleWin` 共存，不影响其行为
- 小窗跟随主窗口主题（light/dark system）
- 三端（Windows/macOS/Linux）行为一致

### 5.3 可访问性

- 小窗可键盘导航（Tab / Shift+Tab / Enter / Escape）
- 输入框 placeholder 文字清晰
- 颜色对比度符合 WCAG AA（复用主窗口主题）

### 5.4 可维护性

- 小窗模块独立，不直接引用主窗口组件状态
- 小窗复用主窗口已有的 IPC handler 逻辑（避免重复代码）
- preload 脚本已有 API 足够，新功能不扩展 preload

---

## 6. 优先级与里程碑

### 6.1 优先级

| 优先级 | 功能点 | 说明 |
|--------|--------|------|
| **P0** | 全局快捷键注册/注销 | 所有功能的基础 |
| **P0** | ClipboardPopupWindow 类 | 核心小窗实现 |
| **P0** | AiPopupWindow 类 | 核心小窗实现 |
| **P0** | 小窗 UI 组件（React） | 渲染进程侧实现 |
| **P1** | 剪贴板小窗 IPC 扩展 | 数据层支持 |
| **P1** | AI 小窗 IPC 扩展 | 数据层支持 |
| **P1** | 快捷键冲突检测与日志 | 提升可调试性 |
| **P2** | 剪贴板搜索过滤 | 增强体验 |
| **P2** | 多显示器支持 | 提升体验 |

### 6.2 新增文件清单

#### 主进程（src/main/）

| 文件 | 操作 | 说明 |
|------|------|------|
| `core/window/clipboardPopup.ts` | 新建 | 剪贴板小窗窗口管理类 |
| `core/window/aiPopup.ts` | 新建 | AI 对话小窗窗口管理类 |
| `core/shortcuts.ts` | 新建 | 全局快捷键注册/注销 |
| `handlers/clipboardPopupHandlers.ts` | 新建 | 剪贴板小窗专用 IPC handler |
| `handlers/aiPopupHandlers.ts` | 新建 | AI 小窗专用 IPC handler |

#### 渲染进程（src/renderer/）

| 文件 | 操作 | 说明 |
|------|------|------|
| `components/clipboard/ClipboardPopup.tsx` | 新建 | 剪贴板小窗 UI 组件 |
| `components/ai/AiPopup.tsx` | 新建 | AI 对话小窗 UI 组件 |
| `pages/HomePage.tsx` | 修改 | 引入小窗组件（调试用） |

#### 类型（src/shared/）

| 文件 | 操作 | 说明 |
|------|------|------|
| `types/electron.ts` | 修改 | 新增 popup 相关 IPC channel 常量 |

---

## 7. 验收标准

| ID | 验收标准 | 测试方法 |
|----|----------|----------|
| AC-S-01 | `Ctrl+Shift+V` 在应用未聚焦时能唤起剪贴板小窗 | 切换到其他应用，按快捷键验证 |
| AC-S-02 | 剪贴板小窗显示最近 20 条记录，最新在上 | 复制多条内容，验证顺序和数量 |
| AC-S-03 | 选中条目按 `Enter` 复制到系统剪贴板并关闭小窗 | 在其他应用按快捷键，粘贴验证 |
| AC-S-04 | `Ctrl+Shift+A` 唤起 AI 对话小窗 | 在其他应用按快捷键验证 |
| AC-S-05 | AI 小窗发送消息后获得 AI 回复 | AI 小窗输入问题，验证回复 |
| AC-S-06 | 小窗按 `Escape` 关闭 | 在小窗激活时按 `Escape` |
| AC-S-07 | 小窗失去焦点自动隐藏 | 鼠标点击其他应用窗口 |
| AC-S-08 | 两个小窗互斥：打开一个自动关闭另一个 | 先 `Ctrl+Shift+V`，再 `Ctrl+Shift+A` |
| AC-S-09 | 快捷键冲突时应用正常启动，记录警告日志 | 手动注册一个冲突快捷键，观察日志 |
| AC-S-10 | 小窗跟随主窗口主题（深色/浅色） | 切换主题，验证小窗颜色 |

---

## 8. 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **RT-S-01**：macOS 全局快捷键需要辅助功能权限 | 中 | 在设置页面添加引导说明；日志提示用户授权 |
| **RT-S-02**：多显示器场景小窗位置不正确 | 低 | 使用 `screen.getDisplayNearestPoint` 定位 |
| **RT-S-03**：小窗与主窗口 AI 状态不同步 | 低 | 小窗复用同一数据库，主窗口刷新时数据一致 |
| **RT-S-04**：Electron 版本升级导致 globalShortcut API 变化 | 低 | 锁定 Electron 版本，升级前回归测试 |

---

## 9. 与现有功能的关系

### 9.1 与 circleWin（圆形悬浮控件）

| 维度 | circleWin | 快捷小窗 |
|------|-----------|---------|
| 触发方式 | 鼠标点击 | 全局快捷键 |
| 尺寸 | 50×50 px（圆形） | 360×480 / 360×400 px |
| 功能 | 单击显示主窗口 | 独立功能（查看/复制、AI 对话） |
| 位置 | 固定右下角 | 固定右下角 |
| 关系 | 互补，不冲突 | 互补，不冲突 |

### 9.2 与主窗口 AI 面板（AiChatPanel）

- 共享同一 AI 服务（`send-ai-message` IPC）
- **不共享**消息历史：小窗有独立历史，关闭后不保留
- 主窗口 AI 面板继续完整保留，不受影响

---

*本规格说明书由 PM Agent 生成，待团队评审后执行。*
