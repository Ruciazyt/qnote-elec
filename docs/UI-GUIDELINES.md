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

## 三、间距与尺寸

- [ ] 图标按钮 32×32（`h-8 w-8`）；行内小图标按钮 ≥ 24×24（WCAG 2.5.8）
- [ ] 同一行相邻图标按钮之间留 `gap-1` 或 `gap-2`，不允许 0
- [ ] 同一页里内容区的左右内边距统一（一页之内不出现两种）
- [ ] 侧栏标题统一 `text-lg font-bold`，操作按钮放在标题右侧同一行
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
      现状：`components/ui/button.tsx` 基类是 `focus-visible:ring-1`，
      实测 1px 环面积 = 1px × 128px 周长 = 128px² < 2px 周长所需的 256px²，不达标。
      这是全应用共用默认值，改动影响所有按钮，**单独提一次**，不夹在别的改动里。

## 六、跨页一致性

- [ ] 同类界面（侧栏、列表卡片、头部行、空态）在不同页面间样式一致
- [ ] 侧栏折叠态几何符合第七节的基准
- [ ] 侧栏**头部行的左沿 = 该页内容列的左沿**（展开态）
- [ ] **侧栏标题的字号与字重统一**。现状四页三个档：
      笔记页/题单页 `text-lg font-bold`（18px）、应用页 `text-[13px] font-medium`、
      快捷方式面板 `text-[12px] font-medium`。
      要么统一，要么在规范里写明「带计数的紧凑面板用小号标题」是例外
      —— 现在是无规则的差异。
- [ ] **侧栏分隔线统一**。现状三种画法：应用页 `border-border/60`、
      快捷方式面板 `border-border/40`、笔记页 `neu-divider-r`
      （`1px 0 3px 0 hsl(var(--foreground)/0.18)`，带模糊的柔和投影）。
      同一个 App 里三条不同强度的分隔线，看着像三套产品。
      折叠态与展开态之间必须一致（同一面板两态的那条线不能换写法）。
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

| 场景 | 轨道宽 | 折叠按钮落点 | 距左沿 | 距右侧分隔线内侧 | 按钮距轨道顶 |
| --- | --- | --- | --- | --- | --- |
| 笔记页 `pages/NotesPage.tsx` | 48（无边框，分隔线走 box-shadow，不占内容盒） | 8..40 | 8px | 8px | 8px |
| 题单页 `Leetcode/SideBar.tsx` | 48（1px 右边框 → 内容盒 47） | 8..40 | 8px | 7px | 8px |
| 应用页 `panel/ResizableSidebar.tsx` | 48（1px 右边框 → 内容盒 47） | 8..40 | 8px | 7px | 4px（固定 `h-10` 行） |
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
2. **分隔线不要占内容盒**：需要一条右边界时用 `inset` 阴影或 `box-shadow`，
   不要用 `border-r` —— 边框会让内容盒少 1px，按钮就不再左右对称
   （47px 内容盒 + 8px 锚点 = 右边留白 7px、左边 8px）。
   笔记页与快捷方式面板已经这么做；题单页与应用页目前是 `border-r`，
   差的那 0.5px 肉眼不可见，但**两边都别再往里加边框**。
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
- [ ] **展开/收起动画期间内容不溢出到相邻区域**。
      宽度过渡时头部行的内容宽度是瞬间切换的，轨道还没长开时头部行就已是展开态的宽度，
      标题与操作按钮会画到右侧主内容区上（题单页实测溢出 99px，持续 200ms）。
      处理办法：给头部行加 `overflow-hidden`，或用共享组件 `ResizableSidebar`
      （它的 `aside` 带 `overflow-hidden`，标题与操作区在收起态被
      `w-0 overflow-hidden opacity-0` 包住）。

## 九、测量方法

几何类问题不要靠读 class 推算，用真实 CSS 量真实 DOM：

1. 先 `pnpm run build:react`，用产物 `dist/renderer/assets/index-*.css`（含真实 token
   与自定义类）
2. 写一个复刻目标结构的 HTML，引用该 CSS
3. 用 Electron 无头加载，`webContents.executeJavaScript` 量 `getBoundingClientRect`
4. 焦点态要用**真实键盘事件**（`sendInputEvent` 发 Tab）才能触发 `:focus-visible`；
   脚本里 `element.focus()` 不触发，量到的会是 `box-shadow: none`
5. **无头窗口必须先 `win.focus()`**。没有窗口焦点时 Chromium 不把 Tab 当作键盘交互，
   `:focus-visible` 一样不成立 —— 表现同样是 `box-shadow: none`，
   很容易被误读成「样式没生效」。
6. Tab 的落点是**有记忆的**（顺序焦点导航的起点会留在上次的位置），
   别写死按 N 次 Tab 就以为停在该元素上 —— 循环 Tab 到 `activeElement.id` 命中为止。
7. 要判断 `box-shadow` 的某一段画在元素的哪一侧，别靠推算：
   建一个 48×40 的测试块（纯色底 + 指定 inset 阴影），`capturePage` 后
   逐列采样像素，看哪一列被染色。`inset 1px 0 0 0` 画在**盒内左侧**。

（仓库里已有一份现成的：`.data/uicheck/measure.html` + `measure.js`，
`.data/` 已在 .gitignore 里。）

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

## 十一、走查记录

| 日期 | 页面 / 文件 | 结论 | 归属 |
| --- | --- | --- | --- |
| 2026-11-04 | `components/Leetcode/SideBar.tsx` 折叠态切换按钮 | 几何改动通过；另有 2 处必改（图标按钮无障碍名称、展开动画首帧溢出） | 浏览器工具开发 |
| 2026-11-04 | `components/Leetcode/SideBar.tsx` + `CollectionDetail.tsx` 9 个纯图标按钮补可读名称 | 通过（名称拆分与 title 用法正确）；另有 1 处必改（删除确认框未点名目标）、3 处既有问题 | 浏览器工具开发 |
| 2026-11-04 | `components/Leetcode/SideBar.tsx` 删除题单确认框文案 | 同一件必改项，本轮定稿「破坏性确认框文案口径」（第十节），并补 `DialogDescription` 要求 | 浏览器工具开发 |
| 2026-11-04 | `pages/NotesPage.tsx` 折叠轨 40→48、按钮锚定 8px | 通过（零横向位移实测成立）；建议把路径行收到 8px；题单页仍停在 40px 待同步 | 笔记开发 / 浏览器工具开发 |
| 2026-11-04 | `panel/ResizableSidebar.tsx` + `apps/AppProjectList.tsx` + `shortcut/ShortcutPanel.tsx` 折叠几何 | 6 项全部通过（居中/描边/零位移/竖排标签/深浅色一致）；遗留：跨页分隔线三种写法、侧栏标题字号三档 | 应用平台开发 |
