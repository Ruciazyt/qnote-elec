# 界面规范（UI Guidelines）


---

## 一、组件复用

- [ ] 交互控件优先用 `ui/` 里的现成组件，不重复造轮子
- [ ] 图标只用 `lucide-react`，尺寸靠类控制（不靠 viewBox 缩放）
- [ ] 弹窗用 `dialog`、浮层用 `popover`、轻提示用 `tooltip`、操作结果用 `toast`
- [ ] 业务组件放 `pages/<功能>/`，`components/` 只留跨页面复用的公共件
- [ ] 通用能力（可折叠侧栏、拖拽分割线、宽度偏好）用 `components/panel/` 里的共享件，
      新的可折叠侧栏一律套 `ResizableSidebar`，不各写一套（AGENTS.md 6.4）

## 二、Token

### 语义色 token 的命名与层级口径


- **命名与 CSS 变量同名**：`--success` → 工具类 `success`。不要另起名字
- **成对带 foreground**：`success` / `success-foreground`，
- **用法**：`text-success` / `bg-success` / `text-success-foreground`；
- **语义映射**：成功、已完成、通过 → `success`；危险、删除、不可逆 → `destructive`；
- **两套值都要给**：`index.css` 的 `:root` 与 `.dark` 各一份 CSS 变量，
- **一个主题只留一处定义**。同一个 `:root` 里写两遍同名变量，后面的会覆盖前面的 ——
- **值按最严的使用场景定**。同一个 token 既当文字色又当底色时，
- **`--warning` 的定值**：浅色 `38 70% 35%`、暗色 `48 85% 60%`。
- **文字不要用透明度档**：语义色做文字必须用实心值（或 `text-foreground`），
- **没有对应语义 token 的信息色**：难度徽章这类要现定映射 ——

### 品牌色与中性色的取值口径


- **`--primary` = 浅色 `195 80% 34%`**（暗色 `195 75% 55%` 不动）。
- **`--primary-strong` = 浅色 `195 80% 30%`**（暗色 `195 80% 60%`）。
- **`--muted-foreground` = 浅色 `215 12% 46%`**（暗色 `215 15% 60%` 不动）。
- **透明度档只能取档位值或方括号任意值**（2026-11-09 实测补）——
- **剪贴板弹窗有独立的 token 作用域**（`pages/clipboard-popup/popup-index.css`）。
- **改 token 前后各留一份数**：把改动前后的对比度记进本节，

- [ ] 颜色只走语义 token，不写死色值：`bg-background`、`bg-card`、`bg-muted`、
      `text-foreground`、`text-muted-foreground`、`border-border`、`bg-primary`、
      `text-destructive`、`bg-accent`、`text-accent-foreground`、`ring-ring`
- [ ] 侧栏用 `--sidebar-*` 一族（`bg-sidebar`、`text-sidebar-foreground`、
      `border-sidebar-border`、`text-sidebar-primary`）；**面板内部的内容区不要再用
      sidebar token**，那一列已经是内容面板的一部分
- [ ] 圆角走 `--radius`（`rounded-md` / `rounded-lg`），不自己写 px 半径
- [ ] 字号以 **DESIGN.md 的字阶**为唯一来源（不是 Tailwind 默认阶梯），不写死 px：
      `text-xl`（20，display）/
      `text-title`（15，卡片标题）/ `text-subhead`（13，分组小标题）/
      `text-sm`（14，正文）/ `text-xs`（12，副信息与计数）/
      `text-label`（11，徽章与 helper text）/ `text-micro`（10，超小副信息）。
      10 / 11 / 13 / 15 四档是 `tailwind.config.js` 里登记的 `fontSize` token，
      12 / 14 / 20 用 Tailwind 自带的。**已有的 `text-[Npx]` 不批量返工**
      （2026-11-05 定案：改动面大、收益不抵风险），但新写的代码不许再出现
      任意值字号；走查要碰的行顺手换成对应类名
- [ ] 阴影走四档词表：`shadow-sm`（基线：卡片/按钮/输入框）、`shadow-md`（浮层：
      popover、下拉、选中卡片）、`shadow-lg`（模态弹窗、Toast）、`shadow-2xl`（浮框卡片）；
      **不用 `shadow-xl`**，不用内联 `box-shadow`，不用彩色光晕
- [ ] 尺寸用语义类（`h-8 w-8`），不用 `style={{ width: 32 }}`

### 全局配置文件的修改归属


1. **同一轮同一文件只允许一个 owner 改**。被指派改这个文件的 Bot 就是该文件本轮 owner，
2. **token 层由 @UI设计校验 汇总执行** —— 它维护本节口径。其它 Bot 发现 token 缺失
3. **一次只改一件事**：token 取值修正与注册补齐分成两次改动。

## 三、间距与尺寸

- [ ] 图标按钮 32×32（`h-8 w-8`）；行内小图标按钮 ≥ 24×24（WCAG 2.5.8）
- [ ] 同一行相邻图标按钮之间留 `gap-1` 或 `gap-2`，不允许 0
- [ ] 同一页里内容区的左右内边距统一（一页之内不出现两种）
- [ ] 面板/侧栏头部标题统一 `text-sm font-medium` + `text-foreground`；
      标题右侧计数与副信息统一 `text-xs text-muted-foreground`（实心值 46%）；
      页面主标题 h1 用 `text-xl font-bold`，不属这条；
      不用 `text-foreground/80`、`/85` 这类中间档，
      也不用 `text-muted-foreground/60` 这类透明度档（次级文字一律走实心值）
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
- [ ] **焦点指示器厚度 ≥ 2px，且对相邻底色的对比度 ≥ 3:1**。
      厚度按 WCAG 2.2 **SC 2.4.13 Focus Appearance（AAA 级）** 的口径定 ——
      指示器区域的等效周长厚度不小于 2 CSS 像素（1px 环面积 128px²，
      2px 周长所需 256px²）。
      **这条是本项目自加的更高标准，不是 AA 强制**：
      WCAG 2.2 的 AA 级只有 SC 2.4.11「焦点不被遮挡」，
      早期版本把这条误引成 2.4.11，已更正 —— 引错条款会让后来人以为可以放宽。
      **适用范围是所有可聚焦控件**，不只按钮：
      基类 `components/ui/button.tsx` 已于 2026-11-04 由 `focus-visible:ring-1`
      改为 `focus-visible:ring-2`（单独一次提交，不夹在别的改动里）；
      `input` / `textarea` / `select` / `calendar` / `toast` 五个基类**至今仍是 ring-1**，
      见走查任务单 P0-1。
      仓库里本来就有 2px 的先例 —— `index.css` 的 `.button` 是 `ring-2 + ring-offset-2`、
      `.note-row` 是 `outline: 2px solid`，基类改 ring-2 是向既有做法对齐，不是引入新做法。
      注意两套环的**位置**不同：一个带 2px offset、环与按钮之间有空隙；一个贴着按钮边画。
      厚度一致之后观感仍要各看一眼，别只核数字。
- [ ] **焦点指示器不能只靠一层淡光晕**。`box-shadow: 0 0 0 3px hsl(var(--primary) / 0.12)`
      这样的 3px 光晕与白底只有 1.17:1 —— 看着有环、实际看不见。
      焦点态要**实心描边**（`ring-2 ring-ring`，4.72:1，取更差列；白底 4.93:1）或把边框本身换成实心品牌色；
      光晕可以叠在上面当柔化，但不能单独承担指示职责
- [ ] **看不见的控件必须移出焦点序**。只写 `opacity-0` + `pointer-events-none`
      挡不住键盘 —— `pointer-events-none` 只管鼠标，里面的按钮仍在 Tab 序里：
      键盘用户会 Tab 到看不见的控件上，焦点框消失、读屏却念出按钮名。
      用 `visibility: hidden`（或 `inert`），并保留一段淡出过渡。
      折叠态的标题区、操作区、内容区三块都要这样处理，不能只处理其中一块。
- [ ] **「悬停才显形」的操作区，焦点进来时也要显形**。
      抄 `pages/home/shortcut/ShortcutTile.tsx:152` 已有的写法 ——
      `opacity-0 group-hover:opacity-100 focus-within:opacity-100`：
      悬停或焦点任一成立就显形，键盘用户不会撞上一个隐形按钮。
      `text-foreground/0`（完全透明）与 `opacity-0` 是同一类问题。
      全仓还有 **8 处硬伤**（另有 2 处非可聚焦元素，不算硬伤），
      见走查任务单 P0-3

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



| 常量 | 值 | 含义 |
| --- | --- | --- |
| `PANEL_COLLAPSED_WIDTH` | 48 | 折叠轨外宽 |
| `PANEL_COLLAPSED_BUTTON_SIZE` | 32 | 折叠态切换按钮边长 |
| `PANEL_COLLAPSED_BUTTON_INSET` | 8 | 折叠态按钮距轨道左沿 |
| `PANEL_HEADER_PADDING_X` | 8 | 展开态头部行左右内边距 |



```
折叠轨宽 = 2 × 展开态头部左内边距 + 按钮边长
```



| 场景 | 轨道宽 | 折叠按钮落点 | 距左沿 | 距右侧分隔线内侧 | 按钮距轨道顶 |
| --- | --- | --- | --- | --- | --- |
| 笔记页 `pages/notes/NotesPage.tsx` | 48（inset 阴影，不占内容盒） | 8..40 | 8px | 8px | 8px |
| 题单页 `Leetcode/SideBar.tsx` | 48（inset 阴影，不占内容盒） | 8..40 | 8px | 8px | 8px |
| 应用页 `panel/ResizableSidebar.tsx` | 48（inset 阴影，不占内容盒） | 8..40 | 8px | 8px | 8px（`h-12` + `pt-2`/`pb-2`，内容盒正好 32px） |
| 快捷方式面板 `shortcut/ShortcutPanel.tsx` | 48（inset 阴影，不占内容盒） | 8..40 | 8px | 8px | 8px |


1. **折叠态按钮用固定 padding 锚定，不用 `justify-center` 居中**。
2. **分隔线不要占内容盒**（折叠轨）：需要一条边界时用 `inset` 阴影，
3. **折叠态那一行不许溢出轨道**：行内容宽必须 ≤ 轨道内容盒，
4. **展开态按钮与内容列左沿对齐**，且头部行的左右内边距与内容列一致。
5. **折叠按钮的 focus 描边四边都要露得出来**：描边是向外扩 1px，

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

### 对比度口径（唯一一套算法，别各算各的）


1. **WCAG 2.x 相对亮度公式**（sRGB → 线性 → 相对亮度 → 比值）。
2. **sRGB 线性化阈值取 0.03928 与 0.055**：`v ≤ 0.03928` 走线性段
3. **HSL 按 CSS 规范转 sRGB**，转换后**保留浮点，不取整到 8-bit** ——
4. **透明档先做 alpha 合成再算**：`bg-primary/10` 要先把 primary 与底色按
5. **底色只有两种**：`--card`（100% 白）与 `--background`（98%）；
6. **复现**：`scripts/check-contrast.mjs`（Node、无依赖）输出每个组合对两个底



1. 先 `pnpm run build:react`，用产物 `dist/renderer/assets/index-*.css`（含真实 token
2. 写一个复刻目标结构的 HTML，引用该 CSS
3. 用 Electron 无头加载，`webContents.executeJavaScript` 量 `getBoundingClientRect`
4. 焦点态要用**真实键盘事件**（`sendInputEvent` 发 Tab）才能触发 `:focus-visible`；
5. **`:focus-visible` 只在「窗口已显示且已获焦」时成立**。实测四种情况：
6. Tab 的落点是**有记忆的**（顺序焦点导航的起点会留在上次的位置），
7. 要判断 `box-shadow` 的某一段画在元素的哪一侧，别靠推算：
8. **窗口要可见而且要有焦点**，否则过渡动画根本不会跑。
9. 采样用 `setTimeout` 而不是 `requestAnimationFrame`：过渡是按时间插值的，
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



---

## 十、破坏性确认框文案口径



```
DialogTitle       删除题单                                     ← 动作 + 对象类别，不带名字
DialogDescription 确定要删除题单「动态规划专题」吗？              ← 一句话，点名目标
                  此操作不可逆！                                ← 单独一行
DialogFooter      取消                    确定删除
```


1. **标题不带名字**。写动作 + 对象类别（「删除题单」「删除文件夹」），具体名字放正文。
2. **正文必须点名**。句式固定为「确定要删除{对象类别}「{name}」吗？」——
3. **名字逐字来自数据**，不缩写、不改写、不省略后缀。禁止用「这个」「该」「上述」
4. **名字用「」包住**，样式 `font-medium text-foreground`（正文本身是
5. **不可逆提示单独一行**，`text-destructive font-medium`，不要和正文挤在同一句。
6. **正文必须由 `DialogDescription` 承载**，不能只是放在一个 `<p>` 里。
7. **触发按钮与确认框用同一个名字**：按钮的可访问名称是「删除题单：{name}」，


```tsx
const dialog = screen.getByRole("dialog");
const describedBy = dialog.getAttribute("aria-describedby");
expect(describedBy).toBeTruthy();
const desc = document.getElementById(describedBy!);
expect(desc?.textContent).toContain("动态规划专题");
```


---

## 十一、两条统一方案的定稿与理由


### 1. 侧栏分隔线


| 状态 | 写法 | 说明 |
| --- | --- | --- |
| 展开态 | 1px 语义边框 `border-border/60`（左侧面板取 `border-r`，右侧面板取 `border-l`） | 不分强度档 |
| 折叠态 | 等价 inset 阴影：右缘 `inset -1px 0 0 0 hsl(var(--border) / 0.6)`，左缘 `inset 1px 0 0 0 hsl(var(--border) / 0.6)` | 不占内容盒，与展开态同色同位置 |


- 竖向拟态投影类 `neu-divider-r` 已从 `index.css` 删除（2026-11-04 落地）；横向 `neu-divider-b` 保留，仅用于工具栏下缘
- 浏览器页侧栏头部那条 `border-border/50` 统一到 `/60`



1. **要统一就只能是全实线或全投影**。投影档会把应用页项目列表与快捷面板改成投影，
2. **实线是全应用既有默认**。仓库里 `border-border/60` 有 39 处、`/50` 有 12 处、
3. **投影在明暗两套主题下强度差近三倍**（浅色 0.18 / 深色 0.5），
4. **笔记页原来用投影的理由在本 App 不成立**。那个理由是「同底色上实线像外框残留接缝」，



### 2. 侧栏标题字号


- 侧栏/面板头部标题：`text-sm font-medium` + `text-foreground`（14px）
- 标题右侧的计数与副信息：`text-xs text-muted-foreground`（12px，实心值 46%）
- 唯一例外：页面主标题 h1 用 `text-xl font-bold`
- 不用 `text-foreground/80`、`/85` 这类中间档


1. **18px 是孤例**。全应用 bold 标题只有两处侧栏标题（笔记、题单，18px）加页面主标题，
2. **不写死 px**。第二节要求字号以 DESIGN.md 的字阶为准、不写死 px，
3. **12px 与旁边的计数同级**，主次分不出来。
4. **14px 在 40px 高的头部里不挤**，与 32px 图标按钮并排也放得下。


| 面板 | 文件 | 展开态分隔线 | 折叠态分隔线 | 头部标题 | 计数 · 副信息 |
| --- | --- | --- | --- | --- | --- |
| 笔记 | `pages/notes/NotesPage.tsx` | `border-border/60`（右缘） | inset 阴影（右缘） | `text-sm font-medium` + `text-foreground` | `text-xs text-muted-foreground` |
| 题单 | `pages/leetcode/SideBar.tsx` | 同上 | 同上 | 同上 | 同上 |
| 应用页 | `components/panel/ResizableSidebar.tsx` | 同上 | 同上 | 同上 | 同上 |
| 快捷面板 | `pages/home/shortcut/ShortcutPanel.tsx` | `border-border/60`（左缘） | inset 阴影（左缘） | 同上 | 同上 |

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
| 2026-11-04 | `pages/notes/NotesPage.tsx` 折叠轨 40→48、按钮锚定 8px | 通过（零横向位移实测成立）；建议把路径行收到 8px；题单页仍停在 40px 待同步 | 笔记开发 / 浏览器工具开发 |
| 2026-11-04 | `panel/ResizableSidebar.tsx` + `apps/AppProjectList.tsx` + `shortcut/ShortcutPanel.tsx` 折叠几何 | 6 项全部通过（居中/描边/零位移/竖排标签/深浅色一致）；遗留：跨页分隔线三种写法、侧栏标题字号三档 | 应用平台开发 |
| 2026-11-04 | 规范校准（Chief 答复后） | 第七节补唯一约束式「轨宽 = 2×头部左内边距 + 按钮边长」并删去「位移是固有取舍」的说法；第二节补语义色 token 命名与层级口径；新增第十一节两条待架构师拍板的统一方案 | UI设计校验 |
| 2026-11-04 | 规范校准（架构师定案后） | 第十一节由「待拍板」改写为「定稿与理由」：分隔线定稿为展开态 `border-border/60` + 折叠态等价 inset 阴影，标题定稿为 `text-sm font-medium` + `text-foreground`，并写入验收标准五条；第七节规则 2 的状态句同步（原文写「题单页与应用页目前是 `border-r`」，改后已不成立） | UI设计校验 |
| 2026-11-04 | 规范校准（复核后收尾） | 第三节标题条目补「不用 `text-foreground/80`、`/85` 中间档」并作为唯一完整版，第六节标题条目压缩为指向第三节的引用（同一规则原写两遍）；第二节 `success` 反例加时态并写死定值（浅色 `152 60% 32%` / 暗色 `152 58% 55%`）；`neu-divider-r` 已删除的表述同步到第六节与第十一节 | UI设计校验 |
| 2026-11-04 | 复核实测：`index.css` 的 `--success` 与 `.neu-divider-r` | `.neu-divider-r` 已删，笔记页改 1px `border-border/60` + 折叠态 inset 阴影、标题 `text-sm font-medium`、路径行 `px-2`，与第十一节定稿一致；`--success` 去重只做了一半 —— 浅色现存 `152 64% 42%` 而非口径的 32%，实心文字在白底卡片上只有 2.79:1 | 浏览器工具开发 |
| 2026-11-04 | `components/Leetcode/SideBar.tsx` 侧栏折叠/展开几何（40px 轨 → 48px 共享常量） | 通过：折叠轨 48、按钮 8..40、两态零位移（实测 0）、focus 描边四边余量 7px、内容列 `px-2` 与头部左沿同在 8px、标题 14px medium、操作按钮间距 8px；深浅两态分隔线同为 `rgba(43,50,59,0.6)`/`rgba(227,231,237,0.6)`。另有 1 处必改（删除确认框正文缺对象类别与「」） | 浏览器工具开发 |
| 2026-11-04 | `panel/ResizableSidebar.tsx` + `shortcut/ShortcutPanel.tsx` 折叠退场与焦点描边 | `invisible` 把隐藏区移出焦点序的方向正确（Tab 不再跳进看不见的「导入」）；竖排标签加 `mb-1` 后描边四边余量 3px 通过。另有 1 处必改（内容区折叠态的 visibility 不在过渡列表 → 瞬间消失，与标题/操作区的淡出不一致，且淡出前有 150ms 停顿） | 应用平台开发 |
| 2026-11-04 | `pages/notes/NotesPage.tsx` 笔记页侧栏（真实构建产物 + 真实 DOM 实测） | 通过：折叠轨 48、展开态 `border-r` 1px、折叠态同色 inset 阴影（浅 `rgba(227,231,237,0.6)` / 深 `rgba(43,50,59,0.6)`）、两态按钮 x 恒为 176（零位移）、标题 14px/500/`text-foreground`/行高 20px、`ml-2`、头部行左内边距与路径行、文件树列同为 8px；`transition-[width]` 下边框全程 1px 不闪。另有 1 处必改（头部行缺 `overflow-hidden` → 展开首帧标题墨迹画到右栏工具条上，14px/约 40ms；改法必须连 `mt-2`/`mb-2` 一起换成 `pt-2`/`pb-2`） | 笔记开发 |
| 2026-11-04 | 四个可折叠侧栏的折叠几何一致性（笔记 / 题单 / 应用管理 / 快捷方式） | 通过：四页共用 `panel/layout.ts` 的一套数（轨 48、按钮 32、内缩 8），实测折叠态按钮一律落在 8..40、左右留白各 8px、描边外扩 1px 后仍余 7px；`layout.test.ts` 用等式锁死（轨宽 = 内缩×2 + 按钮边长、内缩 = 展开态头部左内边距），全仓再无写死的 40/44 折叠轨。遗留 1 处（笔记页头部行缺 `overflow-hidden`，与上一行同一件） | UI设计校验 |
| 2026-11-04 | 规范校准（第九节测量方法复核） | 第 5 条原写「无头窗口先 `win.focus()` 即可」不成立：实测隐藏窗口（`show:false`）无论加不加 `win.focus()`，`:focus-visible` 都不成立，只有**已显示**的窗口（可放在屏幕外）才成立，已按实测四种情况改写；补第 12 条（用仓库 Tailwind 配置单独编复刻页 CSS，不必整包构建，并提醒 `--content` 必须指向复刻页）与第 13 条（`elementFromPoint` 区分「几何溢出」与「真的画出来」） | UI设计校验 |
| 2026-11-04 | `pages/notes/NotesPage.tsx` 头部行裁剪复验（真实渲染层） | 上一行的必改项已改并提交（`4205d80`）：头部行加 `overflow-hidden`、`mt-2`/`mb-2` 换 `pt-2`/`pb-2`。复验通过：轨道右缘外取样条深色像素由 **434 个降到 0 个**（墨迹不再画到右栏）、focus 描边四边完整（按钮上缘比行上缘低 8px）、两态几何未回归（按钮 x 恒 176、轨 48/288、浅深线色不变、标题仍 14px/500/foreground） | UI设计校验 |
| 2026-11-04 | `components/Leetcode/SideBar.tsx` + `CollectionDetail.tsx` 题单页第五节验收（交付后复核） | 三项全部结项：轨宽改走共享常量 `PANEL_COLLAPSED_WIDTH`（`SideBar.test.tsx` 已用等式锁死）、展开态 `border-r border-border/60` 与折叠态同色 inset 阴影、标题 `text-sm font-medium` + `text-foreground`；删除确认框已是 `DialogTitle` + `DialogDescription` + 句式「确定要删除题单「{name}」吗？」+ 名字 `font-medium text-foreground` + 不可逆单独一行；难度徽章按语义色做底色 + `text-foreground` 做字（实测浅色 10.02/10.58/9.63）。另修正规范一处与实现相反的表述：第二节原写徽章「浅底 + `destructive` 字」，已改为「语义色做底色 + `text-foreground` 做字」并附实测对比度 | UI设计校验 |
| 2026-11-04 | `index.css` 浅色 `--warning` 取值定案（38 70% 45% → 38 70% 35%） | 白底卡片 4.76:1，与 `--success` 4.73:1、`--destructive` 4.80:1 同档；暗色 `48 85% 60%` 不动。**事实更正**：这条 token 不是「没人用」—— `components/shell/titleBar.css` 第 46~62 行最大化/还原按钮 hover 态直接取 `hsl(var(--warning))`（不走 Tailwind 类），浅色主题下标题栏底 `--app-frame`（`0 0% 94%`）上现值只有 2.63:1（图形元素的 3:1 线都不到），改后 4.18:1 过线。hover 图标会变深（#C38822 → #986A1B），属可见变化 | 架构师定案 / UI设计校验落地 |
| 2026-11-04 | `components/ui/button.tsx` 基类焦点指示器厚度（ring-1 → ring-2） | 基类改成 `focus-visible:ring-2`，满足 WCAG 2.2 SC 2.4.11（1px 环面积 128px² < 2px 周长所需的 256px²）。ring 是 `box-shadow` 不占布局，第七节几何基准未回归。仓库原有 2px 先例：`index.css` 的 `.button` 是 `ring-2 + ring-offset-2`、`.note-row` 是 `outline: 2px solid`。注意两套环位置不同（一个带 2px offset、一个贴边画），厚度一致后观感仍需各看一眼 **（2026-11-05 引用更正：厚度口径来自 SC 2.4.13 Focus Appearance，AAA 级；SC 2.4.11 是 AA 级的「焦点不被遮挡」，与厚度无关）** | 架构师定案 / UI设计校验落地 |
| 2026-11-04 | `shortcut/ShortcutPanel.tsx` 快捷面板方案 E（展开态头部 + 折叠轨锚定） | 展开态头部 `h-12 + pt-2 + pb-2`、头部下缘线改等色 inset 阴影（不占内容盒：带 `border-b` 时内容盒只剩 31px，按钮落 7.5..39.5，与折叠态箭头的 8 差 0.5px）；折叠轨顶箭头由 `justify-center` 改固定右锚定（`paddingRight = PANEL_COLLAPSED_BUTTON_INSET` + `justify-end`）；竖排标签外边距升为共享常量 `PANEL_RAIL_LABEL_INSET = 4`（走行内样式，Tailwind 动态拼接类名会让外边距丢在产物里）；竖排标题与角标统一 `text-xs`（角标保留 `bg-primary/15` + `text-primary` 强调色）。九变体实测只有方案 E 上下对称（8/8）。**展开态面板左缘 `border-l border-border/60` 保留不动** —— 第十一节定稿管的是竖向面板边界线，头部下缘那条横线是另一回事 | 应用平台开发 |
| 2026-11-05 | 全仓走查（十一节对照）+ token 与规范落地 | 走查记录与任务单见 `docs/UI-AUDIT-2026-11-05.md`。折叠轨几何 48/32/8 四页全过；不合规项：焦点环 1px（input/textarea/calendar）、焦点光晕 1.17:1（`.input-focus` / `.search-input-focus`）、隐藏控件仍在焦点序 8 处、破坏性确认框正文不在描述节点 3 处、品牌色作文字 20+ 处。已落地：`--muted-foreground` 46%、`--primary` 34%、新增 `--primary-strong`（浅 30% / 暗 60%）、`fontSize` 登记 10/11/13/15 四档、Status Badge 新配方、三个侧栏补 `motion-reduce`、剪贴板弹窗品牌色从 221° 蓝归到 195° 青 | QDesign |
| 2026-11-05 晚 | 三份文档与任务单修订（评审后） | **对比度口径统一为一套算法**（第九节），文档里所有对比度数改用实测值，不再各算各的；`--primary-strong` 口径改为**二维**（文字色 × 底纹档）：`--primary` 作文字只能落在无品牌底纹处（`/5` 就只有 4.42），底纹上限 `/15` 只在文字用 `--primary-strong` 时成立，`/20` 禁用；隐藏控件统一为 **8 处硬伤 + 2 处附记**；任务单定位改为按类名/选择器，行号只作参考；P1-1 与 P0-1 重复已删；P1-3 改为「展开 220ms / 收起 150ms」；新增 P1-9（五处位移动效缺 `motion-reduce`）；**当时挂起一处**：第十一节的 `text-muted-foreground/60` 与第二节「文字一律用实心值」冲突（`/60` 只有 2.32:1），已在第三节与第十一节就地标注；该条已由 Chief 裁决，见下一行 | UI设计校验 |

| 2026-11-05 晚（补） | 对比度出数口径收口（补） | `scripts/check-contrast.mjs` 补 12 行组合（次要文字 `/80` `/85`、品牌色 `/40`~`/85` 透明度档）—— 文档里引的这些数原先在脚本输出里查不到，现在都能直接抄；数值精度统一（`2.3~3.2` 改成脚本输出的 `2.27~3.18`）；第二节补一句「本节所有数只从脚本输出抄，口径见第九节」；`popup-index.css` 的口径引用从「第二节」改成「第九节」；任务单 P0-5 补「变体态 15 处」（`hover:` / `focus:` 前缀的写法，基础态扫不到，要靠两维守卫列全） | UI设计校验 |

| 2026-11-05 夜（补 2） | 第十一节次级文字改实心值（Chief 裁决） | 第十一节定稿的 `text-xs text-muted-foreground/60`（2.32:1 白底 / 2.27:1 98% 底）改为实心 `text-xs text-muted-foreground`（46%，4.61:1 取更差列）；第三节同条、第十一节面板核对表同步；第二节「文字一律用实心值」不动 | UI设计校验 |

| 2026-11-05 夜（剪贴板域复验） | `components/clipboard/` 5 文件（`42c3771` 品牌色文字与确认框描述） | **品牌色两档改法在本域是一致的**：品牌文字已全部换成 `text-primary-strong`、底纹档位都 ≤ /15，符合 DESIGN.md 与任务单 P0-5；**破坏性确认框 `DeleteAllConfirmDialog` 符合第十节七条口径**（正文进了 `DialogDescription`、标题只写动作与对象类别、数字点名、不可逆提示单独一行且 `text-destructive font-medium`、次级说明用实心 `text-muted-foreground`）；**隐藏控件不构成焦点序问题**（「已复制」角标是 `span`，不可聚焦，与 P0-3 附记一致）。另报 4 项：P0-6 焦点环对比度（23 处半透明品牌色环，`primary/50` = 2.04）、P0-7 用户气泡复制按钮图标 2.65、P1-10 图标块图标色偏离 Icon Block 配方、P1-11 语义色当文字色与工具栏搜索图标色 | UI设计校验 |

| 2026-11-05 夜（补 3） | 对比度矩阵补组合 + 行尾事故 | `scripts/check-contrast.mjs` 补 10 行：焦点环档位（`/30` `/40` 危险色 `/50`）、用户气泡（底不是卡片，显式指定基底）、选中/悬停底纹差（1.21）；`--json` 单用会输出空矩阵，已修。**行尾事故**：带 shebang 的 `.mjs` 被 CRLF 检出时 vitest 整个套件加载失败（报在 import 行，看不出是脚本自己的问题）—— 根因已由 `.gitattributes` 统一 LF 检出解决（`17518ef`），脚本侧另去掉 shebang 兜底 | UI设计校验 |

| 2026-11-09 上午 | 首页空状态复走查 + 非档位透明度写法 | 走查 `pages/home/HomePage.tsx` 的空状态 5 处改动：品牌色文字两档用法正确（按钮 `text-primary-strong` 压 `primary/10` = 5.05、hover 压 `/15` = 4.72，过线；焦点环由基类 `focus-visible:ring-2 focus-visible:ring-ring` 负责）；**图标块改回 `text-primary`**（DESIGN.md Icon Block 配方：图标用 `--primary`、文字才用 `--primary-strong`；primary 压 `primary/10` = 4.14，图形走 3:1 过线），与 SkillsPage / FloatingAiAssistant / 剪贴板 ImageOcrDialog 三处对齐；`dark:text-primary-strong` 判为冗余已删（变量在 `.dark` 自动换档）；悬停文字补 `hover:text-primary-strong`（变体的 `hover:text-accent-foreground` 特异性更高会盖掉业务侧基础态字色）。**新查出并补进第二节**：非 5 倍数的裸数字透明度档（`bg-primary/8` `/12`）在 Tailwind v3 里不生成任何规则、静默失效 —— 真实失效 2 处（`App.tsx`、`NotesPage.tsx`，均已进 master），注释误导 2 处，任务单 P1-12 | UI设计校验 |

| 2026-11-09 下午 | 两处可见变化用户拍板 + 次级文字透明度档盘点 | **用户对「剪贴板弹窗 221° 蓝 → 195° 青」与「`--primary` 38% → 34%」这组选项回的是「都保留」** —— 两处按定稿走，已随 1.9.0 发布，不再二次确认。**次级文字透明度档（P1-6）盘点**：`text-muted-foreground/60` 已随分域提交全仓改实心（命中 0 处）；剩下的按全口径盘点是 **132 处**（Tailwind 121 + CSS 手写 11，档位 `/25`~`/85`）—— **104 处承载信息的文字、28 处图形**（交互图标 7 / 装饰图形 21）。*（这一行最初记的是 76 处，口径只扫了 `/70 /80 /85` 三档且没扫 CSS，偏少 56 处；已订正，见下一行。）* 详见 `docs/UI-AUDIT-2026-11-05.md` 第十节；用户当轮即回「全留，登记为已知项」 | UI设计校验 |

| 2026-11-09 下午（补） | 次级文字透明度档 132 处登记为已知偏差 | 用户拍板**「全留，登记为已知项」** —— 这 132 处代码不改。**性质是「已接受的偏差」，不是合规**：第二节「文字一律用实心值」对新代码不变，存量按 `docs/UI-AUDIT-2026-11-05.md` 第十节「已知偏差登记」挂着。分类（按 `scripts/audit-muted-text.mjs` 的口径，文字=承载信息、图形=图标）：**104 处承载信息的文字**（浅色从 `/25` 的 1.37:1 到 `/85` 的 3.47:1，**全不过 AA 正文线 4.5:1**；实心是 4.61:1；这批大多是 10–13px 小字，恰是最吃对比度的一类，最淡的几处是首页空状态「粘贴内容」这类刻意弱化的引导）、**28 处图形**（图形线 3:1，其中 27 处不过线；交互图标 7 处 / 装饰图形 21 处，**这 28 处没有一处带 `aria-hidden`** —— 「装饰图形可留」的例外条件不成立，真要留必须先补 `aria-hidden`）、**6 处悬停/焦点变体里才出现的字色**（焦点态已实心，键盘用户拿到 4.61:1）。**留着的原因**：改实心等于全应用次级文字深一档，跨 60+ 组件的可见变化，收益与代价不划算。**回头处理的触发条件**：用户反馈小字看不清 / 下一轮整体视觉调整 / 引入无障碍审计要求。复现脚本 `scripts/audit-muted-text.mjs`（分类，`--json` 出机器可读结果）；若哪天真要改，**压 `bg-muted` 底的 3 处要连底色一起挪**（实心压这底 light 只有 4.20，不过 AA） | UI设计校验 |

---

## 十三、动效


- [ ] 动效只说明「状态变了」，不吸引注意力：不用弹性曲线
      （`cubic-bezier(0.34, 1.56, 0.64, 1)`、`animate-bounce`）、不用循环装饰动画
- [ ] 曲线统一 `cubic-bezier(0.22, 1, 0.36, 1)`
- [ ] 时长按档位取：快 120–150ms（悬停、颜色、图标切换）、
      标准 180–220ms（面板、浮层、页面切换）、300ms 以上只给真需要时间的过程
- [ ] 同一个元素收起比展开快一档（面板：退 150ms / 进 220ms）
- [ ] 空间位移与不透明度分开做：宽度变化时只让宽度参与过渡，内容自己淡出
- [ ] 退场淡出的总时长不超过宽度过渡；不用 `transition-delay` 把 opacity 与
      visibility 一起拖住（会看起来「先卡住再消失」）
- [ ] **所有空间位移都带 `motion-reduce:transition-none`** ——
      命中系统「减少动态效果」时直接跳到位；不透明度变化可以保留
- [ ] 持续动画（呼吸、脉冲、打字点）同一屏最多一处，且都要有 reduced-motion 分支
- [ ] 同页同类动效时长一致：四个侧栏的宽度过渡不要各用一个值
