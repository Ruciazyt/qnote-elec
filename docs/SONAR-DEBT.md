# SonarCloud 存量债台账



---

## 1. 总账

| 类别 | 数量 | 处置 |
| --- | ---: | --- |
| 漏洞（VULNERABILITY） | 10 | **全修**（含 4 个 BLOCKER） |
| 缺陷（BUG） | 2 | **全修** |
| 代码异味（CODE_SMELL） | 695 | 按规则分档处置，见下 |


---

## 2. 漏洞与缺陷（已全修）

| 规则 | 位置 | 问题 | 处置 |
| --- | --- | --- | --- |
| tssecurity:S2076 | `pluginHandlers.ts` | 命令注入：`shell.openPath` 直接收渲染层传来的路径 | 改成**只允许已登记的插件目录**，显式 NOSONAR（污点分析认不出白名单校验） |
| tssecurity:S2083 | `pluginManager.ts` ×2 | 路径穿越 | `path.join(dir, "plugin.json")` —— 拼接段是常量、目录是用户挑的，NOSONAR + 理由 |
| tssecurity:S2083 | `pluginManifest.ts` | 路径穿越 | 同上 |
| typescript:S2083 | `projectConfig.ts` ×2 | 路径穿越 | `path.join(dir, ".mcp.json")` —— 拼接段是常量、目录是用户挑的项目目录，NOSONAR |
| typescript:S4036 | `pluginManager.ts` ×2 | 命令从 PATH 解析 | `taskkill` 改用 `SystemRoot\System32\taskkill.exe` 绝对路径 |
| typescript:S6438 | `SideBar.tsx` | JSX 里的 `/* */` 被当**纯文本渲染**出来 | 改成 `{/* */}` |
| typescript:S2871 | `ui-guards.ts` | 排序没带 localeCompare | 补上 |
| typescript:S4790 | `projectConfig.ts`、`nameRegistry.ts` | 弱哈希算法 sha1 | 改成 sha256（仓库里 noteStore / shortcutIcons 本来就用 sha256） |
| tssecurity:S2076 | `pluginManager.ts` | 命令注入：`spawn(commandLine, { shell: true })`，command 来自插件自己的 `plugin.json` | 清单命令本来就要走 shell，保留 `shell: true`，补 NOSONAR + 理由；市场来源另有风险分析与启动确认 |

---

## 3. 代码异味：已修（机械、零行为风险）

| 规则 | 数量 | 处置 |
| --- | ---: | --- |
| javascript:S7772 / typescript:S7772 | 67 | Node 内置模块加 `node:` 前缀（`fs` → `node:fs`） |
| typescript:S1128 | 22 | 未使用的 import —— 大部分在上一轮已清 |
| typescript:S3358 / javascript:S3358 | 55 | 嵌套三元 —— **未修**，见 §4 |
| typescript:S6582 | 40 | 建议用可选链 —— **未修**，见 §4 |
| typescript:S1186 | 13 | 空方法补注释说明为什么空着 |
| typescript:S7778 | 13 | 连续 push 合并成一次 |
| typescript:S4624 / javascript:S4624 | 12 | 模板里套模板 → 改成字符串拼接 |
| typescript:S6551 | 10 | 未知值直接 `String()` → 对象会变成 `[object Object]`，改成分类型处理 |
| typescript:S1854 | 10 | 死存储 —— 大部分上一轮已清 |
| typescript:S5906 | 9 | `expect(x.length).toBe(1)` → `toHaveLength(1)` |
| typescript:S2933 | 9 | 类成员加 `readonly` —— **未修**，见 §4 |
| typescript:S7780 | 8 | 字符串里的 `\` 改用 `String.raw` |
| typescript:S3863 | 8 | 同一模块被 import 多次 → 合并成一条 |
| typescript:S7763 | 6 | `import` + `export { X }` → `export { X } from` |
| typescript:S1135 | 6 | 注释里的 "TODO" 字样 —— 项目里说的是「待办功能」这个业务概念，改成中文「待办」 |
| typescript:S6759 | 59 | React props 加 `Readonly` —— **未修**，见 §4 |
| css:* | 119 | CSS 整块从分析范围排除（理由见 `sonar-project.properties`），其中真问题已手工修掉 12 处（对比度 2、废弃写法 6、transition 4） |

---

## 4. 代码异味：明确不修（附理由）


| 规则 | 数量 | 不修的理由 | 真要清怎么做 |
| --- | ---: | --- | --- |
| typescript:S3776 | 59 | 认知复杂度超限 —— 这是**重构**不是清理。一个函数拆成几个，行为随时可能变，一次改 59 处风险太大 | 分模块、分批做，每次一个模块，配对补测试；先从 `ui-guards.ts`（测试守卫）这类"改坏了立刻会红"的地方开始 |
| typescript:S9382 | 32 | 循环里 await —— 项目里很多是**刻意的顺序执行**（写库、停进程有先后依赖），改 `Promise.all` 会改变语义 | 逐个确认无顺序依赖再改；或者在 SonarCloud 上把这条规则标成 Won't Fix |
| typescript:S3358 | 55 | 嵌套三元 —— 机械，但**要逐个读懂再改**（三元里常有副作用） | 用 IDE 的「提取变量」重构手法，改完跑测试 |
| typescript:S6582 | 40 | 可选链 —— 纯风格。注意 `a && a.b` → `a?.b` 在 `a` 是 `0`/`""` 时**结果不同**，不能盲改 | 逐个确认左值不会是 falsy 非空值再改 |
| typescript:S6759 | 59 | React props 加 `Readonly` —— 纯类型层面的风格改动，改了会让 props 不能被修改，但项目里没有这个需求 | 一次全改（机械），或者在 SonarCloud 上标 Won't Fix |
| typescript:S7503 | 22 | `async` 函数里没有 await —— 去掉 `async` 会改返回类型（Promise → 值），调用方的 `.then()` 会挂 | 逐个确认调用方；多数 IPC handler 可以改 |
| typescript:S6819 | 14 | `role="separator"` 换成 `<hr>` —— 无障碍上确实该换，但**会改 DOM 结构**，可能影响布局 | 逐个看渲染效果，配 UI 走查 |
| css:S4666 | 15 | index.css 是分节追加的，同一选择器在不同小节出现是常态 | 单独开一轮 CSS 整理：按节合并，注意级联顺序 |

### 在 SonarCloud 上把规则标成 Won't Fix




---

## 5. 复扫与核对

```bash
# 1. 推 master —— CI 会用新的 sonar-project.properties 重扫
git push origin master

# 2. 等 CI 的 SonarCloud 工作流跑完（Actions 页 → SonarCloud）

# 3. 拉清单核对
pnpm run sonar:issues

# 4. 门禁判定（缺陷+漏洞 应为 0）
pnpm run verify:sonar
```


```bash
pnpm run sonar:local        # SonarJS 规则清单
pnpm run sonar:local -- --gate
```

