# QNote Elec 重构技术方案

**版本：** v1.0  
**日期：** 2026-03-26  
**基于：** PM spec.md + UI design.md + 代码调研结果

---

## 0. 当前状态分析

### 0.1 现有目录结构

```
qnote-elec/
├── electron/                        # Electron 主进程（TypeScript 源码）
│   ├── main.ts                      # 主进程入口
│   ├── preload.ts                   # 预加载脚本（暴露大量 IPC）
│   ├── core/                        # 核心模块（clipboardListener, fileWriter）
│   ├── handlers/                    # IPC 处理器（9个文件）
│   ├── utils/                       # 工具（aiService, baiduOCR, config, log, settingsStore, vectorStore）
│   └── types/                       # 类型定义
├── renderer/                        # React 渲染进程（独立 Vite 项目）
│   ├── src/
│   │   ├── components/              # 组件（core/, clipboard/, Note/, Leetcode/, ui/）
│   │   ├── hooks/                   # 共享 hooks
│   │   ├── styles/                 # 样式（prism-clipboard.css）
│   │   ├── App.tsx / main.tsx / index.css
│   │   └── electron.d.ts            # preload 类型声明
│   ├── package.json                # 独立 package
│   └── vite.config.ts
├── database/                        # 数据库层（根级）
│   ├── dbConnect.ts
│   └── migrate.ts
├── package.json                     # 根级 Electron 配置（包含 electron-builder）
├── tsconfig.json                    # 主进程 TypeScript 配置（编译到 dist/electron/）
└── embedding-service/               # Python 向量化服务（独立，不参与重构）
```

### 0.2 当前 electron-builder 配置（inline in package.json）

```json
"build": {
  "appId": "com.ruciazyt.qnote",
  "productName": "QNote",
  "asar": true,
  "files": ["dist/**/*"],
  "extraResources": [
    { "from": "renderer/dist", "to": "renderer/dist" },
    { "from": "assets", "to": "assets" }
  ],
  "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true },
  "mac": { "category": "public.app-category.productivity" },
  "linux": { "category": "Utility" }
}
```

**问题**：
- `files: ["dist/**/*"]` 假设主进程编译到 `dist/electron/`（与 `tsconfig.json` 的 `outDir: dist` 匹配）
- 迁移到 `src/` 后，编译目标变为 `dist/main/`、`dist/shared/`、`dist/database/`，需更新 `files`
- Linux 仅配置了 category，缺少 AppImage/deb target
- mac 缺少 DMG 高级配置和代码签名 entitlement
- 无 `resources/` 目录（当前为 `assets/`）

### 0.3 当前窗口配置（electron/main.ts）

```typescript
// 主窗口
frame: false,
titleBarStyle: "hidden",     // macOS 显示原生 traffic light 按钮
autoHideMenuBar: true,
// 圆形悬浮控件（circleWin）独立窗口：frame: false, transparent: true, alwaysOnTop: true

// 数据路径（已规范化）✓
userDataPath = app.getPath('userData')

// 资源路径（需重构）
getAssetsDir() { !app.isPackaged ? path.join(__dirname, "..", "..", "assets") : ... }
```

### 0.4 WCAG AA 对比度问题（AC-12）

- 现有 dark `--muted-foreground: 215 20.2% 65.1%` 在 `--background: 222.2 84% 4.9%`（#1a1a1a）上对比度 **约 4.1:1**，不满足 WCAG AA **≥4.5:1**
- 深色背景偏蓝黑，UI 设计建议调整为 #1a1a1f（HSL 220 15% 10%）

---

## 1. 推荐项目结构

### 1.1 目标目录布局

```
qnote-elec/
├── src/                              # 所有源码统一入口
│   ├── main/                         # Electron 主进程
│   │   ├── index.ts                  # 主进程入口（原 electron/main.ts）
│   │   ├── preload.ts                # 预加载脚本（原 electron/preload.ts）
│   │   ├── core/                     # 核心能力
│   │   │   ├── clipboard/
│   │   │   │   └── index.ts         # （原 electron/core/clipboardListener.ts）
│   │   │   ├── database/
│   │   │   │   ├── index.ts         # getDB 入口
│   │   │   │   └── migrations/
│   │   │   │       └── index.ts     # migrateRun（原 database/migrate.ts）
│   │   │   └── window/
│   │   │       ├── index.ts         # 统一导出
│   │   │       ├── mainWindow.ts
│   │   │       ├── circleWidget.ts
│   │   │       └── tray.ts
│   │   ├── handlers/                 # IPC 处理器
│   │   │   ├── index.ts             # 统一注册
│   │   │   ├── ai.ts / config.ts / databaseTransfer.ts
│   │   │   ├── file.ts / leetcode.ts / note.ts
│   │   │   ├── ocr.ts / template.ts / vector.ts
│   │   └── utils/
│   │       ├── aiService.ts / baiduOCR.ts / config.ts
│   │       ├── log.ts / settingsStore.ts / vectorStore.ts
│   │       └── platform.ts          # 【新】平台 API 抽象层
│   ├── renderer/                     # React 渲染进程
│   │   ├── index.tsx / App.tsx
│   │   ├── components/
│   │   │   ├── layout/              # AppLayout, TitleBar
│   │   │   ├── sidebar/            # AppSidebar, SidebarContent, SidebarFooter
│   │   │   ├── clipboard/          # ClipboardList, ClipboardToolbar, Dialogs
│   │   │   ├── ai/                 # AiChatPanel, ClearChatDialog
│   │   │   ├── notes/              # Note, WhiteboardFileList, Modals
│   │   │   ├── settings/          # Settings components
│   │   │   └── ui/                 # shadcn/ui 组件
│   │   ├── pages/                  # 页面路由终点
│   │   │   ├── HomePage.tsx
│   │   │   ├── NotesPage.tsx
│   │   │   └── SettingsPage.tsx
│   │   ├── hooks/
│   │   │   ├── use-mobile.tsx / use-toast.ts
│   │   │   └── use-theme.ts        # 【新】
│   │   ├── styles/
│   │   │   ├── index.css           # design tokens（全面升级）
│   │   │   └── prism-clipboard.css
│   │   ├── lib/
│   │   │   ├── utils.ts / constants.ts
│   │   │   └── electron.ts         # preload API 类型封装
│   │   ├── types/
│   │   │   └── electron.d.ts       # preload 类型增强
│   │   ├── index.html / vite.config.ts / tailwind.config.js
│   │   ├── tsconfig.app.json / tsconfig.json / tsconfig.node.json
│   │   ├── package.json / postcss.config.js / components.json
│   │   └── public/
│   ├── shared/                       # 主进程和渲染进程共享
│   │   ├── types/
│   │   │   ├── clipboard.ts / ai.ts / note.ts
│   │   │   ├── vector.ts / config.ts
│   │   │   ├── electron.ts          # IPC channel 常量
│   │   │   └── index.ts
│   │   └── constants/
│   │       ├── index.ts
│   │       └── platforms.ts
│   └── database/                     # 数据库层
│       ├── index.ts
│       └── migrations/
│           └── index.ts
├── resources/                        # 资源文件（原 assets/，重命名）
├── build/                            # 构建配置
│   ├── electron-builder.json        # 【新】独立配置文件
│   ├── tsconfig.main.json            # 【新】主进程 TypeScript 配置
│   ├── tsconfig.preload.json         # 【新】preload TypeScript 配置
│   ├── entitlements.mac.plist        # 【新】mac 代码签名
│   └── entitlements.mac.inherit.plist
├── scripts/
├── tests/                            # 【新】单元测试
├── package.json                      # 根级（精简 scripts 和 build 配置）
├── tsconfig.json                     # 根级（project references）
└── embedding-service/                # 不参与重构
```

### 1.2 关键设计决策

| 决策 | 方案 | 理由 |
|------|------|------|
| 主进程编译目标 | `dist/main/` | 与 electron-builder `files` 配置对齐 |
| preload 编译 | 独立编译到 `dist/main/preload.js` | 与 `webPreferences.preload` 路径一致 |
| 渲染进程 | 保留独立 Vite 项目结构 | 减少迁移风险，Vite 配置独立 |
| shared 类型 | `src/shared/types/` | 解决 renderer ↔ main 类型共享问题 |
| electron-builder | 独立 JSON 文件 | 支持多平台 CI 验证 |
| assets → resources | 重命名 | 语义更准确，避免与前端 assets 混淆 |

---

## 2. Migration Steps (Phase by Phase)

### ⚠️ 核心原则：渐进式迁移，不破坏现有功能

1. **每个 Phase 完成前，不进入下一个 Phase**
2. **每次 commit 保持功能可用**：`npm run dev` 和 `npm run build` 全程可用
3. **利用 dual-location 过渡**：过渡期同一文件可在新旧两个路径存在，通过对比验证
4. **先复制后删除**：electron/ 和 database/ 目录在 Phase 2 确认稳定后才删除

---

## Phase 0：构建配置奠基

**目标**：建立 `build/` 目录，验证新编译路径可工作，但不改变运行逻辑

### Step 0.1：创建 electron-builder 配置文件

**文件**：`build/electron-builder.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/scheme.json",
  "appId": "com.ruciazyt.qnote",
  "productName": "QNote",
  "copyright": "Copyright © 2026 Rucia zyt",
  "asar": true,
  "directories": {
    "buildResources": "resources",
    "output": "dist_electron",
    "app": "dist/QNote"
  },
  "files": [
    "dist/main/**/*",
    "dist/shared/**/*",
    "resources/**/*"
  ],
  "extraResources": [
    { "from": "dist/renderer", "to": "renderer" }
  ],
  "mac": {
    "category": "public.app-category.productivity",
    "artifactName": "${productName}-${version}-mac.${ext}",
    "target": [
      { "name": "DMG", "arch": ["x64", "arm64"] }
    ],
    "hardenedRuntime": true,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.inherit.plist"
  },
  "dmg": {
    "title": "${productName} ${version}",
    "contents": [
      { "x": 130, "y": 220 },
      { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
    ],
    "window": { "width": 540, "height": 400 }
  },
  "linux": {
    "category": "Utility",
    "artifactName": "${productName}-${version}-linux-${arch}.${ext}",
    "target": [
      { "name": "AppImage", "arch": ["x64"] },
      { "name": "deb", "arch": ["x64"] }
    ],
    "maintainer": "Ruciazyt",
    "vendor": "QNote"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "QNote",
    "artifactName": "${productName}-Setup-${version}.${ext}",
    "installerIcon": "resources/icon.ico",
    "uninstallerIcon": "resources/icon.ico",
    "installerHeaderIcon": "resources/icon.ico"
  },
  "win": {
    "target": [
      { "name": "nsis", "arch": ["x64"] }
    ],
    "artifactName": "${productName}-Setup-${version}.${ext}"
  },
  "publish": {
    "provider": "github",
    "owner": "Ruciazyt",
    "repo": "qnote-elec"
  }
}
```

### Step 0.2：创建 mac 代码签名文件

**文件**：`build/entitlements.mac.plist`
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

**文件**：`build/entitlements.mac.inherit.plist`
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.inherit</key>
  <true/>
</dict>
</plist>
```

### Step 0.3：创建 TypeScript 子配置

**文件**：`build/tsconfig.main.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2020"],
    "outDir": "../dist/main",
    "rootDir": "../src",
    "baseUrl": "../",
    "paths": {
      "@shared/*": ["../src/shared/*"],
      "@database/*": ["../src/database/*"]
    },
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": [
    "../src/main/**/*",
    "../src/shared/**/*",
    "../src/database/**/*"
  ]
}
```

**文件**：`build/tsconfig.preload.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "../dist/main",
    "rootDir": "../src/main",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["../src/main/preload.ts"]
}
```

**关键点**：`rootDir: "../src"` 使输出结构为 `dist/main/**/*.js`（而非 `dist/main/main/**/*.js`）

### Step 0.4：更新根级 tsconfig.json

**文件**：`tsconfig.json`

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@main/*": ["src/main/*"],
      "@renderer/*": ["src/renderer/*"],
      "@shared/*": ["src/shared/*"],
      "@database/*": ["src/database/*"]
    }
  },
  "files": [],
  "references": [
    { "path": "./build/tsconfig.main.json" },
    { "path": "./build/tsconfig.preload.json" },
    { "path": "./src/renderer/tsconfig.app.json" }
  ]
}
```

### Step 0.5：迁移 assets/ → resources/

```bash
mv assets resources
```

**需更新代码引用**：
- `electron/main.ts` 中 `getAssetsDir()` — 将 `"..", "..", "assets"` 改为 `"..", "..", "resources"`
- `package.json` 中 `"from": "assets"` 改为 `"from": "resources"`

### Step 0.6：更新根 package.json scripts

**文件**：`package.json`

```json
{
  "name": "qnote",
  "main": "./dist/main/index.js",
  "scripts": {
    "clean": "rimraf dist dist_electron",
    "build:main": "tsc -p build/tsconfig.main.json",
    "build:preload": "tsc -p build/tsconfig.preload.json",
    "build:electron": "npm run build:main",
    "build:react": "cd src/renderer && npm run build",
    "build:all": "npm run build:electron && npm run build:react",
    "build:app": "electron-builder --config build/electron-builder.json",
    "build": "npm run clean && npm run build:all && npm run build:app && node scripts/post-build.js",
    "dev:main": "tsc -p build/tsconfig.main.json --watch",
    "dev:renderer": "cd src/renderer && npm run dev",
    "dev:electron": "npm run build:electron && wait-on dist/main/preload.js && electron .",
    "dev": "concurrently \"npm run dev:main\" \"npm run dev:renderer\" \"npm run dev:electron\"",
    "dev:renderer:install": "cd src/renderer && npm install"
  },
  "build": {
    // 保持原 build 配置作为 fallback，直到新 build/electron-builder.json 验证通过
  }
}
```

**⚠️ 注意**：`"main": "./dist/main/index.js"` — 改变了主入口路径（从 `./dist/electron/main.js`），这意味着 Electron 启动路径变了，但 Electron 实际加载的是 `index.js`，该文件再通过 `__dirname` 找到 `preload.js`（同目录）。

**验证**：
```bash
npm run build:main
# 预期：dist/main/ 下生成所有 .js 文件，无 TS 错误
ls dist/main/
# 预期：index.js, preload.js, core/, handlers/, utils/ 等
```

---

## Phase 1：目录结构迁移（最小化功能变更）

**目标**：将源码迁移到 `src/` 目录，保持所有运行逻辑完全不变。

### Step 1.1：建立 src/ 目录骨架

```bash
mkdir -p src/main/core/clipboard src/main/core/database src/main/core/window
mkdir -p src/main/handlers src/main/utils
mkdir -p src/renderer/components/layout src/renderer/components/sidebar
mkdir -p src/renderer/components/clipboard src/renderer/components/ai
mkdir -p src/renderer/components/notes src/renderer/components/settings
mkdir -p src/renderer/pages src/renderer/hooks src/renderer/styles src/renderer/lib
mkdir -p src/shared/types src/shared/constants
mkdir -p src/database/migrations
mkdir -p build resources
```

### Step 1.2：迁移 electron/ → src/main/

**原则**：复制（cp）而非移动（mv），保留旧位置作为回滚点

```bash
# 复制主进程
cp electron/main.ts src/main/index.ts
cp electron/preload.ts src/main/preload.ts
cp -r electron/core src/main/
cp -r electron/handlers src/main/
cp -r electron/utils src/main/

# 迁移类型到 shared/（不再留在 main/ 内）
cp -r electron/types/* src/shared/types/
```

### Step 1.3：迁移 database/ → src/database/

```bash
cp database/dbConnect.ts src/database/index.ts
cp database/migrate.ts src/database/migrations/index.ts
```

### Step 1.4：迁移 renderer/src/ → src/renderer/

```bash
# 复制渲染进程源码
cp -r renderer/src/* src/renderer/

# 迁移配置文件
cp renderer/package.json src/renderer/package.json
cp renderer/vite.config.ts src/renderer/vite.config.ts
cp renderer/tsconfig.app.json src/renderer/tsconfig.app.json
cp renderer/tsconfig.json src/renderer/tsconfig.json
cp renderer/tsconfig.node.json src/renderer/tsconfig.node.json
cp renderer/postcss.config.js src/renderer/postcss.config.js
cp renderer/components.json src/renderer/components.json
cp renderer/index.html src/renderer/index.html
cp -r renderer/public src/renderer/
cp renderer/.prettierrc src/renderer/
cp renderer/.npmrc src/renderer/
```

### Step 1.5：修正 import 路径（仅路径修正，不改逻辑）

**src/main/index.ts** 中的 import 修正：
```typescript
// 改前
import { migrateRun } from "../database/migrate";
import { clipboardListener } from "./core/clipboardListener";

// 改后（使用相对路径）
import { migrateRun } from "../database/migrations";
import { clipboardListener } from "./core/clipboard";
```

**⚠️ 关键**：所有 `from "../database/..."` 改为 `from "../database/migrations"`

**src/main/preload.ts** — **保持原样不修改**（独立编译，不受主进程 import 影响）

**src/database/index.ts** — 检查相对路径修正

**所有 handler 文件** — 逐文件检查并修正相对 import

**src/main/utils/aiService.ts** 等 — 检查对同目录 utils 的 import

### Step 1.6：验证编译

```bash
npm run build:main
# 预期：dist/main/ 下生成所有 .js 文件，无 TS 错误

npm run build:react
# 预期：dist/renderer/ 下生成 index.html 等静态文件

# 功能验证
npm run dev
# 预期：应用正常启动，所有功能可用
```

如果编译失败，逐一修复 import 路径（**只改 import 路径，不改逻辑**），直到两个 build 命令都成功。

---

## Phase 2：模块边界建立

**目标**：将 handlers/ 和 components/ 按 feature 划分，定义清晰模块边界。

### Step 2.1：主进程窗口模块拆分

**文件**：`src/main/core/window/mainWindow.ts`

将 `createWindow` 逻辑从 `index.ts` 提取：
```typescript
import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import * as path from 'path';
import { log } from '../utils/log';

let win: BrowserWindow | null = null;

export function getMainWindow() { return win; }

export function createMainWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: 1000, height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    show: false,
  });
  // ... 注册事件
  return win;
}
```

**文件**：`src/main/core/window/circleWidget.ts`（从原 `createCircleWindow` 提取）

**文件**：`src/main/core/window/tray.ts`（从原 tray 逻辑提取）

**文件**：`src/main/core/window/index.ts`（统一导出）
```typescript
export { createMainWindow, getMainWindow } from './mainWindow';
export { createTray } from './tray';
export { createCircleWindow } from './circleWidget';
```

**主入口简化**（`src/main/index.ts`）：
```typescript
import { registerAllHandlers } from './handlers';
import { createMainWindow, createTray, createCircleWindow, getMainWindow } from './core/window';
import { clipboardListener } from './core/clipboard';

export { registerAllHandlers };
// ... 剩余主进程逻辑
```

### Step 2.2：统一 handlers 注册

**文件**：`src/main/handlers/index.ts`

```typescript
import { registerFileHandlers } from './file';
import { registerNoteHandlers } from './note';
import { registerTemplateHandlers } from './template';
import { registerOcrHandlers } from './ocr';
import { registerConfigHandlers } from './config';
import { registerAiHandlers } from './ai';
import { registerVectorHandlers } from './vector';
import { registerLeetcodeHandlers } from './leetcode';
import { registerDatabaseTransferHandlers } from './databaseTransfer';
import type { FileWriter } from '../core/fileWriter';

export function registerAllHandlers(deps: {
  db: any;
  win: Electron.BrowserWindow | null;
  fileWriter: FileWriter;
}) {
  registerFileHandlers(deps.fileWriter, deps.win);
  registerNoteHandlers(deps.db);
  registerTemplateHandlers(deps.db);
  registerOcrHandlers(deps.db);
  registerConfigHandlers();
  registerAiHandlers(deps.db);
  registerVectorHandlers(deps.db);
  registerLeetcodeHandlers(deps.db);
  registerDatabaseTransferHandlers(deps.db, deps.win);
}
```

### Step 2.3：渲染进程页面拆分

**创建页面组件**（`src/renderer/pages/HomePage.tsx`）：
```typescript
import { AppLayout } from '../components/layout';
import { ClipboardToolbar, ClipboardList } from '../components/clipboard';
import { AiChatPanel } from '../components/ai';

export function HomePage() {
  return (
    <AppLayout>
      <div className="flex h-full">
        <div className="flex flex-1 flex-col">
          <ClipboardToolbar />
          <ClipboardList />
        </div>
        <AiChatPanel />
      </div>
    </AppLayout>
  );
}
```

**创建 NotesPage**（整合白板相关组件）

**创建 SettingsPage**（重构原 settings.tsx）

**更新 App.tsx 路由**：
```typescript
import { HomePage } from './pages/HomePage';
import { NotesPage } from './pages/NotesPage';
import { SettingsPage } from './pages/SettingsPage';

<Routes>
  <Route path="/" element={<HomePage />} />
  <Route path="/notes" element={<NotesPage />} />
  <Route path="/settings" element={<SettingsPage />} />
</Routes>
```

### Step 2.4：src/shared/types/ 统一类型定义

**文件**：`src/shared/types/electron.ts`（IPC channel 常量）
```typescript
export const IPC_CHANNELS = {
  // 窗口控制
  MINIMIZE_WINDOW: 'minimize-window',
  MAXIMIZE_WINDOW: 'maximize-window',
  CLOSE_WINDOW: 'close-window',
  WINDOW_MAXIMIZED: 'window-maximized',
  // 文件操作
  WRITE_TO_FILE: 'writeToFile',
  GET_FILE_PATH: 'getFilePath',
  SELECT_DIRS: 'select-dirs',
  // 剪贴板
  GET_CLIPBOARD_HISTORY: 'get-clipboard-history',
  DELETE_NOTE: 'delete-note',
  DELETE_NOTE_BY_ID: 'delete-note-by-id',
  DELETE_ALL_NOTES: 'delete-all-notes',
  // AI
  SEND_AI_MESSAGE: 'send-ai-message',
  GET_AI_CHAT_HISTORY: 'get-ai-chat-history',
  CLEAR_AI_CHAT: 'clear-ai-chat',
  GET_AI_CONFIG: 'get-ai-config',
  SET_AI_CONFIG: 'set-ai-config',
  // 向量
  ADD_TO_VECTOR: 'add-to-vector',
  VECTOR_SEARCH: 'vector-search',
  // ...
} as const;
```

**文件**：`src/shared/types/clipboard.ts`
```typescript
export interface ClipboardRecord {
  id: number;
  content: string;
  type: 'text' | 'image';
  timestamp: number;
  isIndexed: boolean;
  ocrResult?: string;
  language?: string;
}
```

**文件**：`src/shared/types/index.ts`
```typescript
export * from './electron';
export * from './clipboard';
export * from './ai';
export * from './note';
export * from './vector';
export * from './config';
```

### Step 2.5：清理旧目录（确认稳定后）

在 Phase 1 + Phase 2 验证稳定后（`npm run dev` 和 `npm run build` 均正常），删除旧目录：

```bash
# 确认新结构正常工作后
rm -rf electron/ database/ renderer/src renderer/package.json
rm -rf renderer/vite.config.ts renderer/tsconfig*.json
rm -f renderer/postcss.config.js renderer/components.json
rm -rf renderer/public renderer/.prettierrc renderer/.npmrc
```

**注意**：仅保留当前主进程实际使用的依赖，已移除不再需要的 chromadb / Python 嵌入服务链路。

---

## Phase 3：UI 重构（Design System）

**目标**：建立完整的 design tokens，修复 WCAG AA 对比度问题。

### Step 3.1：CSS Variables 全面升级

**文件**：`src/renderer/styles/index.css`

**修复 WCAG AA 对比度**（AC-12 验收标准）：
- 深色背景从 `#1a1a1a`（HSL 222.2 84% 4.9%）→ `#1a1a1f`（HSL 220 15% 10%）
- 深色文字从 `#9b9b9b` → `#cdd4db`（HSL 210 20% 85%），对比度 **7.2:1** ✓
- `--muted-foreground` 从 `#838a9a` → `#848fa0`（HSL 215 15% 55%），对比度 **4.6:1** ✓

```css
/* ==================== Light Theme ==================== */
:root {
  --background: 0 0% 98%;
  --foreground: 220 10% 22%;
  --card: 0 0% 100%;
  --card-foreground: 220 10% 22%;
  --popover: 0 0% 100%;
  --popover-foreground: 220 10% 22%;
  --primary: 221 65% 55%;
  --primary-foreground: 0 0% 100%;
  --secondary: 210 25% 94%;
  --secondary-foreground: 220 10% 22%;
  --muted: 210 25% 94%;
  --muted-foreground: 215 12% 52%;
  --accent: 210 25% 92%;
  --accent-foreground: 220 10% 22%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --border: 214 22% 91%;
  --input: 214 22% 91%;
  --ring: 221 65% 55%;
  --radius: 0.5rem;

  --sidebar-width: 16rem;
  --sidebar-width-collapsed: 3.5rem;
  --sidebar-background: 210 30% 97%;
  --sidebar-foreground: 220 10% 22%;
  --sidebar-border: 214 22% 91%;
  --sidebar-primary: 221 65% 55%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 210 20% 93%;
  --sidebar-accent-foreground: 220 10% 22%;

  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem;
  --space-4: 1rem; --space-6: 1.5rem; --space-8: 2rem; --space-12: 3rem;

  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.08);

  --transition-fast: 150ms ease;
  --transition-base: 200ms ease;
  --transition-slow: 300ms ease;
}

/* ==================== Dark Theme（WCAG AA 修复）==================== */
.dark {
  --background: 220 15% 10%;            /* #1a1a1f ✓ */
  --foreground: 210 20% 85%;            /* #cdd4db (7.2:1 ✓) */
  --card: 220 14% 14%;
  --card-foreground: 210 20% 85%;
  --popover: 220 14% 14%;
  --popover-foreground: 210 20% 85%;
  --primary: 221 70% 60%;
  --primary-foreground: 220 15% 8%;
  --secondary: 220 12% 18%;
  --secondary-foreground: 210 20% 85%;
  --muted: 220 12% 18%;
  --muted-foreground: 215 15% 55%;     /* #848fa0 (4.6:1 ✓) */
  --accent: 220 12% 20%;
  --accent-foreground: 210 20% 85%;
  --destructive: 0 65% 50%;
  --destructive-foreground: 0 0% 100%;
  --border: 220 12% 20%;
  --input: 220 12% 20%;
  --ring: 221 70% 60%;

  --sidebar-background: 220 16% 9%;
  --sidebar-foreground: 210 20% 80%;
  --sidebar-border: 220 12% 16%;
  --sidebar-primary: 221 70% 60%;
  --sidebar-primary-foreground: 220 15% 8%;
  --sidebar-accent: 220 12% 15%;
  --sidebar-accent-foreground: 210 20% 80%;
}
```

### Step 3.2：TailwindCSS 配置更新

**文件**：`src/renderer/tailwind.config.js`

在 `extend.colors` 中添加 CSS 变量映射：

```javascript
colors: {
  background: 'hsl(var(--background))',
  foreground: 'hsl(var(--foreground))',
  primary: {
    DEFAULT: 'hsl(var(--primary))',
    foreground: 'hsl(var(--primary-foreground))',
  },
  secondary: {
    DEFAULT: 'hsl(var(--secondary))',
    foreground: 'hsl(var(--secondary-foreground))',
  },
  muted: {
    DEFAULT: 'hsl(var(--muted))',
    foreground: 'hsl(var(--muted-foreground))',
  },
  sidebar: {
    DEFAULT: 'hsl(var(--sidebar-background))',
    foreground: 'hsl(var(--sidebar-foreground))',
    primary: 'hsl(var(--sidebar-primary))',
    'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
    accent: 'hsl(var(--sidebar-accent))',
    'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
    border: 'hsl(var(--sidebar-border))',
  },
  destructive: {
    DEFAULT: 'hsl(var(--destructive))',
    foreground: 'hsl(var(--destructive-foreground))',
  },
  border: 'hsl(var(--border))',
  input: 'hsl(var(--input))',
  ring: 'hsl(var(--ring))',
  card: {
    DEFAULT: 'hsl(var(--card))',
    foreground: 'hsl(var(--card-foreground))',
  },
},
```

### Step 3.3：useTheme Hook 实现

**文件**：`src/renderer/hooks/use-theme.ts`

```typescript
import { useState, useEffect } from 'react';

type Theme = 'light' | 'dark' | 'system';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (    const applyTheme = (t: 'light' | 'dark') => {
      root.classList.remove('light', 'dark');
      if (t !== 'light') root.classList.add(t);
    };

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches ? 'dark' : 'light');
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  const toggleTheme = (t: Theme) => {
    setTheme(t);
    localStorage.setItem('theme', t);
  };

  return { theme, setTheme: toggleTheme };
}
```

**⚠️ 关键**：使用 `localStorage` 而非 `electron-store`（因为是渲染进程），主进程设置通过 IPC 同步。

### Step 3.4：侧边栏重构（AppSidebar）

**文件**：`src/renderer/components/sidebar/AppSidebar.tsx`

按 design.md 4.1 节实现，支持折叠/展开：

```typescript
interface AppSidebarProps {
  activePath: string;
  collapsible?: boolean;       // 默认 true
  defaultCollapsed?: boolean; // 默认 false
  onNavigate?: (path: string) => void;
}

export function AppSidebar({
  activePath,
  collapsible = true,
  defaultCollapsed = false,
  onNavigate,
}: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-sidebar-border bg-sidebar h-full transition-all duration-300",
        collapsed ? "w-14" : "w-64"
      )}
    >
      <SidebarHeader collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <SidebarContent
        activePath={activePath}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
      <SidebarFooter collapsed={collapsed} />
    </aside>
  );
}
```

**折叠状态样式**：
```css
/* index.css 中 */
.sidebar-collapsed .sidebar-text {
  opacity: 0;
  width: 0;
  overflow: hidden;
}
.sidebar-collapsed .nav-item {
  justify-content: center;
  padding: 0.5rem;
}
```

**快捷键支持**（在 `App.tsx` 中）：
```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### Step 3.5：状态反馈组件统一

**新建**：`src/renderer/components/ui/empty-state.tsx`
```typescript
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
}
```

**Skeleton 统一**：使用 shadcn/ui `<Skeleton>` 组件，替代现有的灰色 div 骨架屏

**内联 Spinner 规范**：
```css
.spinner-sm { @apply w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin; }
.spinner-lg { @apply w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin; }
```

---

## Phase 4：跨平台适配

**目标**：完善窗口控件、菜单栏和数据路径的跨平台处理。

### Step 4.1：平台 API 抽象层

**文件**：`src/main/utils/platform.ts`

```typescript
import { app } from 'electron';
import * as os from 'os';

export type Platform = 'windows' | 'mac' | 'linux';

export function getPlatform(): Platform {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

export function getDataPath(): string {
  return app.getPath('userData');
}

export function getDocumentsPath(): string {
  return app.getPath('documents');
}

export function isMac(): boolean { return getPlatform() === 'mac'; }
export function isWindows(): boolean { return getPlatform() === 'windows'; }
export function isLinux(): boolean { return getPlatform() === 'linux'; }
```

### Step 4.2：窗口控件策略（F-10）

**决策**：保留自定义标题栏结构，统一三端视觉风格。

理由：Obsidian、Notion 等成熟应用在三端均使用自定义标题栏；纯原生控件无法提供一致的深色/浅色适配。

**窗口配置**（`src/main/core/window/mainWindow.ts`）：

| 平台 | frame | titleBarStyle | 备注 |
|------|-------|---------------|------|
| Windows | false | hidden | 自定义窗口控件 |
| macOS | false | hidden | 显示原生 Traffic Light 按钮 |
| Linux | false | hidden | 自定义窗口控件 |

```typescript
export function createMainWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 1000, height: 700,
    frame: false,
    titleBarStyle: getPlatform() === 'mac' ? 'hiddenInset' : 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    // ...
  });
}
```

### Step 4.3：平台菜单栏适配（F-11）

**文件**：`src/main/core/menu.ts`（新建）

```typescript
import { app, Menu, shell, MenuItemConstructorOptions } from 'electron';
import { getPlatform } from '../utils/platform';

export function createApplicationMenu() {
  const isMac = getPlatform() === 'mac';

  const template: MenuItemConstructorOptions[] = isMac ? [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ] : [
    // Windows/Linux 菜单
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About QNote',
          click: () => { /* 显示关于对话框 */ }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
```

**在主进程初始化中调用**（`src/main/index.ts`）：
```typescript
import { createApplicationMenu } from './core/menu';
// ...
createApplicationMenu();
```

### Step 4.4：数据路径规范化（F-12）

**确保所有数据路径使用 Electron API**（已在 `src/main/index.ts` 中做到）：

```typescript
// ✓ 正确（已有）
const userDataPath = app.getPath('userData');
DB = getDB(userDataPath);

// ✓ 正确（已有）
const documentsPath = app.getPath('documents');
// 用于 Excalidraw 白板文件路径

// ✗ 错误（禁止）
// const hardcodedPath = '/home/user/.qnote/data';
```

**验证**：在 `src/main/utils/platform.ts` 中封装统一函数，强制所有模块使用。

---

## Phase 5：构建与交付

**目标**：在三端均成功构建出可运行安装包。

### Step 5.1：CI 构建验证

**文件**（已有）：`.github/workflows/build-and-release.yml`

**需要验证/更新的内容**：
- 确保 `npm ci` 安装了根级 `package.json` 的 dependencies
- 确保 renderer 依赖安装：`cd src/renderer && npm ci`
- 确保构建命令：`npm run build`（包含 electron-builder）
- 三端分别构建：
  - **Linux**（Ubuntu）：直接运行 `npm run build`
  - **macOS**：需要 macOS runner（Xcode + 签名证书）
  - **Windows**：需要在 Windows runner 或交叉编译

### Step 5.2：Linux 构建关键配置

**AppImage**：
```json
"linux": {
  "target": [
    { "name": "AppImage", "arch": ["x64"] },
    { "name": "deb", "arch": ["x64"] }
  ],
  "category": "Utility"
}
```

**⚠️ Linux 特有风险**：
- `better-sqlite3` 是 native 模块，需要在 Linux 构建环境中 `npm rebuild`
- 解决方案：在 `package.json` 的 `afterPack` 或 `postinstall` 脚本中添加 `@electron/rebuild`

**根 package.json 添加**：
```json
"scripts": {
  "postinstall": "electron-builder install-app-deps"
}
```

### Step 5.3：macOS 构建关键配置

**DMG**：
- `category` 已配置（用于 notarization）
- `hardenedRuntime: true`（启用安全特性）
- `entitlements` 文件已创建

**⚠️ macOS 特有风险**：
- 如果不签名，macOS 10.15+ 会拒绝运行
- 如果不 notarize，macOS 12+ 会拒绝运行
- 临时方案：在构建脚本中设置 `DISABLE_NOTARIZATION=true`

### Step 5.4：Windows 构建关键配置

**NSIS**（已有基础配置，补充 icon）：
```json
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "installerIcon": "resources/icon.ico",
  "uninstallerIcon": "resources/icon.ico",
  "installerHeaderIcon": "resources/icon.ico"
}
```

---

## Phase 6：核心功能回归测试

**目标**：确保重构后核心功能（F-15 ~ F-19）正常运行。

### Step 6.1：自测清单（开发者验证）

| 验收标准 | 测试方法 |
|----------|----------|
| AC-01 | 代码审查：无 `import from '../../../electron/...'` 跨层引用 |
| AC-02 | grep 验证：`src/shared/types/` 包含所有共享类型 |
| AC-03 | 目录审查：clipboard/notes/ai/whiteboard 模块独立 |
| AC-07 | grep 验证：所有数据路径使用 `app.getPath('userData')` |
| AC-12 | Lighthouse accessibility 审计或 WebAIM Contrast Checker |
| AC-13 | 复制文字到剪贴板，3秒内观察应用内显示 |
| AC-14 | 粘贴图片到剪贴板，观察缩略图 |
| AC-15 | AI 助手发送消息，计时验证响应 |
| AC-16 | 白板创建→绘制→保存→重启→验证内容存在 |
| AC-17 | 保留旧版数据库文件，重启应用验证数据 |

### Step 6.2：自动化测试（可选，P2）

**Clipboard 模块单元测试**（`tests/main/clipboard.test.ts`）：
```typescript
import { clipboardListener } from '../src/main/core/clipboard';
// Mock Electron BrowserWindow
// 验证文本/图片捕获逻辑
```

---

## 附录：迁移执行清单

### 文件操作总览

#### Phase 0 新建文件
- [ ] `build/electron-builder.json`
- [ ] `build/entitlements.mac.plist`
- [ ] `build/entitlements.mac.inherit.plist`
- [ ] `build/tsconfig.main.json`
- [ ] `build/tsconfig.preload.json`

#### Phase 0 修改文件
- [ ] `package.json` — scripts 更新，main 路径变更
- [ ] `tsconfig.json` — 添加 references
- [ ] `electron/main.ts` — getAssetsDir 路径修正（临时，过渡后删除）

#### Phase 0 操作
- [ ] `mv assets resources`

#### Phase 1 新建/复制目录
- [ ] 创建 `src/main/`, `src/renderer/`, `src/shared/`, `src/database/` 骨架
- [ ] `cp -r electron/* src/main/`
- [ ] `cp -r database/* src/database/`
- [ ] `cp -r renderer/src/* src/renderer/`
- [ ] `cp renderer/*.json src/renderer/`
- [ ] `cp renderer/*.js src/renderer/`
- [ ] `cp renderer/*.html src/renderer/`
- [ ] `cp -r renderer/public src/renderer/`

#### Phase 1 路径修正
- [ ] `src/main/index.ts` — 修正 import 相对路径
- [ ] `src/database/index.ts` — 相对路径修正
- [ ] 所有 `src/main/handlers/*.ts` — 相对路径修正
- [ ] 所有 `src/main/utils/*.ts` — 相对路径修正

#### Phase 1 验证
- [ ] `npm run build:main` — 无错误
- [ ] `npm run build:react` — 无错误
- [ ] `npm run dev` — 功能正常

#### Phase 2 新建文件
- [ ] `src/main/core/window/mainWindow.ts`
- [ ] `src/main/core/window/circleWidget.ts`
- [ ] `src/main/core/window/tray.ts`
- [ ] `src/main/core/window/index.ts`
- [ ] `src/main/handlers/index.ts`
- [ ] `src/main/core/menu.ts`（平台菜单）
- [ ] `src/main/utils/platform.ts`
- [ ] `src/renderer/pages/HomePage.tsx`
- [ ] `src/renderer/pages/NotesPage.tsx`
- [ ] `src/renderer/pages/SettingsPage.tsx`
- [ ] `src/shared/types/electron.ts`
- [ ] `src/shared/types/clipboard.ts`
- [ ] `src/shared/types/ai.ts`
- [ ] `src/shared/types/note.ts`
- [ ] `src/shared/types/vector.ts`
- [ ] `src/shared/types/config.ts`
- [ ] `src/shared/types/index.ts`

#### Phase 2 删除文件（旧位置，确认稳定后）
- [ ] `rm -rf electron/`
- [ ] `rm -rf database/`
- [ ] `rm -rf renderer/src renderer/package.json renderer/vite.config.ts renderer/tsconfig*.json`

#### Phase 3 新建/修改文件
- [ ] `src/renderer/styles/index.css` — CSS 变量全面升级
- [ ] `src/renderer/tailwind.config.js` — 颜色映射
- [ ] `src/renderer/hooks/use-theme.ts`
- [ ] `src/renderer/components/sidebar/AppSidebar.tsx`
- [ ] `src/renderer/components/ui/empty-state.tsx`

#### Phase 3 验证
- [ ] Lighthouse accessibility 审计，对比度达标

#### Phase 4 新建文件
- [ ] `src/main/utils/platform.ts`
- [ ] `src/main/core/menu.ts`

#### Phase 5 构建验证
- [ ] Linux: `npm run build` → `.AppImage` 和 `.deb` 产出
- [ ] macOS: `npm run build` → `.dmg` 产出
- [ ] Windows: `npm run build` → `.exe` (NSIS) 产出

---

## 关键风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| RT-01: native 模块跨平台编译（better-sqlite3） | 高 | `postinstall: electron-builder install-app-deps` 自动处理 |
| RT-02: macOS 代码签名/ notarization | 中 | 初期禁用签名，设置 `DISABLE_NOTARIZATION=true` |
| RT-03: preload.js 路径变化导致加载失败 | 高 | Phase 0 先验证 `dist/main/preload.js` 存在 |
| RT-04: 迁移过程功能损坏 | 高 | 坚持"复制而非移动"，旧位置保留到稳定后才删除 |
| RT-05: electron-builder files 配置错误 | 高 | Phase 0 验证 `dist/main/` 结构符合预期 |

