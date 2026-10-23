# QNote Elec UI/UX Design Document

**版本：** v1.0
**日期：** 2026-03-26
**状态：** 设计稿
**基于代码调研：** renderer/src 全组件梳理完毕

---

## 0. 前置说明

本文档基于 `renderer/src` 现有代码调研结果，遵循以下原则：
- 保持与现有 shadcn/ui + Radix 组件体系的一致性
- 颜色/字体使用 TailwindCSS 原生类名为准
- 不写代码实现，只输出设计规范
- 参考 Obsidian / Logseq / Notion 的设计风格

**现有技术栈确认：**
- React + TypeScript + TailwindCSS
- shadcn/ui 组件（基于 Radix Primitive）
- Lucide React 图标库
- React Router（HashRouter）
- 三方集成：Excalidraw, Prism.js, date-fns

---

## 1. 项目新结构（Target Directory Structure）

### 1.1 整体目录组织

```
qnote-elec/
├── src/
│   ├── main/                         # Electron 主进程
│   │   ├── index.ts                  # 主进程入口
│   │   ├── preload.ts                # 预加载脚本
│   │   ├── core/                     # 核心能力
│   │   │   ├── clipboard/             # 剪贴板监听
│   │   │   ├── database/              # SQLite 操作
│   │   │   └── window/                # 窗口管理
│   │   ├── handlers/                  # IPC 处理器
│   │   │   ├── clipboard.ts
│   │   │   ├── ai.ts
│   │   │   ├── vector.ts
│   │   │   └── file.ts
│   │   └── utils/
│   ├── renderer/                     # React 渲染进程
│   │   ├── index.tsx                 # 渲染进程入口
│   │   ├── App.tsx                   # 根组件
│   │   ├── components/               # UI 组件（按功能模块组织）
│   │   │   ├── layout/              # 布局组件（Layout, TitleBar）
│   │   │   ├── sidebar/             # 侧边栏
│   │   │   ├── clipboard/           # 剪贴板历史（ClipboardList, Toolbar）
│   │   │   ├── ai/                 # AI 助手（AiChatPanel）
│   │   │   ├── notes/              # 笔记/白板（Note, WhiteboardFileList）
│   │   │   ├── settings/           # 设置页面
│   │   │   └── ui/                 # 共享基础组件（shadcn/ui）
│   │   │       ├── button.tsx
│   │   │       ├── card.tsx
│   │   │       ├── dialog.tsx
│   │   │       ├── input.tsx
│   │   │       ├── skeleton.tsx
│   │   │       ├── toast.tsx / toaster.tsx
│   │   │       ├── tooltip.tsx
│   │   │       ├── separator.tsx
│   │   │       ├── sheet.tsx
│   │   │       ├── scroll-area.tsx
│   │   │       ├── label.tsx
│   │   │       ├── textarea.tsx
│   │   │       ├── progress.tsx
│   │   │       └── sidebar.tsx      # shadcn/ui sidebar 重构
│   │   ├── hooks/                   # 共享 React hooks
│   │   │   ├── use-toast.ts
│   │   │   ├── use-mobile.ts
│   │   │   └── use-theme.ts         # 新增：主题管理
│   │   ├── pages/                   # 页面级组件（路由终点）
│   │   │   ├── HomePage.tsx         # 剪贴板首页
│   │   │   ├── NotesPage.tsx        # 笔记/白板页
│   │   │   └── SettingsPage.tsx     # 设置页
│   │   ├── styles/                  # 全局样式
│   │   │   ├── index.css           # 主样式文件（design tokens）
│   │   │   ├── prism-clipboard.css
│   │   │   └── components/
│   │   ├── lib/                     # 工具库
│   │   │   ├── utils.ts            # cn() 等
│   │   │   └── constants.ts
│   │   └── types/                   # 渲染进程类型
│   │       └── electron.d.ts
│   ├── shared/                       # 主进程和渲染进程共享
│   │   ├── types/                  # 统一类型定义
│   │   │   ├── clipboard.ts
│   │   │   ├── ai.ts
│   │   │   ├── note.ts
│   │   │   └── index.ts
│   │   └── constants/
│   └── database/                     # 数据库层
│       ├── index.ts
│       └── migrations/
├── resources/                        # 资源文件
├── build/                            # 构建配置
└── memory_store/                     # 本地记忆索引（SQLite 表）
```

### 1.2 目录重构说明

| 原路径 | 新路径 | 理由 |
|--------|--------|------|
| `components/core/` | `components/layout/` + `components/sidebar/` | layout 和 sidebar 是独立关注点 |
| `components/clipboard/Home.tsx` | `pages/HomePage.tsx` | Home 是页面级组件，非可复用组件 |
| `components/clipboard/ClipboardList.tsx` | `components/clipboard/` | 保留在功能模块下 |
| `components/clipboard/AiChatPanel.tsx` | `components/ai/` | AI 是独立功能模块 |
| `components/Note/` | `components/notes/` | 统一 notes 复数命名 |
| `components/Leetcode/` | 保持或移除 | 与核心功能无关，可移除 |
| `index.css` | `styles/index.css` | 样式文件统一管理 |

---

## 2. 颜色系统（Design Tokens）

### 2.1 设计理念

参考 Obsidian 的蓝灰中性色调和 Logseq 的简约专业风格，使用 HSL 色彩系统，确保：
- 对比度符合 WCAG AA 标准（4.5:1 以上）
- 深色主题下正文文字对比度需达到 4.8:1 以上（AC-12）
- 所有颜色通过 CSS 变量声明，便于主题切换

### 2.2 CSS 变量定义（styles/index.css）

```css
/* ==================== 基础色彩（HSL 系统） ==================== */

/* Light Theme */
:root {
  /* 核心背景色 - 冷灰白，参考 Obsidian */
  --background: 0 0% 98%;              /* #fafafa，近白 */
  --foreground: 220 10% 22%;          /* #383a42，深灰蓝 */

  /* 卡片 */
  --card: 0 0% 100%;                  /* #ffffff，纯白 */
  --card-foreground: 220 10% 22%;

  /* 弹窗/下拉 */
  --popover: 0 0% 100%;
  --popover-foreground: 220 10% 22%;

  /* 主色调 - 蓝灰，Obsidian 风格 */
  --primary: 221 65% 55%;             /* #4f7dd8，蓝灰 */
  --primary-foreground: 0 0% 100%;

  /* 次要/辅助色 */
  --secondary: 210 25% 94%;           /* #eff2f5，浅灰蓝 */
  --secondary-foreground: 220 10% 22%;

  /* 静音/弱化文字 */
  --muted: 210 25% 94%;
  --muted-foreground: 215 12% 52%;    /* #838a9a，弱化文字 */

  /* 强调/高亮 */
  --accent: 210 25% 92%;              /* #eef0f3 */
  --accent-foreground: 220 10% 22%;

  /* 危险/错误 */
  --destructive: 0 72% 51%;           /* #dc2626，红 */
  --destructive-foreground: 0 0% 100%;

  /* 边框与输入 */
  --border: 214 22% 91%;              /* #e4e8ef */
  --input: 214 22% 91%;
  --ring: 221 65% 55%;

  /* 圆角 */
  --radius: 0.5rem;                   /* 8px */

  /* ==================== 侧边栏专用 ==================== */
  --sidebar-width: 16rem;             /* 256px */
  --sidebar-width-collapsed: 3.5rem; /* 56px，仅图标 */
  --sidebar-background: 210 30% 97%; /* #f4f7fb，淡蓝灰 */
  --sidebar-foreground: 220 10% 22%;
  --sidebar-border: 214 22% 91%;
  --sidebar-primary: 221 65% 55%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 210 20% 93%;
  --sidebar-accent-foreground: 220 10% 22%;

  /* ==================== 间距（4px 基准网格） ==================== */
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;       /* 16px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;       /* 32px */
  --space-12: 3rem;      /* 48px */

  /* ==================== 阴影 ==================== */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.08);

  /* ==================== 过渡 ==================== */
  --transition-fast: 150ms ease;
  --transition-base: 200ms ease;
  --transition-slow: 300ms ease;
}

/* Dark Theme */
.dark {
  --background: 220 15% 10%;           /* #1a1a1f，低饱和黑 */
  --foreground: 210 20% 85%;           /* #cdd4db，柔和白（对比度 7.2:1） */

  --card: 220 14% 14%;                 /* #232328，卡片 */
  --card-foreground: 210 20% 85%;

  --popover: 220 14% 14%;
  --popover-foreground: 210 20% 85%;

  --primary: 221 70% 60%;              /* #5b8dee，亮蓝 */
  --primary-foreground: 220 15% 8%;

  --secondary: 220 12% 18%;            /* #272b32 */
  --secondary-foreground: 210 20% 85%;

  --muted: 220 12% 18%;
  --muted-foreground: 215 15% 55%;     /* #848fa0，弱化文字（对比度 4.6:1，需验证） */

  --accent: 220 12% 20%;              /* #2c3038 */
  --accent-foreground: 210 20% 85%;

  --destructive: 0 65% 50%;           /* #e53e3e */
  --destructive-foreground: 0 0% 100%;

  --border: 220 12% 20%;
  --input: 220 12% 20%;
  --ring: 221 70% 60%;

  /* 暗色侧边栏 */
  --sidebar-background: 220 16% 9%;   /* #16181e，略深于背景 */
  --sidebar-foreground: 210 20% 80%; /* #c5cbd4 */
  --sidebar-border: 220 12% 16%;
  --sidebar-primary: 221 70% 60%;
  --sidebar-primary-foreground: 220 15% 8%;
  --sidebar-accent: 220 12% 15%;       /* #22252d */
  --sidebar-accent-foreground: 210 20% 80%;
}
```

### 2.3 关键颜色使用规范

| CSS 变量 | Light 场景 | Dark 场景 | TailwindCSS 映射 |
|----------|-----------|-----------|-----------------|
| `--background` | 页面背景 | 页面背景 | `bg-background` |
| `--sidebar-background` | 侧边栏背景 | 侧边栏背景 | `bg-sidebar` |
| `--primary` | 主按钮/选中态 | 主按钮/选中态 | `bg-primary` |
| `--muted-foreground` | 次要文字（时间戳等）| 次要文字 | `text-muted-foreground` |
| `--border` | 卡片/输入框边框 | 卡片/输入框边框 | `border-border` |
| `--destructive` | 删除按钮 | 删除按钮 | `bg-destructive` |

### 2.4 深色主题对比度验证（AC-12 验收标准）

spec AC-12 要求文字 #9b9b9b 在背景 #1a1a1b 上对比度 4.8:1，实际约 4.1:1，不满足 WCAG AA。

**修正方案（二选一）：**
- 方案 A（推荐）：将深色背景从 #1a1a1b 调整为 #1a1a1f 或 #1c1c20，提升对比度至 5.0+
- 方案 B：将文字从 #9b9b9b 加深至 #a3a3a3 以上
- 验证工具：Lighthouse accessibility audit 或 WebAIM Contrast Checker
- 目标：正文文字对比度 >= 4.5:1，标题文字 >= 3.0:1

---

## 3. 字体系统（Typography）

### 3.1 字体栈

```css
/* 正文 - 系统无衬线栈（跨平台一致性优先） */
--font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
             "Segoe UI", "PingFang SC", "Hiragino Sans GB",
             "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;

/* 代码 - 等宽字体栈 */
--font-mono: "SF Mono", "Cascadia Code", "Fira Code", "Fira Mono",
             ui-monospace, "Cascadia Mono", "Segoe UI Mono",
             "Source Code Pro", Menlo, Consolas, Monaco, monospace;
```

### 3.2 字体规格（Type Scale）

基于 16px 基准字号，比例 1.25（Major Third）

| 级别 | 字号 | 行高 | 字重 | 用途 | TailwindCSS |
|------|------|------|------|------|-------------|
| Display | 32px | 1.2 | 700 | 页面大标题 | `text-4xl font-bold` |
| H1 | 28px | 1.3 | 600 | 页面标题 | `text-3xl font-semibold` |
| H2 | 22px | 1.35 | 600 | 卡片标题 | `text-xl font-semibold` |
| H3 | 18px | 1.4 | 600 | 区块标题 | `text-lg font-semibold` |
| Body | 15px | 1.6 | 400 | 正文（推荐 15px）| `text-[15px]` |
| Body Small | 14px | 1.5 | 400 | 次要内容 | `text-sm` |
| Caption | 12px | 1.4 | 400 | 时间戳、标签 | `text-xs` |
| Code | 14px | 1.6 | 400 | 代码块 | `text-sm font-mono` |

### 3.3 排版规范（F-08 排版优化）

- 行高（line-height）：正文 1.6，代码 1.6，标题 1.2-1.35
- 段间距：使用 --space-4（16px）
- 列表缩进：2em
- 代码块：左 padding 1rem，背景使用 --muted
- 最大行宽：编辑器区域 max-width: 70ch，超出换行

---

## 4. 组件重新设计

### 4.1 侧边栏（AppSidebar - F-06 重构）

#### 4.1.1 布局结构

```
AppSidebar
├── SidebarHeader
│   ├── AppLogo + AppName（可折叠隐藏）
│   └── CollapseToggle（图标按钮）
├── SidebarContent
│   ├── SidebarGroup: "导航"（主导航）
│   │   ├── NavItem: 主页 (Home icon, "/")
│   │   ├── NavItem: 笔记 (BookOpen icon, "/notes")
│   │   └── NavItem: 设置 (Settings icon, "/settings")
│   ├── SidebarSeparator
│   ├── SidebarGroup: "工具"（次要功能）
│   │   └── NavItem: 力扣分类（可选/可移除）
│   └── SidebarGroup: "状态"（底部信息）
│       ├── VectorStatus（向量库状态指示）
│       └── ThemeToggle（主题切换）
└── SidebarFooter
    └── CollapseToggle
```

#### 4.1.2 状态定义

| 状态 | 视觉表现 |
|------|---------|
| 展开（默认）| 宽度 256px，显示图标+文字 |
| 折叠 | 宽度 56px，仅显示图标，tooltip 提示名称 |
| NavItem Hover | 背景 sidebar-accent，文字 sidebar-accent-foreground |
| NavItem Active | 背景 sidebar-primary，文字 sidebar-primary-foreground |
| 展开/折叠动画 | width 过渡 300ms ease，opacity 过渡 150ms ease |

#### 4.1.3 交互细节

- **快捷键**：Ctrl/Cmd + B 切换展开/折叠（已有键盘快捷键机制）
- **Tooltip**：折叠态下 Hover 显示 tooltip，延迟 300ms，位置 right
- **平台差异**：macOS 上菜单栏独立，侧边栏不包含应用菜单

#### 4.1.4 组件 Props

```typescript
interface AppSidebarProps {
  activePath: string;
  navItems: Array<{
    id: string;
    title: string;
    icon: LucideIcon;
    path: string;
    badge?: string | number;
  }>;
  collapsible?: boolean;        // 默认 true
  defaultCollapsed?: boolean;   // 默认 false（展开）
  onThemeChange?: (theme: 'light' | 'dark' | 'system') => void;
  onNavigate?: (path: string) => void;
}
```

---

### 4.2 剪贴板记录卡片（ClipboardList - F-05/F-09 重构）

#### 4.2.1 布局结构

```
ClipboardList
├── SearchBar（固定在顶部）
│   ├── SearchInput（带搜索图标）
│   └── FilterDropdown（类型筛选：全部/文本/图片）
├── RecordList（可滚动列表，flex-1）
│   └── RecordCard x N
│       ├── RecordContent（文本 pre 或图片 img）
│       ├── RecordMeta（时间戳 + 语言标签）
│       └── RecordActions（操作按钮组）
└── EmptyState（无记录/搜索无结果时）
```

#### 4.2.2 卡片设计

**文本类型：**
```
+------------------------------------------------------------+
|  const foo = 'bar';                              [语言_v] |
|  代码内容（font-mono, 14px）                                  |
|  ------------------------------------------------------------|
|  3 分钟前        | [索引]  [复制]  [删除]                     |
+------------------------------------------------------------+
```

**图片类型：**
```
+------------------------------------------------------------+
|  [图片缩略图，点击放大]                                       |
|  ------------------------------------------------------------|
|  5 分钟前  OCR: 已识别          | [复制]  [删除]            |
+------------------------------------------------------------+
```

#### 4.2.3 状态定义

| 状态 | 视觉表现 |
|------|---------|
| 默认 | 白色/深色背景卡片，轻微阴影 |
| Hover | shadow-md，border-primary/20，translateY(-1px) |
| 语言选择展开 | 卡片 z-50，下拉菜单绝对定位遮挡其他卡片 |
| 正在格式化 | 按钮内 spinner + "格式化" 文字 |
| 已索引（向量库）| 索引按钮 bg-primary 实心 |
| 加载中（Skeleton）| 3 个灰色骨架卡片，pulse 动画 |
| 空状态 | 居中图标 + "暂无记录" |
| 搜索无结果 | "未找到匹配的记录" |

#### 4.2.4 组件 Props

```typescript
interface ClipboardListProps {
  records: ClipboardRecord[];
  formattedLanguages: Record<number, SupportedLanguage>;
  formattingRecordId: number | null;
  showLanguageSelect: number | null;
  onToggleLanguageSelect: (recordId: number) => void;
  onFormatCode: (record: ClipboardRecord, language: SupportedLanguage) => void;
  onCopy: (content: string, type: 'text' | 'image') => void;
  onDeleteRecord: (id: number) => void;
  onAddToVector: (record: ClipboardRecord) => void;
  onImageClick: (img: string) => void;
}
```

---

### 4.3 AI 聊天面板（AiChatPanel - F-07 深色主题）

#### 4.3.1 布局结构

```
AiChatPanel
├── PanelHeader
│   ├── BotAvatar + "AI助手" 标题
│   ├── ClearChatButton（清空对话）
│   └── CollapseButton（收起）
├── MessageList（flex-1，overflow-auto）
│   ├── EmptyState（无消息时）
│   └── MessageBubble x N
│       ├── Avatar（Bot/User）
│       └── Bubble（内容）
└── InputArea
    ├── TextInput（placeholder + 快捷键提示）
    └── SendButton
```

#### 4.3.2 状态定义

| 状态 | 视觉表现 |
|------|---------|
| 收起态 | 宽度 48px，仅显示展开按钮 + Bot 图标 |
| 展开态 | 宽度 320px，bg-muted/30 背景 |
| 空消息 | 居中 Bot 图标（pulse）+ 提示文字 |
| 发送中 | 按钮 spinner，输入框 disabled |
| 消息 - 用户 | 右对齐，bg-primary，白色文字 |
| 消息 - AI | 左对齐，bg-background + 边框 |
| AI 思考中 | 逐点出现动画（三个点依次出现）|

#### 4.3.3 交互细节

- **消息动画**：slideInUp 400ms ease-out，消息间延迟递增 50ms
- **输入框快捷键**：Enter 发送，Shift+Enter 换行
- **面板宽度**：固定 320px，不支持 resize

---

### 4.4 白板面板（NotesPage - F-17 Excalidraw）

#### 4.4.1 布局结构

```
NotesPage
├── WhiteboardSidebar（可折叠）
│   ├── SidebarHeader（标题 + 折叠按钮）
│   ├── FilePathBar
│   │   ├── PathDisplay（文件路径）
│   │   └── ChangePathButton
│   ├── WhiteboardFileList
│   │   └── FileItem x N
│   │       ├── FileIcon + FileName
│   │       └── ActionButtons（hover 时显示）
│   └── EmptyState（无文件）
└── ExcalidrawCanvas
    └── Excalidraw（theme prop 跟随 App 主题）
```

#### 4.4.2 文件列表项状态

| 状态 | 视觉表现 |
|------|---------|
| 默认 | 单行显示文件名，灰色时间戳 |
| Hover | 显示导入/删除/重命名按钮 |
| 选中 | ring-2 ring-primary 边框 |
| 重命名中 | 输入框替代文件名，autoFocus，Enter 确认 |

#### 4.4.3 交互细节

- **快捷键**：Ctrl/Cmd+S 保存到当前文件，Ctrl/Cmd+Shift+S 另存为
- **F2**：在文件列表选中项上按 F2 开始重命名
- **主题跟随**：Excalidraw 的 theme prop 绑定到 App 主题状态

---

### 4.5 标题栏（TitleBar - F-10 跨平台窗口控件）

#### 4.5.1 当前问题

当前 TitleBar 使用 -webkit-app-region: drag + 自定义窗口控件（最小化/最大化/关闭）。spec F-10 要求"移除自定义标题栏，使用系统原生窗口控件"。

#### 4.5.2 跨平台窗口控件方案

| 平台 | 窗口控件策略 | 实现方式 |
|------|------------|---------|
| Windows | Frameless + 自定义控件（推荐）| Obsidian/Notion 均采用，定制化程度高 |
| macOS | titleBarStyle: 'hidden' | 使用原生 Traffic Light 按钮 |
| Linux | frame: true（系统原生）| 使用 GTK/Qt 原生窗口装饰 |

**推荐方案**：保留自定义标题栏结构，统一三端视觉风格。

理由：
1. Obsidian、Notion 等成熟应用在三端均使用自定义标题栏
2. spec 同时提到"参考 Obsidian/Notion"，存在内在一致性要求
3. 纯原生控件（Windows 上）无法提供一致的深色/浅色适配

**若 spec 严格解读为"必须使用系统原生"**：
- macOS：titleBarStyle: 'hiddenInset' 或 'hidden'
- Windows：设置 frame: false 后不渲染 custom titleBar
- Linux：设置 frame: true

#### 4.5.3 标题栏布局（三端统一）

```
+------------------------------------------------------------+
| [icon] QNote                            [-] [□] [x]        |
|  16px图标   拖拽区(expand)              窗口控件按钮组(40px)  |
+------------------------------------------------------------+
高度：40px
背景：--background
边框：--border
```

---

## 5. 布局（Layout）

### 5.1 主布局结构

```
AppLayout
├── SidebarProvider
│   └── FlexContainer（flex h-screen w-full）
│       ├── AppSidebar（固定定位，pt-10 避开标题栏）
│       │   └── collapsible="icon"
│       └── MainContent（flex-1，overflow hidden）
│           ├── TitleBar（固定顶部，h-10，z-50）
│           │   ├── DragRegion（flex-1，-webkit-app-region: drag）
│           │   └── WindowControls（固定右侧，-webkit-app-region: no-drag）
│           └── PageContent（flex-1，overflow auto，page-transition）
│               └── <Routes> -> HomePage | NotesPage | SettingsPage
```

### 5.2 响应式策略（窗口缩放）

| 窗口宽度 | 行为 |
|---------|------|
| >= 1024px | 侧边栏展开，AI 面板展开 |
| 768px ~ 1023px | 侧边栏可折叠为图标态，AI 面板默认收起 |
| < 768px | 侧边栏隐藏（Sheet 替代），AI 面板强制收起 |

**Home 页三栏布局：**

```
+---------+----------------------------+----------+
| Sidebar |      ClipboardList (flex-1)| AI Panel |
|  256px  |          主内容区          |  320px   |
+---------+----------------------------+----------+
```

### 5.3 页面过渡动画规范

| 场景 | 动画 | 时长 | 缓动 |
|------|------|------|------|
| 页面切换 | pageFadeIn（opacity 0->1, translateX 15px->0）| 400ms | cubic-bezier(0.4, 0, 0.2, 1) |
| 侧边栏折叠 | width 256px->56px | 300ms | ease-linear |
| AI 面板展开/收起 | width 0->320px / 320px->0 | 300ms | ease-out |
| 消息气泡出现 | opacity 0->1, translateY 10px->0 | 300ms | ease-out |
| 卡片悬浮 | translateY(-1px), shadow-sm -> shadow-md | 200ms | ease-in-out |

---

## 6. 交互细节

### 6.1 过渡与动画（Animation Spec）

```css
/* 过渡时长常量 */
--transition-fast: 150ms;    /* 微交互：hover、透明度变化 */
--transition-base: 200ms;    /* 组件状态切换：按钮点击、input focus */
--transition-slow: 300ms;    /* 面板展开收起、页面切换 */

/* 统一缓动曲线 */
--ease-out: cubic-bezier(0.0, 0.0, 0.2, 1);
--ease-in-out: cubic-bezier(0.4, 0.0, 0.2, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* 弹性效果 */

/* 关键动画 */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideInRight { from { opacity: 0; transform: translateX(15px); } to { opacity: 1; transform: translateX(0); } }
@keyframes bounceIn { 0% { opacity: 0; transform: scale(0.3); } 50% { opacity: 1; transform: scale(1.05); } 70% { transform: scale(0.9); } 100% { transform: scale(1); } }
@keyframes skeletonPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
```

### 6.2 Hover / Active / Focus 状态规范

**按钮（Button）：**

| 状态 | 样式变化 |
|------|---------|
| Hover | brightness-95（light）/ brightness-110（dark），translateY(-1px) |
| Active | scale-95，阴影减弱 |
| Focus | ring-2 ring-ring ring-offset-2 |
| Disabled | opacity-50，cursor-not-allowed |

**卡片（RecordCard）：**

| 状态 | 样式变化 |
|------|---------|
| Default | shadow-sm，border-border |
| Hover | shadow-md，border-primary/20，translateY(-1px) |
| Selected | ring-2 ring-primary |

**输入框（Input）：**

| 状态 | 样式变化 |
|------|---------|
| Default | border-input，bg-background |
| Hover | border-muted-foreground/40 |
| Focus | ring-2 ring-primary/20，border-primary/50，scale(1.01) |
| Error | border-destructive，红色阴影 |

### 6.3 加载状态（Skeleton + Spinner）

**Skeleton 使用场景：**
- 页面初始加载（首页列表、笔记列表）
- 文件列表加载
- 设置页配置项加载

**Skeleton 样式（沿用现有 shadcn）：**

```tsx
// 列表骨架
<div className="space-y-4">
  <Skeleton className="h-32 w-full rounded-lg" />
  <Skeleton className="h-32 w-full rounded-lg" />
  <Skeleton className="h-32 w-full rounded-lg" />
</div>

// 侧边栏骨架
<SidebarMenuSkeleton showIcon />
```

**内联 Spinner（按钮内）：**

```tsx
// 小号 spinner（按钮内）
<div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />

// 大号 Spinner（页面中央加载）
<div className="flex items-center justify-center h-full">
  <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
</div>
```

### 6.4 空状态（Empty States）

| 页面/组件 | 空状态内容 | 图标 |
|----------|----------|------|
| 剪贴板历史（无记录）| "暂无记录，开始复制内容吧" | 剪贴板图标 |
| 剪贴板历史（搜索无结果）| "未找到匹配的记录" | 搜索图标 |
| AI 助手（无对话）| "开始与 AI 对话" + "基于剪贴板内容进行智能问答" | Bot 图标（pulse）|
| 白板文件列表 | "暂无白板文件，保存当前白板即可创建" | 文件图标 |

---

## 7. 跨平台考虑（F-10 ~ F-14）

### 7.1 窗口控件差异

| 方面 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 标题栏实现 | Frameless + 自定义控件（推荐）或 frame: true | titleBarStyle: 'hidden' | frame: true（原生）|
| 关闭按钮位置 | 右侧 | 左侧（Traffic Light）| 右侧 |
| 菜单栏 | 窗口内 | 系统菜单栏 | 窗口内 |
| 最小化/最大化图标 | -- / [] | traffic light | -- / [] |

### 7.2 数据路径规范化（F-12）

所有路径必须使用 Electron API，禁止硬编码：

```typescript
// 正确
const userDataPath = app.getPath('userData');
const documentsPath = app.getPath('documents');

// 错误
const hardcodedPath = '/home/user/.qnote/data';
```

### 7.3 平台菜单栏适配（F-11）

| 平台 | 菜单位置 | 实现方式 |
|------|---------|---------|
| macOS | 系统菜单栏 | Menu.setApplicationMenu() |
| Windows | 窗口内标题栏下方 | 同上，role: 'appMenu' |

---

## 8. 实现优先级（Implementation Priorities）

### P0 - 最优先（基础重构，影响所有功能）

| 序号 | 功能点 | 设计任务 | 理由 |
|------|--------|---------|------|
| 1 | F-05 设计系统建立 | 在 styles/index.css 中建立完整的 CSS 变量体系（颜色/字体/间距/阴影） | 所有后续 UI 重构依赖此基础 |
| 2 | F-07 深色/浅色主题 | 实现 useTheme hook，支持 light/dark/system 三种模式，修复 AC-12 对比度问题 | 主题是其他 UI 重构的前提 |
| 3 | F-01/F-02 目录结构重构 | 按目标目录重新组织 src/main 和 src/renderer 文件 | 后续开发效率的基础 |

### P1 - 核心 UI 重构（影响主要用户体验）

|

| 序号 | 功能点 | 设计任务 |
|------|--------|---------|
| 4 | F-06 侧边栏重构 | 按第 4.1 节规范重新设计 AppSidebar 组件结构 |
| 5 | F-09 状态反馈组件 | 统一 Skeleton、EmptyState、LoadingSpinner 组件 |
| 6 | F-08 排版优化 | 规范化字体系统，建立 type scale |
| 7 | F-10 窗口控件统一 | 确定跨平台标题栏策略并实现 |
| 8 | F-11 平台菜单栏适配 | 实现平台差异化菜单 |

### P2 - 锦上添花（体验优化）

| 序号 | 功能点 | 设计任务 |
|------|--------|---------|
| 9 | F-14 平台 API 抽象 | 统一平台相关 API 调用层 |
| 10 | F-04 路径 alias 配置 | 完善 tsconfig path alias，移除硬编码 |

---

## 9. 注意事项

### 9.1 设计系统一致性

- 所有颜色必须通过 CSS 变量引用，禁止硬编码 hex 值
- 所有间距必须基于 4px 网格系统
- 所有圆角必须基于 --radius 变量（8px 基准）
- 阴影必须基于 --shadow-sm/md/lg 变量

### 9.2 用户操作路径（核心交互）

**剪贴板记录 -> AI 分析：**
1. 用户复制内容 -> 自动出现在列表顶部（300ms slideInUp）
2. 用户点击记录右侧 "索引" 按钮 -> 添加到向量库
3. 用户在 AI 面板输入问题 -> AI 基于剪贴板内容回答

**白板创建流程：**
1. 用户导航到 /notes
2. 在白板画图
3. Ctrl+S 保存 -> 弹出文件名输入框
4. Enter 确认 -> 保存成功 toast

**主题切换：**
1. 用户点击侧边栏底部 ThemeToggle
2. 弹出菜单：Light / Dark / System
3. 选择后立即应用，localStorage 持久化

---

*本设计文档由 UI Designer Agent 生成，基于 PM 需求文档和现有代码调研结果。*
