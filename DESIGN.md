---
name: QNote
description: 轻量笔记 + Todo + AI 助手，专注、不喧宾夺主的桌面工具
colors:
  # === 品牌主色（Productivity Teal）===
  primary: "hsl(195 80% 38%)"
  primary-foreground: "hsl(0 0% 100%)"
  ring: "hsl(195 80% 38%)"
  sidebar-primary: "hsl(195 80% 38%)"
  # === 中性灰背景/前景 ===
  background: "hsl(0 0% 98%)"
  foreground: "hsl(220 10% 22%)"
  card: "hsl(0 0% 100%)"
  card-foreground: "hsl(220 10% 22%)"
  popover: "hsl(0 0% 100%)"
  popover-foreground: "hsl(220 10% 22%)"
  muted: "hsl(210 25% 94%)"
  muted-foreground: "hsl(215 12% 52%)"
  border: "hsl(214 22% 91%)"
  input: "hsl(214 22% 91%)"
  # === 微弱品牌色（次级背景）===
  secondary: "hsl(195 30% 94%)"
  secondary-foreground: "hsl(200 10% 22%)"
  accent: "hsl(195 30% 92%)"
  accent-foreground: "hsl(200 12% 22%)"
  sidebar-background: "hsl(195 25% 97%)"
  sidebar-foreground: "hsl(200 10% 22%)"
  sidebar-border: "hsl(214 22% 91%)"
  sidebar-accent: "hsl(195 25% 93%)"
  sidebar-accent-foreground: "hsl(200 10% 22%)"
  # === 语义色（不可品牌化）===
  destructive: "hsl(0 72% 51%)"
  destructive-foreground: "hsl(0 0% 100%)"
  success: "hsl(152 64% 42%)"
  success-foreground: "hsl(0 0% 100%)"
  warning: "hsl(38 70% 45%)"
  warning-foreground: "hsl(0 0% 100%)"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: "700"
    lineHeight: "1.2"
    letterSpacing: "-0.01em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: "600"
    lineHeight: "1.3"
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: "400"
    lineHeight: "1.5"
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: "500"
    lineHeight: "1.4"
    letterSpacing: "0"
  micro:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "10px"
    fontWeight: "500"
    lineHeight: "1.4"
    letterSpacing: "0.01em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Code', monospace"
    fontSize: "12px"
    fontWeight: "400"
rounded:
  # 基础单位 4px，基础圆角 8px
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "8px"
  full: "9999px"
spacing:
  # 卡片 / 区域间距标度（基于 4px 网格）
  card-padding: "20px"
  field-gap: "12px"
  card-gap: "20px"
  section-gap: "32px"
  page-padding-x: "24px"
  page-padding-y: "32px"
components:
  card-settings:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: "20px"
  card-header:
    textColor: "{colors.foreground}"
    typography: "title"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
  button-danger:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    rounded: "{rounded.md}"
    height: "36px"
  input-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
  badge-status:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  icon-block:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    width: "40px"
    height: "40px"
---

# Design System: QNote

> 颜色规范、视觉密度、组件哲学。后续开发严格遵循。

## Overview

**Creative North Star: "The Quiet Workshop"**

QNote 是一把**安静的工具**。它不试图成为仪表盘，不试图成为 IDE，更不试图成为又一个"AI 套壳 SaaS"。它的存在是为了让剪贴板、笔记、Todo、AI 这些高频动作消失在肌肉记忆里 —— 用户记不住快捷键没关系，视觉本身就该是低噪音的。

这套规范不是"调色板规范"，是**视觉哲学规范**：颜色密度、装饰元素、信息层级全部以"工具感"为标尺。每个像素都在问同一个问题 —— **这是动作还是装饰？**

**Key Characteristics:**
- **Productivity Teal** 单一品牌色（HSL 195°），不靠彩虹调色板撑视觉
- **平面 + 轻阴影**而非多层渐变；图标方块、状态徽章、卡片用 `ring-1 + bg-primary/10` 微妙表示层级
- **中性为主，色彩为辅** —— 90% 灰阶 + 10% 品牌色。色彩用在"这里能点"或"这里已配置"，不装饰
- **WCAG AA 起步**：所有文字对背景 ≥ 4.5:1，状态指示器对背景 ≥ 3:1

**Confirmed Visual Rejections:**
- ❌ AI 调色板：紫色 / 靛蓝 / 青蓝渐变 (`from-violet-500`, `from-indigo-400`) — 标志 LLM 生成的 UI
- ❌ 6 套强调色万花筒：每张卡片不同色（emerald/violet/amber/slate/sky/indigo）— 视觉信息密度被稀释
- ❌ 弹性曲线动画：`cubic-bezier(0.34, 1.56, 0.64, 1)`、`animate-bounce` — 持续吸引注意力到无意义动作
- ❌ 多层渐变图标方块：`bg-gradient-to-br from-X to-X` — 装饰重于信息

## Colors

**核心哲学：单一品牌色 + 大量中性。** 95% 像素是中性灰，5% 关键动作才出现品牌色。

### Primary — Productivity Teal

| 变量 | Light (HSL) | Dark (HSL) | 用途 |
|---|---|---|---|
| `--primary` | `195 80% 38%` ≈ `#1d97a8` | `195 75% 55%` ≈ `#39bfd6` | 主操作按钮、激活状态、链接、focus ring |
| `--primary-foreground` | `0 0% 100%` | `220 25% 8%` | 主色按钮上的文字 |
| `--ring` | `195 80% 38%` | `195 75% 55%` | focus 描边 |
| `--accent` | `195 30% 92%` | `195 18% 20%` | 微弱品牌底色（hover 背景、二级表面）|
| `--secondary` | `195 30% 94%` | `195 18% 18%` | 同上，区分两个层级 |

**为什么是 Teal（195°）不是 Azure（221°）或 Indigo（260°）？**
- 221°（Azure）是 Linear / Notion / Slack 的同款色 —— 零辨识度
- 260°（Indigo / Violet）是所有 LLM 产品的标志色 —— "AI 套壳" 的视觉指纹
- 195° 在 blue 范畴之外，邻近 `--success` 的 152° 但不撞色 —— "主操作"与"成功反馈"层级清晰

### Neutral — 中性灰阶

| 变量 | Light (HSL) | Dark (HSL) | 用途 |
|---|---|---|---|
| `--background` | `0 0% 98%` | `220 15% 10%` | 页面底层背景 |
| `--card` | `0 0% 100%` | `220 15% 12%` | 卡片表面（比 background 亮 / 暗一阶）|
| `--foreground` | `220 10% 22%` | `195 15% 88%` | 主要文字 |
| `--muted` | `210 25% 94%` | `215 15% 18%` | 次级表面（icon block、徽章底色）|
| `--muted-foreground` | `215 12% 52%` | `215 15% 60%` | 次级文字（描述、提示）|
| `--border` | `214 22% 91%` | `215 15% 20%` | 卡片、输入框、分割线 |

### Semantic — 不可品牌化的语义色

| 变量 | Light (HSL) | Dark (HSL) | 用途 |
|---|---|---|---|
| `--destructive` | `0 72% 51%` | `0 62% 55%` | 危险操作（删除、清空、覆盖）|
| `--success` | `152 64% 42%` | `152 58% 55%` | 成功反馈（已保存、已配置）|
| `--warning` | `38 70% 45%` | `48 85% 60%` | 警示（窗口控制 hover、未来 warning 状态）|

> 红色和绿色是国际惯例，**不允许品牌化**（不要把 destructive 调成 teal 红或 success 调成品牌色绿）。

### Named Rules

**The 10% Rule.** 任何单一视口（页面/卡片/对话框）中，主色 `--primary` 覆盖的像素面积 ≤ 10%。它的稀有性是品牌识别的全部价值。Hero 按钮、focus 描边、状态点 —— 就这些。

**The Semantic Color Lock.** `--destructive` 和 `--success` 是不可改的色相。永远用它们处理"破坏 / 成功"语义，**不**用 `--primary` 替代。

**The One Accent Rule.** 整套系统只有 `--primary` 一个色相参与品牌表达。**不要**为不同模块引入第二个品牌色（"状态色"可以用语义色，但不要新加一个"次品牌色"）。

**The Neutral Default.** 默认填充是 `bg-muted` 或 `bg-card` / `bg-background`。`bg-primary/10` 是例外（仅用于 hover 反馈、icon block 底色）。

## Typography

**Display Font:** `system-ui, -apple-system, "Segoe UI", sans-serif`（系统默认 UI 字体）
**Body Font:** 同上
**Code Font:** `ui-monospace, SFMono-Regular, Menlo, Monaco, monospace`（系统等宽）

**Character:** 故意不用自定义字体 —— 启动速度、跨平台一致性、可读性都靠系统字体。如果未来要品牌化，首选 **Inter**（无衬线，UI 优化），显示字体可考虑 **Source Serif 4**（与 Productivity Teal 形成"现代工具 + 经典编辑"的对照）。

### Hierarchy

| 角色 | 字号 | 字重 | 行高 | 用在哪里 |
|---|---|---|---|---|
| **Display** | 20px | 700 | 1.2 | 页面大标题（设置首页）|
| **Title** | 15px | 600 | 1.3 | 卡片标题、对话框标题 |
| **Body** | 14px | 400 | 1.5 | 主要正文、按钮文字、输入框 |
| **Label** | 11px | 500 | 1.4 | 副标题、徽章、helper text |
| **Micro** | 10px | 500 | 1.4 | 超小副信息（kb/s、思考中、错误内联标签）|
| **Code** | 12px | 400 | 1.5 | 文件路径、JSON、代码块 |

### Named Rules

**The Label Suffix Rule.** 副标题一律用 `text-muted-foreground` 区分主标题（`text-foreground`），不靠字号差异做层级。视觉靠"色彩"分层，不靠"大小"。

**The Weight Step Rule.** 字重只用 `400 / 500 / 600 / 700` 四档，相邻两档字重差至少 200。不混用 `font-medium (500)` 和 `font-semibold (600)` 紧挨 —— 看起来"差不多但又有点不一样"是最糟糕的状态。

## Layout

**桌面优先（默认 minWidth 1000px）**。响应式分三档：
- `< 640px`（手机 / 极窄窗口）：1 列
- `640-1023px`（小屏 / 笔记本）：1 列（设置/笔记/题单都单列展开）
- `≥ 1024px`（标准桌面）：3 列

**容器宽度**：设置页 `max-w-6xl`（1152px），日常页面 `max-w-7xl`（1280px）。
**节奏**：所有间距基于 4px 网格。`gap-5`（20px）是默认卡片间距；`gap-3`（12px）是字段间距；`gap-2`（8px）是行内元素间距。

**Header 留白**：每个 section 标题前 `mb-3`（12px），section 之间 `mb-8`（32px）。

## Elevation & Depth

**Tonal Layering + 轻阴影为主，渐变 / 发光 / 模糊为禁。**

阴影只出现在两个场合：
1. **悬浮浮框**（AI 助手卡片 / 球）：`shadow-2xl` 用于明确"这不是页面一部分" —— 仅一处
2. **模态弹窗**（确认对话框、提示）：`shadow-lg` 足够

所有其他元素**靠背景色阶层**（background < card < popover）表达层级，**不靠阴影**。这是 Linear / Notion 风格的"安静工具"路径。

### Shadow Vocabulary

| 角色 | 值 | 用在哪里 |
|---|---|---|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | 卡片 hover 微提示（可选）|
| `shadow-lg` | `0 4px 16px rgba(0,0,0,0.12)` | 模态弹窗 |
| `shadow-2xl` | `0 24px 64px rgba(0,0,0,0.18)` | 浮框卡片 / 浮框球 |

> **不**用 `shadow-xl`、`shadow-md`，中间档位无存在必要。
> **不**用彩色光晕（`shadow-*-primary/50`）—— 装饰重于信息。

### Named Rules

**The Flat-By-Default Rule.** 元素静止时无阴影。阴影仅作为状态响应（hover / 浮起 / 弹窗）出现，**不**作为"装饰"长期存在。

**The Two-Shadow Budget Rule.** 一个视口内同时出现的显著阴影（`shadow-lg` 以上）≤ 2 个。超出即视觉噪音。

**The Zero-Glow Rule.** 禁止 `box-shadow` 使用品牌色（`shadow-*-primary/50`）。阴影是结构性的，**不**是装饰。

## Shapes

**8px 圆角为基础单位。** 4 / 6 / 8 / 12 / full 五档足够。

| 圆角 | 用途 |
|---|---|
| `4px` (sm) | 徽章、tag、小型 chip |
| `6px` (md) | 按钮、输入框、tab |
| `8px` (lg) | 卡片、小型浮起元素 |
| `12px` (xl) | 模态弹窗、AI 浮框卡片 |
| `9999px` (full) | 圆形浮框球、用户头像 |

### Named Rules

**The 8px Rule.** 默认圆角 8px。一致性 > 个性。不要为某个组件临时换成 10px / 14px。

**The No-Decoration Rule.** 不使用 `rounded-t-*` / `rounded-b-*` 的非对称圆角（除非有明确功能原因，例如 banner 顶部圆角匹配弹窗顶部）。一致性比"有趣"重要。

## Components

### SettingsCard（设置页卡片）

- **Shape:** `rounded-xl`（8px）、`border border-border/60`
- **Background:** `bg-card`
- **Header:** 含 icon block（40×40，`rounded-lg`，`bg-primary/10`，`ring-1 ring-primary/20`）+ 标题（`text-foreground`，font-weight 600）+ 副标题（`text-muted-foreground`，11px）+ 可选状态徽章
- **Body:** `p-5`（20px），字段间 `gap-3`（12px）
- **Hover:** `hover:border-primary/40` 微弱提示可点击 / 可聚焦

### Icon Block

- **Size:** 40×40 / 32×32 / 24×24 三档
- **Style:** `rounded-lg` 或 `rounded-xl`，`bg-primary/10`，`ring-1 ring-primary/20`
- **Icon color:** `text-primary`
- **目的:** 给每个功能 / 卡片一个**视觉锚点**。所有 icon block 风格统一

### Button

- **Shape:** `rounded-md`（6px）
- **Primary:** `bg-primary text-primary-foreground`
- **Outline:** `bg-background border border-border/70 hover:bg-muted`
- **Danger:** `bg-destructive text-destructive-foreground`
- **Height:** 36px（标准）/ 28px（小尺寸） / 40px（大尺寸 / 主页 hero）
- **Padding:** `px-4`（标准）/ `px-3`（小）
- **Icon 间距:** 文字 + icon 时 `mr-1.5`

### Input

- **Background:** `bg-background`
- **Border:** `border-border/70`
- **Focus:** `ring-2 ring-primary/30`（柔和光晕，**不**用 border 颜色切换）
- **Height:** 36px（标准）
- **Label:** 字段标题用 `text-sm font-medium text-foreground/80`，helper text 用 `text-[11px] text-muted-foreground/70`
- **不**用 placeholder 充当 label（无障碍要求）

### Status Badge（已配置/未配置）

- **Shape:** `rounded-md`（6px）
- **Active:** `bg-primary/10 text-primary border-primary/25`
- **Idle:** `bg-muted text-muted-foreground/70 border-border/70`
- **Dot:** 6px 圆点，`bg-primary` 或 `bg-muted-foreground/40`
- **用法:** OCR / AI 配置状态、记忆索引记录数

### Floating AI Panel（招牌组件）

- **状态:** 折叠（球 56×56） / 展开（卡片 380×560）
- **锚点:** 右下角，固定 right/bottom 偏移
- **球:** `rounded-full bg-primary`，hover `scale-105`，drag `cursor-grab/grabbing`
- **卡片:** `rounded-xl border border-border/60`，`shadow-2xl`（4px 角对应 380px 宽，整体更克制）
- **Header:** 含 Bot icon block（28×28）+ 标题 + 副标题（"思考中..." / "可拖动定位"）+ 清空 + 收起按钮
- **跨窗口同步:** 位置和展开状态通过 IPC 广播给所有 Electron 窗口
- **关键交互:** 单击 vs 拖动用 3px 阈值 + `suppressNextClickRef` 区分

### Sidebar（应用侧栏）

- **Width:** 默认 192px（12rem），用户可拖拽到 192-420px
- **Background:** `bg-sidebar-background`（极浅 teal 调）
- **Nav Item:** `hover:bg-sidebar-accent`，激活 `bg-sidebar-primary text-sidebar-primary-foreground`
- **Brand zone:** 顶部 "QNote" 标题 + 分割线 —— 不放额外元素
- **Footer:** 侧边栏收起/展开 toggle

## Do's and Don'ts

### Do

- **Do** 颜色用 CSS 变量（`bg-primary`、`text-muted-foreground`），**不**直接写 `bg-teal-500` 等 Tailwind 调色板类 —— 调色板是底层，原色是上层
- **Do** 状态反馈用语义色 —— 配置成功用 `--success`、删除警告用 `--destructive`，**不**用 `--primary` 替代
- **Do** 卡片静止态用 `border + bg-card`，**不**用 `shadow` 表达层级
- **Do** 圆角 8px 起步，按尺寸档位递增（卡片 12 / 按钮 6 / 徽章 4）
- **Do** 浮框 / 弹窗用单一 `shadow-2xl` 强化"脱离页面"感，其他元素不用 shadow-lg 以上
- **Do** 跨窗口共享状态（位置、展开）走 IPC + 后端存储，**不**用 localStorage 各窗口独立
- **Do** 动画用 `cubic-bezier(0.22, 1, 0.36, 1)` 线性 ease-out，**不**用 spring 弹性曲线
- **Do** 拖动手感：cursor `grab`（未拖）/ `grabbing`（拖动中），**不**用 cursor `move`

### Don't

- **Don't** 使用 `from-violet / from-indigo / from-purple` 等 AI 调色板渐变
- **Don't** 用 `bg-gradient-to-br from-X to-X` 多层渐变图标方块 —— 改用 `bg-primary/10 + ring-1`
- **Don't** 用 `animate-bounce`、spring 曲线、装饰性持续动画 —— 动画只在状态变化时用一次
- **Don't** 引入第二个品牌色（即使是"状态色"或"辅助色"）—— 全部用中性 + `--primary`
- **Don't** 为不同卡片挑不同强调色（之前的 6 色万花筒）—— 现在统一 accent + neutral 两套主题
- **Don't** 让卡片标题用 1 个 18px 文字 + 巨大空白 —— 用 15px 紧凑标题 + 副标题分层
- **Don't** 浮框 / 卡片用多层渐变背景（`shadow-2xl shadow-primary/40` 等）—— 单层 shadow 就够
- **Don't** 红色 success 反馈用 `--primary` 替代 —— 用户的认知期望"绿色=成功 / 红色=危险"
- **Don't** 表单字段靠 placeholder 充当 label —— label 必须可见

### 组件选择决策树

新增功能 / 组件时按以下顺序决策：

1. **需要色彩吗？** 90% 情况不需要 —— 用 `text-foreground` / `text-muted-foreground`
2. **需要层级吗？** 用 `bg-muted` 区分次级表面，**不**用阴影
3. **是动作按钮吗？** → `<Button variant="primary">` / `outline` / `danger`
4. **是状态反馈吗？** → `success` (绿) / `destructive` (红) / 闲置灰
5. **是品牌色吗？** 仅"主操作 / 激活 / 链接" → `--primary`

### 跨窗口 / 持久化决策

- 单一窗口可见的状态（todo 状态、设置）→ DB
- 跨窗口共享的 UI 状态（浮框位置 / 展开）→ IPC + 后端 JSON 文件（`userData/<key>.json`）
- 单一窗口内的 UI 偏好（侧栏宽度、侧栏 collapsed）→ localStorage
- 会话内的临时状态（弹窗打开/关闭、菜单展开）→ React state，**不**持久化
