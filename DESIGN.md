---
name: QNote
description: 轻量笔记 + Todo + AI 助手，专注、不喧宾夺主的桌面工具
colors:
  # 本块登记的是**浅色主题**的主值；暗色取值见下方 Colors 表与 src/renderer/index.css。
  # 两处必须一致 —— 改 token 时 index.css 与本文件一起改。
  # === 品牌主色（Productivity Teal）===
  # primary 浅色 34%：白字压在这个底上是 4.93:1，过 AA 正文线 4.5:1。
  # 它自己当文字色：无品牌底纹处白底 4.93:1、98% 底 4.72:1（取更差 4.72:1）过线；
  # 但任何品牌底纹都不过线（/5 4.42、/10 4.14、/15 3.87、/20 3.61）——
  # 要在品牌底纹上写文字就用 primary-strong（底纹上限 /15）。
  primary: "hsl(195 80% 34%)"
  primary-foreground: "hsl(0 0% 100%)"
  # 品牌色「作文字」用的深档：同一个 195° 色相，深一档
  # （无品牌底纹处白底 6.01:1、98% 底 5.75:1，取更差 5.75:1）
  # 底纹上限 bg-primary/15（/5 5.39、/10 5.05、/15 4.72 过线；/20 是 4.41，禁用）。
  primary-strong: "hsl(195 80% 30%)"
  ring: "hsl(195 80% 34%)"
  sidebar-primary: "hsl(195 80% 34%)"
  # === 中性灰背景/前景 ===
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
  # === 微弱品牌色（次级背景）===
  secondary: "hsl(195 30% 94%)"
  secondary-foreground: "hsl(200 10% 22%)"
  accent: "hsl(195 30% 92%)"
  accent-foreground: "hsl(200 12% 22%)"
  # 侧栏与标题栏同色 —— 两者合成同一个外框，中间不露接缝
  sidebar-background: "hsl(0 0% 94%)"
  sidebar-foreground: "hsl(200 10% 22%)"
  sidebar-border: "hsl(214 22% 91%)"
  # hover 底色：贴着 94% 的外框要差得开才读得出「这里可点」
  sidebar-accent: "hsl(195 25% 84%)"
  sidebar-accent-foreground: "hsl(200 10% 22%)"
  # === 语义色（不可品牌化）===
  destructive: "hsl(0 72% 51%)"
  destructive-foreground: "hsl(0 0% 100%)"
  # success / warning 的浅色取值按「最严使用场景」定过值：
  # 42% 的绿在白底卡片上只有 2.80:1、45% 的琥珀只有 3.05:1，都过不了正文线；
  # 现值是 4.75:1 / 4.77:1，与 destructive 4.80:1 同档。理由见正文 Colors 一节。
  success: "hsl(152 60% 32%)"
  success-foreground: "hsl(0 0% 100%)"
  warning: "hsl(38 70% 35%)"
  warning-foreground: "hsl(0 0% 100%)"
  # === 外框、可见分割线、链接色 ===
  # app-frame 是标题栏 + 导航侧栏那一层外框；divider 是必须看得见的分栏线；
  # link 刻意避开品牌青 —— 置顶徽章、打开链接按钮已经占了 primary。
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
  # 基础单位 4px，基础圆角 8px（--radius: 0.5rem）
  # sm / md / lg 来自 tailwind.config.js 的 borderRadius 覆写；xl 用 Tailwind 默认的 0.75rem
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
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
    # 品牌底纹 + 品牌深档文字（bg-primary/10 + text-primary-strong），不是实心 primary
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

> 颜色规范、视觉密度、组件哲学。后续开发严格遵循。

## 这份文档管什么

| 文档 | 管什么 | 什么时候看它 |
| --- | --- | --- |
| **DESIGN.md**（本文件） | 视觉语言：token 取值与理由、字阶、形状、动效、组件规格 | 拿不准「用哪个色 / 哪档字号 / 哪一档阴影」 |
| `docs/UI-GUIDELINES.md` | 走查清单：可访问性硬规则、几何基准、测量方法、破坏性确认框文案口径 | 改完界面要自查，或要判「这样算不算合规」 |
| `docs/UI-AUDIT-2026-11-05.md` | 走查记录与未闭合的走查项、待办清单 | 想知道还有什么没修 |

**冲突时以本文件为准**（视觉语言是上游）。只有一条例外：
`index.css` 与 `tailwind.config.js` 是**实现的唯一来源** ——
文档与代码不一致时以代码为准，并回头把文档改对。

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
| `--primary` | `195 80% 34%` ≈ `#11799c` | `195 75% 55%` ≈ `#36b7e2` | 主操作按钮**底色**、激活态底色、focus ring |
| `--primary-foreground` | `0 0% 100%` | `220 25% 8%` | 主色按钮上的文字 |
| `--primary-strong` | `195 80% 30%` ≈ `#0f6b8a` | `195 80% 60%` ≈ `#47c2eb` | **品牌色作文字**（徽章文字、浅底上的品牌字） |
| `--ring` | `195 80% 34%` | `195 75% 55%` | focus 描边 |
| `--accent` | `195 30% 92%` | `195 18% 20%` | 微弱品牌底色（hover 背景、二级表面）|
| `--secondary` | `195 30% 94%` | `195 18% 18%` | 同上，区分两个层级 |

> **品牌色的两档。** `--primary` 与 `--primary-strong` 是**同一个色相**（195°），
> 只差明度，不是第二个品牌色 —— 「One Accent Rule」管的是色相，不是明度档。
>
> **用法是两条规则，不是一条**（数字取更差列，口径见 `docs/UI-GUIDELINES.md` 第九节）：
>
> 1. **`--primary` 作文字只能落在无品牌底纹处** —— 白底 4.93:1、98% 底 4.72:1
>    （取更差 4.72:1）过线；**任何**品牌底纹都不过线：
>    `/5` 4.42、`/10` 4.14、`/15` 3.87、`/20` 3.61。
> 2. **`--primary-strong` 作文字的底纹上限是 `/15`** —— 无底纹处白底 6.01:1、
>    98% 底 5.75:1；`/5` 5.39、`/10` 5.05、`/15` 4.72 都过线；
>    **`/20` 是 4.41:1，禁用** —— 只许用于不带文字的装饰（进度条、滑块填充、
>    边框、ring、模糊底）。
>
> 品牌色当底色、描边、图标用 `--primary`；当文字用 `--primary-strong`。
> 一句话版本：**品牌底纹上要写字，就换 `--primary-strong`，且底纹不超 `/15`。**

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
| `--muted-foreground` | `215 12% 46%` | `215 15% 60%` | 次级文字（描述、提示）|
| `--border` | `214 22% 91%` | `215 15% 20%` | 卡片、输入框、分割线 |
| `--app-frame` | `0 0% 94%` | `220 15% 7%` | 应用外框（标题栏 + 导航侧栏那一层）|
| `--divider` | `214 16% 80%` | `215 12% 30%` | 必须看得见的分栏线（比 `--border` 更偏离面色）|

> **`--muted-foreground` 46% 不是挑的，是补齐的。** 它原先是 52%，
> 白底卡片上只有 3.89:1 —— 同一套里 success / warning / destructive 都 4.7+，
> 只有这个次级文字掉队。现值 4.82:1（98% 底 4.61:1，取更差 4.61:1）。
> **文字一律用实心值**：`/60` 2.27:1、`/70` 2.67:1、`/80` 3.18:1
> （取更差列；白底对应 2.32 / 2.74 / 3.27）—— 透明度档一律掉到 4.5 以下。
>
> `--border` 与 `--divider` 不是同一个东西：`--border` 是 91% 亮度，
> 正好落在笔记页两侧的面色之间（侧栏 94% / 内容 98%），画出来是
> 一段比两边都浅的脏过渡带；需要「明确看得见边界」的地方要用 `--divider`。

### Semantic — 不可品牌化的语义色

| 变量 | Light (HSL) | Dark (HSL) | 用途 |
|---|---|---|---|
| `--destructive` | `0 72% 51%` | `0 62% 55%` | 危险操作（删除、清空、覆盖）|
| `--success` | `152 60% 32%` | `152 58% 55%` | 成功反馈（已保存、已配置）|
| `--warning` | `38 70% 35%` | `48 85% 60%` | 警示（窗口控制 hover、未来 warning 状态）|
| `--link` | `212 90% 42%` | `205 92% 70%` | 网址正文（刻意避开品牌青）|

> **语义色的浅色档是算出来的，不是挑出来的。** 三个语义色在浅色主题下的
> 对比度要落在**同一档** —— `--success` 4.55:1、`--warning` 4.57:1、
> `--destructive` 4.59:1（取更差列；白底对应 4.75 / 4.77 / 4.80），
> 视觉权重一致，警告色不会比成功色更轻、也不会比危险色更重。
> 也不会比危险色更重。
>
> `--success` 原先取 `152 64% 42%`：42% 的绿当文字色落在白底卡片上只有
> 2.80:1，10px 的徽章小字过不了 4.5:1；32% 是 4.75:1（取更差 4.55:1），刚过线 ——
> 余量不大，所以徽章文字必须用实心值，不能再叠 `/80`。
>
> `--warning` 原先取 `38 70% 45%`：只有 3.05:1，当正文色不过线，
> 当图形色（标题栏最大化按钮的 hover 图标，底色是 `--app-frame`）
> 连 3:1 都不到；35% 是 4.77:1（取更差 4.57:1）。再压到 32% 会读成深棕、
> 比成功色还重，所以停在 35%。
>
> 暗色两档都远超标准，不必再往上提亮：success 在深色卡片底
> （`--card` 220 15% 12%）上是 8.52:1，warning 是 10.85:1。

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

| 角色 | 字号 | 字重 | 行高 | 用在哪里 | 类名 |
|---|---|---|---|---|---|
| **Display** | 20px | 700 | 1.2 | 页面大标题（设置首页）| `text-xl font-bold` |
| **Title** | 15px | 600 | 1.3 | 卡片标题、对话框标题 | `text-title` |
| **Subhead** | 13px | 500 | 1.45 | 分组小标题（设置分区标签）| `text-subhead` |
| **Body** | 14px | 400 | 1.5 | 主要正文、按钮文字、输入框 | `text-sm` |
| **Label** | 11px | 500 | 1.4 | 副标题、徽章、helper text | `text-label` |
| **Micro** | 10px | 500 | 1.4 | 超小副信息（kb/s、思考中、错误内联标签）| `text-micro` |
| **Code** | 12px | 400 | 1.5 | 文件路径、JSON、代码块 | `text-xs font-mono` |

> **字号怎么写。** 上表六档是唯一的字号来源，类名由 `tailwind.config.js` 的
> `fontSize` token 提供（10 / 11 / 13 / 15 四档是本仓登记的，12 / 14 / 20
> 用 Tailwind 自带的 `text-xs` / `text-sm` / `text-xl`）。
> 过去全靠 `text-[10px]` 这类任意值硬写，字号改了要满仓库找 —— 2026-11-05
> 起新代码一律用类名；**已有的 `text-[Npx]` 不批量返工**（改动面太大，
> 收益不抵风险），但凡是本次走查要碰的行，顺手换成对应类名。

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

阴影分两个层级：

1. **基线阴影（`shadow-sm`）** —— 卡片、按钮、输入框、下拉项这类表面。
   它**不表达层级**，只把表面从底色上托起来一点点，等价于一条极淡的边；
   卡片的层级由 `border + bg-card` 表达，`shadow-sm` 只是基类自带的那条淡边。
2. **脱离阴影（`shadow-lg` / `shadow-2xl`）** —— 只有两处：
   模态弹窗（`shadow-lg`）与浮框（AI 助手卡片 / 球，`shadow-2xl`，全应用仅一处），
   用来明确「这不是页面的一部分」。

层级差异一律**靠背景色阶层**（background < card < popover）表达，
**不用 `shadow-md` 以上**。这是 Linear / Notion 风格的"安静工具"路径。

### Shadow Vocabulary

四档，与仓库实际用法一一对应：

| 角色 | 值 | 用在哪里 |
|---|---|---|
| `shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | **基线**：卡片、按钮、输入框、下拉项（卡片上它只当一条极淡的边，不表达层级）|
| `shadow-md` | `0 4px 6px -1px …, 0 2px 4px -2px …` | 浮层：popover、select 下拉、选中卡片 |
| `shadow-lg` | `0 10px 15px -3px …` | 模态弹窗、Toast |
| `shadow-2xl` | `0 25px 50px -12px …` | 浮框卡片（AI 面板）、图片预览 |

> **不**用 `shadow-xl` —— 它在词表里没有位置。仓库里只剩两处
> （快捷方式拖拽中的图块、宠物气泡），两处都该换档，见走查待办。
>
> **不**用彩色光晕（`shadow-*-primary/50`）—— 装饰重于信息。
>
> 阴影只出现在两类地方：**浮层**（脱离页面）与**模态**。页面内的层级
> 一律靠背景色阶层（background < card < popover）表达。

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

## Motion（动效）

QNote 的动效只有一个职责：**说明状态变了**。不吸引注意力，不表演。

### 曲线

统一 `cubic-bezier(0.22, 1, 0.36, 1)`（线性 ease-out）。**不**用弹性曲线
（`cubic-bezier(0.34, 1.56, 0.64, 1)`、`animate-bounce`）—— 弹一下就是在要用户看，
而这个 App 的动作大多不需要被看。

### 时长档位

| 档 | 时长 | 用在哪 |
| --- | --- | --- |
| 快 | 120–150ms | 悬停反馈、颜色与透明度变化、图标状态切换 |
| 标准 | 180–220ms | 面板展开收起、浮层出现、页面切换 |
| 慢 | 300ms 以上 | 只给「确实需要时间」的过程（进度、加载） |

超过 300ms 的动效在桌面工具里一律视为过长 —— 界面会显得迟钝。

### 退场比入场快

同一个元素的收起用**比展开更短**的时长（面板：退 150ms / 进 220ms）。
收起是用户明确不要这块内容了，慢吞吞地缩回去会让人等；
展开是用户要看到东西，值得铺开。

### 空间位移与不透明度分开做

宽度变化时内容会被拉长/压扁，所以**只让宽度参与过渡**，内容自己淡出 ——
整块淡入淡出会让文字在拉伸中糊掉。

退场的淡出总时长不要超过宽度过渡，否则显得迟钝；也不要在淡出前留一段
「没反应」的延迟（`transition-delay` 会把 opacity 和 visibility 一起拖住，
看起来就是先卡住再消失）。做法是 opacity 立即开始过渡、visibility 延迟到
淡完那一刻再切。

### 减弱动效要有退路

所有空间位移（宽度过渡、缩放、滑动）都要带 `motion-reduce:transition-none`
或等价的 `prefers-reduced-motion` 分支，命中系统级「减少动态效果」时直接跳到位。
不透明度变化可以保留 —— 淡出是状态反馈，不是空间位移。

当前已覆盖：四个可折叠侧栏（笔记 / 题单 / 应用 / 快捷，2026-11-05 补齐）
与 `AppLogConsole`。**另有五处位移动效待补** —— PetSpeechBubble、
FloatingAiAssistant、BrowserSidePanel、AiChatPanel、NoteFileList，
见走查任务单 P1-9。**新写的位移动效默认要带这一档。**

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
  **不**用 border 颜色切换，也不用 1px 的细环
- **Height:** 36px（标准）
- **Label:** 字段标题用 `text-sm font-medium text-foreground`，
  helper text 用 `text-label text-muted-foreground`
- **不**用 placeholder 充当 label（无障碍要求）；label 与控件用 `htmlFor` + `id` 关联
- **不**给次级文字叠透明度档（`text-muted-foreground/70` 是 2.67:1，取更差列），
  也不写任意值字号（`text-[11px]` → `text-label`）

### Status Badge（已配置/未配置）

- **Shape:** `rounded-md`（6px）
- **Active:** `bg-primary/10 text-primary-strong border-primary/25`
- **Idle:** `bg-background text-muted-foreground border-border/70`
- **Dot:** 6px 圆点，`bg-primary` 或 `bg-muted-foreground/40`
- **用法:** OCR / AI 配置状态、记忆索引记录数

> **为什么文字换成了 `--primary-strong`、闲置底色换成了 `--background`。**
> 徽章文字是 11px，走正文那条 4.5:1 的线。原配方 `bg-primary/10 text-primary`
> 只有 4.14:1（取更差列）—— 品牌色压在品牌浅底上读不出来；
> 换成 `text-primary-strong` 在 `bg-primary/10` 底上是 5.05:1（取更差列；
> 白底 5.26:1，无底纹处 6.01:1，同一个 195° 色相，深一档），
> 看着仍然是「品牌色」，但读得清。
> 闲置徽章原来 `bg-muted text-muted-foreground/70` 只有 2.53:1
> （透明度档叠在浅底上必然掉），改成 `bg-background text-muted-foreground`
> 是 4.61:1；闲置态用「白底 + 灰字 + 灰边」表达，比一块灰底更安静。
> 徽章底色**不许超过 `/15`**（`/20` 是 4.41:1）。
> 圆点是**冗余装饰**（信息在文字里），3:1 的图形线对它不适用；
> 但哪天圆点改成承载语义（比如红点=错误），必须用语义色实心值。

### Floating AI Panel（招牌组件）

- **状态:** 折叠（球 56×56） / 展开（卡片 380×560）
- **锚点:** 右下角，固定 right/bottom 偏移
- **球:** `rounded-full bg-primary`，hover `scale-105`，drag `cursor-grab/grabbing`
- **卡片:** `rounded-xl border border-border/60`，`shadow-2xl`（4px 角对应 380px 宽，整体更克制）
- **Header:** 含 Bot icon block（28×28）+ 标题 + 副标题（"思考中..." / "可拖动定位"）+ 清空 + 收起按钮
- **跨窗口同步:** 位置和展开状态通过 IPC 广播给所有 Electron 窗口
- **关键交互:** 单击 vs 拖动用 3px 阈值 + `suppressNextClickRef` 区分

### Sidebar（侧栏）

这个 App 里有**两种**侧栏，别混：

**① 应用导航侧栏**（`components/core/AppSidebar.tsx`，窗口左缘）

- **Width:** `16rem`（256px），折叠态 `3.5rem`（56px），可拖到 152px
- **Background:** `bg-sidebar` —— 它等于 `--app-frame`（与标题栏同色，
  两者合成同一个外框，中间不露接缝）。**不是**「极浅 teal 调」
- **Nav Item:** `hover:bg-sidebar-accent`，激活 `bg-sidebar-primary text-sidebar-primary-foreground`
  （激活态只有底色 + 前景色，不叠阴影 / 描边 / 强调条）
- **顶部:** 不设品牌区。顶部只留 40px 让位给标题栏
- **Footer:** 收起/展开 toggle —— 复用导航项的样式，读作「列表的最后一行」
- 导航用 `<Link>`（真 `href`），不用 `<a onClick>`

**② 内容侧栏**（可折叠 + 可拖拽，四页共用）

统一走 `components/panel/` 的通用件，不各写一套：

- **折叠:** `ResizableSidebar`；折叠轨宽 48px、切换按钮 32px、锚点 8px
  （`panel/layout.ts` 的共享常量，四个页面同一套几何）
- **拖拽:** `PanelResizer`（7px 热区，作为 flex 子节点真实占位）
- **宽度:** 默认 288px。下限统一 220px；上限按页面取
  —— 笔记页 560、应用页 560、浏览器页 720，且都要给主内容区留 360px
- **持久化:** 宽度走 `usePanelWidth`，折叠态走 `useCollapsedState`（都存 localStorage）

### 组件地图

改界面前先在这张表里找现成的，别造新的：

- `components/ui/` —— shadcn/ui 基础件（button、dialog、popover、tooltip、toast、
  input、select、switch、sheet、sidebar 等 18 个）。**先复用，再自己写。**
- `components/panel/` —— 通用面板件：`ResizableSidebar`（可折叠侧栏）、
  `PanelResizer`（拖拽分割线）、`layout.ts`（共享几何常量）
- `hooks/usePanelWidth.ts` / `hooks/useCollapsedState.ts` —— 宽度与折叠态的持久化
- 其余 `components/<域>/` —— 业务件（笔记、题单、应用、剪贴板、快捷方式、待办…），
  **不跨域复用**

## States（空 / 加载 / 错）

每个列表、每个面板都要有这三态，缺一态就算没做完：

- **空态** —— 一句说明 + 一个动作入口。不要只写一行「暂无数据」；
  告诉用户这里将来会有什么、现在该做什么
- **加载态** —— 骨架屏（`ui/skeleton`）或明确的进度指示。
  不要只把按钮置灰，那读不出「在加载」还是「不能点」
- **错误态** —— 说清发生了什么 + 能做什么。toast 用 `variant="destructive"`，
  或就地提示

空态插画/图标可以动，但动效必须克制：一个方向、2.5s 以上的慢循环、
`prefers-reduced-motion` 下停掉。**不要**用弹跳强调空态。

## Accessibility（可访问性基线）

完整口径在 `docs/UI-GUIDELINES.md` 第五节，这里只列不可让步的几条：

- 正文对比度 ≥ 4.5:1，大字与图形 ≥ 3:1；焦点指示器与相邻颜色 ≥ 3:1
- **焦点指示器厚度 ≥ 2px**，全应用同一档（按钮、输入框、下拉、分割线）
- **纯图标按钮必须有 `aria-label`**，且名称要能区分同组重复控件
- **看不见的控件必须移出焦点序** —— 用 `visibility: hidden` 或 `inert`，
  不能只靠 `opacity-0` + `pointer-events-none`（那只挡鼠标）
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
- **Don't** 为不同卡片挑不同强调色（之前的 6 色万花筒）—— 现在统一 accent + neutral 两套主题
- **Don't** 让卡片标题用 1 个 18px 文字 + 巨大空白 —— 用 15px 紧凑标题 + 副标题分层
- **Don't** 浮框 / 卡片用多层渐变背景（`shadow-2xl shadow-primary/40` 等）—— 单层 shadow 就够
- **Don't** 红色 success 反馈用 `--primary` 替代 —— 用户的认知期望"绿色=成功 / 红色=危险"
- **Don't** 表单字段靠 placeholder 充当 label —— label 必须可见
- **Don't** 用 `opacity-0` + `pointer-events-none` 藏可聚焦控件 —— 键盘仍能 Tab 进去，
  用 `visibility: hidden` 或 `inert`
- **Don't** 用 1px 的焦点环 —— 全应用统一 2px

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
