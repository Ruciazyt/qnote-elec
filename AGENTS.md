# QNote — Agent 开发规范

本文件是本项目（以及在本项目上工作的任何 Agent / 开发者）的强制规范。
**动代码之前先读完这一节。** 其中能被机械判定的规则由校验脚本兜底，
不合规的提交会在 `git commit` 当场被拦下；其余靠自觉。

---

## 1. 项目速览

| 项 | 值 |
| --- | --- |
| 形态 | Electron 桌面应用（Windows 安装版 + 便携版） |
| 主进程 | `src/main`（TypeScript → `dist/main`），preload 在 `src/main/preload.ts` |
| 渲染层 | `src/renderer`（React 18 + Vite 5 + Tailwind 3 + shadcn/ui，new-york 风格） |
| 共享层 | `src/shared`（主进程与渲染层共用的类型） |
| 数据层 | `src/database`（Knex + SQLite，笔记、剪贴板、待办等） |
| 构建配置 | `build/electron-builder.json`（打包）、`build/tsconfig.*.json`（编译） |
| 脚本 | `scripts/`（按用途分目录：`build/` 构建后处理、`release/` 发版、`git-hooks/` 提交规范、`dev/` 开发期辅助） |
| CI | `.github/workflows/`（`build-and-release.yml` 正式发布 / `auto-build.yml` 提交验证） |
| 运行时要求 | Node.js >= 18，pnpm 10.32.0（勿改用 npm / yarn） |

### 常用命令

```bash
pnpm dev                # 主进程 + 渲染层热更新一起起
pnpm run build          # 完整构建（clean → 编译 → 打包 → 便携版后处理）
pnpm run build:electron # 只编译主进程与 preload
pnpm run build:react    # 只构建渲染层
pnpm run build:app      # 只跑 electron-builder
pnpm run release:patch  # 发补丁版本（1.0.18 → 1.0.19）
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
ELECTRON_BUILDER_VERSION 覆盖版本 —— 该变量在 electron-builder 25.x
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
MAJOR.MINOR.PATCH        例：1.0.18
```

- 三段纯数字，不带 `v` 前缀、不带 `-rc` 之类后缀
- 当前发布线是 **1.0.x**；`1.1.0` 属于新的次版本线，需在发版说明里交代
- **版本号的唯一来源是根目录 `package.json` 的 `version` 字段**，任何地方都不许另造版本号

### 3.2 语义化版本

| 场景 | 变更 |
| --- | --- |
| 修复缺陷、性能优化、重构、文档、测试、构建、CI、杂项 | patch（1.0.18 → 1.0.19） |
| 新增功能 | minor（1.0.19 → 1.1.0） |
| 不兼容的 API / 配置 / 数据结构变更 | major（1.1.0 → 2.0.0） |

判断依据是第 2 节的提交 type —— 一批提交里出现 `feat` 就不能只发 patch。

### 3.3 Tag 与 Release

- **Tag 名 = 版本号本身**：`1.0.19`，**不加 `v` 前缀**
- Release 标题 = `QNote 1.0.19`
- Tag 必须与 `package.json` 的 `version` 完全一致
- tag 是**带注释的**（`git tag -a`），注释写 `Release 1.0.19`
- 一个版本号只发一次。改过内容要重发，就 bump 到下一个 patch 号

> 为什么不带 `v`：`v1.0.19` 与 `1.0.19` 在 GitHub 上是两套不同的 tag，
> 混用会让 Release 列表出现两串同号条目，electron-updater 取
> `/releases/download/<tag>/latest.yml` 时也会对不上。统一成不带前缀的形式。

### 3.4 发版流程

正式发布只有一条路径 —— **打 tag 触发 CI**：

```bash
pnpm run release:patch    # 或 release:minor / release:major
```

该脚本会依次：校验工作区干净 → 校验当前版本号格式 → **核对发版类型与本批提交
是否匹配**（有 `feat` 却发 patch 会被直接拦下）→ 拉取最新代码 → 安装依赖 →
按 semver 规则 bump `package.json` 的 version → 以 `chore(release): bump version to X.Y.Z`
提交 → 打 `X.Y.Z` 注释 tag → 推送分支与 tag。推送 tag 后
`build-and-release.yml` 触发，产出安装版、便携版与 `latest.yml` 并创建 Release。

> 新版本号以 `package.json` 为准，不解析 `pnpm version` 的输出 ——
> pnpm 打印的是 `Version bumped successfully: 1.0.18 → 1.0.19` 这类多行文本，
> 不是纯版本号。同理不设 `ELECTRON_BUILDER_VERSION` 之类的环境变量覆盖，
> 该变量在 electron-builder 25.x 里并不生效。

**`auto-build.yml` 不创建 Release。** 它只在每次推 master 时跑一次构建，
把产物上传为 Actions Artifact 用于验证"这次提交能构建出可用的包"。
正式 Release 一律由 tag 触发，这样版本号才有唯一来源。

### 3.5 校验

```bash
pnpm run verify:version
```

检查 `package.json` 的 `version` 是否为三段纯数字、是否为合法 semver、
是否与当前发布线（1.0.x）一致。

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
- [ ] 新增/修改的 UI 遵循 `.cursor/rules/react.mdc` 的 React 最佳实践
- [ ] 没有顺手改无关文件；格式化工具的噪音改动单独成一个 `style:` 提交

---

## 6. 目录与改动落点

| 改动类型 | 落在哪 |
| --- | --- |
| 主进程能力、IPC、窗口、原生能力 | `src/main/`（handler 放 `src/main/handlers/`，常驻能力放 `src/main/core/`） |
| 渲染层界面 | `src/renderer/components/` |
| 跨端共享类型 | `src/shared/` |
| 数据表与迁移 | `src/database/` |
| 打包 / 发布配置 | `build/`、`scripts/`、`.github/workflows/` |

主进程新增 IPC 时三处要同步改，漏一处会静默失效：

1. `src/main/handlers/<模块>.ts` 注册 channel
2. `src/main/preload.ts` 暴露给渲染层
3. `src/renderer/electron.d.ts` 补类型声明

---

## 7. 提交与发版的分工

- 规范要求**不自动执行 `git commit`**：改动改到工作区即止，提交由人来做
- 发版（`pnpm run release:*`）会写 commit 与 tag，属于要显式确认的操作
