# QNote — Agent 开发规范

本文件是本项目（以及在本项目上工作的任何 Agent / 开发者）的强制规范。
**动代码之前先读完这一节。** 其中能被机械判定的规则由校验脚本兜底，
不合规的提交会在 `git commit` 当场被拦下；其余靠自觉。

---

## 1. 项目速览

| 项 | 值 |
| --- | --- |
| 形态 | Electron 桌面应用（Windows 安装版 + 便携版 / macOS dmg + zip） |
| 主进程 | `src/main`（TypeScript → `dist/main`），preload 在 `src/main/preload.ts` |
| 渲染层 | `src/renderer`（React 18 + Vite 6 + Tailwind 3 + shadcn/ui，new-york 风格） |
| 共享层 | `src/shared`（主进程与渲染层共用的类型） |
| 数据层 | `src/database`（Knex + SQLite，笔记、剪贴板、待办等） |
| 构建配置 | `build/electron-builder.json`（打包）、`build/tsconfig.*.json`（编译）、`build/entitlements.mac.plist`（macOS 权限声明） |
| 脚本 | `scripts/`（按用途分目录：`build/` 构建后处理、`release/` 发版、`git-hooks/` 提交规范、`dev/` 开发期辅助） |
| CI | `.github/workflows/`（`build-and-release.yml` 正式发布 / `auto-build.yml` 提交验证） |
| 运行时要求 | Node.js >= 18，pnpm 10.32.0（勿改用 npm / yarn） |

### 常用命令

```bash
pnpm dev                # 主进程 + 渲染层热更新一起起
pnpm test               # 跑单元测试（vitest run，非 watch，跑完自己退出）
pnpm run build          # 完整构建（clean → 编译 → 打包 → 便携版后处理）
pnpm run build:electron # 只编译主进程与 preload
pnpm run build:react    # 只构建渲染层
pnpm run build:app      # 只跑 electron-builder（打包前会自动生成图标）
pnpm run generate:icons # 只生成图标（macOS 的 .icns + 运行时 PNG）
pnpm run release:patch  # 发补丁版本（1.10.0 → 1.10.1）
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

带 `BREAKING CHANGE:` 脚注，或 type 后加 `!`（如 `feat(api)!: ...`）→ **major**。

- **删除内部 preload 暴露按 `refactor` 计，不视为破坏性变更。**
  例如删掉 `window.electron.send` 这类通用通道，或删掉渲染层零调用的
  某个 API 暴露 —— 它们是 preload 的内部 API，从未在公开契约里承诺过，
  删除不触发 major。§3.2 的 major 针对的是**对外契约**的破坏
  （对外接口签名、配置格式、持久化数据结构）。
- 反过来，如果删的是渲染层**正在用**的暴露，那不是清理，是缺陷，
  用 `fix`，不能拿 `refactor` 掩盖。

> 最后一列的"触发版本位"是本项目版本号规范的直接依据：
> 一批提交里只要出现 `feat` 就发 minor，出现破坏性变更就发 major，
> 其余一律发 patch。详见第 3 节。

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

正文写**为什么改**，不重复 subject 已经说过的"改了什么"：

```
fix(updater): 修正检查更新时版本号比较始终判定为最新

latest.yml 里的版本号取自 appInfo.version，而 auto-build 之前用
ELECTRON_BUILDER_VERSION 覆盖版本 —— 该变量在 electron-builder 26.x
里并不生效，导致产物版本与发布 tag 不一致。

Closes #123
```

脚注用 `Closes #123` / `Refs #123` 关联 issue；破坏性变更必须写：

```
BREAKING CHANGE: update:install 通道改为要求先完成下载，参数签名变化。
```

### 2.6 校验

`scripts/git-hooks/verify-commit-msg.js` 按上述规则逐条检查，挂在 `.githooks/commit-msg` 上。
首次克隆后执行一次 `pnpm run setup:hooks` 启用（该命令只改本地 `.git/config`，不污染仓库）。

也可以单独校验某条信息：

```bash
pnpm run verify:commit "feat(updater): 增加应用更新卡片"
```

> **钩子文件必须以可执行位（100755）提交。** git 只运行可执行的钩子文件，
> 权限不对时它不报错，而是**静默跳过** —— 规范看着写了，实际拦不住任何东西。
> Windows 上 `core.fileMode` 默认是 false，提交时一律记成 100644，所以提交前要补一次：
>
> ```bash
> git add .githooks/commit-msg
> git update-index --chmod=+x .githooks/commit-msg
> ```
>
> `pnpm run setup:hooks` 会自动检查并补正已追踪文件的模式；未追踪时它会提示上面两条命令。

**脚本拦得住的**（改了 `scripts/git-hooks/verify-commit-msg.js` 里那张表即可调整）：

- `type` 不在白名单内
- `scope` 含大写字母或非法字符、scope 为空括号
- 首行超过 72 字符；中文 subject 超过 30 字
- subject 末尾有句号、以「了」「的」结尾、以「已经」开头
- subject 里有连续空格
- `BREAKING CHANGE:` 脚注写了但内容为空

**脚本拦不住、只能靠自觉的**：

- subject 是否真的说清了"改了什么"（祈使句）
- 一个提交是否只做了一件事
- 有没有第一人称"我"
- 改动有没有碰到不该碰的文件

---

## 3. 版本号规范

### 3.1 格式

```
MAJOR.MINOR.PATCH        例：1.10.0
```

- 三段纯数字，不带 `v` 前缀、不带 `-rc` 之类后缀
- 当前发布线是 **1.10.x**
  - 换线理由：1.9.x 从 1.9.0 起步，这期间累积了一个功能级提交 ——
    灵动岛（island）、剪贴板面板几何常量与外部文件夹接口。按 3.2
    的规则它要求 minor 版本，而 minor 落在 1.10.0。1.9.x 留给「上一条线刚起步、
    功能还在零星补」的阶段，功能性的东西该有自己的次版本线。
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
| 修复缺陷、性能优化、重构、文档、测试、构建、CI、杂项 | patch（1.10.0 → 1.10.1） |
| 新增功能 | minor（1.10.0 → 1.11.0） |
| 不兼容的 API / 配置 / 数据结构变更 | major（1.10.0 → 2.0.0） |

判断依据是第 2 节的提交 type —— 一批提交里出现 `feat` 就不能只发 patch。

### 3.3 Tag 与 Release

- **Tag 名 = 版本号本身**：`1.10.0`，**不加 `v` 前缀**
- Release 标题 = `QNote 1.10.0`
- Tag 必须与 `package.json` 的 `version` 完全一致
- tag 是**带注释的**（`git tag -a`），注释写 `Release 1.10.0`
- 一个版本号只发一次。改过内容要重发，就 bump 到下一个 patch 号

> 为什么不带 `v`：`v1.10.0` 与 `1.10.0` 在 GitHub 上是两套不同的 tag，
> 混用会让 Release 列表出现两串同号条目，electron-updater 取
> `/releases/download/<tag>/latest.yml` 时也会对不上。统一成不带前缀的形式。

### 3.4 发版流程

正式发布只有一条路径 —— **打 tag 触发 CI**：

```bash
pnpm run release:patch    # 或 release:minor / release:major
```

该脚本会依次：校验工作区干净 → 校验当前版本号格式 → **核对发版类型与本批提交
是否匹配**（有 `feat` 却发 patch 会被直接拦下）→ 拉取最新代码 → 安装依赖 →
**运行单元测试**（测试不过直接中止，不会带着红测试发版）→
**跑 SonarCloud 质量门禁**（有命中拦截级别的问题就中止，清单见
`.data/sonar/sonar-issues.md`）→
按 semver 规则 bump `package.json` 的 version → 以 `chore(release): bump version to X.Y.Z`
提交 → 打 `X.Y.Z` 注释 tag → 推送分支与 tag。推送 tag 后
`build-and-release.yml` 触发，先过 `sonar-gate` 作业（不过就不出包、不建 Release），
然后产出安装版、便携版与 `latest.yml` 并创建 Release。

> 新版本号以 `package.json` 为准，不解析 `pnpm version` 的输出 ——
> pnpm 打印的是 `Version bumped successfully: 1.10.0 → 1.10.1` 这类多行文本，
> 不是纯版本号。同理不设 `ELECTRON_BUILDER_VERSION` 之类的环境变量覆盖，
> 该变量在 electron-builder 26.x 里并不生效。

> 门禁查的是 SonarCloud 上**最近一次分析**的结果，不是现扫一遍 ——
> 现扫需要 JDK 17+ 与 sonar-scanner CLI（见 §6.6）。令牌缺失时门禁跳过，
> 不会把发版卡死；紧急情况可用 `SKIP_SONAR=1` 显式跳过（会留痕）。

**`auto-build.yml` 不创建 Release。** 它只在每次推 master 时跑一次构建，
把产物上传为 Actions Artifact 用于验证"这次提交能构建出可用的包"。
正式 Release 一律由 tag 触发，这样版本号才有唯一来源。

### 3.5 校验

```bash
pnpm run verify:version
```

检查 `package.json` 的 `version` 是否为三段纯数字、是否为合法 semver、
是否与当前发布线（1.10.x）一致。

---

## 4. 红线

以下内容**绝不允许**进入仓库（包括历史）：

- 任何 API Key、Secret、Token、密码、私钥 —— 包括看起来像测试值的真 key
  （百度 OCR 的 API_KEY/SECRET_KEY、DeepSeek / OpenAI / Anthropic 的 `sk-` 系列）
- 用户的笔记内容、剪贴板记录、数据库文件
- 构建产物：`dist/`、`dist_electron/`、`*.exe`、`*.zip`
- 本地开发数据：`.data/`、`*.db`、`*.log`、`.env`

密钥一律走运行时配置注入（参考 `src/main/utils/baiduOCR.ts` 的
`setBaiduKeys()` 模式：源码里只留空默认值，由用户在设置页填入）。

**提交前自查**：

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

| 改动类型 | 落在哪 |
| --- | --- |
| 主进程能力、IPC、窗口、原生能力 | `src/main/`（handler 放 `src/main/handlers/`，常驻能力放 `src/main/core/`） |
| 渲染层界面 | `src/renderer/components/` |
| 跨端共享类型 | `src/shared/` |
| 数据表与迁移 | `src/database/` |
| 应用管理（项目清单、进程启停、HTML 预览） | `src/main/core/appManager.ts`、`src/main/core/window/appPreview.ts`、`src/main/utils/appManifest.ts`、`src/renderer/components/apps/` |
| 清单命令的风险分析（市场来源项目的启动确认） | `src/shared/appRisk.ts`（纯函数）、`src/main/core/appManager.ts`（`checkStartConfirmation` / `confirmStart`）、`src/renderer/components/apps/StartConfirmDialog.tsx` |
| 通用面板件（可折叠侧栏、拖拽分割线、宽度偏好） | `src/renderer/components/panel/`、`src/renderer/hooks/usePanelWidth.ts`、`src/renderer/hooks/useCoalescedStorage.ts`（合并写盘：拖拽时别每帧同步写 localStorage） |
| 上下分栏（笔记树 / 外部文件夹，默认 6:4，可拖动） | `src/renderer/components/panel/PanelHeightResizer.tsx`（纵向分割线）、`src/renderer/hooks/useSplitRatio.ts`（比例持久化）、`src/renderer/components/Note/layout.ts`（比例与收起态高度常量） |
| 灵动岛（最小化后顶在屏幕顶边的浮层） | `src/shared/island.ts`（契约）、`src/main/core/window/island.ts`（窗口与几何）、`src/main/handlers/islandHandlers.ts`（IPC）、`src/renderer/components/island/`（界面） |
| 云端存储（共享数据放 D1，私有数据留本地） | `src/database/cloud/`（存储层）、`src/main/handlers/cloudHandlers.ts`（IPC）、`src/renderer/components/core/CloudStorageCard.tsx`、`src/renderer/components/apps/PublishedAppMarket.tsx` |
| 打包 / 发布配置 | `build/`、`scripts/`、`.github/workflows/` |
| 静态分析 / 质量门禁 | `sonar-project.properties`（分析范围）、`eslint.config.mjs` + `tsconfig.lint.json`（本地 SonarJS 规则）、`scripts/quality/`（清单与门禁脚本）、`.github/workflows/sonar.yml`（扫描）、`docs/SONAR.md` + `docs/SONAR-DEBT.md`（规范与存量债台账） |

主进程新增 IPC 时六个地方要同步改，漏一处会静默失效：

1. `src/main/handlers/<模块>.ts` 注册 channel（业务 IPC）
2. `src/main/index.ts` 注册 channel（应用级 IPC：悬浮窗、语音热键、剪贴板面板热键、外链打开）
3. `src/main/core/window/mainWindow.ts` 注册 channel（窗口最小化/最大化/关闭/开发者工具）
4. `src/main/core/window/clipboardPopup.ts` 注册 channel（剪贴板弹窗关闭/显示主窗口）
5. `src/main/preload.ts` 暴露给渲染层
6. `src/renderer/electron.d.ts` 补类型声明

### 6.2 CI 脚本里出现中文时，shell 必须用 pwsh

`.github/workflows/` 里的 `run:` 块只要写了中文、破折号这类非 ASCII 字符，
`shell:` 就**必须写 `pwsh`**（PowerShell 7），不能写 `powershell`。

原因：GitHub runner 把 `run:` 写成**无 BOM 的 UTF-8** 临时 `.ps1`，
而 Windows PowerShell 5.1 会按系统 ANSI 码页解码它 —— 中文全变乱码，
乱码里混进的引号字符会把字符串提前截断，CI 直接挂在解析阶段：

```
The string is missing the terminator: ".
```

具体触发链：runner 是 en-US 码页（cp1252），`——` 的 UTF-8 字节是 `E2 80 94`，
被 cp1252 解成 `â€”`，其中 `0x94` → **U+201D 右双引号** —— 而 PowerShell
接受弯引号作字符串定界符，于是字符串提前闭合，剩下的引号开了个没闭合的字符串。

`pwsh` 默认按 UTF-8 读无 BOM 文件，没这个问题；`windows-latest` runner 自带 PowerShell 7。

验证过：这个坑只在 `shell: powershell` 下出现 —— 仓库里所有带中文的步骤
（`build-and-release.yml` 的 "List build results"）都没写 `shell:`，
走默认的 pwsh，所以一直没暴露。

### 6.3 macOS 打包

macOS 产物由 CI 的 `build-mac` 作业产出（`macos-15` runner），
**只能在 macOS 上打** —— electron-builder 不支持交叉构建 mac 产物。

| 项 | 说明 |
| --- | --- |
| 产物 | `QNote-<版本>-mac-arm64.dmg` / `-mac-x64.dmg`，以及同名的 `.zip` |
| 架构 | arm64（Apple Silicon）与 x64（Intel），**一次 electron-builder 调用同时出** |
| 打包配置 | `build/electron-builder.json` 的 `mac` 段 |
| 权限声明 | `build/entitlements.mac.plist` |
| 图标 | `scripts/build/generate-icons.js` 从 `src/renderer/public/icon.svg` 生成 |
| 自动更新元数据 | `latest-mac.yml`（Windows 那份是 `latest.yml`，两个不能混） |

几条容易踩的约束：

- **两个架构必须一次构建**。electron-builder 只会写一份 `latest-mac.yml`，
  分两次跑会各写一份，发到同一个 Release 时互相覆盖。
- **dmg 与 zip 都要出**。mac 自动更新靠 zip，dmg 不支持差分更新。
- **`latest-mac.yml` 必须与安装包在同一个 Release 里**，否则 mac 用户点
  「检查更新」会报「找不到更新源」。
- **`.blockmap` 也要跟着产物发布**。electron-updater 按 `<产物名>.blockmap`
  取差分依据，取不到会退化成整包下载（mac 的 zip 约 205MB）。
- **图标不能用 `.ico`**。Electron 的 `nativeImage` 在 macOS / Linux 上读
  `.ico` 会得到空图，托盘图标直接抛「无法加载图标文件」。按平台选图标的
  逻辑集中在 `src/main/utils/assets.ts`，改图标相关代码先看它。
- **macOS 应用图标要满幅方形**（圆角由系统遮罩加），而托盘 / 窗口图标是
  应用内自己画的，要保留圆角 —— 生成脚本里这两种源是分开的。
- **Hardened Runtime 下必须声明 `com.apple.security.cs.disable-library-validation`**，
  否则 sqlite3 的原生模块加载不了，表现为启动后数据库初始化失败。
- **mac 自动更新要求应用已签名**。未签名的 mac 版能安装，但更新装不上。

macOS 产物的签名 / 公证与是否进正式 Release，都是**条件式**的，
细节见 `docs/MACOS-BUILD.md`。

### 6.4 应用管理：项目清单规范

「应用」标签页按文件夹管理本机项目。**规范本体在 `docs/APP-MANAGEMENT.md`**，
改这块行为前先读它。几条容易踩的约束：

- **导入的就是项目本身**：没有「根目录 + 扫描子目录」这层 ——
  用户导入哪个文件夹，哪个文件夹就是项目，因此项目可以散落在任意路径下。
  改动这块时不要把工作区概念加回来。
- **清单是唯一入口**：项目根目录下必须有一份 `qnote.json`，
  没有清单的项目不可启动、不可预览（界面标为「未配置」）。
  清单里 `command` 与 `preview` 至少填一个。
- **不合规不落库**：导入时清单解析不过就不写进数据库，
  改成弹清单编辑器、补完再导入 —— 留个跑不起来的空壳在列表里，
  只会让人以为应用坏了。
- **清单写在项目里，不写数据库**：应用库（`app_project`）只存索引，
  每次刷新都重新读一遍文件。
- **私有协议 `qnote-app://` 不能改**：`protocol.registerSchemesAsPrivileged`
  **必须在 app ready 之前调用**（`src/main/index.ts` 的模块级代码），
  挪到 ready 之后就不生效了，预览页会打不开。
  用它而不是 `file://` 的原因：Chromium 在 `file://` 下会拦掉
  `<script type="module">`，vite 产物全是白屏。
- **清单里的 `command` 是经 shell 执行的**（`spawn(..., shell: true)`）——
  `;` `&&` `|` `$(` 都会被解释。所以清单是**不可信输入**时
  （从应用市场获取的），运行前必须让用户确认：
  - `app_project` 表有 `origin`（`local` / `market`）与
    `confirmed_manifest_hash` 两列，**后者存的是清单内容的哈希** ——
    清单改了就对不上，确认框会再弹一次
  - 判定逻辑在 `AppManager.checkStartConfirmation` ——
    **单独成方法是为了能脱离 spawn 来测**，别为了省事把它塞回 startProject
  - 风险分析在 `src/shared/appRisk.ts`（纯函数）。它**不是安全边界** ——
    关键词匹配挡不住刻意伪装，真正的防线是「来源标记 + 运行前确认」
  - 市场导入走 `app:import-from-market` **专用路径**：
    目标目录已有 `qnote.json` 就拒绝，**一个字节都不动**。
    别改回「写清单 + 导入项目」两步 —— 两步分开的话清单已经写了，
    导入才发现失败，用户自己已有项目的清单就被换成了别人的命令
- **原生视图盖在 DOM 之上**：预览区是 `WebContentsView`，
  永远压住渲染层，z-index 无效。要开弹窗必须先把预览收起来
  （`AppPreviewPane` 的 `suspended`），否则对话框点不动。
- **`useNativeViewCover` 是持有者集合**：多个页面各自持有原生视图时，
  不能再用单一布尔值 —— 谁后跑谁说了算，切页时会把状态覆盖掉。
- **侧栏的折叠与伸缩用 `ResizableSidebar`**：折叠、拖拽调宽、宽度上限、
  状态持久化都在这个组件里（`src/renderer/components/panel/`）。
  新的可折叠侧栏一律套它，别再各写一套 —— 宽度持久化统一走
  `usePanelWidth`，折叠状态统一走 `useCollapsedState`（都存 localStorage，
  别用组件内 state，应用一关就没了）。
- **拖拽分割线是 flex 子节点**：`PanelResizer` 真实占位，不叠在侧栏边缘。
  预览区的原生视图盖在 DOM 之上，压在它上面的 DOM 收不到鼠标事件 ——
  分割线有 1px 伸进网页区，那 1px 就点不动。

### 6.5 灵动岛

主窗口最小化后顶在屏幕顶边的那块浮层。形态参考 [fly-island](https://github.com/flyl1u/fly-island)，
但实现是 QNote 自己的（Electron + React，不是 Tauri + Rust）。几条容易踩的约束：

- **尺寸动画由主进程逐帧 `setBounds` 驱动**。Electron 的 `setBounds(bounds, animate)`
  在 Windows 上不支持动画，所以主进程自己补间（`src/main/core/window/island.ts`）。
  这样窗口的物理尺寸和内容的视觉尺寸天然同步，不会出现「内容展开了窗口还小着」。
  渲染层只负责画内容和播自己的淡入淡出。
- **胶囊宽度由渲染层量出来报给主进程**（`ResizeObserver` → `island:set-collapsed-width`），
  主进程夹到 [220, 460]。胶囊用 `width: max-content`，**不要加 `max-width`** ——
  那样量到的是「被窗口挤窄的宽度」而不是自然宽度，收起动画途中回写进主进程会把补间截断。
- **贴顶时顶端两角是直角，浮着时四角一样圆**（`data-attach="attached" | "floating"`）。
  贴顶态还要把上边描边去掉，不然屏幕边缘会横着多一条 1px 的线。
- **展开态的面板不画阴影**：面板这么大，一层厚阴影压下去像块黑砖，
  边界交给那圈 1px 描边就够了。收起态的胶囊保留阴影 —— 它贴在屏幕边上，
  靠那点投影才浮得起来。
- **窗口比卡片大一圈，专门留给阴影**（`ISLAND_SHADOW_PAD_X / ISLAND_SHADOW_PAD_Y`）。
  阴影是 CSS 的 `box-shadow`，画在卡片**外面**；窗口跟卡片一样大的话，
  阴影画出去的部分被窗口矩形裁掉，底角变成两条硬边（看着像直角阴影）。
  因此**卡片坐标 ≠ 窗口坐标**：卡片的 x = 窗口的 x + `ISLAND_SHADOW_PAD_X`，y 相同。
- **鼠标不在卡片上时，窗口要放成穿透**（`island:set-interactive` →
  `setIgnoreMouseEvents(true, { forward: true })`）。窗口比卡片大一圈，
  那圈是透明的，但窗口终归是矩形 —— 不放行的话，底下那三十来像素高的带子
  会把应用的点击吃掉。渲染层自己做命中判定（靠转发过来的 `mousemove`），
  别改回 `mouseenter` / `mouseleave`。
- **拖动期间不能改穿透状态**：窗口一放行鼠标，渲染层的指针捕获就丢了，
  拖动会当场断在原地 —— 卡片比指针慢一帧，指针越过卡片边缘就会被判成
  「不在卡片上」，这时放行穿透，拖动必断。渲染层用「指针还按着」挡住，
  主进程侧再兜一层（拖动中的请求先记着，拖完再生效）。
- **拖动位置直接发 IPC，别攒到下一帧**：攒一帧就是白白多等 16ms（60Hz），
  岛会慢半拍，看着就是「不太跟鼠标」。`pointermove` 本身已按帧派发，
  一帧挪一次窗口正合适；真来了比帧更密的移动（高刷鼠标）才退回去攒帧。
- **岛不跟着鼠标换屏**：放在哪块屏就留在哪块屏，显示器 id 记在配置里
  （`IslandSettings.displayId`），拔掉那块屏才回主屏。
- **横向位置要记住**：吸回顶边只改纵向，横向停在用户放的地方 ——
  一律拉回正中就成了「岛只能固定在中间」。
- **展开动画不回弹**（`easeOutQuint`，约等于 DESIGN.md 那条
  `cubic-bezier(0.22, 1, 0.36, 1)`）。早期用 `easeOutBack`，尺寸冲过目标
  再荡回来，那一下的边界抖动最刺眼。
- **面板内容一直挂着**，不跟着展开收起卸载 —— 展开那一刻才 mount 一大棵列表，
  动画头几帧会掉帧，看着就是「抖了一下」。收起时靠 `visibility: hidden`
  做结构性隐藏（里面的按钮不会被 Tab 选中）。
- **岛的配色要单独钉**。`--island-*` 是私有 token，CSS 文字对比度守卫不认
  （和 `--sticky-ink` 一样），所以有 `scripts/build/check-island-contrast.mjs`
  与 `src/renderer/test/island-contrast.test.ts` 两道。
- **dev 实例连不上 CDP**（`/json/list` 永远不返回），看岛的界面只能靠
  `pnpm run preview:island` —— 它另起一个最小 Electron 应用，加载岛的真实产物 +
  喂假数据，用 `capturePage` 截出收起/展开两张图，落在 `dist/island-preview-*.png`。
- **主窗口回前台时岛自动隐藏**：主窗口 `restore` / `showMainWindow` 时收起岛，
  否则两块浮层叠在一起。岛显示时用 `showInactive`，不抢焦点。
- **置顶层级用 `screen-saver`**（Windows 层级里最高的一档）。默认的
  `alwaysOnTop` 只给 `floating`（topmost 档）—— 别的应用弹一个 topmost 窗口
  （聊天气泡、输入法候选框、截图工具）就压到岛上面了，
  独占全屏的应用更是连 topmost 都压得住。便签的「屏幕级置顶」用的也是这一档。
- **每次显示都要重新设一次置顶层级**：Windows 上透明层窗口隐藏再显示之后，
  always-on-top 状态有时会掉 —— 掉了岛就变回一个普通窗口，
  随便哪个应用盖上来，岛就没了（表现为「有时候被别的窗口挡住」）。
  设层级顺带把自己顶到 topmost 档的最前面。

### 6.6 SonarQube Cloud 质量门禁

静态分析走 [SonarQube Cloud](https://sonarcloud.io/project/overview?id=Ruciazyt_qnote-elec)
（原名 SonarCloud，界面已改名），项目 key `Ruciazyt_qnote-elec`，组织 `Ruciazyt`。
**详细说明在 `docs/SONAR.md`**，改这块行为前先读它。
几条容易踩的约束：

- **分析范围写在 `sonar-project.properties` 里，不在脚本里**。`sonar.sources` 必须
  包含 `scripts/` —— SonarCloud 报的 S4036（命令注入）、S5852 / S8786（正则回溯）、
  S8705（参数注入）几乎全在构建与发版脚本里，它们不在 `src/` 下，默认配置会把
  这一整块漏掉。
- **覆盖率必须真的产出 lcov**。`pnpm run test:coverage` 跑出
  `src/renderer/coverage/lcov.info`，Sonar 侧填的路径要对上。vitest 的根目录是
  `src/renderer`，它写出来的 SF 路径是相对该目录的、而且 Windows 上是反斜杠 ——
  直接喂给 Sonar 会让它去找 `<仓库根>/App.tsx`，覆盖率整体算成 0。
  `scripts/quality/normalize-lcov.js` 负责把路径改写成相对仓库根的正斜杠形式，
  `test:coverage` 脚本里已经串上了，别拆开。
- **门禁查的是最近一次分析，不是现扫**。本地查 API 不需要 Java；现扫要 JDK 17+
  与 sonar-scanner CLI（`pnpm run sonar:scan`），CI 的 `sonar.yml` 每次推 master 会扫。
  本地 HEAD 与那次分析的提交对不上时，清单顶部会明确标出来。
- **CI 里判定要带 `--wait`**：扫描器把结果传上去之后计算任务还要跑一会儿，
  立刻查 API 拿到的是上一次的旧结果 —— 门禁就成了假通过。
- **令牌缺失时门禁跳过，不阻断发版**。令牌来自环境变量 `SONAR_TOKEN` 或
  `.data/sonar/token`（`.data/` 已 gitignore）；CI 用仓库 secret `SONAR_TOKEN`。
  项目是私有的，匿名访问 SonarCloud API 一律返回 "Project doesn't exist"。
- **默认拦「缺陷 + 漏洞」两类**（`BUG` / `VULNERABILITY`），代码异味只报不拦。
  **不按严重级别拦** —— 这个项目有 700+ 个未解决问题，其中代码异味占 695 个，
  按级别拦（CRITICAL/MAJOR 有 334 个）会把发版永久堵死，门禁最后肯定会被
  `SKIP_SONAR=1` 绕过。改口径用环境变量 `SONAR_BLOCK_TYPES`（CI 用仓库变量同名覆盖），
  写 `all` 表示全拦；要配合级别过滤再加 `SONAR_BLOCK_SEVERITIES`。
  紧急情况 `SKIP_SONAR=1` 显式跳过，会留痕。
- **严重级别有两套名字**：Cloud 换成了新的 impact 模型（BLOCKER / HIGH / MEDIUM / LOW），
  老接口仍返回旧模型（CRITICAL / MAJOR / MINOR）—— 只认一套的话，
  HIGH 级问题会被当成"不拦"悄悄放过去。两套都要认。
- **门禁放在 bump 版本号之前**（`scripts/release/release.js`）：不过就不改版本号、
  不打 tag、不推远端，不会留下半成品。CI 侧还有一道 `sonar-gate` 作业 ——
  tag 触发时先过门禁，不过就不出包、不建 Release。
- **`.data/sonar/` 是清单落点**（`sonar-issues.md` + `sonar-issues.json`），
  那个目录已 gitignore，清单不会进仓库。
- **存量债有台账**（`docs/SONAR-DEBT.md`）：哪些清了、哪些**判��后决定不追**、
  各自的理由与"真要清该怎么做"。改静态分析口径前先读它 ——
  里面"明确不修"的那几条（认知复杂度、循环内 await、可选链、props 只读等）
  是**主动决策**，不是遗漏，别把它们当待办又清一遍。

#### 用户要求修复 Sonar 问题时的标准动作

**先跑 `pnpm run sonar:issues` 拿清单，再动手改。** 不要凭印象改、
也不要先去 SonarCloud 网页上翻 —— 脚本已经拉好、分好组、带文件行号，
并且写了一份到 `.data/sonar/sonar-issues.md`。

```bash
pnpm run sonar:issues        # 出清单（不阻断），清单同时写到 .data/sonar/
pnpm run verify:sonar        # 同上，但命中拦截级别就退出码 1（等价于 --gate）
```

**没有令牌时用本地扫描代替**（`pnpm run sonar:local`）：SonarCloud 对 JS/TS 用的
就是 `eslint-plugin-sonarjs` 这套规则，本地现扫等于把 Sonar 的一部分提前搬到本地。
它不需要令牌、不用等 CI，但**不含**只有服务端才知道的东西（跨文件数据流、
覆盖率、安全热点的人工复核结论）。两份清单一起看。

```bash
pnpm run sonar:local         # 本地现扫，error + warning 清单
pnpm run sonar:local -- --gate   # 有 error 就退出码 1
pnpm run lint                # 同上的底层命令（eslint .）
pnpm run lint:fix            # 能自动修的机械问题（未用 import、prefer-const 等）
```

配置在根目录 `eslint.config.mjs`（flat config）与 `tsconfig.lint.json`（类型感知
用的 tsconfig）。规则是**挑过的**：只开缺陷类与安全类，纯代码异味类的度量规则
（函数必须有显式返回类型、认知复杂度、行数上限）本地一律关着 —— 开着只会把
真正的问题淹掉。

拿到清单后的处理顺序：

1. **先看概览**：按严重级别、类型、规则分布排序 —— 同一类规则成片出现时，
   往往是同一个根因，改一处能消掉一整批，别一条一条单独修。
2. **只修真实问题**。清单里有噪音是正常的：
   - 规则本来就对、只是触发姿势特殊 → 用 `// NOSONAR` 标注并写清理由
     （仓库里已有先例，见 `src/main/core/window/appPreview.ts`）
   - 误报 / 不可复现 → 别改代码去迎合扫描器，先确认是不是分析范围配错了
3. **改完复跑**：同一个命令再跑一次，确认这批消失了、没带出新的。
   清单反映的是 SonarCloud 上**最近一次分析**的结果，
   所以本地复跑看到的还是旧快照 —— 要看新结果得推 master 让 CI 重扫，
   或本地 `pnpm run sonar:scan`（需要 JDK 17+）。
4. **按第 2 节拆提交**：一条规则一批改动，不要把不同规则混在一个提交里。
5. **别顺手改无关文件**：Sonar 清单会把整个仓库的问题都列出来，
   一次全修完动静太大 —— 按规则分批改、每批一个提交更安全。

清单里的每条都带一条直达 SonarCloud 的链接，
需要看上下文（该规则的完整说明、示例代码）时点它。

### 6.7 云端存储：共享数据与私有数据的边界

QNote 的数据分两层，**边界不能模糊**。规范全文在 `docs/CLOUD-STORAGE.md`，
改这块行为前先读它。

| 层 | 内容 | 存哪 |
| --- | --- | --- |
| **私有** | 笔记、剪贴板、Todo、AI 对话、快捷方式、书签、题单、记忆索引、设置 | **永远本地 SQLite**，零改动 |
| **共享** | 已发布的 APP 目录（`published_app`） | 本地 SQLite / **公共目录 Worker** / 直连 D1，用户在设置页切 |

共享存储有**三个**后端，接口完全一样：

| 后端 | 连什么 | 用户要做什么 | 凭据在哪 |
| --- | --- | --- | --- |
| `local` | 本地 SQLite | 什么都不用做 | 无 |
| `public` | 公共目录 Worker 代理 | 什么都不用做（地址已内置） | **只在 Worker 侧** |
| `d1` | 直连 Cloudflare D1 REST | 填账号 ID / 库 ID / Token | 在用户本机（是他自己的） |

几条容易踩的约束：

- **私有数据不上云**。别因为「反正有 D1 了」就把某个用户自有的表搬过去 ——
  笔记、剪贴板、Todo、AI 对话里全是用户自己的内容。
  要新增共享数据，先问一句「这条数据所有人看都合适吗」。
- **D1 的 API Token 是账号级的，控制台里也没法只授权到单个库**
  （Cloudflare 文档原话："A Cloudflare API token with D1 access is
  account-wide"）。所以**不要把 Token 内置进客户端** ——
  那等于把账号下所有 D1 库的写权限发给每一个用户。
  「所有用户零配置」的正确解法是 `cloud-worker/`：Worker 用 D1 绑定直连，
  客户端只内置一个**公开地址**。
- **共享存储是多后端的**，各后端必须给出**一样的行为**。
  差异只允许出现在 `SqlExecutor`（两个方法）里，查询逻辑写在
  `SharedStoreOnExecutor` 上，各后端共用。
  改查询逻辑后要跑 `src/database/cloud/sharedStore.test.ts` ——
  那是**契约测试**，同一套用例跑每个后端一遍。
- **Worker 的 SQL 白名单必须有测试**。它的地址是公开的（内置在客户端里），
  谁都能往里 POST —— 白名单一松，数据库的全权就暴露在公网上。
  改白名单要同时看 `cloud-worker/src/guard.test.ts`（守白名单本身）
  与 `cloud-worker/src/index.live.test.ts`（守「客户端实际发的语句不被误伤」）。
- **D1 上没有交互式事务**。每条查询包在自己的隐式事务里，
  `BEGIN` / `COMMIT` 跨请求无效。唯一能拿到原子性的手段是
  **batch**（一次请求发多条语句，全成或全滚）。
  凡是需要原子性的地方一律走 `executor.batch()`，
  别自己拼 `BEGIN` / `COMMIT`。
- **写操作不重试**。D1 只自动重试只读查询；我们也不重试写 ——
  重试一次写可能变成写两条。只读查询才会走退避重试。
- **配置存在本地** `settings` 表（键名 `cloud_storage_config`）。
  看着别扭但是必须的：配置决定用哪个后端，配置本身在云端就是先鸡后蛋。
  解析失败必须退回纯本地，不能抛异常 —— 一份坏配置不该让应用起不来。
- **切到云端前先做真实的连通性检查**，通不过就不切，让用户留在本地。
  云端建表失败也要退回本地，不让应用因为云端不可用而起不来。
- **API Token 走运行时配置**（设置页填、存本地 settings），
  不进仓库 —— 见第 4 节的红线。
- **公共目录地址是公开的**，可以内置进安装包（它不是密钥）；
  真正的凭据在 Worker 侧。注意主进程是 **tsc** 编译的，
  `process.env` 是**运行时**读的 —— 「CI 里设个环境变量就烤进包里」
  在当前构建链下不成立。
- **共享表的 id 用字符串**，不用自增整数：自增 id 在本地库和云端库里
  是两套不同的编号空间，切来切去会撞。
- **preload 不能 import `src/shared`**：preload 的 tsconfig 把 `rootDir`
  钉在 `src/main`，引用共享模块会报 TS6059，还会把共享模块的 `.js`
  吐在源码旁边。preload 里的类型就地写，完整声明放
  `src/renderer/electron.d.ts`。



---

## 7. 提交与发版的分工

- 规范要求**不自动执行 `git commit`**：改动改到工作区即止，提交由人来做
- 发版（`pnpm run release:*`）会写 commit 与 tag，属于要显式确认的操作
