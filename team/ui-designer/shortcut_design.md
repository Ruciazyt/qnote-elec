# QNote Elec 快捷功能 UI/UX 设计文档

**版本：** v1.0
**日期：** 2026-03-27
**状态：** 设计稿
**基于：** shortcut_spec.md 功能需求规格、design.md 设计系统

---

## 0. 前置说明

本文档为 ClipboardPopup（剪贴板小窗）和 AiPopup（AI 对话小窗）提供 UI/UX 设计规范，与 qnote-elec 现有设计系统（design.md）保持完全一致，使用同一套 CSS 变量、TailwindCSS 类名和动画规范。

### 0.1 设计继承关系

| 维度 | 来源 | 说明 |
|------|------|------|
| 颜色系统 | design.md §2 | 复用 `--background`、`--foreground`、`--primary`、`--border` 等 CSS 变量 |
| 圆角规范 | design.md §2 | `--radius: 0.5rem`（8px） |
| 阴影规范 | design.md §2 | `--shadow-sm/md/lg` |
| 过渡规范 | design.md §6 | `--transition-fast: 150ms` 等 |
| 字体规范 | design.md §3 | 系统无衬线栈 + 等宽字体栈 |
| 状态规范 | design.md §4/§6 | Hover/Focus/Active/Loading/Empty 状态定义 |

### 0.2 小窗通用属性（来自 shortcut_spec §3.2）

| 属性 | 值 |
|------|-----|
| frame | false（无边框）|
| transparent | false |
| resizable | false |
| skipTaskbar | true |
| alwaysOnTop | true |
| 弹出位置 | 屏幕右下角，距边缘 80px |
| 窗口消失策略 | 隐藏而非销毁（复用）|

---

## 1. ClipboardPopup（剪贴板小窗）视觉设计

### 1.1 整体尺寸与布局

```
┌──────────────────────────────────────┐
│  📋 最近剪贴板                   [×] │  ← 标题栏（40px，含关闭按钮）
├──────────────────────────────────────┤
│  🔍 搜索剪贴板...                    │  ← 搜索框（40px）
├──────────────────────────────────────┤
│  ┌────────────────────────────────┐  │
│  │  ○ const foo = 'bar';        │  │  ← 选中条目（键盘/鼠标）
│  │    3 秒前              [复制]│  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │  ● previous text here...      │  │  ← 普通条目
│  │    10 秒前             [复制]│  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │  ○ [图片缩略图 80px max-h]   │  │  ← 图片条目
│  │    1 分钟前             [复制]│  │
│  └────────────────────────────────┘  │
│  ...（最多 20 条，超出滚动）          │
└──────────────────────────────────────┘
        ↑ 圆角 12px，外阴影
```

**尺寸规格：**

| 属性 | 值 | 说明 |
|------|-----|------|
| 窗口宽度 | 360 px | 固定，不可调整 |
| 窗口高度 | 480 px | 固定，不可调整 |
| 圆角 | 12px（--radius-2）| `rounded-xl` |
| 外边距 | 距屏幕右下角 80px | spec §3.5 |
| 阴影 | `0 8px 32px rgba(0,0,0,0.15)` | `shadow-2xl` 或自定义 |

### 1.2 标题栏设计

```
┌──────────────────────────────────────┐  ← 高度 40px
│  📋 最近剪贴板                 [×]   │
└──────────────────────────────────────┘
```

**设计规范：**

| 属性 | 值 |
|------|-----|
| 高度 | 40px（h-10）|
| 背景色 | `bg-card`（Light: #ffffff, Dark: #232328）|
| 底部边框 | `border-b border-border`（1px）|
| 标题文字 | `text-sm font-medium text-foreground` |
| 标题图标 | Lucide `ClipboardList` 16px |
| 关闭按钮 | 右侧，24×24px，`hover:text-destructive`，`hover:bg-destructive/10` |

**TailwindCSS 类名：**

```tsx
// 标题栏容器
<div className="h-10 px-3 flex items-center justify-between border-b border-border bg-card">

// 标题
<h2 className="text-sm font-medium text-foreground flex items-center gap-2">
  <ClipboardList className="w-4 h-4 text-muted-foreground" />
  最近剪贴板
</h2>

// 关闭按钮
<button
  onClick={onClose}
  className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors duration-150"
  aria-label="关闭"
>
  <X className="w-4 h-4" />
</button>
```

### 1.3 搜索框设计

```
┌──────────────────────────────────────┐  ← 高度 40px
│  🔍  搜索剪贴板...                   │
└──────────────────────────────────────┘
```

**设计规范：**

| 属性 | 值 |
|------|-----|
| 高度 | 40px（h-10）|
| 内边距 | 水平 12px（px-3），垂直 8px（py-2）|
| 背景色 | `bg-muted/40` |
| 圆角 | 8px（`rounded-lg`）|
| 边框 | 无（与标题栏区分开）|
| placeholder | "搜索剪贴板..."，`text-muted-foreground` |
| 搜索图标 | Lucide `Search` 14px，`text-muted-foreground` |
| 字体 | 14px（`text-sm`）|

**TailwindCSS 类名：**

```tsx
// 搜索框容器
<div className="h-10 px-3 py-2">
  <div className="relative h-full">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
    <input
      type="text"
      placeholder="搜索剪贴板..."
      className="w-full h-full pl-9 pr-3 text-sm bg-muted/40 rounded-lg border-none outline-none text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20 transition-all duration-150"
    />
  </div>
</div>
```

### 1.4 剪贴板条目列表设计

#### 1.4.1 列表容器

| 属性 | 值 |
|------|-----|
| 内边距 | 8px（p-2）|
| 最大高度 | 480 - 40 - 40 = 400px（减去标题栏和搜索框）|
| 溢出处理 | `overflow-y-auto`，自定义滚动条 |
| 滚动条宽度 | 4px（`scrollbar-thin`）|

**TailwindCSS 类名：**

```tsx
<div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent">
```

#### 1.4.2 文本条目（RecordCard）

**默认状态：**

```
┌────────────────────────────────────┐
│  ○ const foo = 'bar';              │
│    3 分钟前              [复制]   │
└────────────────────────────────────┘
```

| 属性 | 值 |
|------|-----|
| 内边距 | 12px（p-3）|
| 背景色 | `bg-card` |
| 圆角 | 8px（`rounded-lg`）|
| 边框 | 1px `border-border` |
| 间距 | 上下相邻条目间距 4px（space-y-1）|
| 内容溢出 | 最多显示 3 行，超出省略（`line-clamp-3`）|
| 代码字体 | 代码内容使用 `font-mono text-[13px]` |
| 时间戳 | `text-xs text-muted-foreground` |
| 复制按钮 | 右侧浮动，`text-xs text-muted-foreground hover:text-primary` |

**选中/高亮状态（键盘导航）：**

| 属性 | 值 |
|------|-----|
| 背景色 | `bg-primary/10` |
| 边框 | `border-primary/30` |
| 左侧指示器 | 4px 宽 `bg-primary` 竖条（替换 ○ 图标）|

**TailwindCSS 类名：**

```tsx
// 文本条目 - 默认
<div className="group p-3 rounded-lg bg-card border border-border hover:border-primary/20 hover:shadow-sm transition-all duration-150 cursor-pointer">
  <div className="flex items-start gap-2">
    <pre className="flex-1 text-[13px] font-mono text-foreground line-clamp-3 whitespace-pre-wrap break-all">{
      content
    }</pre>
    <button className="text-xs text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100 shrink-0">
      复制
    </button>
  </div>
  <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
    <span>{relativeTime}</span>
  </div>
</div>

// 文本条目 - 选中（键盘导航）
<div className="group p-3 rounded-lg bg-primary/10 border border-primary/30 shadow-sm transition-all duration-150 cursor-pointer ring-2 ring-primary/20">
  <div className="flex items-start gap-2">
    <div className="w-1 h-full self-stretch bg-primary rounded-full shrink-0 mt-1" />
    <pre className="flex-1 text-[13px] font-mono text-foreground line-clamp-3 whitespace-pre-wrap break-all">{
      content
    }</pre>
    <button className="text-xs text-primary hover:text-primary/80 transition-colors opacity-100">
      复制
    </button>
  </div>
  <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
    <span>{relativeTime}</span>
  </div>
</div>
```

#### 1.4.3 图片条目

```
┌────────────────────────────────────┐
│  ○ [图片缩略图 80px max-h]        │
│    1 分钟前                [复制]  │
└────────────────────────────────────┘
```

| 属性 | 值 |
|------|-----|
| 图片最大高度 | 80px（`max-h-[80px]`）|
| 图片宽度 | 自适应，`w-auto` |
| 圆角 | 4px（`rounded`）|
| object-fit | `object-contain`，白底 |

**TailwindCSS 类名：**

```tsx
// 图片条目
<div className="group p-3 rounded-lg bg-card border border-border hover:border-primary/20 hover:shadow-sm transition-all duration-150 cursor-pointer">
  <div className="flex items-start gap-2">
    <div className="relative">
      <img
        src={imageUrl}
        alt="剪贴板图片"
        className="max-h-[80px] w-auto rounded object-contain bg-muted/20"
      />
    </div>
    <button className="text-xs text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100 shrink-0 ml-auto">
      复制
    </button>
  </div>
  <div className="mt-2 text-xs text-muted-foreground">
    {relativeTime}
  </div>
</div>
```

#### 1.4.4 列表项交互状态汇总

| 状态 | 背景 | 边框 | 左侧指示器 | 复制按钮 |
|------|------|------|-----------|---------|
| 默认 | `bg-card` | `border-border` | ○ 图标 | `opacity-0`（hover 显示）|
| Hover | `bg-card` | `border-primary/20` | ○ 图标 | `opacity-100` |
| 键盘选中 | `bg-primary/10` | `border-primary/30` | 4px 竖条 | `opacity-100` |
| 键盘选中+Hover | `bg-primary/10` | `border-primary/30` | 4px 竖条 | `opacity-100` |

### 1.5 空状态设计

```
┌────────────────────────────────────┐
│                                     │
│         📋                          │
│     暂无剪贴板记录                   │
│   开始复制内容即可自动记录            │
│                                     │
└────────────────────────────────────┘
```

**TailwindCSS 类名：**

```tsx
<div className="flex flex-col items-center justify-center h-full text-center p-6">
  <ClipboardList className="w-12 h-12 text-muted-foreground/40 mb-4" />
  <p className="text-sm font-medium text-foreground mb-1">暂无剪贴板记录</p>
  <p className="text-xs text-muted-foreground">开始复制内容即可自动记录</p>
</div>
```

### 1.6 加载状态设计

```
┌────────────────────────────────────┐
│  ┌────────────────────────────────┐│
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░││  ← Skeleton 行 1
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░││
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░││
│  └────────────────────────────────┘│
│  ┌────────────────────────────────┐│
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░││  ← Skeleton 行 2
│  └────────────────────────────────┘│
└────────────────────────────────────┘
```

**TailwindCSS 类名：**

```tsx
// 加载骨架
<div className="p-2 space-y-1">
  {[1, 2, 3].map((i) => (
    <div key={i} className="p-3 rounded-lg bg-card border border-border animate-pulse">
      <div className="space-y-2">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-4 bg-muted rounded w-1/2" />
      </div>
      <div className="mt-3 flex justify-between">
        <div className="h-3 bg-muted rounded w-16" />
      </div>
    </div>
  ))}
</div>
```

### 1.7 搜索无结果状态

```
┌────────────────────────────────────┐
│                                     │
│         🔍                          │
│     未找到匹配的记录                 │
│   尝试其他关键词                     │
│                                     │
└────────────────────────────────────┘
```

**TailwindCSS 类名：**

```tsx
<div className="flex flex-col items-center justify-center h-full text-center p-6">
  <Search className="w-12 h-12 text-muted-foreground/40 mb-4" />
  <p className="text-sm font-medium text-foreground mb-1">未找到匹配的记录</p>
  <p className="text-xs text-muted-foreground">尝试其他关键词</p>
</div>
```

---

## 2. AiPopup（AI 对话小窗）视觉设计

### 2.1 整体尺寸与布局

```
┌──────────────────────────────────────┐
│  🤖 AI 助手                     [×]  │  ← 标题栏（40px，含关闭按钮）
├──────────────────────────────────────┤
│                                      │
│  [🤖 你好，可以问我任何问题]           │  ← AI 消息气泡（左对齐）
│                                      │
│            [我：这是我的问题内容...]  │  ← 用户消息气泡（右对齐）
│                                      │
│                                      │
├──────────────────────────────────────┤
│  [输入框...]                   [发送]│  ← 输入区（56px，含输入框+按钮）
└──────────────────────────────────────┘
```

**尺寸规格：**

| 属性 | 值 | 说明 |
|------|-----|------|
| 窗口宽度 | 360 px | 固定 |
| 窗口高度 | 400 px | 固定 |
| 圆角 | 12px（`rounded-xl`）| |
| 外边距 | 距屏幕右下角 80px | |
| 标题栏高度 | 40px | 同 ClipboardPopup |
| 消息区内边距 | 12px（p-3）| |
| 输入区高度 | 56px（h-14）| |
| 消息气泡最大宽度 | 85%（`max-w-[85%]`）| |

### 2.2 标题栏设计

```
┌──────────────────────────────────────┐  ← 高度 40px
│  🤖 AI 助手                    [×]   │
└──────────────────────────────────────┘
```

| 属性 | 值 |
|------|-----|
| 高度 | 40px（h-10）|
| 背景色 | `bg-card` |
| 底部边框 | `border-b border-border` |
| 标题文字 | `text-sm font-medium text-foreground` |
| 机器人图标 |  Emoji 🤖 或 Lucide `Bot` 16px |
| 关闭按钮 | 同 ClipboardPopup |

**TailwindCSS 类名：**

```tsx
<div className="h-10 px-3 flex items-center justify-between border-b border-border bg-card">
  <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
    <Bot className="w-4 h-4 text-muted-foreground" />
    AI 助手
  </h2>
  <button
    onClick={onClose}
    className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors duration-150"
    aria-label="关闭"
  >
    <X className="w-4 h-4" />
  </button>
</div>
```

### 2.3 消息列表设计

```
┌──────────────────────────────────────┐
│                                      │
│  ┌──────────────────────────────┐  │
│  │ 🤖 你好，可以问我任何关于       │  │  ← AI 消息气泡（左对齐）
│  │ 剪贴板内容的问题。              │  │
│  └──────────────────────────────┘  │
│                                      │
│            ┌────────────────────────┐│
│            │ 我：这是我的问题内容... ││  ← 用户消息气泡（右对齐）
│            └────────────────────────┘│
│                                      │
└──────────────────────────────────────┘
        ↑ flex-col-reverse 或普通 flex
```

#### 2.3.1 AI 消息气泡

| 属性 | 值 |
|------|-----|
| 气泡背景 | `bg-card` |
| 气泡边框 | `border border-border` |
| 气泡圆角 | 12px（`rounded-2xl`），左上角 4px（`rounded-tl-sm`）|
| 气泡最大宽度 | 85%（`max-w-[85%]`）|
| 内边距 | 10px 水平（px-3），8px 垂直（py-2）|
| 头像 | 左侧，24×24px，`bg-primary/20 rounded-full` |
| 文字颜色 | `text-foreground` |
| 字体大小 | 14px（`text-sm`）|
| 行高 | 1.5（`leading-relaxed`）|

**TailwindCSS 类名：**

```tsx
// AI 消息气泡
<div className="flex items-start gap-2 justify-start">
  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
    <Bot className="w-3.5 h-3.5 text-primary" />
  </div>
  <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tl-sm bg-card border border-border">
    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
      {message.content}
    </p>
  </div>
</div>
```

#### 2.3.2 用户消息气泡

| 属性 | 值 |
|------|-----|
| 气泡背景 | `bg-primary` |
| 气泡前景色 | `text-primary-foreground` |
| 气泡圆角 | 12px（`rounded-2xl`），右上角 4px（`rounded-tr-sm`）|
| 气泡最大宽度 | 85% |
| 内边距 | 同 AI 气泡 |
| 头像 | 右侧，24×24px，`bg-primary-foreground/20 rounded-full` |
| 用户图标 | Lucide `User` 14px |

**TailwindCSS 类名：**

```tsx
// 用户消息气泡
<div className="flex items-start gap-2 justify-end">
  <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tr-sm bg-primary text-primary-foreground">
    <p className="text-sm leading-relaxed whitespace-pre-wrap">
      {message.content}
    </p>
  </div>
  <div className="w-6 h-6 rounded-full bg-primary-foreground/20 flex items-center justify-center shrink-0 mt-0.5">
    <User className="w-3.5 h-3.5 text-primary-foreground" />
  </div>
</div>
```

#### 2.3.3 AI 思考中状态（正在输入）

```
┌──────────────────────────────────────┐
│                                      │
│  ┌──────────────────────────────┐  │
│  │ 🤖 ● ● ●                     │  │  ← 三个点动画
│  └──────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

| 属性 | 值 |
|------|-----|
| 动画 | 三个点依次出现（dot-wave 动画）|
| 点颜色 | `text-muted-foreground` |
| 点大小 | 8px（`w-2 h-2`）|
| 点间距 | 4px（`gap-1`）|

**CSS 动画定义：**

```css
@keyframes dot-wave {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}
.animate-dot-wave > span:nth-child(1) { animation: dot-wave 1.2s ease-in-out infinite 0s; }
.animate-dot-wave > span:nth-child(2) { animation: dot-wave 1.2s ease-in-out infinite 0.2s; }
.animate-dot-wave > span:nth-child(3) { animation: dot-wave 1.2s ease-in-out infinite 0.4s; }
```

**TailwindCSS 类名：**

```tsx
<div className="flex items-start gap-2 justify-start">
  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
    <Bot className="w-3.5 h-3.5 text-primary" />
  </div>
  <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tl-sm bg-card border border-border">
    <div className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full bg-muted-foreground animate-dot-wave [animation-delay:0ms]" />
      <span className="w-2 h-2 rounded-full bg-muted-foreground animate-dot-wave [animation-delay:200ms]" />
      <span className="w-2 h-2 rounded-full bg-muted-foreground animate-dot-wave [animation-delay:400ms]" />
    </div>
  </div>
</div>
```

### 2.4 输入区设计

```
┌──────────────────────────────────────┐  ← 高度 56px
│  [输入框...]                   [发送]│
└──────────────────────────────────────┘
```

| 属性 | 值 |
|------|-----|
| 整体高度 | 56px（h-14）|
| 内边距 | 12px（p-3）|
| 输入框背景 | `bg-muted/40` |
| 输入框圆角 | 8px（`rounded-lg`）|
| 输入框高度 | 36px（`h-9`）|
| 输入框字体 | 14px（`text-sm`）|
| 发送按钮尺寸 | 36×36px（`w-9 h-9`）|
| 发送按钮圆角 | 8px（`rounded-lg`）|
| 发送按钮颜色 | `bg-primary hover:bg-primary/90 disabled:bg-muted` |

**TailwindCSS 类名：**

```tsx
// 输入区容器
<div className="h-14 p-3 flex items-center gap-2 border-t border-border bg-card/50">
  {/* 输入框 */}
  <div className="flex-1 relative">
    <textarea
      placeholder="输入问题... (Enter 发送, Shift+Enter 换行)"
      className="w-full h-9 px-3 py-2 text-sm bg-muted/40 rounded-lg border-none outline-none text-foreground placeholder:text-muted-foreground resize-none focus:ring-2 focus:ring-primary/20 transition-all duration-150"
      rows={1}
      disabled={isLoading}
      onKeyDown={handleKeyDown}
    />
  </div>

  {/* 发送按钮 */}
  <button
    onClick={onSend}
    disabled={isLoading || !inputValue.trim()}
    className="w-9 h-9 rounded-lg bg-primary hover:bg-primary/90 disabled:bg-muted disabled:cursor-not-allowed flex items-center justify-center transition-colors duration-150"
    aria-label="发送"
  >
    {isLoading ? (
      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
    ) : (
      <Send className="w-4 h-4 text-primary-foreground" />
    )}
  </button>
</div>
```

### 2.5 空状态设计

```
┌──────────────────────────────────────┐
│                                      │
│         🤖                           │
│     开始与 AI 对话                    │
│   基于剪贴板内容进行智能问答            │
│                                      │
└──────────────────────────────────────┘
```

**TailwindCSS 类名：**

```tsx
<div className="flex flex-col items-center justify-center h-full text-center p-6">
  <Bot className="w-16 h-16 text-muted-foreground/30 mb-4" />
  <p className="text-base font-medium text-foreground mb-2">开始与 AI 对话</p>
  <p className="text-sm text-muted-foreground">基于剪贴板内容进行智能问答</p>
</div>
```

### 2.6 错误状态设计

```
┌──────────────────────────────────────┐
│                                      │
│  ┌──────────────────────────────┐   │
│  │ ⚠️  发送失败，请重试          │   │  ← 错误气泡
│  └──────────────────────────────┘   │
│                                      │
│  [输入框...]                   [发送]│
└──────────────────────────────────────┘
```

| 属性 | 值 |
|------|-----|
| 错误气泡背景 | `bg-destructive/10` |
| 错误气泡边框 | `border-destructive/30` |
| 错误气泡文字 | `text-destructive text-sm` |
| 图标 | Lucide `AlertCircle` 14px |

**TailwindCSS 类名：**

```tsx
// 错误消息气泡
<div className="flex items-start gap-2 justify-start">
  <div className="w-6 h-6 rounded-full bg-destructive/10 flex items-center justify-center shrink-0 mt-0.5">
    <AlertCircle className="w-3.5 h-3.5 text-destructive" />
  </div>
  <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tl-sm bg-destructive/10 border border-destructive/30">
    <p className="text-sm text-destructive leading-relaxed">
      发送失败，请重试
    </p>
  </div>
</div>
```

---

## 3. 设计语言（Design Tokens）

### 3.1 继承自 design.md 的 CSS 变量

两个小窗完全复用 design.md §2 定义的所有 CSS 变量，以下是关键变量对照：

| CSS 变量 | Light 值 | Dark 值 | 用途 |
|----------|---------|---------|------|
| `--background` | `#fafafa` | `#1a1a1f` | 窗口背景 |
| `--foreground` | `#383a42` | `#cdd4db` | 主文字 |
| `--card` | `#ffffff` | `#232328` | 卡片/气泡背景 |
| `--card-foreground` | `#383a42` | `#cdd4db` | 卡片文字 |
| `--primary` | `#4f7dd8` | `#5b8dee` | 选中态/按钮 |
| `--primary-foreground` | `#ffffff` | `#1a1a1f` | 主色上文字 |
| `--muted` | `#eff2f5` | `#272b32` | 次要背景 |
| `--muted-foreground` | `#838a9a` | `#848fa0` | 次要文字 |
| `--border` | `#e4e8ef` | `#2c3038` | 边框 |
| `--destructive` | `#dc2626` | `#e53e3e` | 错误/危险 |
| `--radius` | `0.5rem`（8px）| 同 | 圆角基准 |

### 3.2 小窗专用变量

在 `styles/index.css` 中补充以下变量：

```css
/* ==================== 快捷小窗专用 ==================== */

/* 窗口 */
--popup-width: 360px;
--popup-clipboard-height: 480px;
--popup-ai-height: 400px;
--popup-radius: 0.75rem;       /* 12px */
--popup-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
--popup-margin: 80px;          /* 距屏幕边缘 */

/* 标题栏 */
--popup-header-height: 2.5rem; /* 40px */

/* 输入区 */
--popup-input-height: 3.5rem;   /* 56px */

/* 列表项 */
--popup-item-padding: 0.75rem; /* 12px */
--popup-item-gap: 0.25rem;      /* 4px */

/* 图片条目 */
--popup-image-max-height: 80px;

/* 消息气泡 */
--popup-bubble-max-width: 85%;
--popup-bubble-padding-x: 0.75rem; /* 12px */
--popup-bubble-padding-y: 0.5rem;  /* 8px */
--popup-bubble-radius: 0.75rem;    /* 12px */
--popup-bubble-radius-sm: 0.25rem; /* 4px（小角）*/
```

---

## 4. 组件状态设计

### 4.1 键盘导航状态（ClipboardPopup）

| 状态 | 视觉表现 | TailwindCSS 类名 |
|------|---------|----------------|
| 默认条目 | `bg-card border-border` | `bg-card border-border` |
| 键盘焦点条目 | `bg-primary/10 border-primary/30` + 左侧竖条 | `bg-primary/10 border-primary/30 ring-2 ring-primary/20` |
| 焦点+Hover | 同焦点态 | 同上 |
| 输入框焦点 | `ring-2 ring-primary/20` | `focus:ring-2 focus:ring-primary/20` |

**键盘导航实现要点：**

- 使用 `Tab` / `Shift+Tab` 或 `↓` / `↑` 切换焦点
- 当前焦点条目添加 `data-focused="true"` 属性
- 焦点条目左侧有 4px 宽的主色竖条指示器

```tsx
// 键盘焦点条目
<div
  data-focused={isFocused}
  className={cn(
    "p-3 rounded-lg border transition-all duration-150 cursor-pointer",
    "hover:border-primary/20 hover:shadow-sm",
    isFocused
      ? "bg-primary/10 border-primary/30 ring-2 ring-primary/20"
      : "bg-card border-border"
  )}
>
  {isFocused && (
    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-l-lg" />
  )}
  {/* 内容 */}
</div>
```

### 4.2 键盘导航状态（AiPopup）

| 状态 | 视觉表现 |
|------|---------|
| 输入框默认 | `bg-muted/40` |
| 输入框焦点 | `ring-2 ring-primary/20 bg-muted/50` |
| 发送按钮默认 | `bg-primary` |
| 发送按钮禁用（空输入）| `bg-muted cursor-not-allowed` |
| 发送按钮加载中 | spinner 替代发送图标 |

### 4.3 加载状态（ClipboardPopup）

| 状态 | 视觉表现 |
|------|---------|
| 初始加载 | 3 个 Skeleton 卡片 |
| 搜索加载中 | 输入框内左侧 spinner（可选）|
| 复制到剪贴板 | 按钮内 spinner + "复制中..." |

**TailwindCSS 类名：**

```tsx
// Skeleton 卡片（沿用 design.md §6.3）
<div className="p-3 rounded-lg bg-card border border-border animate-pulse">
  <div className="space-y-2">
    <div className="h-4 bg-muted rounded w-3/4" />
    <div className="h-4 bg-muted rounded w-1/2" />
  </div>
  <div className="mt-3 flex justify-between">
    <div className="h-3 bg-muted rounded w-16" />
  </div>
</div>
```

### 4.4 加载状态（AiPopup）

| 状态 | 视觉表现 |
|------|---------|
| 消息发送中 | 输入框 disabled，发送按钮 spinner |
| AI 思考中 | 消息区域显示 dot-wave 动画 |
| 页面初始加载 | 空状态或消息历史 Skeleton |

### 4.5 空状态（ClipboardPopup）

| 场景 | 视觉表现 |
|------|---------|
| 无剪贴板记录 | 剪贴板图标 + "暂无剪贴板记录" + "开始复制内容即可自动记录" |
| 搜索无结果 | 搜索图标 + "未找到匹配的记录" + "尝试其他关键词" |

### 4.6 空状态（AiPopup）

| 场景 | 视觉表现 |
|------|---------|
| 无对话历史 | Bot 大图标（64px）+ "开始与 AI 对话" + "基于剪贴板内容进行智能问答" |

### 4.7 错误状态（AiPopup）

| 场景 | 视觉表现 |
|------|---------|
| 发送失败 | `bg-destructive/10 border-destructive/30` 气泡 + AlertCircle 图标 |
| 网络错误 | 同上，文字 "网络连接失败，请检查网络" |

---

## 5. 动画与过渡设计

### 5.1 窗口弹出/消失动画

**弹出（Window Appear）：**

| 阶段 | 描述 | 时长 | 缓动 |
|------|------|------|------|
| 初始 | 透明度 0，scale(0.95)，translateY(10px) | - | - |
| 结束 | 透明度 1，scale(1)，translateY(0) | 200ms | `cubic-bezier(0.34, 1.56, 0.64, 1)`（spring）|

**消失（Window Disappear）：**

| 阶段 | 描述 | 时长 | 缓动 |
|------|------|------|------|
| 初始 | 透明度 1，scale(1)，translateY(0) | - | - |
| 结束 | 透明度 0，scale(0.95)，translateY(10px) | 150ms | `ease-in` |

**CSS 动画定义：**

```css
/* 窗口出现 */
@keyframes popup-appear {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* 窗口消失 */
@keyframes popup-disappear {
  from {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
  to {
    opacity: 0;
    transform: scale(0.95) translateY(10px);
  }
}

.popup-enter {
  animation: popup-appear 200ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.popup-exit {
  animation: popup-disappear 150ms ease-in forwards;
}
```

**React 实现（TailwindCSS + CSS）：**

```tsx
// TailwindCSS 中无法直接实现 scale+translateY 组合，用 CSS 类配合
<div className={cn(
  "transition-all duration-200",
  isVisible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-2.5 pointer-events-none"
)}>
```

**推荐方案：使用 CSS 类名 + style 标签**

```tsx
// ClipboardPopup.tsx
import "./ClipboardPopup.css";

<div className={isVisible ? "popup-enter" : "popup-exit"}>
  {/* 内容 */}
</div>
```

### 5.2 列表项动画

**新条目出现（slideInUp）：**

```css
@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.clipboard-item-enter {
  animation: slideInUp 200ms ease-out forwards;
}
```

**条目悬停（Hover）：**

| 属性 | 过渡 | 时长 |
|------|------|------|
| 边框颜色 | `border-color` | 150ms |
| 阴影 | `box-shadow` | 150ms |
| 复制按钮透明度 | `opacity` | 150ms |

### 5.3 消息气泡动画

**气泡出现（slideInUp + fadeIn）：**

| 属性 | 过渡 | 时长 |
|------|------|------|
| 透明度 | 0 → 1 | 300ms |
| translateY | 10px → 0 | 300ms |
| 缓动 | `ease-out` | - |

**TailwindCSS 扩展（tailwind.config.js）：**

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      animation: {
        'slide-in-up': 'slideInUp 300ms ease-out forwards',
        'dot-wave': 'dotWave 1.2s ease-in-out infinite',
        'popup-appear': 'popupAppear 200ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'popup-disappear': 'popupDisappear 150ms ease-in forwards',
      },
      keyframes: {
        slideInUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        dotWave: {
          '0%, 60%, 100%': { transform: 'translateY(0)' },
          '30%': { transform: 'translateY(-4px)' },
        },
        popupAppear: {
          from: { opacity: '0', transform: 'scale(0.95) translateY(10px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        popupDisappear: {
          from: { opacity: '1', transform: 'scale(1) translateY(0)' },
          to: { opacity: '0', transform: 'scale(0.95) translateY(10px)' },
        },
      },
    },
  },
}
```

### 5.4 焦点切换动画

条目获得键盘焦点时，使用 `transition-all duration-150` 实现平滑过渡：

```tsx
<div className={cn(
  "p-3 rounded-lg border bg-card border-border transition-all duration-150",
  isFocused && "bg-primary/10 border-primary/30 ring-2 ring-primary/20 shadow-sm"
)}>
```

---

## 6. 技术实现提示

### 6.1 TailwindCSS 类名速查表

**窗口容器：**

```tsx
// ClipboardPopup 外层
<div className="fixed bottom-20 right-20 w-[360px] h-[480px] rounded-xl bg-card border border-border shadow-2xl overflow-hidden z-[9999]" />

// AiPopup 外层
<div className="fixed bottom-20 right-20 w-[360px] h-[400px] rounded-xl bg-card border border-border shadow-2xl overflow-hidden z-[9999]" />
```

**标题栏：**

```tsx
<div className="h-10 px-3 flex items-center justify-between border-b border-border bg-card">
  <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
    <ClipboardList className="w-4 h-4 text-muted-foreground" />
    最近剪贴板
  </h2>
  <button className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors duration-150">
    <X className="w-4 h-4" />
  </button>
</div>
```

**搜索框：**

```tsx
<div className="h-10 px-3 py-2">
  <div className="relative h-full">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
    <input
      type="text"
      placeholder="搜索剪贴板..."
      className="w-full h-full pl-9 pr-3 text-sm bg-muted/40 rounded-lg border-none outline-none text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20 transition-all duration-150"
    />
  </div>
</div>
```

**剪贴板条目：**

```tsx
// 默认状态
<div className="group p-3 rounded-lg bg-card border border-border hover:border-primary/20 hover:shadow-sm transition-all duration-150 cursor-pointer">
  <div className="flex items-start gap-2">
    <pre className="flex-1 text-[13px] font-mono text-foreground line-clamp-3 whitespace-pre-wrap break-all">
      {content}
    </pre>
    <button className="text-xs text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100 shrink-0">
      复制
    </button>
  </div>
  <div className="mt-2 text-xs text-muted-foreground flex items-center justify-between">
    <span>{relativeTime}</span>
  </div>
</div>

// 键盘选中状态
<div className={cn(
  "group p-3 rounded-lg border transition-all duration-150 cursor-pointer",
  "flex items-start gap-2",
  isFocused
    ? "bg-primary/10 border-primary/30 ring-2 ring-primary/20"
    : "bg-card border-border hover:border-primary/20 hover:shadow-sm"
)}>
  {isFocused && <div className="w-1 h-full self-stretch bg-primary rounded-full shrink-0 mt-1" />}
  <pre className="flex-1 text-[13px] font-mono text-foreground line-clamp-3 whitespace-pre-wrap break-all">
    {content}
  </pre>
  <button className={cn(
    "text-xs transition-colors shrink-0",
    isFocused ? "text-primary opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100"
  )}>
    复制
  </button>
</div>
```

**AI 消息气泡：**

```tsx
// AI 消息
<div className="flex items-start gap-2 justify-start">
  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
    <Bot className="w-3.5 h-3.5 text-primary" />
  </div>
  <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tl-sm bg-card border border-border">
    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
      {content}
    </p>
  </div>
</div>

// 用户消息
<div className="flex items-start gap-2 justify-end">
  <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tr-sm bg-primary text-primary-foreground">
    <p className="text-sm leading-relaxed whitespace-pre-wrap">
      {content}
    </p>
  </div>
  <div className="w-6 h-6 rounded-full bg-primary-foreground/20 flex items-center justify-center shrink-0 mt-0.5">
    <User className="w-3.5 h-3.5 text-primary-foreground" />
  </div>
</div>
```

**输入区：**

```tsx
<div className="h-14 p-3 flex items-center gap-2 border-t border-border bg-card/50">
  <textarea
    placeholder="输入问题... (Enter 发送, Shift+Enter 换行)"
    className="flex-1 h-9 px-3 py-2 text-sm bg-muted/40 rounded-lg border-none outline-none text-foreground placeholder:text-muted-foreground resize-none focus:ring-2 focus:ring-primary/20 transition-all duration-150 disabled:opacity-50"
    rows={1}
    disabled={isLoading}
  />
  <button
    disabled={isLoading || !inputValue.trim()}
    className="w-9 h-9 rounded-lg bg-primary hover:bg-primary/90 disabled:bg-muted disabled:cursor-not-allowed flex items-center justify-center transition-colors duration-150"
  >
    {isLoading ? (
      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
    ) : (
      <Send className="w-4 h-4 text-primary-foreground" />
    )}
  </button>
</div>
```

### 6.2 cn() 工具函数

沿用 design.md 的 `cn()` 工具函数（基于 clsx + tailwind-merge）：

```tsx
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 6.3 主题跟随

两个小窗通过 Electron 的 `BrowserWindow` 共享主窗口的 theme source：

```typescript
// clipboardPopup.ts / aiPopup.ts
const win = new BrowserWindow({
  // ...
  webPreferences: {
    partition: 'persist:main',
    // 主题跟随主窗口
  },
});

// 监听系统主题变化
win.webContents.on('preferred-color-scheme-changed', () => {
  // 触发渲染进程重新渲染
});
```

渲染进程侧使用已有的 `useTheme` hook（design.md §1 定义）：

```tsx
import { useTheme } from '@/hooks/use-theme';

function ClipboardPopup() {
  const { theme } = useTheme();
  // 组件自动响应 theme 变化
}
```

### 6.4 窗口位置计算

```typescript
import { screen } from 'electron';

function getPopupPosition(popupWidth: number, popupHeight: number) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const margin = 80;

  let x = width - popupWidth - margin;
  let y = height - popupHeight - margin;

  // 屏幕边界检测
  if (x < 0) x = margin;
  if (y < 0) y = margin;

  return { x, y };
}

// 使用
const position = getPopupPosition(360, 480);
const win = new BrowserWindow({
  width: 360,
  height: 480,
  x: position.x,
  y: position.y,
  // ...
});
```

### 6.5 组件文件结构

```
src/renderer/components/
├── clipboard/
│   ├── ClipboardPopup.tsx      # 剪贴板小窗主组件
│   ├── ClipboardPopup.css      # 动画 CSS
│   ├── ClipboardPopupItem.tsx  # 单个条目组件
│   └── ClipboardPopupSearch.tsx # 搜索框组件
├── ai/
│   ├── AiPopup.tsx             # AI 对话小窗主组件
│   ├── AiPopup.css             # 动画 CSS
│   ├── AiMessageBubble.tsx     # 消息气泡组件
│   └── AiInputArea.tsx         # 输入区组件
```

### 6.6 快捷键处理

使用 `@electron/remote` 或 IPC 在渲染进程处理快捷键：

```tsx
// AiPopup.tsx
function handleKeyDown(e: React.KeyboardEvent) {
  if (e.key === 'Escape') {
    onClose();
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
}

// ClipboardPopup.tsx
function handleKeyDown(e: React.KeyboardEvent) {
  if (e.key === 'Escape') {
    onClose();
  }
  if (e.key === 'Enter') {
    onCopySelected();
  }
  if (e.key === 'ArrowDown' || e.key === 'Tab') {
    e.preventDefault();
    selectNext();
  }
  if (e.key === 'ArrowUp' || e.key === 'Shift+Tab') {
    e.preventDefault();
    selectPrev();
  }
}
```

### 6.7 TailwindCSS 配置扩展

在 `tailwind.config.js` 中添加动画：

```js
module.exports = {
  theme: {
    extend: {
      animation: {
        'slide-in-up': 'slideInUp 300ms ease-out forwards',
        'dot-wave': 'dotWave 1.2s ease-in-out infinite',
        'popup-appear': 'popupAppear 200ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'popup-disappear': 'popupDisappear 150ms ease-in forwards',
      },
      keyframes: {
        slideInUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        dotWave: {
          '0%, 60%, 100%': { transform: 'translateY(0)' },
          '30%': { transform: 'translateY(-4px)' },
        },
        popupAppear: {
          from: { opacity: '0', transform: 'scale(0.95) translateY(10px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        popupDisappear: {
          from: { opacity: '1', transform: 'scale(1) translateY(0)' },
          to: { opacity: '0', transform: 'scale(0.95) translateY(10px)' },
        },
      },
    },
  },
}
```

---

## 附录 A：完整 ASCII 界面草图

### A.1 ClipboardPopup 完整草图

```
┌────────────────────────────────────┐
│  📋 最近剪贴板                [×] │  ← 标题栏 40px
├────────────────────────────────────┤
│  🔍 搜索剪贴板...                  │  ← 搜索框 40px
├────────────────────────────────────┤
│  ┌────────────────────────────────┐│
│  │ ● const foo = 'bar';          ││ ← 键盘选中
│  │   3 秒前                 [复制]││   bg-primary/10
│  └────────────────────────────────┘│   border-primary/30
│  ┌────────────────────────────────┐│   左侧主色竖条
│  │ ○ previous text here...       ││ ← 普通（hover 显示复制）
│  │   10 秒前                [复制]││
│  └────────────────────────────────┘│
│  ┌────────────────────────────────┐│
│  │ ○ [图片缩略图 80px]            ││ ← 图片条目
│  │   1 分钟前               [复制]││
│  └────────────────────────────────┘│
│  ┌────────────────────────────────┐│
│  │ ○ const bar = function() {...││
│  │   5 分钟前                [复制]││
│  └────────────────────────────────┘│
│  ...（最多 20 条，超出滚动）         │
└────────────────────────────────────┘
  ↑ w-360 h-480 rounded-xl shadow-2xl
    bottom-20 right-20
```

### A.2 AiPopup 完整草图

```
┌────────────────────────────────────┐
│  🤖 AI 助手                   [×]  │  ← 标题栏 40px
├────────────────────────────────────┤
│                                    │
│  ┌────────────────────────────┐   │
│  │ 🤖 你好，可以问我任何关于   │   │ ← AI 气泡
│  │ 剪贴板内容的问题。          │   │   bg-card border-border
│  └────────────────────────────┘   │   rounded-tl-sm
│                                    │
│  ┌────────────────────────────┐   │
│  │ 我：这是我的问题内容...     │   │ ← 用户气泡
│  └────────────────────────────┘   │   bg-primary
│                                    │   rounded-tr-sm
│                                    │
│  ┌────────────────────────────┐   │
│  │ 🤖 ● ● ●                  │   │ ← 思考中
│  └────────────────────────────┘   │   dot-wave 动画
│                                    │
├────────────────────────────────────┤
│  [输入框...]                 [发送]│ ← 输入区 56px
└────────────────────────────────────┘
  ↑ w-360 h-400 rounded-xl shadow-2xl
    bottom-20 right-20
```

---

## 附录 B：颜色对照表

### B.1 ClipboardPopup 颜色

| 元素 | Light | Dark | TailwindCSS 变量 |
|------|-------|------|-----------------|
| 窗口背景 | `#ffffff` | `#1a1a1f` | `bg-background` |
| 标题栏背景 | `#ffffff` | `#232328` | `bg-card` |
| 标题文字 | `#383a42` | `#cdd4db` | `text-foreground` |
| 标题图标 | `#838a9a` | `#848fa0` | `text-muted-foreground` |
| 关闭按钮 | `#838a9a` | `#848fa0` | `text-muted-foreground` |
| 关闭按钮 hover | `#dc2626` | `#e53e3e` | `hover:text-destructive` |
| 搜索框背景 | `#eff2f5` | `#272b32` | `bg-muted/40` |
| 搜索框文字 | `#383a42` | `#cdd4db` | `text-foreground` |
| 搜索框 placeholder | `#838a9a` | `#848fa0` | `placeholder:text-muted-foreground` |
| 条目背景 | `#ffffff` | `#232328` | `bg-card` |
| 条目边框 | `#e4e8ef` | `#2c3038` | `border-border` |
| 条目文字 | `#383a42` | `#cdd4db` | `text-foreground` |
| 条目时间戳 | `#838a9a` | `#848fa0` | `text-muted-foreground` |
| 选中条目背景 | `#4f7dd8` @ 10% | `#5b8dee` @ 10% | `bg-primary/10` |
| 选中条目边框 | `#4f7dd8` @ 30% | `#5b8dee` @ 30% | `border-primary/30` |
| 选中指示器 | `#4f7dd8` | `#5b8dee` | `bg-primary` |
| 图片背景 | `#eff2f5` @ 20% | `#272b32` @ 20% | `bg-muted/20` |

### B.2 AiPopup 颜色

| 元素 | Light | Dark | TailwindCSS 变量 |
|------|-------|------|-----------------|
| 窗口背景 | `#fafafa` | `#1a1a1f` | `bg-background` |
| 输入区背景 | `#fafafa` @ 50% | `#1a1a1f` @ 50% | `bg-card/50` |
| 输入框背景 | `#eff2f5` | `#272b32` | `bg-muted/40` |
| AI 气泡背景 | `#ffffff` | `#232328` | `bg-card` |
| AI 气泡边框 | `#e4e8ef` | `#2c3038` | `border-border` |
| AI 头像背景 | `#4f7dd8` @ 20% | `#5b8dee` @ 20% | `bg-primary/20` |
| AI 头像图标 | `#4f7dd8` | `#5b8dee` | `text-primary` |
| 用户气泡背景 | `#4f7dd8` | `#5b8dee` | `bg-primary` |
| 用户气泡文字 | `#ffffff` | `#1a1a1f` | `text-primary-foreground` |
| 用户头像背景 | `#ffffff` @ 20% | `#1a1a1f` @ 20% | `bg-primary-foreground/20` |
| 发送按钮 | `#4f7dd8` | `#5b8dee` | `bg-primary` |
| 发送按钮 hover | `#4f7dd8` @ 90% | `#5b8dee` @ 90% | `hover:bg-primary/90` |
| 错误气泡背景 | `#dc2626` @ 10% | `#e53e3e` @ 10% | `bg-destructive/10` |
| 错误气泡边框 | `#dc2626` @ 30% | `#e53e3e` @ 30% | `border-destructive/30` |
| 错误文字 | `#dc2626` | `#e53e3e` | `text-destructive` |
| 思考中点 | `#838a9a` | `#848fa0` | `text-muted-foreground` |

---

*本设计文档由 UI Designer Agent 生成，基于 shortcut_spec.md 功能需求和 design.md 设计系统。*
