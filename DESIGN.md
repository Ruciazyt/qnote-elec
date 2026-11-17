---
name: QNote
description: 轻量笔记 + Todo + AI 助手，专注、不喧宾夺主的桌面工具
colors:
  primary: "hsl(195 80% 34%)"
  primary-foreground: "hsl(0 0% 100%)"
  primary-strong: "hsl(195 80% 30%)"
  ring: "hsl(195 80% 34%)"
  sidebar-primary: "hsl(195 80% 34%)"
  background: "hsl(0 0% 98%)"
  foreground: "hsl(220 10% 22%)"
  card: "hsl(0 0% 100%)"
  card-foreground: "hsl(220 10% 22%)"
  popover: "hsl(0 0% 100%)"
  popover-foreground: "hsl(220 10% 22%)"
  muted: "hsl(210 25% 94%)"
  muted-foreground: "hsl(215 12% 46%)"
  border: "hsl(214 22% 91%)"
  input: "hsl(214 22% 91%)"
  secondary: "hsl(195 30% 94%)"
  secondary-foreground: "hsl(200 10% 22%)"
  accent: "hsl(195 30% 92%)"
  accent-foreground: "hsl(200 12% 22%)"
  sidebar-background: "hsl(0 0% 94%)"
  sidebar-foreground: "hsl(200 10% 22%)"
  sidebar-border: "hsl(214 22% 91%)"
  sidebar-accent: "hsl(195 25% 84%)"
  sidebar-accent-foreground: "hsl(200 10% 22%)"
  destructive: "hsl(0 72% 51%)"
  destructive-foreground: "hsl(0 0% 100%)"
  success: "hsl(152 60% 32%)"
  success-foreground: "hsl(0 0% 100%)"
  warning: "hsl(38 70% 35%)"
  warning-foreground: "hsl(0 0% 100%)"
  app-frame: "hsl(0 0% 94%)"
  divider: "hsl(214 16% 80%)"
  link: "hsl(212 90% 42%)"
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
  subhead:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: "500"
    lineHeight: "1.45"
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
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
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
    backgroundColor: "hsl(195 80% 34% / 0.1)"
    textColor: "{colors.primary-strong}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  badge-status-idle:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
  icon-block:
    backgroundColor: "hsl(195 80% 34% / 0.1)"
    iconColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    width: "40px"
    height: "40px"
---

# Design System: QNote


## 这份文档管什么

| 文档 | 管什么 | 什么时候看它 |
| --- | --- | --- |
| **DESIGN.md**（本文件） | 视觉语言：token 取值与理由、字阶、形状、动效、组件规格 | 拿不准「用哪个色 / 哪档字号 / 哪一档阴影」 |
| `docs/UI-GUIDELINES.md` | 走查清单：可访问性硬规则、几何基准、测量方法、破坏性确认框文案口径 | 改完界面要自查，或要判「这样算不算合规」 |
| `docs/UI-AUDIT-2026-11-05.md` | 走查记录与未闭合的走查项、待办清单 | 想知道还有什么没修 |


## Overview




- **Productivity Teal** 单一品牌色（HSL 195°），不靠彩虹调色板撑视觉
- **平面 + 轻阴影**而非多层渐变；图标方块、状态徽章、卡片用 `ring-1 + bg-primary/10` 微妙表示层级
- **中性为主，色彩为辅** —— 90% 灰阶 + 10% 品牌色。色彩用在"这里能点"或"这里已配置"，不装饰
- **WCAG AA 起步**：所有文字对背景 ≥ 4.5:1，状态指示器对背景 ≥ 3:1

- ❌ AI 调色板：紫色 / 靛蓝 / 青蓝渐变 (`from-violet-500`, `from-indigo-400`) — 标志 LLM 生成的 UI
- ❌ 6 套强调色万花筒：每张卡片不同色（emerald/violet/amber/slate/sky/indigo）— 视觉信息密度被稀释
- ❌ 弹性曲线动画：`cubic-bezier(0.34, 1.56, 0.64, 1)`、`animate-bounce` — 持续吸引注意力到无意义动作
- ❌ 多层渐变图标方块：`bg-gradient-to-br from-X to-X` — 装饰重于信息

## Colors


### Primary — Productivity Teal

| 变量 | Light (HSL) | Dark (HSL) | 用途 |
|---|---|---|---|
| `--primary` | `195 80% 34%` ≈ `#11799c` | `195 75% 55%` ≈ `#36b7e2` | 主操作按钮**底色**、激活态底色、focus ring |
| `--primary-foreground` | `0 0% 100%` | `220 25% 8%` | 主色按钮上的文字 |
| `--primary-strong` | `195 80% 30%` ≈ `#0f6b8a` | `195 80% 60%` ≈ `#47c2eb` | **品牌色作文字**（徽章文字、浅底上的品牌字） |
| `--ring` | `195 80% 34%` | `195 75% 55%` | focus 描边 |
| `--accent` | `195 30% 92%` | `195 18% 20%` | 微弱品牌底色（hover 背景、二级表面）|
| `--secondary` | `195 30% 94%` | `195 18% 18%` | 同上，区分两个层级 |


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
| `--muted-foreground` | `215 12% 46%` | `215 15% 60%` | 次级文字（描述、提示）|
| `--border` | `214 22% 91%` | `215 15% 20%` | 卡片、输入框、分割线 |
| `--app-frame` | `0 0% 94%` | `220 15% 7%` | 应用外框（标题栏 + 导航侧栏那一层）|
| `--divider` | `214 16% 80%` | `215 12% 30%` | 必须看得见的分栏线（比 `--border` 更偏离面色）|


### Semantic — 不可品牌化的语义色

| 变量 | Light (HSL) | Dark (HSL) | 用途 |
|---|---|---|---|
| `--destructive` | `0 72% 51%` | `0 62% 55%` | 危险操作（删除、清空、覆盖）|
| `--success` | `152 60% 32%` | `152 58% 55%` | 成功反馈（已保存、已配置）|
| `--warning` | `38 70% 35%` | `48 85% 60%` | 警示（窗口控制 hover、未来 warning 状态）|
| `--link` | `212 90% 42%` | `205 92% 70%` | 网址正文（刻意避开品牌青）|



### Named Rules





## Typography



### Hierarchy

| 角色 | 字号 | 字重 | 行高 | 用在哪里 | 类名 |
|---|---|---|---|---|---|
| **Display** | 20px | 700 | 1.2 | 页面大标题（设置首页）| `text-xl font-bold` |
| **Title** | 15px | 600 | 1.3 | 卡片标题、对话框标题 | `text-title` |
| **Subhead** | 13px | 500 | 1.45 | 分组小标题（设置分区标签）| `text-subhead` |
| **Body** | 14px | 400 | 1.5 | 主要正文、按钮文字、输入框 | `text-sm` |
| **Label** | 11px | 500 | 1.4 | 副标题、徽章、helper text | `text-label` |
| **Micro** | 10px | 500 | 1.4 | 超小副信息（kb/s、思考中、错误内联标签）| `text-micro` |
| **Code** | 12px | 400 | 1.5 | 文件路径、JSON、代码块 | `text-xs font-mono` |


### Named Rules



## Layout

- `< 640px`（手机 / 极窄窗口）：1 列
- `640-1023px`（小屏 / 笔记本）：1 列（设置/笔记/题单都单列展开）
- `≥ 1024px`（标准桌面）：3 列



## Elevation & Depth



1. **基线阴影（`shadow-sm`）** —— 卡片、按钮、输入框、下拉项这类表面。
2. **脱离阴影（`shadow-lg` / `shadow-2xl`）** —— 只有两处：


### Shadow Vocabulary


| 角色 | 值 | 用在哪里 |
|---|---|---|
| `shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | **基线**：卡片、按钮、输入框、下拉项（卡片上它只当一条极淡的边，不表达层级）|
| `shadow-md` | `0 4px 6px -1px …, 0 2px 4px -2px …` | 浮层：popover、select 下拉、选中卡片 |
| `shadow-lg` | `0 10px 15px -3px …` | 模态弹窗、Toast |
| `shadow-2xl` | `0 25px 50px -12px …` | 浮框卡片（AI 面板）、图片预览 |


### Named Rules




## Shapes


| 圆角 | 用途 |
|---|---|
| `4px` (sm) | 徽章、tag、小型 chip |
| `6px` (md) | 按钮、输入框、tab |
| `8px` (lg) | 卡片、小型浮起元素 |
| `12px` (xl) | 模态弹窗、AI 浮框卡片 |
| `9999px` (full) | 圆形浮框球、用户头像 |

### Named Rules



## Motion（动效）


### 曲线


### 时长档位

| 档 | 时长 | 用在哪 |
| --- | --- | --- |
| 快 | 120–150ms | 悬停反馈、颜色与透明度变化、图标状态切换 |
| 标准 | 180–220ms | 面板展开收起、浮层出现、页面切换 |
| 慢 | 300ms 以上 | 只给「确实需要时间」的过程（进度、加载） |


### 退场比入场快


### 空间位移与不透明度分开做



### 减弱动效要有退路



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
- **Icon 间距:** 文字 + icon 时用基类自带的 `gap-2`，不自己加 `mr-1.5`

### Input

- **Background:** `bg-background`
- **Border:** `border-border/70`
- **Focus:** `focus-visible:ring-2 focus-visible:ring-ring` —— 与按钮基类同一档（2px），
- **Height:** 36px（标准）
- **Label:** 字段标题用 `text-sm font-medium text-foreground`，
- **不**用 placeholder 充当 label（无障碍要求）；label 与控件用 `htmlFor` + `id` 关联
- **不**给次级文字叠透明度档（`text-muted-foreground/70` 是 2.67:1，取更差列），

### Status Badge（已配置/未配置）

- **Shape:** `rounded-md`（6px）
- **Active:** `bg-primary/10 text-primary-strong border-primary/25`
- **Idle:** `bg-background text-muted-foreground border-border/70`
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

### Sidebar（侧栏）



- **Width:** `16rem`（256px），折叠态 `3.5rem`（56px），可拖到 152px
- **Background:** `bg-sidebar` —— 它等于 `--app-frame`（与标题栏同色，
- **Nav Item:** `hover:bg-sidebar-accent`，激活 `bg-sidebar-primary text-sidebar-primary-foreground`
- **顶部:** 不设品牌区。顶部只留 40px 让位给标题栏
- **Footer:** 收起/展开 toggle —— 复用导航项的样式，读作「列表的最后一行」
- 导航用 `<Link>`（真 `href`），不用 `<a onClick>`



- **折叠:** `ResizableSidebar`；折叠轨宽 48px、切换按钮 32px、锚点 8px
- **拖拽:** `PanelResizer`（7px 热区，作为 flex 子节点真实占位）
- **宽度:** 默认 288px。下限统一 220px；上限按页面取
- **持久化:** 宽度走 `usePanelWidth`，折叠态走 `useCollapsedState`（都存 localStorage）

### 组件地图


- `components/ui/` —— shadcn/ui 基础件（button、dialog、popover、tooltip、toast、
- `components/panel/` —— 通用面板件：`ResizableSidebar`（可折叠侧栏）、
- `components/shell/` —— 应用外壳（标题栏、侧栏导航）、
- `components/ai/` —— 跨页面复用的 AI 悬浮层（浮窗助手、桌宠）、
- `hooks/panel/usePanelWidth.ts` / `hooks/panel/useCollapsedState.ts` —— 宽度与折叠态的持久化
- 其余 `pages/<域>/` —— 业务件（笔记、题单、应用、剪贴板、快捷方式、待办…），

## States（空 / 加载 / 错）


- **空态** —— 一句说明 + 一个动作入口。不要只写一行「暂无数据」；
- **加载态** —— 骨架屏（`ui/skeleton`）或明确的进度指示。
- **错误态** —— 说清发生了什么 + 能做什么。toast 用 `variant="destructive"`，


## Accessibility（可访问性基线）


- 正文对比度 ≥ 4.5:1，大字与图形 ≥ 3:1；焦点指示器与相邻颜色 ≥ 3:1
- **焦点指示器厚度 ≥ 2px**，全应用同一档（按钮、输入框、下拉、分割线）
- **纯图标按钮必须有 `aria-label`**，且名称要能区分同组重复控件
- **看不见的控件必须移出焦点序** —— 用 `visibility: hidden` 或 `inert`，
- 折叠 / 隐藏的区域，标题区、操作区、内容区的退场动效要一致
- 可点击的非 `button` 元素要有 `role`、`tabIndex` 与键盘处理

## Do's and Don'ts

### Do

- **Do** 颜色用 CSS 变量（`bg-primary`、`text-muted-foreground`），**不**直接写 `bg-teal-500` 等 Tailwind 调色板类 —— 调色板是底层，原色是上层
- **Do** 品牌色**当底色 / 描边 / 图标**用 `--primary`（`bg-primary`、`ring-primary`）；
      **当文字**用 `--primary-strong`（`text-primary-strong`）——
      `--primary` 当文字只配无品牌底纹处，`--primary-strong` 的底纹上限是 `/15`
- **Do** 次级文字用 `--muted-foreground` **实心值**，不叠 `/60` `/70` `/80` 透明度档 —— 浅底上 46% 是 4.61:1（取更差列），叠一档就掉到 2.27~3.18:1
- **Do** 状态反馈用语义色 —— 配置成功用 `--success`、删除警告用 `--destructive`，**不**用 `--primary` 替代
- **Do** 卡片静止态用 `border + bg-card` 表达层级，**不**用 `shadow-md` 以上；
      `shadow-sm` 只相当于一条极淡的边（基类自带），不承担层级职责
- **Do** 圆角 8px 起步，按尺寸档位递增（卡片 8 / 按钮 6 / 徽章 4）
- **Do** 浮框用单一 `shadow-2xl` 强化"脱离页面"感，模态弹窗用 `shadow-lg`，
      其他元素不用 `shadow-lg` 以上
- **Do** 跨窗口共享状态（位置、展开）走 IPC + 后端存储，**不**用 localStorage 各窗口独立
- **Do** 动画用 `cubic-bezier(0.22, 1, 0.36, 1)` 线性 ease-out，**不**用 spring 弹性曲线
- **Do** 位移动效带 `motion-reduce:transition-none`（系统「减少动态效果」时直接跳到位）
- **Do** 拖动手感：cursor `grab`（未拖）/ `grabbing`（拖动中），**不**用 cursor `move`

### Don't

- **Don't** 使用 `from-violet / from-indigo / from-purple` 等 AI 调色板渐变
- **Don't** 用 `bg-gradient-to-br from-X to-X` 多层渐变图标方块 —— 改用 `bg-primary/10 + ring-1`
- **Don't** 用 `animate-bounce`、spring 曲线、装饰性持续动画 —— 动画只在状态变化时用一次
- **Don't** 引入第二个品牌色（即使是"状态色"或"辅助色"）—— 全部用中性 + `--primary`
- **Don't** 用 `text-primary` 在**品牌底纹上**写文字 —— 无底纹处白底 4.93:1、
      98% 底 4.72:1 过线，但 `/5` 就已经 4.42、`/10` 4.14、`/15` 3.87，全不过；
      品牌底纹上的文字一律用 `text-primary-strong`（`/15` 以内 4.72:1 起步），`/20` 禁用
- **Don't** 给次级文字叠透明度档（`text-muted-foreground/60` `/70` `/80`）—— 浅底上从 4.61:1 掉到 2.27~3.18:1
- **Don't** 写非 5 倍数的透明度档（`/8`、`/12`）—— Tailwind 不生成规则，底色静默消失；
      要非 5 倍数就用方括号任意值（`bg-primary/[0.08]`）
- **Don't** 为不同卡片挑不同强调色（之前的 6 色万花筒）—— 现在统一 accent + neutral 两套主题
- **Don't** 让卡片标题用 1 个 18px 文字 + 巨大空白 —— 用 15px 紧凑标题 + 副标题分层
- **Don't** 浮框 / 卡片用多层渐变背景（`shadow-2xl shadow-primary/40` 等）—— 单层 shadow 就够
- **Don't** 红色 success 反馈用 `--primary` 替代 —— 用户的认知期望"绿色=成功 / 红色=危险"
- **Don't** 表单字段靠 placeholder 充当 label —— label 必须可见
- **Don't** 用 `opacity-0` + `pointer-events-none` 藏可聚焦控件 —— 键盘仍能 Tab 进去，
- **Don't** 用 1px 的焦点环 —— 全应用统一 2px

### 组件选择决策树


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
