# QNote — Agent 开发规范


---

## 1. 项目速览

| 项 | 值 |
| --- | --- |
| 形态 | Electron 桌面应用（Windows 安装版 + 便携版 / macOS dmg + zip） |
| 主进程 | `src/main`（TypeScript → `dist/main`），preload 在 `src/main/preload.ts`；`handlers/` `core/` `utils/` **按功能分子目录** |
| 渲染层 | `src/renderer`（React 18 + Vite 6 + Tailwind 3 + shadcn/ui，new-york 风格）；`components/` `hooks/` `utils/` **按功能分子目录** |
| 共享层 | `src/shared`（主进程与渲染层共用的类型），按功能分子目录 |
| 数据层 | `src/database`（Knex + SQLite，笔记、剪贴板、待办等） |
| Rust 原生模块 | 各功能目录内的 `*-rs/` crate（纯逻辑单元的 Rust 移植，napi 绑定），主进程按需加载 |
| 构建配置 | `build/electron-builder.json`（打包）、`build/tsconfig.*.json`（编译）、`build/entitlements.mac.plist`（macOS 权限声明） |
| 脚本 | `scripts/`（按用途分目录：`build/` 构建后处理、`release/` 发版、`git-hooks/` 提交规范、`dev/` 开发期辅助、`migrate/` 数据迁移） |
| CI | `.github/workflows/`（`build-and-release.yml` 正式发布 / `auto-build.yml` 提交验证） |
| 运行时要求 | Node.js >= 18，pnpm 10.32.0（勿改用 npm / yarn） |

### 常用命令

```bash
pnpm dev                # 主进程 + 渲染层热更新一起起
pnpm test               # 跑单元测试（vitest run，非 watch，跑完自己退出）
pnpm run build          # 完整构建（clean → 编译 → Rust 原生模块 → 打包 → 便携版后处理）
pnpm run build:electron # 只编译主进程与 preload
pnpm run build:react    # 只构建渲染层
pnpm run build:rust     # 只编译 src/ 下各功能目录里的 Rust crate（没装 cargo 时只警告）
pnpm run build:app      # 只跑 electron-builder（打包前会自动生成图标）
pnpm run generate:icons # 只生成图标（macOS 的 .icns + 运行时 PNG）
pnpm run release:patch  # 发补丁版本（1.13.0 → 1.13.1）
pnpm run sonar:issues   # 拉 SonarCloud 的问题清单（不需要 Java）
pnpm run verify:sonar   # 同上，但命中拦截级别就退出码 1
pnpm run sonar:local    # 本地现扫（SonarJS 规则，不需要令牌）
pnpm run lint           # ESLint（缺陷类 + 安全类规则）
pnpm run test:coverage  # 跑测试并产出 lcov 覆盖率报告
```

> `build:main` 会先跑 `scripts/build/prune-dist.js`，把 `dist/` 里已经没有源文件对应的
> 陈旧产物剔掉。**tsc 不会清理旧产物**，而 CommonJS 解析是「文件优先于目录」——
> 源码里把 `a.ts` 改名成 `a/` 目录后，`dist/main/a.js` 会盖住 `dist/main/a/index.js`，
> 运行时报 `xxx is not a function`（实测在 `gitlabBot/runner` 与 `handlers/plugin` 两处都中过招）。
> 只跑 `tsc -w` 的 watch 模式不会清，改了目录结构后要手动跑一次 `pnpm run build:electron`。

---

## 2. 提交规范（Angular 提交规范）

### 2.1 格式

```
<type>(<scope>): <subject>

[可选正文]

[可选脚注]
```

- `type` 必填，取值见 2.2
- `scope` 可选，指明改动落在哪个模块
- `subject` 必填，一句话说清"改了什么"
- 正文与脚注之间空一行

### 2.2 type 取值

| type | 用途 | 触发版本位 |
| --- | --- | --- |
| `feat` | 新增功能 | **minor** |
| `fix` | 修复缺陷 | patch |
| `perf` | 性能优化（用户可感知） | patch |
| `refactor` | 重构，既不改行为也不加功能 | patch |
| `style` | 纯格式调整（缩进、分号、命名），不改行为 | patch |
| `docs` | 文档、注释 | patch |
| `test` | 测试 | patch |
| `build` | 构建系统、打包配置、依赖 | patch |
| `ci` | CI 流程、GitHub Actions | patch |
| `chore` | 杂项（版本号 bump、配置微调等） | patch |
| `revert` | 回滚此前的提交 | patch |


- **删除内部 preload 暴露按 `refactor` 计，不视为破坏性变更。**
- 反过来，如果删的是渲染层**正在用**的暴露，那不是清理，是缺陷，


### 2.3 scope 怎么写

- 用模块名，**小写**，可多选：`feat(ocr):`、`fix(renderer,main):`
- 本项目常用 scope：`main`、`renderer`、`ocr`、`ai`、`notes`、`clipboard`、`browser`、`shortcut`、`todo`、`leetcode`、`updater`、`build`、`ci`、`docs`
- 跨端改动把两端都写上：`fix(main,renderer):`
- 拿不准就不写 scope，别硬凑

### 2.4 subject 怎么写

- **祈使句、描述"做了什么"**：`feat(ocr): 增加百度 OCR 表格识别` ✅
- 不写"做了什么"的反面：`refactor: 重构了 OCR 模块` ❌（说清改成什么了）
- **句末不加句号**
- 中文正文里不要用第一人称（"我"），也不要用"已"、"了"这类完成态后缀
- 长度：中文 ≤ 30 字，英文 ≤ 72 字符
- 一个提交只做一件事。顺手改的无关代码请拆成独立提交

### 2.5 正文与脚注


```
fix(updater): 修正检查更新时版本号比较始终判定为最新

latest.yml 里的版本号取自 appInfo.version，而 auto-build 之前用
ELECTRON_BUILDER_VERSION 覆盖版本 —— 该变量在 electron-builder 26.x
里并不生效，导致产物版本与发布 tag 不一致。

Closes #123
```


```
BREAKING CHANGE: update:install 通道改为要求先完成下载，参数签名变化。
```

### 2.6 校验



```bash
pnpm run verify:commit "feat(updater): 增加应用更新卡片"
```



- `type` 不在白名单内
- `scope` 含大写字母或非法字符、scope 为空括号
- 首行超过 72 字符；中文 subject 超过 30 字
- subject 末尾有句号、以「了」「的」结尾、以「已经」开头
- subject 里有连续空格
- `BREAKING CHANGE:` 脚注写了但内容为空


- subject 是否真的说清了"改了什么"（祈使句）
- 一个提交是否只做了一件事
- 有没有第一人称"我"
- 改动有没有碰到不该碰的文件

---

## 3. 版本号规范

### 3.1 格式

```
MAJOR.MINOR.PATCH        例：1.19.0
```

- 三段纯数字，不带 `v` 前缀、不带 `-rc` 之类后缀
- 当前发布线是 **2.3.x**
  - 换线理由：2.3.0 收拢 2.2.0 之后的一批改动 —— 技能页新增「工具」页签
    （内置工具的就地配置入口）、GitLab 机器人的配置与 webhook 管理简化，
    以及一轮全仓 review 修掉的缺陷：AI 运行时的超时与换 provider 处理、
    插件授权与资源包打包收紧、笔记 IPC 绑定配置根目录、笔记页刷新不再丢
    未保存内容、待办提醒时间的上下午解析、发版脚本的版本 bump 顺序。
    新增功能只有「工具」页签一处，按 3.2 走 minor。
    上一条线 2.2.0 把插件系统补到可用状态 —— 授权改成逐项授权并能逐项撤销、
    依赖解析支持 id@^1.0.0、市场带版本与依赖并能升级、发布前拦网关不兼容的 IP
    字面量、老应用迁移脚本独立成入口；SDK 通道从长轮询换成插件注册回调地址，
    两个方向都变成一次 HTTP 往返。宿主 API 面与插件侧 ctx 接口没有变化，
    插件作者需要更新 SDK 副本 —— 按 3.2 走 minor。
    上一条线 2.1.x 在插件系统之上补齐命令面板、侧栏动态入口、插件设置面板与
    插件通知，并统一版本号读取入口 —— 都是新增功能，按 3.2 走 minor。
    再往前的 2.0.x 把【应用】模块重做成 VSCode 式插件系统 —— 清单从 qnote.json
    改为 plugin.json，权限改成声明式 capabilities，插件通过 SDK 注册命令与取数据。
    按 3.2 的规则这是破坏性变更，要求 major 版本，而 major 落在 2.0.0。
    再往前的 1.14.x 发布了 macOS 自研安装包更新通道、灵动岛侧边停靠与摘要
    复制、技能页拆分、MCP 服务与网页检索工具、自研拖拽重排引擎（替换 dnd-kit），
    1.14.1 修了 mac 安装脚本的路径归一化。1.15.0 让笔记里的 md 链接可点击，
    并把 AI 组件与功能级工具下沉到 pages/。1.16.0 加了待办提醒时间与 AI 的
    create_todo / update_todo 工具，并修掉一批质量门禁问题。1.17.0 在此之上
    增加 Todo 的「本周」页签 —— 完成时间或创建时间落在本周的待办都归进去。
    1.18.0 把笔记内容处理、清单命令风险分析、待办时间解析、AI 会话摘要与
    网页解析这几块纯逻辑单元移植成 Rust 原生模块，主进程优先走原生实现、
    加载不到时回退 TS 实现。1.19.0 把公共目录从 Cloudflare Worker 与直连
    D1 合并为 TiDB Cloud Data Service，并把笔记目录扫描改成分层懒加载 ——
    选中大目录不再卡死主进程。
  - 换线必须同步改 `scripts/release/verify-version.js` 的 `RELEASE_LINE` ——
    两处不一致会被版本号校验拦下。
  - **切线与 version bump 不能拆成两个提交，更不能把切线提交单独推到 master。**
    只改 `RELEASE_LINE`、不动 `package.json` 的 version 时，
    `verify-version.js` 会判定「不在当前发布线上」并退出非零 ——
    `auto-build.yml` 的 "Verify version format" 步骤随之失败，
    那次推 master 的 CI 是红的（2026-11-05 的 `b462f6a` 就是这样：
    切线与 bump 分成两个提交，中间那个推上去时 package.json 还是 1.8.0）。
    - **手工换线**：切线与 `package.json` 的 version bump 合成**同一个提交**再推。
    - **用 `pnpm run release:minor` 换线**（见 3.4 的正规路径）：切线提交是脚本
      bump 之前的那个中间提交，**在 bump 完成前不要推 master** ——
      手工再改一次 version 会被脚本的 bump 顶成下一个版本号。
- **版本号的唯一来源是根目录 `package.json` 的 `version` 字段**，任何地方都不许另造版本号

### 3.2 语义化版本

| 场景 | 变更 |
| --- | --- |
| 修复缺陷、性能优化、重构、文档、测试、构建、CI、杂项 | patch（1.13.0 → 1.13.1） |
| 新增功能 | minor（1.13.0 → 1.14.0） |
| 不兼容的 API / 配置 / 数据结构变更 | major（1.13.0 → 2.0.0） |


### 3.3 Tag 与 Release

- **Tag 名 = 版本号本身**：`1.13.0`，**不加 `v` 前缀**
- Release 标题 = `QNote 1.13.0`
- Tag 必须与 `package.json` 的 `version` 完全一致
- tag 是**带注释的**（`git tag -a`），注释写 `Release 1.13.0`
- 一个版本号只发一次。改过内容要重发，就 bump 到下一个 patch 号


### 3.4 发版流程


```bash
pnpm run release:patch    # 或 release:minor / release:major
```





### 3.5 校验

```bash
pnpm run verify:version
```


---

## 4. 红线


- 任何 API Key、Secret、Token、密码、私钥 —— 包括看起来像测试值的真 key
- 用户的笔记内容、剪贴板记录、数据库文件
- 构建产物：`dist/`、`dist_electron/`、`*.exe`、`*.zip`
- 本地开发数据：`.data/`、`*.db`、`*.log`、`.env`



```bash
git diff --cached | grep -nEi "sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*['\"][^'\"]{8,}|secret"
```

---

## 5. 提交前的检查清单

- [ ] 提交信息符合第 2 节（type / scope / subject / 脚注）
- [ ] 一个提交只做一件事，无关改动已拆开
- [ ] 没有密钥、用户数据、构建产物被提交（第 4 节）
- [ ] `pnpm run build:electron` 通过（改过主进程或 preload）
- [ ] `pnpm run build:react` 通过（改过渲染层）
- [ ] `pnpm test` 通过（改过渲染层或公共逻辑）
- [ ] `pnpm run sonar:issues` 无命中拦截级别的问题（改过主进程 / 脚本 / 渲染层）
- [ ] 新增/修改的 UI 遵循 `.cursor/rules/react.mdc` 的 React 最佳实践
- [ ] 改过 `.github/workflows/` 的，检查脚本里有无非 ASCII 字符（有就用 `shell: pwsh`，见 6.2）
- [ ] 没有顺手改无关文件；格式化工具的噪音改动单独成一个 `style:` 提交

---

## 6. 目录与改动落点

### 6.1 目录按功能分两层，别平铺


```
src/main/handlers/notes/     src/main/handlers/ai/     src/main/handlers/plugin/
src/main/handlers/browser/   src/main/handlers/clipboard/  src/main/handlers/island/
src/main/handlers/todo/      src/main/handlers/shortcut/   src/main/handlers/sticky/
src/main/handlers/update/    src/main/handlers/cloud/      src/main/handlers/system/
src/main/core/notes/         src/main/core/ai/        src/main/core/plugin/
src/main/core/clipboard/     src/main/core/shortcut/  src/main/core/update/
src/main/core/system/        ← 常驻单例：settings store、退出态、config、log
src/main/core/window/<功能>/  ← 窗口按功能分：island/ sticky/ clipboard/ browser/ plugin/
src/main/core/ai/<模块>/      ← AI 功能域：memory/ observability/ prompts/ runtime/ skills/ tools/
src/main/utils/              ← 扁平，无子目录：只放纯工具
src/shared/notes/            src/shared/ai/           src/shared/plugin/
src/shared/clipboard/        src/shared/cloud/        src/shared/island/  src/shared/sticky/
src/renderer/components/<公共件>/  ← ui/ panel/ shell/（只放跨页面复用的公共件，功能级界面归到 pages/<功能>/）
src/renderer/pages/<功能>/        ← ai/ browser/ clipboard-popup/ home/ island/ plugin/
                                     leetcode/ notes/ settings/ skills/ sticky/ todo/
src/renderer/hooks/<功能>/       ← ai/ browser/ panel/ plugin/ sticky/ shell/ system/ ui/
src/renderer/utils/<功能>/       ← clipboard/ system/（只放跨页面复用的公共工具，功能级工具归到 pages/<功能>/）
src/renderer/pages/<功能>/       ← home/ notes/ settings/ todo/ browser/ skills/ plugin/
```



| 改动类型 | 落在哪 |
| --- | --- |
| 主进程能力、IPC、窗口、原生能力 | `src/main/`（handler 放 `src/main/handlers/<功能>/`，常驻能力与功能域放 `src/main/core/<功能>/`，纯工具放 `src/main/utils/`（扁平，不分子目录）） |
| 渲染层界面 | 公共件放 `src/renderer/components/<公共件>/`（跨页面复用才留这儿）；业务件放 `src/renderer/pages/<功能>/` |
| 页面页头（标题 / 图标 / 副标题 / 右侧操作） | `src/renderer/components/shell/PageHeader.tsx`（标题 20px / 700，图标 20px，页头下间距 `mb-8`） |
| Rust 原生模块（纯逻辑单元的 Rust 移植） | crate 放在服务它的功能目录内（`src/shared/<功能>/<功能>-rs/`、`src/main/core/ai/tools/web/web-rs/`），主进程入口 `src/main/core/<功能>/native*.ts`，加载器 `src/main/core/system/nativeModules.ts`，编译 `scripts/build/build-rust.js`，见 6.10 |
| 渲染层页面（路由级） | `src/renderer/pages/<功能>/`（页面与它的测试文件放同一个功能目录，如 `pages/notes/NotesPage.tsx` + `pages/notes/NotesPage.test.tsx`） |
| 跨端共享类型 | `src/shared/<功能>/` |
| 数据表与迁移 | `src/database/` |
| 插件系统（清单、进程启停、预览、SDK） | `src/main/core/plugin/`（按模块分子目录：`runtime/` `permissions/` `dependencies/` `market/` `migration/` `manifest/` `sdk/`）、`src/main/handlers/plugin/`、`src/main/core/window/plugin/`、`src/shared/plugin/`、`src/renderer/pages/plugin/` |
| AI 功能域（对话、Agent、记忆、提示词、工具调用、向量库） | `src/main/core/ai/`（平铺的 `aiService.ts` / `providers.ts` / `toolContext.ts` 等 + `memory/` `observability/` `prompts/` `runtime/` `skills/` `tools/` 子目录）、`src/main/handlers/ai/`、`src/shared/ai/`、`src/renderer/pages/ai/`（渲染层 AI 界面：浮窗助手、桌宠、对话面板） | 主进程 AI 域各功能目录的测试文件放进该目录自己的 `test/` 子目录，不平铺（如 `core/ai/mcp/toolName.ts` + `core/ai/mcp/test/toolName.test.ts`） |
| AI 工具接入代码托管平台（GitLab / GitHub） | `src/main/core/ai/tools/<平台>/`（按模块分子目录：`api/` `runtime/` `schemas/` `tools/` `utils/`），平台之间不互拷：纯逻辑共用件放 `src/main/core/ai/tools/shared/`（`cursor.ts` 翻页句柄、`tokens.ts` 体积估算、`list.ts` 列表分页、`qnoteOverflow.ts` 溢出落盘）。一个平台要接的落点一共九处：`tools/<平台>/index.ts`（工具清单）、`tools/catalog.ts`（META 分组 + 目录条目）、`tools/registry.ts`（按配置挂载）、`tools/index.ts`（导出）、`runtime/configStore.ts`（配置存 settings 表）、`handlers/ai/toolHandlers.ts`（配置 IPC + 未配置标记）、`main/preload.ts` + `renderer/electron.d.ts`（IPC 绑定）、`main/index.ts`（初始化配置存储）、`renderer/pages/skills/<平台>ConfigButton.tsx`（设置页按钮），另加 `core/ai/prompts/agentSystem.ts` 的工具说明段 |
| 清单命令的风险分析（市场来源插件的启动确认） | `src/shared/plugin/permissions/pluginRisk.ts`（纯函数）、`src/main/core/plugin/runtime/pluginManager.ts`（`checkStartConfirmation` / `confirmStart`）、`src/renderer/pages/plugin/runtime/StartConfirmDialog.tsx` |
| 插件声明式权限的判定 | `src/main/core/plugin/permissions/capabilities.ts`（`checkCapability`）、`src/shared/plugin/manifest/pluginManifest.ts`（清单校验） |
| 插件 SDK 通道与宿主 API | `src/main/core/plugin/sdk/rpcServer.ts`（传输）、`src/main/core/plugin/sdk/hostApi.ts`（API 面）、`resources/plugin-sdk/`（插件侧 SDK）、`src/shared/plugin/sdk/protocol.ts`（协议） |
| 通用面板件（可折叠侧栏、拖拽分割线、宽度偏好） | `src/renderer/components/panel/`、`src/renderer/hooks/panel/usePanelWidth.ts`、`src/renderer/hooks/panel/useCoalescedStorage.ts`（合并写盘：拖拽时别每帧同步写 localStorage） |
| 拖拽重排（列表 / 行 / dock 换序的手感） | `src/renderer/hooks/ui/useDragReorder.ts`（引擎）、`src/renderer/hooks/ui/dragReorderGeometry.ts`（几何纯函数）、`src/renderer/styles/drag-reorder.css`（动效）—— 自研，别再引 dnd-kit（已移除） |
| 上下分栏（笔记树 / 外部文件夹，默认 6:4，可拖动） | `src/renderer/components/panel/PanelHeightResizer.tsx`（纵向分割线）、`src/renderer/hooks/panel/useSplitRatio.ts`（比例持久化）、`src/renderer/pages/notes/layout.ts`（比例与收起态高度常量） |
| 灵动岛（最小化后顶在屏幕顶边的浮层） | `src/shared/island/island.ts`（契约）、`src/main/core/window/island/island.ts`（窗口与几何）、`src/main/handlers/island/islandHandlers.ts`（IPC）、`src/renderer/pages/island/`（界面） |
| 云端存储（共享数据放 TiDB Cloud，私有数据留本地） | `src/database/cloud/`（存储层）、`src/main/handlers/cloud/cloudHandlers.ts`（IPC）、`src/renderer/pages/settings/CloudStorageCard.tsx`、`src/renderer/pages/plugin/market/PublishedPluginMarket.tsx`、`data-app/`（Data App 配置：端点定义 + SQL） |
| 主进程运行时路径（preload、资源、开发态仓库根） | `src/main/utils/paths.ts`（`getPreloadPath()` / `getDevRoot()`） |
| 打包 / 发布配置 | `build/`、`scripts/`、`.github/workflows/` |
| 静态分析 / 质量门禁 | `sonar-project.properties`（分析范围）、`eslint.config.mjs` + `tsconfig.lint.json`（本地 SonarJS 规则）、`scripts/quality/`（清单与门禁脚本）、`scripts/quality/eslint-rules/`（QNote 自定义规则，见 6.8）、`.github/workflows/sonar.yml`（扫描）、`docs/SONAR.md` + `docs/SONAR-DEBT.md`（规范与存量债台账） |


1. `src/main/handlers/<功能>/<模块>.ts` 注册 channel（业务 IPC）
2. `src/main/index.ts` 注册 channel（应用级 IPC：悬浮窗、语音热键、剪贴板面板热键、外链打开）
3. `src/main/core/window/mainWindow.ts` 注册 channel（窗口最小化/最大化/关闭/开发者工具）
4. `src/main/core/window/clipboard/clipboardPopup.ts` 注册 channel（剪贴板弹窗关闭/显示主窗口）
5. `src/main/preload.ts` 暴露给渲染层
6. `src/renderer/electron.d.ts` 补类型声明

### 6.2 CI 脚本里出现中文时，shell 必须用 pwsh



```
The string is missing the terminator: ".
```




### 6.3 macOS 打包


| 项 | 说明 |
| --- | --- |
| 产物 | `QNote-<版本>-mac-arm64.dmg` / `-mac-x64.dmg`，以及同名的 `.zip` |
| 架构 | arm64（Apple Silicon）与 x64（Intel），**一次 electron-builder 调用同时出** |
| 打包配置 | `build/electron-builder.json` 的 `mac` 段 |
| 权限声明 | `build/entitlements.mac.plist` |
| 图标 | `scripts/build/generate-icons.js` 从 `src/renderer/public/icon.svg` 生成 |
| 自动更新元数据 | `latest-mac.yml`（Windows 那份是 `latest.yml`，两个不能混） |


- **两个架构必须一次构建**。electron-builder 只会写一份 `latest-mac.yml`，
- **dmg 与 zip 都要出**。mac 自动更新靠 zip，dmg 不支持差分更新。
- **`latest-mac.yml` 必须与安装包在同一个 Release 里**，否则 mac 用户点
- **`.blockmap` 也要跟着产物发布**。electron-updater 按 `<产物名>.blockmap`
- **图标不能用 `.ico`**。Electron 的 `nativeImage` 在 macOS / Linux 上读
- **macOS 应用图标要满幅方形**（圆角由系统遮罩加），而托盘 / 窗口图标是
- **Hardened Runtime 下必须声明 `com.apple.security.cs.disable-library-validation`**，
- **mac 自动更新要求应用已签名**。未签名的 mac 版能安装，但更新装不上。


### 6.4 插件系统：清单规范与 SDK

- **导入的就是插件本身**：没有「根目录 + 扫描子目录」这层 ——
- **清单是唯一入口**：插件根目录下必须有一份 `plugin.json`，名字不是 `qnote.json`
- **不合规不落库**：导入时清单解析不过就不写进数据库，
- **清单写在插件里，不写数据库**：插件库（`plugin` 表）只存索引，
- **两个 id 各司其职**：`id` 是对外业务标识（`publisher.name`，字符串），
  `local_id` 是本地自增号。**预览协议的 host 段 `qnote-app://p<local_id>/` 只认数字**，
  所以内部一律用 `local_id`，别把字符串 id 塞进 URL
- **私有协议 `qnote-app://` 不能改**：`protocol.registerSchemesAsPrivileged`
- **清单里的 `command` 是经 shell 执行的**（`spawn(..., shell: true)`）——
  - `plugin` 表有 `origin`（`local` / `market`）与
    `confirmed_manifest_hash` 两列，**后者存的是清单内容的哈希** ——
    清单改了就对不上，确认框会再弹一次
  - 判定逻辑在 `PluginManager.checkStartConfirmation` ——
    **单独成方法是为了能脱离 spawn 来测**，别为了省事把它塞回 startPlugin
  - 风险分析在 `src/shared/plugin/permissions/pluginRisk.ts`（纯函数）。它**不是安全边界** ——
    关键词匹配挡不住刻意伪装，真正的防线是「来源标记 + 运行前确认」
  - 市场导入走 `plugin:import-from-market` **专用路径**：
    目标目录已有 `plugin.json` 就拒绝，**一个字节都不动**。
    别改回「写清单 + 导入插件」两步 —— 两步分开的话清单已经写了，
    导入才发现失败，用户自己已有插件的清单就被换成了别人的命令
- **没声明 `capabilities` 就是最小权限**：只能加载预览页面，不能起子进程、
  不能读写笔记待办。**`process.spawn` 没声明时启动直接被拒**，
  判定在 `src/main/core/plugin/permissions/capabilities.ts` 的 `checkCapability`
- **SDK 通道是 loopback HTTP + 插件注册回调地址**（`src/main/core/plugin/sdk/rpcServer.ts`）：
  插件进程靠 `QNOTE_PLUGIN_RPC` / `QNOTE_PLUGIN_TOKEN` 环境变量接进来，
  起来后自己 `listen(0, "127.0.0.1")` 起回调服务，向宿主 `POST /register-callback`
  报端口。两个方向都是**一次 HTTP 往返**，请求与结果装在同一个响应里。
  **别改回 WebSocket** —— 插件的 stdout/stderr 要原样给用户看日志，
  stdin 是单向的撑不起「插件 → 宿主」的调用；
  **也别改回长轮询** —— 请求与响应拆成两半要靠 id 配对，
  宿主侧得多养一套 pending 表，插件侧还得串行轮询
- **宿主 API 面**在 `src/main/core/plugin/sdk/hostApi.ts`：
  `qnote.notify` / `qnote.log` / `qnote.settings.*` / `qnote.commands.*` /
  `qnote.todos.list` / `qnote.notes.list`。数据访问一律走主进程，
  插件不许直接碰 SQLite
- **插件侧 SDK** 是 `resources/plugin-sdk/qnote-plugin-sdk.js`（纯 ESM，无构建步骤）。
  插件作者 `import` 它，导出 `activate(ctx)` / `deactivate()`
- **老应用迁移是幂等的**：`src/main/core/plugin/migration/legacyMigration.ts` 在插件管理器
  初始化时跑一次，把 `app_project` 里的老记录转成插件并在插件目录补一份
  `plugin.json`。**原 `qnote.json` 与 `app_project` 表都不删** —— 留回滚口子
- **原生视图盖在 DOM 之上**：预览区是 `WebContentsView`，
- **`useNativeViewCover` 是持有者集合**：多个页面各自持有原生视图时，
- **侧栏的折叠与伸缩用 `ResizableSidebar`**：折叠、拖拽调宽、宽度上限、
- **拖拽分割线是 flex 子节点**：`PanelResizer` 真实占位，不叠在侧栏边缘。

- **插件目录按功能模块分子目录**：同一层的插件文件按模块归到子目录，跨层用
  同一套模块名（`manifest` / `runtime` / `permissions` / `dependencies` / `sdk` /
  `market` / `migration` / `dialog`）—— 共享层 `src/shared/plugin/<模块>/`、
  主进程 `src/main/core/plugin/<模块>/`、IPC `src/main/handlers/plugin/<模块>/`、
  渲染层 `src/renderer/pages/plugin/<模块>/`。**别再把同域文件平铺在一个目录里**。
  入口文件（路由页 `pages/plugin/PluginsPage.tsx`、模块主控
  `core/plugin/runtime/pluginManager.ts`）留在功能目录根，其余下沉到子目录。
- **授权粒度落在 `plugin_grant` 表**：清单声明的权限拆成一项一项（读笔记 / 写笔记 /
  读待办 …），`plugin_grant` 存 `plugin_id` + `capability` + `granted`。
  设置页能逐项撤销，**撤销后下一次调用立刻失败**（不用重启插件）。
  判定在 `hostApi.requireCapability` 一处 —— 清单声明 + 用户授权两道都要过。
  `checkCapability` 保持纯函数，**别把查库塞进去**。
- **同步授权别把用户的撤销抹回去**：清单变更时只给**新增**的项写 `granted=1`，
  已存在的行保留用户的选择；清单里不再声明的项删掉。
- **依赖解析在 `pluginDependencies.ts`**：`extensionDependencies` 格式 `id` 或
  `id@^1.0.0`，版本比对复用 `pluginManifest.ts` 的 `satisfiesRange`。
  依赖缺失或版本不满足 → **拒绝激活并指明缺哪个**，不做自动安装。
- **市场版本与升级**：`published_app` 带 `version` / `dependencies` 两列，
  本地镜像与 TiDB 两套后端都写。装的是**指定版本**；升级走
  `plugin:upgrade-from-market` —— 覆盖清单与资源包、**清掉确认指纹**，
  下次运行重新走一次权限确认。
- **发布前先查 IP 字面量**：`preview` 的 url、`runtime.env` 的值、
  `capabilities.network` 的模式里出现带 scheme 的 IP 链接就拒发
  （AWS ALB 的硬约束）。**纯主机名 `http://localhost` 与不带 scheme 的
  `127.0.0.1:7799` 放行**。
- **迁移脚本能单独跑**：`pnpm run migrate:plugins`（先 `build:main`，
  支持 `--user-data <dir>`），幂等，老 `qnote.json` 不删不改。

### 6.5 灵动岛


- **尺寸动画由主进程逐帧 `setBounds` 驱动**。Electron 的 `setBounds(bounds, animate)`
- **收起横条的宽度是定死的 400**（等于展开宽度），不再由渲染层量出来报给主进程
  —— `island:set-collapsed-width` 整条链路已删。展开时只变高度，没有横向抖动；
  侧边竖条的宽度是定死的 44。
- **收起条上的剪切板文字点一下就复制**：走 `popup-copy-clipboard-item` 把那条写回系统剪贴板，
  摘要短暂显示「已复制」。点它**不能**顺手把岛展开 —— 摘要按钮的 `onPointerDown`
  必须 `stopPropagation`，否则胶囊的拖拽逻辑会把它当成点击胶囊。
- **摘要优先级**：AI 运行中 > 剪切板第一条 > 未完成待办 > 最近笔记；只有剪切板来源可点复制。
- **停靠边有三条**：`top`（横条）/ `left` / `right`（竖条），记在配置里的 `dockEdge`。
  拖动松手时取离得最近的那条边吸附（三条都够远就浮着）。
- **吸附目标屏按指针位置判，不按卡片中心**：卡片比指针宽，拖到屏幕边缘时中心会越过
  边界落进隔壁屏 —— 按中心判会把岛吸到隔壁屏的左边缘，看着就像「消失了」。
- **贴着屏幕的那一侧是直角**，浮着时四角一样圆（`data-attach` + `data-edge`）。
- **整块岛不画阴影**：阴影太重；窗口也不再比卡片大一圈 —— 窗口就是卡片本身。
- **鼠标不在卡片上时，窗口要放成穿透**（`island:set-interactive` →
- **拖动期间不能改穿透状态**：窗口一放行鼠标，渲染层的指针捕获就丢了，
- **拖动位置直接发 IPC，别攒到下一帧**：攒一帧就是白白多等 16ms（60Hz），
- **岛不跟着鼠标换屏**：放在哪块屏就留在哪块屏，显示器 id 记在配置里
- **吸回边缘只改垂直于那条边的坐标**：吸回顶边只改纵向，横向停在用户放的地方；
- **侧边竖条和展开面板等高**（都是 480），所以侧边打开时只有宽度在变 ——
  贴着停靠边横向铺开，不是从上往下掉。
- **展开动画不回弹**（`easeOutQuint`，约等于 DESIGN.md 那条
- **面板内容一直挂着**，不跟着展开收起卸载 —— 展开那一刻才 mount 一大棵列表，
- **岛的配色要单独钉**。`--island-*` 是私有 token，CSS 文字对比度守卫不认
- **dev 实例连不上 CDP**（`/json/list` 永远不返回），看岛的界面只能靠
- **主窗口回前台时岛自动隐藏**：主窗口 `restore` / `showMainWindow` 时收起岛，
- **置顶层级用 `screen-saver`**（Windows 层级里最高的一档）。默认的
- **每次显示都要重新设一次置顶层级**：Windows 上透明层窗口隐藏再显示之后，

### 6.6 SonarQube Cloud 质量门禁


- **分析范围写在 `sonar-project.properties` 里，不在脚本里**。`sonar.sources` 必须
- **覆盖率必须真的产出 lcov**。`pnpm run test:coverage` 跑出
- **门禁查的是最近一次分析，不是现扫**。本地查 API 不需要 Java；现扫要 JDK 17+
- **CI 里判定要带 `--wait`**：扫描器把结果传上去之后计算任务还要跑一会儿，
- **令牌缺失时门禁跳过，不阻断发版**。令牌来自环境变量 `SONAR_TOKEN` 或
- **默认拦「缺陷 + 漏洞」两类**（`BUG` / `VULNERABILITY`），代码异味只报不拦。
- **门禁是发版流水线的前置 job**（`needs: sonar-gate`）：门禁红了，Windows 与 macOS 的
  打包和 `release` 会被整个跳过 —— tag 推上去了也不会有安装包和 Release。
- **门禁脚本的退出码**：`0` 放行；`1` = 命中拦截项（CI 判失败）；`2` = 无法判定
  （令牌/网络/分析没出来），CI 把 `2` 当 warning 放行。脚本只按「有没有 BUG /
  VULNERABILITY」判，SonarCloud 自带那道门禁（比如新代码覆盖率）只是打 warning。
- **门禁红了去哪儿看问题清单**：项目是私有的，匿名调 SonarCloud API 拿不到
  （`issues/search` 返回 200 但 total=0）。真清单在 CI 产物 `sonar-issues` 里
  （`.data/sonar/sonar-issues.md` + `.json`，含逐条位置与规则），门禁原始输出在
  job logs 里。两者都要鉴权：可以用 `git credential fill` 里已存的凭据调
  `api.github.com`（**别把令牌打印出来**）。
- **严重级别有两套名字**：Cloud 换成了新的 impact 模型（BLOCKER / HIGH / MEDIUM / LOW），
- **门禁放在 bump 版本号之前**（`scripts/release/release.js`）：不过就不改版本号、
- **`.data/sonar/` 是清单落点**（`sonar-issues.md` + `sonar-issues.json`），
- **存量债有台账**（`docs/SONAR-DEBT.md`）：哪些清了、哪些**判��后决定不追**、

#### 用户要求修复 Sonar 问题时的标准动作


```bash
pnpm run sonar:issues        # 出清单（不阻断），清单同时写到 .data/sonar/
pnpm run verify:sonar        # 同上，但命中拦截级别就退出码 1（等价于 --gate）
```


```bash
pnpm run sonar:local         # 本地现扫，error + warning 清单
pnpm run sonar:local -- --gate   # 有 error 就退出码 1
pnpm run lint                # 同上的底层命令（eslint .）
pnpm run lint:fix            # 能自动修的机械问题（未用 import、prefer-const 等）
```



1. **先看概览**：按严重级别、类型、规则分布排序 —— 同一类规则成片出现时，
2. **只修真实问题**。清单里有噪音是正常的：
   - 规则本来就对、只是触发姿势特殊 → 用 `// NOSONAR` 标注并写清理由
     （仓库里已有先例，见 `src/main/core/window/apps/appPreview.ts`）
   - 误报 / 不可复现 → 别改代码去迎合扫描器，先确认是不是分析范围配错了
3. **改完复跑**：同一个命令再跑一次，确认这批消失了、没带出新的。
4. **按第 2 节拆提交**：一条规则一批改动，不要把不同规则混在一个提交里。
5. **别顺手改无关文件**：Sonar 清单会把整个仓库的问题都列出来，


### 6.7 云端存储：共享数据与私有数据的边界


| 层 | 内容 | 存哪 |
| --- | --- | --- |
| **私有** | 笔记、剪贴板、Todo、AI 对话、快捷方式、书签、题单、记忆索引、设置 | **永远本地 SQLite**，零改动 |
| **共享** | 已发布的 APP 目录（`published_app`） | 本地 SQLite / **TiDB Cloud**，用户在设置页切 |


| 后端 | 连什么 | 用户要做什么 | 凭据在哪 |
| --- | --- | --- | --- |
| `local` | 本地 SQLite | 什么都不用做 | 无 |
| `catalog` | **TiDB Cloud Data Service**（固定端点，HTTPS 443） | 什么都不用做（连接信息已内置） | **只在 TiDB 侧** |


- **私有数据不上云**。别因为「反正有 TiDB 了」就把某个用户自有的表搬过去 —— 进云的只有 `published_app` 一张表。
- **公共目录的端点 SQL 写死在服务端**。客户端只能调 Data Service 里那几个固定端点，发不了任意 SQL —— 这是「内置但不暴露」的关键，别改成能发任意 SQL 的直连。
- **公共目录的端点定义在 `data-app/`**（Data App 声明式配置，`http_endpoints/config.json` + `http_endpoints/sql/`）。改端点先改那里再推给 TiDB Cloud 部署，客户端里的路径常量要与 `config.json` 对齐。端点路径用单段式（`/apps_list`），别用嵌套路径 —— SQL 文件名按 `<方法>-<端点路径>.sql` 落盘，多段路径的命名规则官方没写清。
- **数据库凭据永远不在客户端**。客户端只拿 API Key（Public Key / Private Key），它只能调已定义的端点，且能在 TiDB Cloud 控制台一键作废。
- **共享存储是多后端的**，各后端必须给出**一样的行为**。本地走 SQLite，公共目录走端点，两边对外语义要一致。
- **端点的参数传递按官方约定**：GET 的参数进 query string，POST 的参数进 JSON body。只用 GET / POST —— 更新与删除都走 POST，别碰 PUT / DELETE。
- **配置存在本地** `settings` 表（键名 `cloud_storage_config`）。
- **切到云端前先做真实的连通性检查**，通不过就不切，让用户留在本地。
- **API Key 不进仓库**：构建期由 `scripts/build/inject-catalog-credentials.js` 注入 `resources/catalog/credentials.json`（gitignore），主进程运行时读。**设置页不提供覆盖入口** —— 公共目录的连接信息固定跟着安装包走，用户那边不用填任何东西。
- **内置的公共目录连接信息会跟着安装包走**，Private Key 等同公开 —— 它只能调已定义的端点，出事可以在控制台作废。
- **公共目录前面的网关会拦「内容里带具体 IP 地址」的请求**：TiDB Cloud Data Service 前面挂的是 AWS ALB，它扫整个请求（URL、query、body），只要出现 `http://127.0.0.1:7799/`、`http://10.0.0.1` 这类**指向 IP 字面量的链接**就返回 `403 Forbidden`（HTML，`server: awselb/2.0`，不是 JSON）。纯主机名 `http://localhost` 与不带 scheme 的 `127.0.0.1:7799` 不受影响。清单里的 `preview` 现在只写端口号（`"preview": 7799`），不带 IP 字面量，发布不会被拦。
- **发布的应用带项目文件**：清单之外还有一列 `bundle` 存资源包（base64 的 deflate 包，打包与解开在 `src/main/core/apps/bundle.ts`）。发布时把项目目录一起传上去，别人「获取」时直接能跑。依赖目录、缓存与密钥文件不上传，单个应用超过 8MB 就不打包。
- **`bundle` 列要手动补一次**：公共目录在 Data Service 的 SQL 编辑器里跑 `ALTER TABLE qnote_catalog.published_app ADD COLUMN bundle MEDIUMTEXT NULL;`，端点定义在 `data-app/http_endpoints/` 里对账，实际改动要去 TiDB Cloud 控制台改端点 SQL 再点 Deploy —— 线上那个公共目录没接 GitHub，推仓库不会触发部署。这列已在 2026-11-20 补好，换新集群才要再跑一次。**列必须可空**：TiDB 不给 TEXT 列设默认值，而老客户端发布时不带 `bundle` 参数，NOT NULL 又没默认值会让整条 INSERT 报 `1364 Field 'bundle' doesn't have a default value`。**先建列再部署端点** —— 端点 SQL 里 `bundle` 进了 INSERT 列清单，列还不存在时发布会被整个打断，客户端的退回逻辑救不回来。没补之前客户端会退回「只发清单」（读回发现没有 bundle 就标 `bundleDropped`），不会报错 —— 端点不认的未知参数会被静默忽略，不能靠报错来判断。
- **共享表的 id 用字符串**，不用自增整数：自增 id 在本地库和云端库里
- **preload 不能 import `src/shared`**：preload 的 tsconfig 把 `rootDir`



### 6.8 机器可校验的规则（lint）

规则实现在 `scripts/quality/eslint-rules/`，由 `eslint.config.mjs` 以 `qnote/*` 挂上，`pnpm run lint` 会跑；新增功能目录后要把名字补进 `directory-layout.mjs` 的清单。

**core 与 utils 的分界**：`core/` 放进程级单例（跟着 app 生命周期活的状态），`utils/` 放纯逻辑。判据是「是不是常驻单例」，不是「有没有状态」。`src/main/utils/` 是**扁平**的，不分子目录 —— 凡是带功能域归属的内容，都归到 `core/<功能>/`。

| 规则 | 管什么 | 级别 |
| --- | --- | --- |
| `qnote/directory-layout` | 角色目录下的文件必须落在功能子目录里（别平铺）；功能子目录名要在已知清单内；`src/main/utils/` 是扁平的，出现子目录即 error | 平铺 error，新目录 warning |
| `qnote/no-manual-runtime-path` | 主进程运行期路径必须走 `src/main/utils/paths.ts`，不许手拼 `preload.js` / `package.json` | error |
| `qnote/preload-no-shared-import` | preload 不得 import `src/shared`（preload 的 tsconfig 把 rootDir 卡在 `src/main`） | error |
| `qnote/no-direct-database-import` | 渲染层与共享层不得直接引数据层，数据访问走主进程 IPC | error |
| `qnote/no-arbitrary-duration` | 禁止 `duration-[...]` 任意值时长（判歧义后规则根本不生成），改用 `tailwind.config.js` 登记的命名档位 | error |
| `qnote/no-module-state-in-utils` | `src/main/utils/` 里不许有模块级可变状态（模块级 `let`、导出的共享实例、会被改的 Map/Set）—— 那是 `core/` 的活 | error |
| `qnote/page-padding` | 页面根容器的边距必须是 `px-6 py-8`，`<PageHeader>` 下间距必须是 `mb-8`；全宽页面不写页面级边距 | error |

**页面边距是全局一档**：`px-6 py-8`（24px / 32px）+ 页头下间距 `mb-8`。

- 写新页面时根容器直接照抄 `px-6 py-8`，别自己挑 `px-4` / `py-6`，也别加 `sm:` 响应式变体
- 全宽页面（笔记、应用、浏览器、题单、主页）根容器不写 `px-` / `py-`
- 页头统一用 `src/renderer/components/shell/PageHeader.tsx`，下间距写在它的 `className` 上
- 由 `qnote/page-padding` 机器校验

### 6.9 拖拽重排：自研引擎，别用 dnd-kit

排序类交互（列表换序、行重排、dock 重排）统一走 `src/renderer/hooks/ui/useDragReorder.ts`，
动效样式在 `src/renderer/styles/drag-reorder.css`，几何算在 `dragReorderGeometry.ts`（纯函数，可单测）。
**dnd-kit 已移除** —— 它的「transform + 单一 transition」模型表达不了「落点细线从中间生长」、
「A x 0.7^n 的波纹 + 24ms x n 延迟」和「每段动效各自的曲线」，所以重写了引擎。

- **只用 transform 移动，不改 layout**：被拖的项 `position: absolute` 脱离文档流（原位闭合），
  其余项靠 `--drag-x` / `--drag-y` 摆位；拖动过程不再读 DOM 尺寸。
- **三条曲线各归各**：`--drag-ease-hand`（跟手 90ms）/ `--drag-ease-pop`（抬起 180ms）/
  `--drag-ease-spring`（落位 250ms，几乎不过冲）。别拿一个 ease-out 走天下。
- **落点细线是 15% 文字色**（`hsl(var(--foreground) / 0.15)`），画在空隙里，从中间生长、换空隙滑行；
  落点就是它自己的原位时不画线。
- **波纹振幅 A x 0.7^n，延迟 24ms x n**：离线近的先动、动得多（图标 A≈10px、卡片 A≈8px）。
- **落下用 FLIP**：记下落下瞬间的视觉位置，换序后用 transform 倒推回去再弹回 0。
- **键盘也能排**：空格/回车拾起、方向键移动、空格放下、Esc 取消，用 `aria-live` 播报位置。
- **reduced-motion 只留那条线**：项不位移、不缩放。
- **拖拽引擎自带样式**：`useDragReorder.ts` 里 import 了 CSS，别在页面里重复引。

### 6.10 Rust 原生模块：纯逻辑单元的 Rust 移植

用 rust-anything 把 TypeScript 里的「纯逻辑」单元逐块移植成 Rust crate。
**不是重写整个应用** —— 只给「纯逻辑」单元换实现，Electron 外壳、IPC、React 界面都留在 TS。

**crate 跟着功能目录走**：不建顶层 `rust/` 目录，crate 放在服务它的功能目录内，目录名统一 `*-rs` 后缀。

| crate | 移植的 TS 单元 | 主进程入口 |
| --- | --- | --- |
| `src/shared/notes/notes-rs/` | 笔记内容处理 | `src/main/core/notes/nativeNotes.ts` |
| `src/shared/plugin/plugin-rs/` | 清单命令风险分析 | `src/main/core/plugin/permissions/nativePlugin.ts` |
| `src/shared/todo/todo-rs/` | 待办时间解析与提醒判定 | `src/main/core/todo/nativeTodo.ts` |
| `src/shared/ai/ai-rs/` | 会话摘要与块序列化 | `src/main/core/ai/nativeAi.ts` |
| `src/main/core/ai/tools/web/web-rs/` | 网页解析与搜索结果提取 | `src/main/core/ai/tools/web/searchEngine.ts`（同文件内原地分派，避免循环依赖） |

| 项 | 说明 |
| --- | --- |
| crate 内部 | `src/port.rs` 是移植实现，`src/lib.rs` 与 `index.cjs` 是生成的绑定，`src/utf16.rs` 处理 UTF-16 码元 |
| 行为基线 | `cases.jsonl` —— TS 原实现跑出来的真实返回值 |
| 编译产物 | `dist/native/`（`.node` + 桥接层 `.cjs`），**不进 git** |
| 加载器 | `src/main/core/system/nativeModules.ts` —— 通用加载与模式切换，所有 crate 共用一份 |
| 打包 | `build/electron-builder.json` 的 extraResources 把 `dist/native` 放到 `resources/native`，**必须在 asar 之外** |
| 构建 | `pnpm run build:rust`（`scripts/build/build-rust.js` 扫 `src/**/Cargo.toml`），打包前自动跑 |
| CI | 两个工作流装好 rustup 后跑 `pnpm run build:rust`；`RUST_REQUIRED=1` 表示编不出来就中止 |
| 运行模式 | `RUST_ANYTHING_MODE=auto|old|shadow|new` —— auto 原生优先、加载失败回退 TS；old 只走 TS；shadow 两边都跑、不一致就 `log.warn`；new 缺原生模块直接报错 |

- **移植循环**：`analyze` → `bridge` → `record` → 写 `port.rs` → `build` → `diff` → `shadow` → `gate`，
  `gate` 全绿这个单元才算搬完。`diff` 必须 100% 一致才接进生产链路。
- **改签名后必须 `rust-anything refresh`** 重新生成绑定。
- **JS 返回 `null` 时别用 `Option<T>`** —— napi 会把它变成 `undefined`。
  返回 `serde_json::Value` 走 JSON 通道，`null` 才是 `null`。
- **JS 字符串按 UTF-16 码元索引**，用脚手架给的 `src/utf16.rs`，别按字节算。
  `Math.imul`、`toLowerCase` 的 final sigma、JS 的 `trim` 空白集都要自己还原。
- **TS 里会抛的地方，Rust 侧返回 `Err("TypeError: ...")`**，否则行为不一致。
- **JS 正则和 Rust regex 不等价**：Rust 的 `(?i)` 走 Unicode 折叠（ſ→s、U+212A→k），
  `\b` / `\d` / `\s` 的集合也与 JS 不同。移植时用占位符 `~s~` / `~k~` / `~az~` 展开成显式字符类，
  `\b` 写成 `(?-u:\b)`，`\d` 写成 `[0-9]`，`\s` 写成 JS 的空白集。
- **渲染层用不了原生模块**（浏览器里没有 `.node`）。`src/shared/` 下被渲染层 import 的值
  必须保留 TS 版本，只在主进程换成原生实现。
- **crate 相互独立**，不做 Cargo workspace，各自带 `Cargo.lock`；
  `*-rs` 目录要从 `build/tsconfig.main.json`、`tsconfig.lint.json`、`eslint.config.mjs` 三处排除。
- **没装 cargo 也能构建**：本地缺 Rust 时只警告，应用回退到 TS 实现。


### 6.11 AI 执行层：opencode（自研 Agent 循环已退役）

| 项 | 落点 |
| --- | --- |
| 运行时 | `src/main/core/ai/runtime/opencode/` —— `server.ts`（托管二进制）、`client.ts`（HTTP 薄客户端 + SSE）、`driver.ts`（事件→IPC）、`runtime.ts`（编排 + 会话映射）、`profile.ts`（agent profile）、`workspace.ts`（工作区文件）、`bridge.ts`（provider 映射） |
| 工具通道 | `src/main/core/ai/runtime/mcp/` —— QNote 侧 MCP server（Streamable HTTP + Bearer 鉴权），工具仍走 `tool()` 包装，**工具函数体一行不用改** |
| 系统提示词 | `src/main/core/ai/prompts/agentSystem.ts` 的 `AGENT_SYSTEM_TEXT`（纯文本，不依赖 LangChain 模板） |
| IPC 契约 | `ai-stream:thinking` / `chunk` / `tool-call` / `tool-result` / `end` / `error` / `compacting`；`need_continue` 与 `ai-continue-agent` 已下线 |
| 工具定义 | `src/main/core/ai/tools/tool.ts` 的自研 `tool()`（zod schema + `invoke` 解析），不再依赖 `@langchain/core/tools` |
| 直连模型 | `src/main/core/ai/providers.ts` 用 `node-fetch` 直接打 `/chat/completions` 或 `/v1/messages` |

- **opencode 是会话历史真相源**：QNote 的 `ai_chat` 表降级为展示镜像。
  chat 会话 → opencode 会话的映射靠 session 的 `metadata.qnoteChatSessionId`，
  重启后照样接得上（`runtime.ts` 的 `resolveOpencodeSessionId`）。
- **模型只看得到 QNote 自家工具**：agent profile 里写 `permission: {"*": deny, "qnote_*": allow}`，
  内置的 bash / edit / read 一律不发给模型。**规则顺序不能反** —— opencode 是后写的覆盖先写的，
  必须先 `"*": deny` 再按前缀 allow。
- **工具名带 `qnote_` 前缀**（opencode 给 MCP 工具加服务器名前缀），系统提示词里要写清这条。
  driver **不做前缀剥离**（它不认 opencode 的命名规则），统一由
  `catalog.ts` 的 `resolveToolDisplay()` 还原成 MCP server 里的原名并查出中文标题，
  `ToolCallRecord.title` 带着它一路到界面。
- **思考走独立通道**：opencode 的 reasoning part 单独走 `ai-stream:thinking`，
  **别再包成 `<think>` 标签塞进正文 chunk** —— 那会让正文里混进自己的编码。
  `BlockBuilder.pushThinking()` 收思考，`pushText()` 保留（模型原生输出的 `<think>` 仍要剥离）。
- **工具参数会晚到**：opencode 的工具 part 先 `pending`（参数还是空的）再 `running`（参数齐了）。
  driver 在 `running` 时补齐参数并再通知一次，界面上的工具卡片因此会更新两次，别当成重复事件。
- **SSE 翻译层砍不掉**：opencode 的 `POST /session/{id}/message` 响应**只给最后一个 assistant
  message**（中间的 reasoning、工具 part 全丢），完整历史得另外调 `GET /session/{id}/message`；
  要看到过程只有 SSE 一条路。所以「SSE → QNote IPC」这层翻译是必然的，别再想着砍它。
- **provider 走 opencode 自定义 provider**：openai / deepseek 用 `@ai-sdk/openai-compatible`
  （打 `/chat/completions`），claude 用 `@ai-sdk/anthropic`。
  **别用 opencode 内置的 openai provider** —— 它打 `/v1/responses`，第三方兼容接口不认。
- **模型报错时 opencode 不回响应**：只发 `session.status{type:"retry"}`，HTTP 请求悬着；
  靠 driver 的超时兜底，别裸等 `sendMessage`。
- **同时只允许一个 opencode server**：它有全局状态目录，两个实例会互相搞坏
  （会话列表为空、`POST /session` 直接 400）。
- **二进制随包**：`scripts/build/prepare-opencode.js` 把 `opencode-ai` 的二进制拷进
  `resources/opencode/`；`resolveOpencodeBinary()` 的查找顺序是 打包资源 → dev 资源 →
  node_modules → PATH。
- **LangChain 已全部退役**：`@langchain/core` / `@langchain/openai` / `@langchain/anthropic`
  三个依赖都已从 `package.json` 移除。自研 Agent 循环（`agents/`）、热记忆与压缩器、
  提示词模板、观测回调、tiktoken 补丁一并删除，别再把它们引回来。
  工具用 `src/main/core/ai/tools/tool.ts` 的自研 `tool()`；直连模型只剩三处
  （leetcode 题单解析、插件 SDK `chatWithAi`、API Key 校验），都走 `providers.ts` 的原生 fetch。

### 6.12 GitLab Runner 网关：从 GitLab 唤起 opencode

| 项 | 落点 |
| --- | --- |
| 模块 | `src/main/core/ai/gitlabBot/` —— `config/configStore.ts`（配置）、`events/`（事件解析与触发判定、hydration、pipeline payload / pointer、队列与入队入口）、`gateway/`（仅本机 Relay 网关与鉴权）、`task/`（仓库工作区、任务提示词、任务执行与落库）、`runner/`（自托管 Runner 子模块：`paths.ts` 目录与二进制定位、`process.ts` 子进程管理、`registration.ts` 自动注册、`configFile.ts` config.toml 解析、`lock.ts` 残留进程清理）；`index.ts` 与 `runner/` 保留在根目录 |
| IPC | `src/main/handlers/gitlab/gitlabBotHandlers.ts` —— `gitlab-bot:get-config` / `save-config` / `clear-config` / `runner-status` / `restart-runner` |
| 界面 | `src/renderer/pages/skills/GitlabBotConfigButton.tsx` + `GitlabBotRunnerSection.tsx` + `useGitlabBotConfig.ts`，挂在技能页 GitLab 分组头部 |
| 入口 | `GET /gitlab/health`；`POST /gitlab/relay`（仅绑定 `127.0.0.1`，Runner 令牌走 `X-QNote-Relay-Token` 头） |
| 配置项 | settings 表 `gitlab_bot_config`：`enabled` / `port` / `relayToken` / `triggerWords` / `allowedProjects` / `runnerEnabled` / `runnerProject` / `runnerTags`；Relay 令牌在网关启用时自动生成 |

- **GitLab 通过本机 Runner 接入**：GitLab 触发 Pipeline，Runner 轮询领取任务后向本机 Relay 转发；
  Relay 仅监听本机地址（默认 `127.0.0.1:7799`），不接受外部主机直连。opencode server 仍只在本机运行。
- **事件触发条件**：Relay 令牌验证通过 → 网关启用 → 项目在白名单内（空 = 不限）→
  事件类型是 note / issue / merge_request 且正文命中触发词。触发词后面的内容就是给 agent 的指令。
- **代码档位用另一个 agent profile**：`qnote-code`（`profile.ts` 的 `buildCodeAgentProfile`），
  权限是 `{"*": deny}` 再逐项放行 `bash` / `read` / `write` / `edit` / `glob` / `grep` + `qnote_*`，
  并显式 `external_directory: deny`（opencode 默认是 `ask`，无头场景会卡死等人点确认）。
- **session 的工作目录靠 query 参数**：`POST /session?directory=<仓库路径>` 才会把 session 落在那个目录，
  **body 里写 `directory` 会被忽略**（实测两次落点不同）。opencode 的 `bash` / `read` / `write` 都跟着
  session 目录走，相对路径就落在仓库里。
- **opencode 的 `bash` 在 Windows 上是 PowerShell 5.1**，不是 GNU bash：`&&` 会直接解析报错。
  提示词里已经写明（`profile.ts` 的 `CODE_SHELL_NOTE`），别让 agent 写 bash 专属语法。
- **Git 凭据不落盘**：clone / fetch / push 走 `credential.helper=store --file=<临时文件>`，
  临时文件用完即删；仓库的 remote url 里不含 token。
- **任务串行执行**：Relay 收到事件后入队，同一时刻只跑一个任务，避免两个任务同时改同一个仓库。
- **bot 任务的 AI 处理过程是增量落库的**：任务一开始就建一条空的 assistant 行，之后每 1 秒把已产生的
  思考 / 工具 / 正文刷回这一行（`chatPersistence.ts` 的 `startAiChatAssistantRow` 与
  `updateAiChatAssistantRow`，落点在 `gitlabBot/task/task.ts`）。**整轮结束才落库的老做法会让中途
  退出的任务一条都不剩** —— 2026-11-27 那次任务跑了 8 分钟被关掉，session 里就是空的。
  轮次结束或抛错时再做一次终刷；什么都没产出就把那条空行删掉。
- **GitLab 任务的 session 目录是仓库，`opencode.json` 必须同步过去**：opencode 按 session 的
  `directory` 解析项目配置（provider 与 `.opencode/agents/`），配置不在那个目录时
  `POST /session/<id>/message` 直接 500 —— 报错是 `UnknownError`，卡在
  `SessionPrompt.createUserMessage`，**发生在调模型之前**，模型 ID 本身没问题也会挂。
  `runtime.ts` 的 `syncWorkspace()` 每次 `runTurn` 都把 `opencode.json` 与两个 agent
  markdown 复制到会话目录，并把 `/opencode.json` 与 `/.opencode/` 写进仓库的
  `.git/info/exclude`（本地忽略，不进版本库，避免混进业务 diff）。
  **普通对话不传 `directory`，不受影响。**
- **agent 读网关配置走 `gitlab_gateway_status` 工具**（`tools/gitlab/tools/gateway.ts`）——
  提供 Relay 状态、接入地址、触发词与项目白名单，不返回令牌。
- **Relay 不需要开放入站防火墙端口**：本机 Runner 通过 `127.0.0.1` 访问 Relay；
  GitLab 与 Runner 的通信由 Runner 主动轮询完成。任务未到达 Relay 时，检查 Runner 状态与项目 CI 配置。
- **GitLab 工具层配置别被重置**：`registry.ts` 在模块加载时会调 `configureQNoteGitlabAdapter`，
  那时 `initGitlabConfigStore` 可能还没跑。所以 `configureGitlabToolkit` 在 `options.config`
  未给时必须**保留**已有配置（`options.config ?? runtime.config`），否则 `isGitlabConfigured()`
  变 false，**全部 GitLab 工具都不会挂载**，agent 一个都拿不到。

#### 6.12.1 Runner 接入：GitLab 连不上本机时的通路

**前提事实（实测，别再猜）**：企业网 ACL 会拦掉 `10.99.x` → `10.112.x` 的回程，
**防火墙规则根本没机会生效** —— 换端口建临时 webhook 同样超时、本机收到 0 个请求。
所以「让 GitLab 主动连 QNote」这条路在内网是死的。

**解法**：把入站方向反过来。

```
用户评论 "@qnote 修bug"
  ↓ GitLab webhook → GitLab 自己的 pipeline trigger API
  ↓   POST /api/v4/projects/<数字ID>/ref/<分支>/trigger/pipeline?token=glptt-...
  ↓   GitLab 调 GitLab 自己，必然通（实测 201 Created，pipeline source=trigger）
  ↓ self-hosted Runner 主动轮询领 job（出站，你 → GitLab，通）
Runner 在本机执行 job → curl QNote 的 relay 端点（127.0.0.1，通）
  ↓ QNote 收到原始事件 → 复用 parseGitlabEvent / decideTrigger → 干活
```

| 项 | 落点 |
| --- | --- |
| 工具 | `gitlab_ensure_runner`（`tools/gitlab/tools/runner.ts`）—— 建 trigger token、把 webhook 指向 trigger API、写 CI 变量、返回 CI 模板 |
| 模板 | `tools/gitlab/tools/runnerSetup.ts` —— `buildTriggerApiUrl()` / `buildCiTemplate()` |
| relay | `src/main/core/ai/gitlabBot/gateway/relay.ts` —— `authorizeRelay()` / `parseRelayRequest()`；令牌走 `X-QNote-Relay-Token` 头，判定与入队在 `events/queue.ts` |
| 回源取报文（兜底） | `src/main/core/ai/gitlabBot/events/triggerPayload.ts` —— `loadTriggerPayload()`，按 pipeline id 读 pipeline 变量；**需要 Maintainer 及以上权限** |
| 指针模板 | `src/main/core/ai/gitlabBot/events/triggerPointer.ts` —— `TRIGGER_POINTER_TEMPLATE`（ASCII 指针）+ `parseTriggerPointer()` |
| 回源补齐 | `src/main/core/ai/gitlabBot/events/eventHydrator.ts` —— `resolveEventPayload()`：指针报文按 id 回 GitLab 取原文，拼成标准形状再喂 `parseGitlabEvent` |

- **`TRIGGER_PAYLOAD` 是 GitLab 给 trigger pipeline 强制注入的 file 类型变量**，
  runner 一定要为它生成脚本，job 绕不开这一步。**所以「报文里不放自由文本」是唯一的根治办法。**
- **ParserError 的真正根因是编码，不是反引号**：runner 写出的 `.ps1` 是 **UTF-8 无 BOM**，
  而 Windows PowerShell 5.1 按**系统 ANSI 代码页（本机 ACP=936 / GBK）**解码无 BOM 脚本 ——
  中文的 UTF-8 字节被 GBK 解码**吞掉紧跟的引号**，字符串提前终止 → `ParserError`。
  本地复现：同一份脚本加 UTF-8 BOM 就正常，不加就炸。
  **连锁反应更要命**：runner 把**所有**变量（`CI_PIPELINE_ID`、`CI_PROJECT_ID`、项目 CI 变量）
  都写进同一个 `.ps1`，这段炸了 → **变量全丢**（实测 `$env:CI_PIPELINE_ID` 为空）→
  job 里 `curl` 拿不到 URL → `curl: (2) no URL specified` → job 失败。
  对照实测：payload 纯 ASCII → job 成功、变量齐全；payload 含中文 → ParserError + 变量全空。
- **解法：webhook 用自定义模板，只输出 ASCII 指针**。模板存在
  `gitlabBot/events/triggerPointer.ts` 的 `TRIGGER_POINTER_TEMPLATE`，
  由 `gitlab_ensure_runner` 写进 hook 的 `custom_webhook_template`。
  模板只放 id 与路径（`object_kind` / `object_id` / `issue_iid` / `project_path` …），
  **一个自由文本都不放** → `TRIGGER_PAYLOAD` 恒为 ASCII → runner 变量段正常 → job 正常。
  QNote 拿到指针后用 `eventHydrator.ts` 按 note id / issue iid 回 GitLab API 取原文，
  **拼成标准 webhook 形状再喂现有 `parseGitlabEvent`**，解析逻辑一行没改。
- **自定义模板的坑**：占位符语法是 `{{path}}` **不带空格**；写成 `{{ path }}` 会被渲染成
  字符串 `"null"`（GitLab 把找不到的键当 nil 序列化）。模板本身必须是**合法 JSON**，
  拼错了 `PUT /projects/:id/hooks/:id` 直接 422。GitLab 19.2 实测支持项目级
  `custom_webhook_template`（`PUT` 与 `GET` 都能读写）。
- **job 把指针文件直接 POST 过来，QNote 不读 pipeline 变量**：CI job 用
  `--data-binary "@$env:TRIGGER_PAYLOAD"`（bash 是 `--data-binary "@$TRIGGER_PAYLOAD"`）
  把 runner 写好的指针文件原样发成 body，QNote 收到 body 就直接按 id 回源取原文。
  `$TRIGGER_PAYLOAD` 是 file 类型变量，runner 写文件后把**文件路径**放进环境变量，
  路径原样交给 curl 就完全不经过 shell 变量，编码与引号问题都不存在。
  **别把文件内容读进 shell 变量再拼进命令行** —— 那才是把内容塞回脚本的老路。
  模板生成器在 `tools/gitlab/tools/runnerSetup.ts` 的 `buildCiTemplate()`。
- **读 pipeline 变量要 Maintainer 及以上**：兜底路径
  `GET /projects/<项目ID>/pipelines/<pipelineID>/variables` 在 **Developer 令牌下是 403**
  （实测：同一令牌读 pipeline 详情 200、读 pipeline 变量 403）。
  QNote 拿到 403 会回 **400**，CI job 的 `curl --fail` 因此以**退出码 22** 失败，
  现象是 `curl: (22) The requested URL returned error: 400`。
  **项目访问令牌（project access token）默认只给 Developer**，换成它就必然踩这个坑 ——
  要么按上一条让 job 直接传指针，要么把令牌提到 Maintainer。
- **protected branch 的权限也要对得上**：`main` 的 push 规则是 Maintainer，
  Developer 令牌推 `main` 会 403（`You are not allowed to push into this branch`）。
  bot 的正常流程是「建分支 + 开 MR + 由 Maintainer 合并」，别让它直接推主干。
- **兜底路径：body 为空时按 pipeline id 回源**：relay 端点在 body 为空时用
  `X-QNote-Pipeline-Id` + `X-QNote-Project-Id` 走上面那条读 pipeline 变量的路。
  **`CI_PIPELINE_ID` / `CI_PROJECT_ID` 是 runner 内置的普通变量，不走变量文件生成，
  纯数字，不会有转义问题。**
  实现落在 `gitlabBot/events/triggerPayload.ts` 的 `loadTriggerPayload()`，
  relay 端点（`gateway/server.ts`）在 body 为空时走这条回源路径。
- **opencode 的事件流按会话目录分流**：`GET /event` 不带 `?directory=` 时只收到
  默认目录（opencode workspace）的会话事件；**会话建在别的目录（GitLab 任务用的仓库 clone 目录）
  就一条都收不到** → 主进程收不到 `onText` / `onToolCall` → **任务会话落库时 AI 回复与动作记录全是空的**。
  官方 SDK 的 `event.subscribe` 本来就带 `?directory=&workspace=`。
  修法：`client.ts` 的 `subscribeEvents()` 接 `query.directory`，
  `driver.ts` 的 `OpencodeDriverOptions.directory` 透传，`runtime.ts` 把 `input.directory` 传下去。
  症状对照：会话行数在涨但 `content` 长度与 `blocks` 数量恒为 0。
- **Windows 上别给 runner 配 Git Bash（`shell = "bash"`）**：MSYS 会把 runner 传的
  Windows 路径转成 POSIX 路径，而 runner 自己又要拼一次原始路径，最后得到
  `/d/.../builds/D:/.../builds/...` 这种废路径，变量文件生成直接失败
  （`Error while executing file based variables removal script`）。
  `runner/shell.ts` 的 `detectRunnerShell()` 因此在 Windows 上固定返回 `powershell`，
  macOS / Linux 才用 `bash`。
- **file 类型变量的内容本身就是 webhook 原文**（GitLab 另加 `id` / `ref` / `variables` 三个字段），
  **现有 `parseGitlabEvent` 直接可用**。
- **trigger API 的 webhook URL 必须用数字项目 ID**：`/api/v4/projects/<数字ID>/ref/<分支>/trigger/pipeline?token=<glptt-...>`。
  用 `encodeURIComponent("组/项目")` 编出的 `%2F` 在 GitLab 19.2 路径上会 401。
- **pipeline trigger token 的端点是 `POST /projects/:id/triggers`**（不是 `/trigger_tokens`，后者 404），
  令牌前缀 `glptt-`。`GET /projects/:id/triggers` 会把令牌明文列出来。
- **CI 模板里不要写反斜杠续行**：GitLab runner 把 YAML block scalar 逐行交给 shell，
  PowerShell 里行尾反斜杠会把下一行参数当成独立命令（实测报 `-Headers : 命令不存在`）。
  **每个命令写成一行**。
- **PowerShell 侧别用 `Invoke-WebRequest`**：runner 是 NonInteractive 模式，
  IWR 会弹提示直接失败（`Windows PowerShell is in NonInteractive mode`）。**用 `curl.exe`**
  （Windows 10+ 自带，实测 8.22.0）。
- **CI 变量要建两个**：`QNOTE_RELAY_URL`（`http://127.0.0.1:<端口>/gitlab/relay`）与
  `QNOTE_RELAY_TOKEN`（网关的 relay 令牌，`masked: true`）。runner 与 QNote 同机时用回环地址，
  绕开防火墙与 ACL。
- **runner 注册**（两条路都实测过）：
  - 旧式注册令牌：`gitlab-runner register --registration-token <GR...>`，令牌来自
    `POST /projects/:id/runners/reset_registration_token`。
  - **自动注册走新式令牌**：`POST /user/runners` 建 project_type runner → 拿 `glrt-` 令牌 →
    `gitlab-runner register --non-interactive --config <配置路径> --url <实例地址>
    --token <glrt-令牌> --executor shell --shell <powershell|bash> --name <名字>`。
    **`--url` 与 `--executor` 必填，缺一个就 PANIC**（`Invalid executor specified`）。
    用 `--token` 时**不能带** `--tag-list` / `--run-untagged` —— 那些是服务端属性。
  - 想给已有的 runner 换令牌：`POST /runners/:id/reset_authentication_token`（201，返回新令牌）。
    路径是 `/runners/:id/...`，**不是** `/user/runners/:id/...`（后者 404）。
  - `gitlab-runner register` 会在**当前工作目录**生成 `.runner_system_id`，
    `config.toml` 要用 `--config` 指到别处，否则会污染仓库根目录。
- **runner 二进制下载源是 `https://gitlab-runner-downloads.s3.amazonaws.com/v<版本>/binaries/<文件名>`**
  （注意是 `/v19.6.1/binaries/`，**不是** `/releases/v19.6.1/binaries/`（403），
  也不是 `/19.6.1/binaries/`（403））。校验和在同版本目录的 `release.sha256` 里，
  记的是 `binaries/<文件名>`，按 basename 匹配。
- **CI job 必须带 `tags: [qnote]`**：自动注册建的 runner 是 `run_untagged: false`，
  只有显式打了标签的 job 才会被领走。模板由 `buildCiTemplate({ tags })` 生成。


#### 6.12.2 Runner 随 QNote 生命周期启停

**要求**：Runner 不是用户手动起的独立进程 —— QNote 启动就拉起，QNote 退出就收掉。

| 项 | 落点 |
| --- | --- |
| 进程管理 | `src/main/core/ai/gitlabBot/runner/process.ts` —— spawn `gitlab-runner run --config <配置> --working-directory <builds>`，崩溃后按 3s/10s/30s/60s 退避重启，最多 5 次 |
| 目录与二进制 | `src/main/core/ai/gitlabBot/runner/paths.ts` —— dev 用 `<仓库>/.data/opencode/runner`，安装版用 `userData/runner`；二进制优先找 `resources/gitlab-runner/`（打包目录），再找 `runnerDir()`，最后找 PATH |
| 自动注册 | `src/main/core/ai/gitlabBot/runner/registration.ts` —— `ensureRunnerRegistered()` |
| 残留清理 | `src/main/core/ai/gitlabBot/runner/lock.ts` —— 锁文件记 PID，QNote 被强杀后下次启动先干掉上一个 runner |
| 打包 | `scripts/build/prepare-gitlab-runner.js` —— 下载二进制到 `resources/gitlab-runner/`，`build-app.js` 打包前调它 |

- **挂载点**：`gitlabBot/index.ts` 的 `initGitlabBot()` 里 `startGitlabBotServer()` 之后
  `startGitlabRunner()`；`applyGitlabBotConfig()` 改完配置再 `syncGitlabRunner()`（开就起、关就停）；
  `src/main/index.ts` 的 `will-quit` 里 `stopGitlabRunner()`。
  **Windows 上子进程不会随父进程退出**，不显式 kill 就会留一堆 runner 抢同一个 job。
- **本地 config.toml 缺失才注册**：有 `config.toml` 且能解析出 token 就直接起，
  免得每次启动都去动 GitLab 侧的令牌（旧令牌会打断正在跑的 job）。
  注册流程：按描述找同名 runner（描述固定 `qnote-local`）→ 找到就 `reset_authentication_token`
  换新令牌，找不到就 `POST /user/runners` 建一个 → 再 `gitlab-runner register` 把令牌写进本地
  config.toml。
- **runner 是 project_type 的**：非 admin 用户建不了 instance_type runner
  （`GET /runners/all` 是 403）。所以 runner 必须绑一个项目，配置项 `runnerProject`
  （留空则取 `allowedProjects[0]`）。
- **打包要 +145MB**：`resources/gitlab-runner/` 与 `resources/opencode/` 一样进 `.gitignore`，
  由 `prepare:gitlab-runner` 脚本在打包前下载。macOS 下这个二进制没签名，
  和 opencode.exe 一样过不了公证。
- **下载脚本产出的文件名必须与 `runnerBinaryName()` 一致**（`gitlab-runner.exe` /
  `gitlab-runner`），否则打包后找不到二进制。
- **runner 的日志别全塞进 QNote 日志**：`Checking for jobs` / `Appending trace` /
  `Submitting job` 这些轮询噪音要过滤，ANSI 色码要剥掉，否则 app.log 会被刷爆。

---

#### 6.12.3 事件队列、发送前检查与会话刷新

**一、事件按消息队列消费**

| 项 | 落点 |
| --- | --- |
| 队列 | `src/main/core/ai/gitlabBot/events/queue.ts` —— `GitlabEventQueue` |
| 幂等键 | `dedupeKey(event)` —— note 按 note id，issue / MR 按 iid + action |
| 发送前检查 | `src/main/core/ai/tools/gitlab/utils/triggerGuard.ts` —— `stripTriggerWords` / `guardBotContent` |
| 触发词表 | `src/main/core/ai/tools/gitlab/runtime/triggerWords.ts` —— 由 `gitlabBot/index.ts` 从配置同步 |
| 会话变更 | `src/main/core/ai/chatEvents.ts` —— `emitAiChatChanged` / `onAiChatChanged` |

- **判定挪到出队时**：入队只收事件，出队才跑 `decideTrigger`。入队前判定会让「事件」在队列里
  根本不存在，重复投递与自产消息无从拦。
- **幂等键要覆盖在途事件**：事件取出后到派发完成前，键必须留在 `pendingKeys` 里 ——
  只在「已取出」时删掉，GitLab 重投就能再入队一次，同一个任务会跑两遍。
- **容量上限 50，满了丢最旧**：入队时判 `pending.length >= capacity`，丢最旧一条并记日志。
- **失败重试 2 次**：间隔按 `retryDelayMs * (attempt + 1)` 递增；重试用尽只放弃这一条，
  不影响队列后续。
- **relay 与 webhook 走同一条队列**：两条入口可能送来同一事件，幂等键就是给这个场景兜底的。
- **任务失败不要落空行**：`task.ts` 里 AI 一条字都没产出时，把错误信息落成 assistant 消息，
  完全没内容就不落库 —— 否则会话里会出现一个什么都没有的气泡。

**二、发送前检查：agent 的回复不许带触发词**

- **落点是工具层的五个写回出口**：`gitlab_add_comment`（评论）、
  `gitlab_create_issue` / `gitlab_update_issue`（标题 + 正文）、
  `gitlab_create_merge_request` / `gitlab_update_merge_request`（标题 + 描述）。
- **做法**：发出去前用当前配置的触发词表把内容里的触发词剥掉（大小写不敏感），
  剥掉的词放进返回值的 `trigger_words_removed`；**内容只剩触发词时直接拦下不发**。
- **为什么拦在写回侧而不是判定侧**：自触发是「agent 写出去的内容里带着触发词」，
  触发源在写回那一刻就产生了。收窄判定范围（只认评论正文）也拦不住 agent 回帖时复述触发词。
- **词表要从配置同步**：`gitlabBot/index.ts` 在 `initGitlabBot` / `applyGitlabBotConfig` /
  `resetGitlabBotConfig` 三处调 `setGitlabTriggerWords`，否则改了触发词配置，工具层还按旧的来。
- **副作用**：用户让 agent 在 MR 描述里写「触发词用法」时，描述里的触发词也会被剥掉。

**三、会话列表与内容改成持续刷新**

| 环节 | 落点 |
| --- | --- |
| 事件总线 | `src/main/core/ai/chatEvents.ts` |
| 落库触发 | `src/main/core/ai/chatPersistence.ts` —— `persistAiChatExchange` 事务成功后 emit |
| 推送 | `src/main/handlers/ai/aiHandlers.ts` —— `getMainWindow()` 现取后 `webContents.send("ai-chat:changed")` |
| preload | `src/main/preload.ts` 的 `onAiChatChanged` |
| 渲染层 | `src/renderer/hooks/ai/useAiAssistant.ts` —— 收到推送刷列表 + 当前会话历史；`window` 的 `focus` 与 `document` 的 `visibilitychange` 再补拉一次 |

- **不刷新 = 后台任务永远看不见**：GitLab 任务在主进程后台落库，渲染层只在 mount / 新建 /
  发送后 / 取消 / 宠物语音结束时拉一次，界面永远停在旧状态 —— **数据在库里也看不见**。
- **推送为主，focus 补拉兜底**：推送覆盖「订阅已建立」之后的落库；订阅建立之前
  （渲染层刚热更新、窗口重建）的漏，由切回窗口时补拉兜住。
- **正在流式输出时不刷新历史**：历史刷新会整段替换消息列表，本地流式期间
  （`activeSessionRef` 有值）直接跳过，避免打断正在生成的内容。
- **窗口句柄要现取**：`getMainWindow()` 在回调里取，别在注册时取快照。

---

## 7. 提交与发版的分工

- 规范要求**不自动执行 `git commit`**：改动改到工作区即止，提交由人来做
- 发版（`pnpm run release:*`）会写 commit 与 tag，属于要显式确认的操作
