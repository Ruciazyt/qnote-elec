# 界面规范（UI Guidelines）

> 这份文档是 QNote 渲染层的**走查清单**。界面改动完成后按这里的条目逐条核对，
> 走查结论按「文件与位置 → 违反哪条 → 具体怎么改」的格式交给对应域的 Bot。
>
> **依据**：`src/renderer/components.json`（shadcn/ui，new-york 风格、neutral 基础色、
> cssVariables 开启、lucide 图标）、`src/renderer/tailwind.config.js`（设计 token）、
> `src/renderer/index.css`（CSS 变量与自定义类）。
>
> **通用组件**在 `src/renderer/components/ui`，共 18 个：button、calendar、card、dialog、
> input、label、popover、progress、select、separator、sheet、sidebar、skeleton、switch、
> textarea、toast、toaster、tooltip。**先复用，再自己写。**

---

## 一、组件复用

- [ ] 交互控件优先用 `ui/` 里的现成组件，不重复造轮子
- [ ] 图标只用 `lucide-react`，尺寸靠类控制（不靠 viewBox 缩放）
- [ ] 弹窗用 `dialog`、浮层用 `popover`、轻提示用 `tooltip`、操作结果用 `toast`
- [ ] 通用能力（可折叠侧栏、拖拽分割线、宽度偏好）用 `components/panel/` 里的共享件，
      新的可折叠侧栏一律套 `ResizableSidebar`，不各写一套（AGENTS.md 6.4）

## 二、Token

### 语义色 token 的命名与层级口径

本节定的是**口径**，不是具体改法；`tailwind.config.js` 与 `index.css` 属渲染层全局配置，
多 Bot 同时改容易撞车，改动由单一域 Bot 落地。

- **命名与 CSS 变量同名**：`--success` → 工具类 `success`。不要另起名字
  （`success2` / `brand-green` / `ok-color` 这种一律不行）—— 变量名与类名对不上，
  查一个 token 要翻两个地方。
- **成对带 foreground**：`success` / `success-foreground`，
  注册在 `extend.colors` 里，位置紧跟 `destructive` 之后（语义色一组）。
- **用法**：`text-success` / `bg-success` / `text-success-foreground`；
  底色用透明度档（`bg-success/10`、`bg-success/15`），不要写死浅色。
- **语义映射**：成功、已完成、通过 → `success`；危险、删除、不可逆 → `destructive`；
  中性、次要、占位 → `muted` / `muted-foreground`。
  **不要再用调色板原色**（`green-600`、`red-500`、`gray-400`、`bg-gray-50`）——
  它们不跟随主题，暗色模式下会跑偏。
- **两套值都要给**：`index.css` 的 `:root` 与 `.dark` 各一份 CSS 变量，
  语义 token 由这两个值派生，深浅色自动跟随。
- **一个主题只留一处定义**。同一个 `:root` 里写两遍同名变量，后面的会覆盖前面的 ——
  而且被覆盖的那份往往带着更完整的注释，看起来像"更正确的设计"，实际是死代码。
  （`--success` 就踩过：`:root` 里 `152 60% 32%` 与 `152 64% 42%` 各写一次，
  生效的是后写的 42%，前一份带注释的深绿从来没生效过。
  重复定义已于 2026-11-04 去掉，每主题各留一份；取值另按下一条定。）
- **值按最严的使用场景定**。同一个 token 既当文字色又当底色时，
  按文字的对比度要求定值，底色/描边用透明度档往浅里调；
  反过来一个值扛不住两种对比度要求，就**再开一个 token**（浅色档给底色描边、
  深色档给文字），不要靠 `/80`、`/90` 硬调出中间值 —— 那只会得到一个两边都不合格的色。
  （`--success` 的定值：浅色 `152 60% 32%`、暗色 `152 58% 55%`。
  浅色这一档是算出来的不是挑出来的：42% 的绿当文字色，落在白底卡片
  （`--card: 0 0% 100%`）上只有 2.79:1，10px 的徽章小字过不了 4.5:1；
  32% 是 4.73:1，刚过线 —— 余量不大，所以徽章文字必须用实心值，不能再叠 `/80`。
  暗色 55% 在深色卡片底（`--card: 220 15% 12%`）上是 9.0:1，已远超标准，
  不必再往上提亮：提到 62% 只多 0.7:1，却让 15 处自定义绿色动画
  （复制成功、保存成功 flash）整体亮一档，且与暗色 `--destructive`（同为 55%）不齐。）
- **`--warning` 的定值**：浅色 `38 70% 35%`、暗色 `48 85% 60%`。
  浅色这一档取 35%：三个语义色在浅色主题下的对比度要落在**同一档** ——
  `--success` 4.73:1、`--warning` 4.76:1、`--destructive` 4.80:1，
  视觉权重一致，警告色不会比成功色更轻、也不会比危险色更重。
  再深到 32%（5.50:1）没必要，那会读成深棕、比成功色还重。
  hue（38°）与 saturation（70%）不动：加深只压亮度、不压色相，与 `destructive` 的色差
  几乎不变（ΔE 55.4 → 55.2）；而把 saturation 提到 75% 反而与 `destructive` 更近（54.2）、
  对比度还更低（4.64），两头都不划算。
  **这条 token 现在就在用**，不是「为将来定值」——
  `components/core/titleBar.css` 的最大化/还原按钮 hover 态直接取 `hsl(var(--warning))`
  （不走 Tailwind 类，所以 grep `text-warning` 看不到它）。浅色主题下标题栏底是
  `--app-frame`（`0 0% 94%`），改前 2.63:1 连图形元素的 3:1 线都不到，改后 4.18:1 过线。
- **文字不要用透明度档**：语义色做文字必须用实心值（或 `text-foreground`），
  `/80` 叠在白底上对比度会掉到 2~3:1，连小字都过不了 4.5:1。
- **没有对应语义 token 的信息色**：难度徽章这类要现定映射 ——
  easy → `success`、medium → `muted`、hard → `destructive`，
  **语义色做底色（浅色调，如 `bg-success/15`）、文字用 `text-foreground`**。
  不要把语义色当文字色：落在同色 15% 浅底上只有 3.9:1 左右，过不了 AA 4.5:1；
  换成「浅底 + 语义色字 + `text-foreground` 字」后实测浅色 10.02 / 10.58 / 9.63、
  暗色 9.74 / 10.68 / 11.47（无头 Electron 像素实测，文字取字形核心像素、
  底色取出现次数最多的像素）。这是量出来的结论，不是口味问题。

- [ ] 颜色只走语义 token，不写死色值：`bg-background`、`bg-card`、`bg-muted`、
      `text-foreground`、`text-muted-foreground`、`border-border`、`bg-primary`、
      `text-destructive`、`bg-accent`、`text-accent-foreground`、`ring-ring`
- [ ] 侧栏用 `--sidebar-*` 一族（`bg-sidebar`、`text-sidebar-foreground`、
      `border-sidebar-border`、`text-sidebar-primary`）；**面板内部的内容区不要再用
      sidebar token**，那一列已经是内容面板的一部分
- [ ] 圆角走 `--radius`（`rounded-md` / `rounded-lg`），不自己写 px 半径
- [ ] 字号走 Tailwind 阶梯（`text-xs` / `text-sm` / `text-lg`），不写死 px
- [ ] 阴影用 `shadow-sm` / `shadow-md` 这一档，不用内联 `box-shadow`
- [ ] 尺寸用语义类（`h-8 w-8`），不用 `style={{ width: 32 }}`

### 全局配置文件的修改归属

`index.css` 与 `tailwind.config.js` 是渲染层全局配置，多 Bot 同时改容易撞车。
2026-11-04 起按下面三条执行：

1. **同一轮同一文件只允许一个 owner 改**。被指派改这个文件的 Bot 就是该文件本轮 owner，
   其它 Bot 不碰。
2. **token 层由 @UI设计校验 汇总执行** —— 它维护本节口径。其它 Bot 发现 token 缺失
   或不合规，走「提需求给 @UI设计校验」或提给 Chief 当轮指定 owner，不自己动手。
   `tailwind.config.js` 里与构建/插件相关的部分归 @质量发版。
3. **一次只改一件事**：token 取值修正与注册补齐分成两次改动。
   （`--warning` 的取值修正与 1.8.0 那次注册补齐已经是两次。）

## 三、间距与尺寸

- [ ] 图标按钮 32×32（`h-8 w-8`）；行内小图标按钮 ≥ 24×24（WCAG 2.5.8）
- [ ] 同一行相邻图标按钮之间留 `gap-1` 或 `gap-2`，不允许 0
- [ ] 同一页里内容区的左右内边距统一（一页之内不出现两种）
- [ ] 面板/侧栏头部标题统一 `text-sm font-medium` + `text-foreground`；
      标题右侧计数与副信息统一 `text-xs text-muted-foreground/60`；
      页面主标题 h1 用 `text-xl font-bold`，不属这条；
      不用 `text-foreground/80`、`/85` 这类中间档
- [ ] 列表项之间统一 `space-y-2`

## 四、交互状态

- [ ] 每个可点元素有 hover 反馈
- [ ] 键盘可达：Tab 顺序与视觉顺序一致，Esc 能关掉弹层
- [ ] 焦点可见（见第五条的厚度要求）
- [ ] `disabled` 有明确视觉区分（`opacity-50` / `opacity-40`）
- [ ] loading 有明确文案或图标，不能只是把按钮置灰
- [ ] error 有文案：toast 用 `variant="destructive"`，或就地提示
- [ ] 空态 / 加载态 / 错误态三件套齐全，空态不要只写一行字
- [ ] **破坏性操作的确认框必须点名目标**，口径见第十节「破坏性确认框文案口径」
- [ ] 破坏性确认框用 `ui/dialog`（不要手写 `fixed inset-0` 的遮罩层）

## 五、可访问性

- [ ] 纯图标按钮有 `aria-label`（**没有可访问名称的图标按钮是硬伤**）
- [ ] **同一组重复控件的可访问名称要能互相区分**：列表里每行的按钮，名称里带上
      该项的标识（题目标题、条目名），否则读屏用户在列表里分不清是哪一行
- [ ] `aria-label` 用**全名**（带区分信息），`title` 用**短名**（鼠标看的那句）。
      两者不一致时以 `aria-label` 为可访问名称，`title` 只是原生悬停提示 ——
      哪天真要统一去掉原生 `title`，名称仍然成立，测试按名称定位也不受影响
- [ ] 展开/收起类按钮有 `aria-expanded`
- [ ] 表单控件有关联标签（`htmlFor` + `id`）
- [ ] 可点击的非 `button` 元素有 `role`、`tabIndex` 与键盘事件
- [ ] 正文对比度 ≥ 4.5:1，大字与图形 ≥ 3:1；焦点指示器与相邻颜色 ≥ 3:1
- [ ] **焦点指示器厚度 ≥ 2px**（WCAG 2.2 SC 2.4.11）。
      基类 `components/ui/button.tsx` 已于 2026-11-04 由 `focus-visible:ring-1`
      改为 `focus-visible:ring-2`（单独一次提交，不夹在别的改动里）。
      依据：1px 环面积 = 1px × 128px 周长 = 128px² < 2px 周长所需的 256px²，不达标。
      仓库里本来就有 2px 的先例 —— `index.css` 的 `.button` 是 `ring-2 + ring-offset-2`、
      `.note-row` 是 `outline: 2px solid`，基类改 ring-2 是向既有做法对齐，不是引入新做法。
      注意两套环的**位置**不同：一个带 2px offset、环与按钮之间有空隙；一个贴着按钮边画。
      厚度一致之后观感仍要各看一眼，别只核数字。
- [ ] **看不见的控件必须移出焦点序**。只写 `opacity-0` + `pointer-events-none`
      挡不住键盘 —— `pointer-events-none` 只管鼠标，里面的按钮仍在 Tab 序里：
      键盘用户会 Tab 到看不见的控件上，焦点框消失、读屏却念出按钮名。
      用 `visibility: hidden`（或 `inert`），并保留一段淡出过渡。
      折叠态的标题区、操作区、内容区三块都要这样处理，不能只处理其中一块。

## 六、跨页一致性

- [ ] 同类界面（侧栏、列表卡片、头部行、空态）在不同页面间样式一致
- [ ] 侧栏折叠态几何符合第七节的基准
- [ ] 侧栏**头部行的左沿 = 该页内容列的左沿**（展开态）
- [ ] 面板/侧栏头部标题与计数的字号按第三节「面板/侧栏头部标题统一」那一条；理由见第十一节
- [ ] **面板边界线统一**：展开态一律 1px 语义边框 `border-border/60`（不分强度档）；
      折叠态用**等价 inset 阴影**画同一条线，不占内容盒 ——
      右缘 `inset -1px 0 0 0 hsl(var(--border) / 0.6)`、
      左缘 `inset 1px 0 0 0 hsl(var(--border) / 0.6)`，
      与展开态颜色完全等价，两态切换时线的位置不动。
      竖向拟态投影类 `neu-divider-r` 已从 `index.css` 删除（2026-11-04 落地），
      竖向分栏一律用上面这条；横向 `neu-divider-b` 保留，仅用于工具栏下缘。
      浏览器页侧栏头部那条 `border-border/50` 统一到 `/60`。
      理由见第十一节
- [ ] 侧栏折叠按钮的悬停提示三页同一种做法（统一用 `ui/tooltip`）
- [ ] **图标按钮的悬停提示跟同页邻居一致**。本仓库现状是两套并存：
      工具栏、列表行里的图标按钮用原生 `title` + `aria-label` 成对
      （`BrowserPage.tsx` 的新建/后退/前进/刷新/收藏夹等）；
      主要操作与需要解释的按钮用 `ui/tooltip`。
      同一页面里不要一半原生一半 Radix。原生 `title` 的代价：样式不可控、
      悬停约 1 秒后才出现、键盘聚焦时不出现

---

## 七、侧栏折叠态几何基准

以下数值是用仓库真实构建产物（`dist/renderer/assets/index-*.css`）在 Chromium 里
实测出来的，量的是真实 DOM，不是推算。

**几何基准由 `components/panel/layout.ts` 的共享常量定义**：

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `PANEL_COLLAPSED_WIDTH` | 48 | 折叠轨外宽 |
| `PANEL_COLLAPSED_BUTTON_SIZE` | 32 | 折叠态切换按钮边长 |
| `PANEL_COLLAPSED_BUTTON_INSET` | 8 | 折叠态按钮距轨道左沿 |
| `PANEL_HEADER_PADDING_X` | 8 | 展开态头部行左右内边距 |

因为 `PANEL_COLLAPSED_BUTTON_INSET === PANEL_HEADER_PADDING_X === 8`，
**折叠态与展开态的按钮左沿相同 → 切换时按钮零横向位移**，这是四页共同的基准。

**唯一约束式**

```
折叠轨宽 = 2 × 展开态头部左内边距 + 按钮边长
```

取 `48 = 2 × 8 + 32` 时，折叠态与展开态的按钮都落在 **8..40**：
零横向位移，同时展开态按钮的左缘与内容列左缘齐平、不探出内容列。

所以「折叠↔展开的横向位移是固有取舍、只能二选一」这个说法**不成立** ——
只要这条等式成立，位移就是 0。改轨宽、头部内边距、按钮边长里的任何一个，
都要连着改另外两个，否则等式一破，位移就回来了。

| 场景 | 轨道宽 | 折叠按钮落点 | 距左沿 | 距右侧分隔线内侧 | 按钮距轨道顶 |
| --- | --- | --- | --- | --- | --- |
| 笔记页 `pages/NotesPage.tsx` | 48（inset 阴影，不占内容盒） | 8..40 | 8px | 8px | 8px |
| 题单页 `Leetcode/SideBar.tsx` | 48（inset 阴影，不占内容盒） | 8..40 | 8px | 8px | 8px |
| 应用页 `panel/ResizableSidebar.tsx` | 48（inset 阴影，不占内容盒） | 8..40 | 8px | 8px | 8px（`h-12` + `pt-2`/`pb-2`，内容盒正好 32px） |
| 快捷方式面板 `shortcut/ShortcutPanel.tsx` | 48（inset 阴影，不占内容盒） | 8..40 | 8px | 8px | 8px |

五条规则：

1. **折叠态按钮用固定 padding 锚定，不用 `justify-center` 居中**。
   轨道带 1px 边框时内容盒只有 47px，居中会算出 7.5px 的小数偏移；
   更要紧的是**宽度过渡期间轨道还是宽的**，居中会把按钮摆到轨道中线 ——
   收起那一帧按钮会先跳到 (轨道宽−32)/2 再滑回来，看着就是横跳一下
   （旧实现实测：轨道 288px 时按钮落在 128px 处，滑到 48px 时才回到 8px）。
   「固定锚定」是唯一能保证按钮落在整数 8px 的办法；
   `justify-center` 只在轨道确定不占内容盒时才等价（快捷方式面板就是这种：
   它用 inset 阴影画分隔线，内容盒是完整的 48px）——
   但那种写法依赖「以后没人加边框」，能用固定锚定就别用居中。
2. **分隔线不要占内容盒**（折叠轨）：需要一条边界时用 `inset` 阴影，
   不要用 `border` —— 边框会让内容盒少 1px，折叠轨上居中的按钮就不再左右对称
   （47px 内容盒 + 8px 锚点 = 右边留白 7px、左边 8px）。
   四条轨的折叠态统一用 inset 阴影：右缘 `inset -1px 0 0 0`、
   左缘 `inset 1px 0 0 0`，颜色 `hsl(var(--border) / 0.6)`，与展开态那条实线等价。
   **展开态那边可以留 `border-border/60` 实线** —— 它的边框在**与切换按钮相反的一侧**
   （左侧面板的边框在右、右侧面板的边框在左），不吃按钮的锚点。
3. **折叠态那一行不许溢出轨道**：行内容宽必须 ≤ 轨道内容盒，
   且折叠态的 `gap` 必须是 0 —— 标题与操作区白占宽度要归零（`w-0`），
   `gap` 照样占位，会把按钮整体往右推。
   曾经的反例：题单页折叠态行是「按钮 36 + 左右各 16px 内边距」= 68px，
   在 39px 的轨道里两侧各溢出 14.5px，整行（连同点击区域）铺到轨道外面。
   **折叠轨里除切换按钮以外的其它可点区**（如竖排标签）另起一行，
   不要和按钮排在同一行 —— 同一行就会挤走按钮的锚点。
4. **展开态按钮与内容列左沿对齐**，且头部行的左右内边距与内容列一致。
   同一页里出现 8px / 12px 两种左沿就是没对齐 —— 路径行、列表容器、
   卡片列表都该与头部行取同一个值。
5. **折叠按钮的 focus 描边四边都要露得出来**：描边是向外扩 1px，
   所以按钮距轨道任一边缘至少要留 2px。实测四条折叠轨的余量：
   左侧 7px、右侧 6~7px、顶部 3~8px —— 都在轨道内侧，没有被
   `overflow-hidden` 裁掉。竖排标签那种占满整条轨的按钮，
   它的描边会左右各探出轨道 1px（无害，但要知道它不是在轨道内侧）。

## 八、边界态

- [ ] 长文本用 `truncate` + `title`，并给父级 `min-w-0`
- [ ] 窄窗口：侧栏有最小宽度，主内容区不被挤没
- [ ] **折叠/隐藏区域的退场动效，三块区域要一致**：同一面板里标题区、操作区、
      内容区的退场时长与节奏必须一致 —— 别一块淡出、一块瞬间消失。
      淡出总时长不要超过面板的宽度过渡（220ms），否则会显得迟钝；
      也不要在淡出前留一段「没反应」的延迟：`transition-delay` 会把 opacity 和
      visibility 一起拖住，看起来就是先卡住再消失。
      做法是 opacity 立即开始过渡、visibility 延迟到淡完那一刻再切：
      收起 `[transition:opacity_150ms,visibility_0s_150ms]`、
      展开 `[transition:opacity_150ms,visibility_0s_0ms]`。
      （`transition-opacity` 只过渡 opacity，visibility 不在列表里会**立即**切换，
      等于没有淡出；`transition-[opacity,visibility]` 则能被 `tailwind-merge`
      正确合并成一条。）
- [ ] **展开/收起动画期间内容不溢出到相邻区域**。
      宽度过渡时头部行的内容宽度是瞬间切换的，轨道还没长开时头部行就已是展开态的宽度，
      标题与操作按钮会画到右侧主内容区上。
      实测（真实构建产物 + 真实 DOM）：
      - 题单页溢出 99px（头部行有按钮 + 标题 + 两个操作按钮），已加 `overflow-hidden` 修掉；
      - 笔记页展开态头部行只有按钮 + 标题，标题元素盒右缘仍超出轨道 **14px**、
        持续 **约 40ms**（轨道宽度从 48px 涨过 62px 那段）——
        盒宽被压到 14px（单个汉字的 min-content），两个字换行竖排，
        墨迹随之画到轨道右缘之外（轨道右缘 x=48、标题盒右缘 x=62，越出 14px），
        压在右栏工具条上。
      处理办法：给头部行加 `overflow-hidden`，或用共享组件 `ResizableSidebar`
      （它的 `aside` 带 `overflow-hidden`，标题与操作区在收起态被
      `w-0 overflow-hidden opacity-0` 包住）。
      **加 `overflow-hidden` 时必须同时把上下留白从外边距换成内边距**：
      裁剪区是元素自己的 padding box，`mt-2`/`mb-2` 在盒外 —— 用外边距时行盒正好从按钮
      上边缘开始，focus 描边向外扩的那 1px 会被裁掉（实测只剩左右两条竖边）。
      正确写法是 `pt-2`/`pb-2`（与题单页、应用页一致）。
      像素判定（轨道右缘外侧 40×36 取样条里的深色像素数）：
      当前实现 **434 个**（墨迹确实画出去了）→ 加 `overflow-hidden` 后 **0 个**；
      描边像素：只加 `overflow-hidden` → 描边被裁掉；
      换用 `pt-2`/`pb-2` → 描边完整可见（按钮上缘比行上缘低 8px）。

## 九、测量方法

几何类问题不要靠读 class 推算，用真实 CSS 量真实 DOM。

**优先跑真实渲染层**（办法见第 8~11 条）：真实组件 + 真实构建产物，
量出来的就是用户会看到的行为，不会因为复刻时漏了某个条件而算错。
下面 1~7 是只隔离某一条规则时的复刻办法：

1. 先 `pnpm run build:react`，用产物 `dist/renderer/assets/index-*.css`（含真实 token
   与自定义类）
2. 写一个复刻目标结构的 HTML，引用该 CSS
3. 用 Electron 无头加载，`webContents.executeJavaScript` 量 `getBoundingClientRect`
4. 焦点态要用**真实键盘事件**（`sendInputEvent` 发 Tab）才能触发 `:focus-visible`；
   脚本里 `element.focus()` 不触发，量到的会是 `box-shadow: none`
5. **`:focus-visible` 只在「窗口已显示且已获焦」时成立**。实测四种情况：
   隐藏窗口（`show:false`）+ 程序化 `element.focus()` → 不成立；
   隐藏窗口 + `sendInputEvent` 发 Tab → 不成立；
   隐藏窗口 + `win.focus()` + Tab → **仍然不成立**；
   显示的窗口（哪怕放在 `x:-3200, y:-3200` 的屏幕外）+ `win.focus()` + Tab → 成立。
   不成立时量到的是 `box-shadow: none`，很容易被误读成「样式没生效」。
6. Tab 的落点是**有记忆的**（顺序焦点导航的起点会留在上次的位置），
   别写死按 N 次 Tab 就以为停在该元素上 —— 循环 Tab 到 `activeElement.id` 命中为止。
7. 要判断 `box-shadow` 的某一段画在元素的哪一侧，别靠推算：
   建一个 48×40 的测试块（纯色底 + 指定 inset 阴影），`capturePage` 后
   逐列采样像素，看哪一列被染色。`inset 1px 0 0 0` 画在**盒内左侧**。
8. **窗口要可见而且要有焦点**，否则过渡动画根本不会跑。
   隐藏或未获焦的窗口里 Chromium 把 `requestAnimationFrame` 压到 1~2fps，
   采样会只拿到 1 帧、轨道宽度一直停在起点 —— 看起来像「没有动画」，
   其实是窗口状态问题。`win.showInactive()` 之后还要 `win.focus()`。
9. 采样用 `setTimeout` 而不是 `requestAnimationFrame`：过渡是按时间插值的，
   定时器采样照样拿到每一刻的真实值，而且不受上面那条节流影响。
10. **判断「有没有真的画出去」要看像素，不能只看 `getBoundingClientRect`** ——
    `overflow:hidden` 只裁绘制，不改布局，几何值照样是溢出的。
    取样条放在侧栏右缘外侧，`capturePage` 后数条带里的深色像素；
    要在溢出状态里抓图，就把 `transition-duration` 临时调大（慢放）再点展开。
11. 跑真实渲染层不需要接主进程：给 `window.electron` 挂个桩就行。
    桩要用 **普通对象**，`contextBridge` 克隆不了 Proxy（preload 会直接加载失败）；
    测量台可以用 `contextIsolation: false` 直接把 Proxy 挂到页面 `window` 上。
12. **只测盒模型不必跑整包构建**：在 `src/renderer` 下用仓库自己的 Tailwind 配置
    编一小份 CSS 即可（`node_modules/.bin/tailwindcss -c tailwind.config.js
    -i in.css -o out.css --content "<要测的 html>"`），真实盒模型由这份产物决定，
    几秒出结果。**`--content` 必须指到复刻页**，否则那些任意值类名不会被生成，
    量到的全是浏览器默认值 —— 表现是「类名写了但没生效」，很容易误判成代码有问题。
13. **想知道「那个位置屏幕上到底是谁」，用 `elementFromPoint`**：
    比像素采样便宜，也能区分「几何溢出」与「真的画出来了」——
    命中溢出元素 = 墨迹真的盖在相邻区域上；命中相邻区域 = 已被裁掉。

（仓库里已有一份现成的：`.data/uicheck/measure.html` + `measure.js`，
`.data/` 已在 .gitignore 里。

真实渲染层测量台：`.data/uicheck/measure-real.js`（主脚本）+
`probe.js`（页面内探针）+ `stub-preload.js`（`window.electron` 桩）。
起一个本地 http 服务加载真实构建产物 `vite build --outDir .data/uicheck/rb`，
不接主进程、不碰用户数据，量的是真实组件 + 真实 CSS。）

---

## 十、破坏性确认框文案口径

凡是「删掉就没了」的操作，确认框按这套写。适用范围：删题单、删笔记、删文件夹、
删应用项目、清空聊天记录、删账号等。

**结构**（用 `ui/dialog`）：

```
DialogTitle       删除题单                                     ← 动作 + 对象类别，不带名字
DialogDescription 确定要删除题单「动态规划专题」吗？              ← 一句话，点名目标
                  此操作不可逆！                                ← 单独一行
DialogFooter      取消                    确定删除
```

**七条口径**

1. **标题不带名字**。写动作 + 对象类别（「删除题单」「删除文件夹」），具体名字放正文。
   标题是弹窗的可访问名称，要短。
2. **正文必须点名**。句式固定为「确定要删除{对象类别}「{name}」吗？」——
   动词、对象类别、目标名三段齐全，缺一段就等于没说是哪一个。
3. **名字逐字来自数据**，不缩写、不改写、不省略后缀。禁止用「这个」「该」「上述」
   「它」这类指代：读屏用户和多人协作场景里都指不准。
4. **名字用「」包住**，样式 `font-medium text-foreground`（正文本身是
   `text-muted-foreground`，目标名要能从正文里扫出来）；长名加 `break-all` 防溢出。
5. **不可逆提示单独一行**，`text-destructive font-medium`，不要和正文挤在同一句。
6. **正文必须由 `DialogDescription` 承载**，不能只是放在一个 `<p>` 里。
   `ui/dialog` 的 `DialogContent` 不会自动生成描述 —— Radix 只有在真的渲染了
   `DialogDescription` 时，才把它的 id 接进 `aria-describedby`
   （`context.descriptionPresent ? concatAriaDescribedby(...)`）。
   放在普通 `<p>` 里 → 弹窗打开的瞬间读屏只念标题，正文里的目标名要用户自己
   往里导航才读得到。**这是全仓库的通病**（`DialogDescription` 目前 0 处使用）。
7. **触发按钮与确认框用同一个名字**：按钮的可访问名称是「删除题单：{name}」，
   弹窗正文是「确定要删除题单「{name}」吗？」—— 两处的 `{name}` 必须是同一份数据。

**测试怎么断言**：不要断言文案全文（措辞会改），断言「弹窗打开时会被朗读的那段
文本里含有目标名」：

```tsx
const dialog = screen.getByRole("dialog");
const describedBy = dialog.getAttribute("aria-describedby");
expect(describedBy).toBeTruthy();
const desc = document.getElementById(describedBy!);
expect(desc?.textContent).toContain("动态规划专题");
```

这条断言同时锁住了「用了 `DialogDescription`」和「描述里有目标名」两件事。
**不需要**再给弹窗加 `aria-label` —— 名字已经在可见文本里，加了反而多余。

---

## 十一、两条统一方案的定稿与理由

以下两条跨域规则已由 @架构师 定案，是硬规则，不再讨论。
第六节的两条即执行口径；本节记结论与理由，避免各域再自行发挥。

### 1. 侧栏分隔线

**定稿：四个面板（笔记、题单、应用页、快捷面板）用同一条线。**

| 状态 | 写法 | 说明 |
| --- | --- | --- |
| 展开态 | 1px 语义边框 `border-border/60`（左侧面板取 `border-r`，右侧面板取 `border-l`） | 不分强度档 |
| 折叠态 | 等价 inset 阴影：右缘 `inset -1px 0 0 0 hsl(var(--border) / 0.6)`，左缘 `inset 1px 0 0 0 hsl(var(--border) / 0.6)` | 不占内容盒，与展开态同色同位置 |

配套两处：

- 竖向拟态投影类 `neu-divider-r` 已从 `index.css` 删除（2026-11-04 落地）；横向 `neu-divider-b` 保留，仅用于工具栏下缘
- 浏览器页侧栏头部那条 `border-border/50` 统一到 `/60`

折叠态那条线必须与展开态**同色同位置**：切换时线不能移动，强度不能变。

**为什么是实线，不选投影**

1. **要统一就只能是全实线或全投影**。投影档会把应用页项目列表与快捷面板改成投影，
   但题单页侧栏有自己的底色、只能留实线 —— 那样同一个 App 里仍同时存在两种线，
   走查提出的「三套产品」没有解决。全投影还要改题单页面板底色，超出本轮范围。
2. **实线是全应用既有默认**。仓库里 `border-border/60` 有 39 处、`/50` 有 12 处、
   `/40` 有 8 处；用投影的只有 2 处。
3. **投影在明暗两套主题下强度差近三倍**（浅色 0.18 / 深色 0.5），
   同一条线跨页一眼能看出不是一套。
4. **笔记页原来用投影的理由在本 App 不成立**。那个理由是「同底色上实线像外框残留接缝」，
   但内容面板本身是圆角加 8px 边距的独立表面，内部一条 1px 线读作分栏线；
   而且树与编辑区之间本来就有可拖拽的分割热区，实线是唯一的静态可见分隔。

**改成实线带来的连带变化**（笔记页，改完必须实测）

笔记页的分隔线原是 `box-shadow`，向右溢出约 3px 压在右栏上，而右栏的 Excalidraw
canvas 不透明会把投影整条盖掉 —— 笔记页靠 `relative z-10` 把侧栏提成独立层叠上下文
才压住 canvas（`NotesPage.tsx` 里那段注释）。改成 1px 边框后投影不再溢出右栏，
那段 z-10 兜底可能就不需要了；但**必须实测绘图 tab 下的分隔线是否还在**，
不能只改样式不验证。

### 2. 侧栏标题字号

**定稿**

- 侧栏/面板头部标题：`text-sm font-medium` + `text-foreground`（14px）
- 标题右侧的计数与副信息：`text-xs text-muted-foreground/60`（12px）
- 唯一例外：页面主标题 h1 用 `text-xl font-bold`
- 不用 `text-foreground/80`、`/85` 这类中间档

**为什么是 14px**

1. **18px 是孤例**。全应用 bold 标题只有两处侧栏标题（笔记、题单，18px）加页面主标题，
   其余 25+ 处标题与小标题都是 12–13px medium。
2. **不写死 px**。第二节要求字号走 Tailwind 阶梯，`text-[13px]`、`text-[12px]` 本身不合规，
   只能取 `text-xs`（12）或 `text-sm`（14）。
3. **12px 与旁边的计数同级**，主次分不出来。
4. **14px 在 40px 高的头部里不挤**，与 32px 图标按钮并排也放得下。

**改完之后四个面板应各是什么样**（表里写的是目标状态，用于走查时逐行核对）

| 面板 | 文件 | 展开态分隔线 | 折叠态分隔线 | 头部标题 | 计数 · 副信息 |
| --- | --- | --- | --- | --- | --- |
| 笔记 | `pages/NotesPage.tsx` | `border-border/60`（右缘） | inset 阴影（右缘） | `text-sm font-medium` + `text-foreground` | `text-xs text-muted-foreground/60` |
| 题单 | `components/Leetcode/SideBar.tsx` | 同上 | 同上 | 同上 | 同上 |
| 应用页 | `components/panel/ResizableSidebar.tsx` | 同上 | 同上 | 同上 | 同上 |
| 快捷面板 | `components/shortcut/ShortcutPanel.tsx` | `border-border/60`（左缘） | inset 阴影（左缘） | 同上 | 同上 |

### 验收标准

- [ ] 四个面板边界线展开态是 1px `--border/60`、折叠态是同色同位置的 inset 阴影；
      两态切换时线的位置不动、强度不变
- [ ] 四个面板头部标题同为 14px medium + `text-foreground`，计数与副信息同为 12px muted
- [ ] 折叠轨按钮左右留白仍各 8px，focus 描边四边完整（第七节不回归）
- [ ] 明暗两套主题下四条边界线看起来是同一种线
- [ ] `index.css` 里不再有竖向投影类被侧栏使用

---

## 十二、走查记录

| 日期 | 页面 / 文件 | 结论 | 归属 |
| --- | --- | --- | --- |
| 2026-11-04 | `components/Leetcode/SideBar.tsx` 折叠态切换按钮 | 几何改动通过；另有 2 处必改（图标按钮无障碍名称、展开动画首帧溢出） | 浏览器工具开发 |
| 2026-11-04 | `components/Leetcode/SideBar.tsx` + `CollectionDetail.tsx` 9 个纯图标按钮补可读名称 | 通过（名称拆分与 title 用法正确）；另有 1 处必改（删除确认框未点名目标）、3 处既有问题 | 浏览器工具开发 |
| 2026-11-04 | `components/Leetcode/SideBar.tsx` 删除题单确认框文案 | 同一件必改项，本轮定稿「破坏性确认框文案口径」（第十节），并补 `DialogDescription` 要求 | 浏览器工具开发 |
| 2026-11-04 | `pages/NotesPage.tsx` 折叠轨 40→48、按钮锚定 8px | 通过（零横向位移实测成立）；建议把路径行收到 8px；题单页仍停在 40px 待同步 | 笔记开发 / 浏览器工具开发 |
| 2026-11-04 | `panel/ResizableSidebar.tsx` + `apps/AppProjectList.tsx` + `shortcut/ShortcutPanel.tsx` 折叠几何 | 6 项全部通过（居中/描边/零位移/竖排标签/深浅色一致）；遗留：跨页分隔线三种写法、侧栏标题字号三档 | 应用平台开发 |
| 2026-11-04 | 规范校准（Chief 答复后） | 第七节补唯一约束式「轨宽 = 2×头部左内边距 + 按钮边长」并删去「位移是固有取舍」的说法；第二节补语义色 token 命名与层级口径；新增第十一节两条待架构师拍板的统一方案 | UI设计校验 |
| 2026-11-04 | 规范校准（架构师定案后） | 第十一节由「待拍板」改写为「定稿与理由」：分隔线定稿为展开态 `border-border/60` + 折叠态等价 inset 阴影，标题定稿为 `text-sm font-medium` + `text-foreground`，并写入验收标准五条；第七节规则 2 的状态句同步（原文写「题单页与应用页目前是 `border-r`」，改后已不成立） | UI设计校验 |
| 2026-11-04 | 规范校准（复核后收尾） | 第三节标题条目补「不用 `text-foreground/80`、`/85` 中间档」并作为唯一完整版，第六节标题条目压缩为指向第三节的引用（同一规则原写两遍）；第二节 `success` 反例加时态并写死定值（浅色 `152 60% 32%` / 暗色 `152 58% 55%`）；`neu-divider-r` 已删除的表述同步到第六节与第十一节 | UI设计校验 |
| 2026-11-04 | 复核实测：`index.css` 的 `--success` 与 `.neu-divider-r` | `.neu-divider-r` 已删，笔记页改 1px `border-border/60` + 折叠态 inset 阴影、标题 `text-sm font-medium`、路径行 `px-2`，与第十一节定稿一致；`--success` 去重只做了一半 —— 浅色现存 `152 64% 42%` 而非口径的 32%，实心文字在白底卡片上只有 2.79:1 | 浏览器工具开发 |
| 2026-11-04 | `components/Leetcode/SideBar.tsx` 侧栏折叠/展开几何（40px 轨 → 48px 共享常量） | 通过：折叠轨 48、按钮 8..40、两态零位移（实测 0）、focus 描边四边余量 7px、内容列 `px-2` 与头部左沿同在 8px、标题 14px medium、操作按钮间距 8px；深浅两态分隔线同为 `rgba(43,50,59,0.6)`/`rgba(227,231,237,0.6)`。另有 1 处必改（删除确认框正文缺对象类别与「」） | 浏览器工具开发 |
| 2026-11-04 | `panel/ResizableSidebar.tsx` + `shortcut/ShortcutPanel.tsx` 折叠退场与焦点描边 | `invisible` 把隐藏区移出焦点序的方向正确（Tab 不再跳进看不见的「导入」）；竖排标签加 `mb-1` 后描边四边余量 3px 通过。另有 1 处必改（内容区折叠态的 visibility 不在过渡列表 → 瞬间消失，与标题/操作区的淡出不一致，且淡出前有 150ms 停顿） | 应用平台开发 |
| 2026-11-04 | `pages/NotesPage.tsx` 笔记页侧栏（真实构建产物 + 真实 DOM 实测） | 通过：折叠轨 48、展开态 `border-r` 1px、折叠态同色 inset 阴影（浅 `rgba(227,231,237,0.6)` / 深 `rgba(43,50,59,0.6)`）、两态按钮 x 恒为 176（零位移）、标题 14px/500/`text-foreground`/行高 20px、`ml-2`、头部行左内边距与路径行、文件树列同为 8px；`transition-[width]` 下边框全程 1px 不闪。另有 1 处必改（头部行缺 `overflow-hidden` → 展开首帧标题墨迹画到右栏工具条上，14px/约 40ms；改法必须连 `mt-2`/`mb-2` 一起换成 `pt-2`/`pb-2`） | 笔记开发 |
| 2026-11-04 | 四个可折叠侧栏的折叠几何一致性（笔记 / 题单 / 应用管理 / 快捷方式） | 通过：四页共用 `panel/layout.ts` 的一套数（轨 48、按钮 32、内缩 8），实测折叠态按钮一律落在 8..40、左右留白各 8px、描边外扩 1px 后仍余 7px；`layout.test.ts` 用等式锁死（轨宽 = 内缩×2 + 按钮边长、内缩 = 展开态头部左内边距），全仓再无写死的 40/44 折叠轨。遗留 1 处（笔记页头部行缺 `overflow-hidden`，与上一行同一件） | UI设计校验 |
| 2026-11-04 | 规范校准（第九节测量方法复核） | 第 5 条原写「无头窗口先 `win.focus()` 即可」不成立：实测隐藏窗口（`show:false`）无论加不加 `win.focus()`，`:focus-visible` 都不成立，只有**已显示**的窗口（可放在屏幕外）才成立，已按实测四种情况改写；补第 12 条（用仓库 Tailwind 配置单独编复刻页 CSS，不必整包构建，并提醒 `--content` 必须指向复刻页）与第 13 条（`elementFromPoint` 区分「几何溢出」与「真的画出来」） | UI设计校验 |
| 2026-11-04 | `pages/NotesPage.tsx` 头部行裁剪复验（真实渲染层） | 上一行的必改项已改并提交（`4205d80`）：头部行加 `overflow-hidden`、`mt-2`/`mb-2` 换 `pt-2`/`pb-2`。复验通过：轨道右缘外取样条深色像素由 **434 个降到 0 个**（墨迹不再画到右栏）、focus 描边四边完整（按钮上缘比行上缘低 8px）、两态几何未回归（按钮 x 恒 176、轨 48/288、浅深线色不变、标题仍 14px/500/foreground） | UI设计校验 |
| 2026-11-04 | `components/Leetcode/SideBar.tsx` + `CollectionDetail.tsx` 题单页第五节验收（交付后复核） | 三项全部结项：轨宽改走共享常量 `PANEL_COLLAPSED_WIDTH`（`SideBar.test.tsx` 已用等式锁死）、展开态 `border-r border-border/60` 与折叠态同色 inset 阴影、标题 `text-sm font-medium` + `text-foreground`；删除确认框已是 `DialogTitle` + `DialogDescription` + 句式「确定要删除题单「{name}」吗？」+ 名字 `font-medium text-foreground` + 不可逆单独一行；难度徽章按语义色做底色 + `text-foreground` 做字（实测浅色 10.02/10.58/9.63）。另修正规范一处与实现相反的表述：第二节原写徽章「浅底 + `destructive` 字」，已改为「语义色做底色 + `text-foreground` 做字」并附实测对比度 | UI设计校验 |
| 2026-11-04 | `index.css` 浅色 `--warning` 取值定案（38 70% 45% → 38 70% 35%） | 白底卡片 4.76:1，与 `--success` 4.73:1、`--destructive` 4.80:1 同档；暗色 `48 85% 60%` 不动。**事实更正**：这条 token 不是「没人用」—— `components/core/titleBar.css` 第 46~62 行最大化/还原按钮 hover 态直接取 `hsl(var(--warning))`（不走 Tailwind 类），浅色主题下标题栏底 `--app-frame`（`0 0% 94%`）上现值只有 2.63:1（图形元素的 3:1 线都不到），改后 4.18:1 过线。hover 图标会变深（#C38822 → #986A1B），属可见变化 | 架构师定案 / UI设计校验落地 |
| 2026-11-04 | `components/ui/button.tsx` 基类焦点指示器厚度（ring-1 → ring-2） | 基类改成 `focus-visible:ring-2`，满足 WCAG 2.2 SC 2.4.11（1px 环面积 128px² < 2px 周长所需的 256px²）。ring 是 `box-shadow` 不占布局，第七节几何基准未回归。仓库原有 2px 先例：`index.css` 的 `.button` 是 `ring-2 + ring-offset-2`、`.note-row` 是 `outline: 2px solid`。注意两套环位置不同（一个带 2px offset、一个贴边画），厚度一致后观感仍需各看一眼 | 架构师定案 / UI设计校验落地 |
| 2026-11-04 | `shortcut/ShortcutPanel.tsx` 快捷面板方案 E（展开态头部 + 折叠轨锚定） | 展开态头部 `h-12 + pt-2 + pb-2`、头部下缘线改等色 inset 阴影（不占内容盒：带 `border-b` 时内容盒只剩 31px，按钮落 7.5..39.5，与折叠态箭头的 8 差 0.5px）；折叠轨顶箭头由 `justify-center` 改固定右锚定（`paddingRight = PANEL_COLLAPSED_BUTTON_INSET` + `justify-end`）；竖排标签外边距升为共享常量 `PANEL_RAIL_LABEL_INSET = 4`（走行内样式，Tailwind 动态拼接类名会让外边距丢在产物里）；竖排标题与角标统一 `text-xs`（角标保留 `bg-primary/15` + `text-primary` 强调色）。九变体实测只有方案 E 上下对称（8/8）。**展开态面板左缘 `border-l border-border/60` 保留不动** —— 第十一节定稿管的是竖向面板边界线，头部下缘那条横线是另一回事 | 应用平台开发 |
