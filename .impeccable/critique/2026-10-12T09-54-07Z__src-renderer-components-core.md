---
target: QNote 应用外壳（侧栏/标题栏）整体 UI review
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
target_identity: "file:D:\\personal-projects\\qnote-elec\\src\\renderer\\components\\core"
timestamp: 2026-10-12T09-54-07Z
slug: src-renderer-components-core
---
# Critique — QNote 应用外壳（导航壳层）

**Method: dual-agent (A: explore bg_f942efa · B: explore bg_55137b1)**
Scope: `src/renderer/components/core/` (AppSidebar / TitleBar / layout / titleBar.css)
Mode: Operate · 语言：简体中文界面

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | 系统状态可见性 | 3 | 内容面板无页面标题；标题栏恒为 "QNote"（TitleBar.tsx:46） |
| 2 | 系统/现实匹配 | 2 | 力扣分类用 PenTool（书法笔）图标语义错误；最大化图标非 Windows 惯用 |
| 3 | 用户控制与自由 | 2 | Ctrl+B 全局劫持无 target 判断（sidebar.tsx:151-161），编辑器内抢加粗 |
| 4 | 一致性与标准 | 2 | `<a>` 无 href → 不可聚焦、Enter 无效、无 link 角色 |
| 5 | 错误预防 | 2 | 设置页可关闭"设置"自身，用户失去回到当前页的路径 |
| 6 | 识别优于回忆 | 2 | 笔记默认隐藏（useSidebarTabs.ts:17-19），外壳内零提示 |
| 7 | 灵活性与效率 | 2 | rail `tabIndex={-1}` 仅指针可达；无 Ctrl+, / Alt+1..n |
| 8 | 美学与极简 | 2 | 激活态是全app 最响亮的对象，与"安静工具"主张相反 |
| 9 | 错误恢复 | 2 | 外壳无任何状态面：无"AI 未配置"提示、无离线态 |
| 10 | 帮助与文档 | 2 | tooltip 仅折叠态出现（sidebar.tsx:677）；展开态截断后无补救 |
| **Total** | | **21/40** | Functional but under-guided |

## Design Specificity Verdict

有能力的基础设施，穿了产品的衣服。导航是一列可任意替换的 lucide 图标 + 中文标签
（AppSidebar.tsx:31-74），基本是 shadcn sidebar 示例重排；PenTool 对应"力扣分类"更是
语义错误。真正属于产品的是外框——微信式灰色外框 + 白色圆角内容面板，这是一个站得住的
视觉立场。但那是"窗口外框"的立场，不是"QNote"的立场。对照 North Star，外壳不是过度设计，
而是**承载不足**：它应该在传递产品性格，实际传递的是空。

## 机械扫描（Assessment B）

- `--scope layout`：**0 findings**（仓库全域同样为 0）
- 全 scope：**6 findings，全部 advisory**，且**全部落在 `settings.tsx`**，均为
  `design-system-font-size` 偏离 DESIGN.md 字号梯（13px ×4、28px、9px）
- 外壳本身（AppSidebar / TitleBar / layout / titleBar.css）：**0 findings**
- 无视觉验证：渲染进程依赖 `window.electron` 预加载，浏览器内无法渲染；本会话无浏览器执行能力。
  静态证据：模块图全部 200，`tsc -b` 退出码 0。

**关键结论：扫描器对外壳零告警，而人工评审给出 21/40。** 说明这里的问题不是机械布局缺陷，
而是判断层问题——过度指定的激活态、品牌纪律失守、主功能被藏。任何规则扫描器都看不见这些。

## 优先级问题

**[P0] 主导航对键盘与读屏完全不可达**
`<a>` 无 `href`（AppSidebar.tsx:109）→ 按 HTML 规范不可聚焦、Enter 不触发、无 link 角色。
整列导航只能用鼠标点。修：`href={item.url}`、`<nav aria-label="主导航">` 包裹。

**[P0] 焦点环是 Tailwind 默认蓝色**
`sidebar.tsx:606` 与 `:442` 使用 `ring-sidebar-ring`，但 tailwind.config.js:64-72 的 sidebar
色组**没有 `ring` 键**，index.css 也**没有定义 `--sidebar-ring`** → 该工具类根本不会生成，
`focus-visible:ring-2` 回落到 Tailwind 默认 `rgb(59 130 246 / .5)`。在一个只允许
"单一品牌色相"的系统里，焦点环是蓝色的。修：`ring-sidebar-ring` → `ring-primary`。

**[P1] 激活态被同时指定了五次**
底色填充 + `shadow-sm` + `ring-1`（AppSidebar.tsx:115）+ 3px 强调条（index.css:1556-1578）
+ 缩放弹跳（index.css:1970）+ hover 辉光（index.css:1668-1672）+ cva 自身的
`data-[active=true]:bg-sidebar-primary`（sidebar.tsx:606）。同时违反 Flat-By-Default、
Zero-Glow、以及"弹性曲线"禁令（DESIGN.md:148）。修：只保留底色 + 强调条，删其余。

**[P1] hover 反馈约 1.05:1，实际不可见**
`--sidebar-accent: 195 25% 93%`（index.css:57）叠在 `--app-frame: 0 0% 94%`（index.css:16）上。
这是"这里可点"的主信号，却是外壳里最弱的一层；DESIGN.md:143 要求指示器 ≥3:1。
rail 的 `hover:after:bg-sidebar-border` 同理。修：加深 accent，rail 改用 `--divider`。

**[P1] 笔记应用的"笔记"默认不在导航里**
`useSidebarTabs.ts:17-19` 默认关闭 笔记/Todo/力扣，默认只见 主页/浏览器/AI技能/设置。
可配置性**已完整实现且完全不可发现**——唯一提示是设置页卡片里的 `3 / 6` 徽章。
修：笔记默认开启，或在导航底部加一行弱化的"更多功能…"。

**[P2] Ctrl+B 无上下文判断**（sidebar.tsx:151-161）：在编辑器里按 Ctrl+B 收起侧栏而非加粗。

**[P2] 侧栏框体比视口矮 40px**：`pt-10` + `h-svh`（border-box）在 `fixed inset-y-0` 容器上，
`h-full` 取到的是内容盒高度 = `100svh − 40px`。当前因框体与 body 同色而不可见，属潜伏问题。
若修复，页脚收起开关会下移到与内容面板底边对齐。

## Personas

**Power user**：Ctrl+B 抢加粗；宽度永远只能指针拖；无 Ctrl+, ；快速切换时导航项会走完 0.3s
弹跳（index.css:1970）显得浮夸；折叠后只剩 BookOpen/ListChecks/PenTool 三个需悬停辨认的图形。

**First-timer**：装了一个笔记应用，导航里没有"笔记"；外壳内没有任何品牌标识（DESIGN.md:344
承诺 "QNote + 分割线"，AppSidebar.tsx:95-97 两者皆无）；`AI 技能` 是 `tabKey: "always"`
（AppSidebar.tsx:66）——最不可移除的一项恰好是最不可解释的一项。

## 小问题

- `.page-transition`（index.css:870）挂在永不重挂载的包裹层（layout.tsx:15），实际只在启动时淡入一次。
- 展开态标签截断后无 tooltip 补救（AppSidebar.tsx:122 + sidebar.tsx:677）。
- DESIGN.md §Sidebar 仍写着"默认 192px / 192–420px"，代码已是 168px / 152–420（sidebar.tsx:24-30）。
- DESIGN.md §Sidebar 仍写着 sidebar 背景"极浅 teal 调"，已被改为 `--app-frame` 中性灰（index.css:46）。
- `.sidebar-app-name`（index.css:2963）已随应用名移除变成死代码。
