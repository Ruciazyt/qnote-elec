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
| 脚本 | `scripts/`（按用途分目录：`build/` 构建后处理、`release/` 发版、`git-hooks/` 提交规范、`dev/` 开发期辅助） |
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
- 当前发布线是 **2.0.x**
  - 换线理由：2.0.0 把【应用】模块重做成 VSCode 式插件系统 —— 清单从 qnote.json
    改为 plugin.json，权限改成声明式 capabilities，插件通过 SDK 注册命令与取数据。
    按 3.2 的规则这是破坏性变更，要求 major 版本，而 major 落在 2.0.0。
    上一条线 1.14.x 发布了 macOS 自研安装包更新通道、灵动岛侧边停靠与摘要
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
src/main/core/ai/<模块>/      ← AI 功能域：agents/ memory/ observability/ prompts/ skills/ tools/
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
| 插件系统（清单、进程启停、预览、SDK） | `src/main/core/plugin/pluginManager.ts`、`src/main/core/plugin/sdk/`、`src/main/core/window/plugin/pluginPreview.ts`、`src/main/utils/pluginManifest.ts`、`src/renderer/pages/plugin/` |
| AI 功能域（对话、Agent、记忆、提示词、工具调用、向量库） | `src/main/core/ai/`（平铺的 `aiService.ts` / `providers.ts` / `streaming.ts` / `toolContext.ts` 等 + `agents/` `memory/` `observability/` `prompts/` `skills/` `tools/` 六个子目录）、`src/main/handlers/ai/`、`src/shared/ai/`、`src/renderer/pages/ai/`（渲染层 AI 界面：浮窗助手、桌宠、对话面板） |
| 清单命令的风险分析（市场来源插件的启动确认） | `src/shared/plugin/pluginRisk.ts`（纯函数）、`src/main/core/plugin/pluginManager.ts`（`checkStartConfirmation` / `confirmStart`）、`src/renderer/pages/plugin/StartConfirmDialog.tsx` |
| 插件声明式权限的判定 | `src/main/core/plugin/capabilities.ts`（`checkCapability`）、`src/shared/plugin/pluginManifest.ts`（清单校验） |
| 插件 SDK 通道与宿主 API | `src/main/core/plugin/sdk/rpcServer.ts`（传输）、`src/main/core/plugin/sdk/hostApi.ts`（API 面）、`resources/plugin-sdk/`（插件侧 SDK）、`src/shared/plugin/sdk/protocol.ts`（协议） |
| 通用面板件（可折叠侧栏、拖拽分割线、宽度偏好） | `src/renderer/components/panel/`、`src/renderer/hooks/panel/usePanelWidth.ts`、`src/renderer/hooks/panel/useCoalescedStorage.ts`（合并写盘：拖拽时别每帧同步写 localStorage） |
| 拖拽重排（列表 / 行 / dock 换序的手感） | `src/renderer/hooks/ui/useDragReorder.ts`（引擎）、`src/renderer/hooks/ui/dragReorderGeometry.ts`（几何纯函数）、`src/renderer/styles/drag-reorder.css`（动效）—— 自研，别再引 dnd-kit（已移除） |
| 上下分栏（笔记树 / 外部文件夹，默认 6:4，可拖动） | `src/renderer/components/panel/PanelHeightResizer.tsx`（纵向分割线）、`src/renderer/hooks/panel/useSplitRatio.ts`（比例持久化）、`src/renderer/pages/notes/layout.ts`（比例与收起态高度常量） |
| 灵动岛（最小化后顶在屏幕顶边的浮层） | `src/shared/island/island.ts`（契约）、`src/main/core/window/island/island.ts`（窗口与几何）、`src/main/handlers/island/islandHandlers.ts`（IPC）、`src/renderer/pages/island/`（界面） |
| 云端存储（共享数据放 TiDB Cloud，私有数据留本地） | `src/database/cloud/`（存储层）、`src/main/handlers/cloud/cloudHandlers.ts`（IPC）、`src/renderer/pages/settings/CloudStorageCard.tsx`、`src/renderer/pages/plugin/PublishedPluginMarket.tsx`、`data-app/`（Data App 配置：端点定义 + SQL） |
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
  - 风险分析在 `src/shared/plugin/pluginRisk.ts`（纯函数）。它**不是安全边界** ——
    关键词匹配挡不住刻意伪装，真正的防线是「来源标记 + 运行前确认」
  - 市场导入走 `plugin:import-from-market` **专用路径**：
    目标目录已有 `plugin.json` 就拒绝，**一个字节都不动**。
    别改回「写清单 + 导入插件」两步 —— 两步分开的话清单已经写了，
    导入才发现失败，用户自己已有插件的清单就被换成了别人的命令
- **没声明 `capabilities` 就是最小权限**：只能加载预览页面，不能起子进程、
  不能读写笔记待办。**`process.spawn` 没声明时启动直接被拒**，
  判定在 `src/main/core/plugin/capabilities.ts` 的 `checkCapability`
- **SDK 通道是 loopback HTTP + 长轮询**（`src/main/core/plugin/sdk/rpcServer.ts`）：
  插件进程靠 `QNOTE_PLUGIN_RPC` / `QNOTE_PLUGIN_TOKEN` 环境变量接进来。
  **别改回 WebSocket** —— 插件的 stdout/stderr 要原样给用户看日志，
  stdin 是单向的撑不起「插件 → 宿主」的调用
- **宿主 API 面**在 `src/main/core/plugin/sdk/hostApi.ts`：
  `qnote.notify` / `qnote.log` / `qnote.settings.*` / `qnote.commands.*` /
  `qnote.todos.list` / `qnote.notes.list`。数据访问一律走主进程，
  插件不许直接碰 SQLite
- **插件侧 SDK** 是 `resources/plugin-sdk/qnote-plugin-sdk.js`（纯 ESM，无构建步骤）。
  插件作者 `import` 它，导出 `activate(ctx)` / `deactivate()`
- **老应用迁移是幂等的**：`src/main/core/plugin/legacyMigration.ts` 在插件管理器
  初始化时跑一次，把 `app_project` 里的老记录转成插件并在插件目录补一份
  `plugin.json`。**原 `qnote.json` 与 `app_project` 表都不删** —— 留回滚口子
- **原生视图盖在 DOM 之上**：预览区是 `WebContentsView`，
- **`useNativeViewCover` 是持有者集合**：多个页面各自持有原生视图时，
- **侧栏的折叠与伸缩用 `ResizableSidebar`**：折叠、拖拽调宽、宽度上限、
- **拖拽分割线是 flex 子节点**：`PanelResizer` 真实占位，不叠在侧栏边缘。

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
| `src/shared/plugin/plugin-rs/` | 清单命令风险分析 | `src/main/core/plugin/nativePlugin.ts` |
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


---

## 7. 提交与发版的分工

- 规范要求**不自动执行 `git commit`**：改动改到工作区即止，提交由人来做
- 发版（`pnpm run release:*`）会写 commit 与 tag，属于要显式确认的操作
