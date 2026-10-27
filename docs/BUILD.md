# QNote 构建和发布指南

## 📦 构建类型

QNote 支持两种构建类型：

1. **安装版** (`QNote-Setup-x.x.x.exe`) - 传统的 Windows 安装程序
2. **便携版** (`QNote-x.x.x-portable.zip`) - 免安装的便携版压缩包

## 🛠️ 本地构建

### 环境要求

- Node.js 18+
- pnpm 10+
- Windows 10/11 (用于构建 Windows 应用)

### 构建步骤

```bash
# 1. 安装工作区依赖
pnpm install

# 2. 构建所有版本（安装版 + 便携版 ZIP）
pnpm run build

# 3. 只产出便携版的未打包目录（不生成 ZIP）
pnpm run build-portable
```

> 💡 `pnpm run build-portable` 只跑 `electron-builder --win dir`，产物是
> `dist_electron/win-unpacked/` 这个**未打包目录**。ZIP 由
> `scripts/build/post-build.js` 生成 —— 它要在压缩前写入便携版标记，
> 所以要拿 ZIP 必须走完整的 `pnpm run build`。

### 构建脚本说明

| 脚本                     | 说明                                          |
| ------------------------ | --------------------------------------------- |
| `pnpm run build`         | 完整构建流程，生成安装版和便携版 ZIP          |
| `pnpm run build-portable` | 只产出便携版的未打包目录，不生成 ZIP          |
| `pnpm run build:app`     | 只跑 electron-builder，产出安装版              |
| `pnpm run build:electron`| 只编译主进程与 preload                         |
| `pnpm run build:react`   | 只构建渲染层                                   |
| `pnpm run clean`         | 清理构建文件                                   |

## 🚀 自动发布流程

### GitHub Actions 自动构建

每次推送**形如 `1.0.19` 的版本号 tag** 时，GitHub Actions 会自动：

1. **构建应用**: 同时构建安装版和便携版
2. **创建 Release**: 在 GitHub 上创建新的 Release
3. **上传文件**: 将构建的文件上传到 Release 中

> tag 名 = 版本号本身，**不带 `v` 前缀**。`v1.0.19` 与 `1.0.19` 在 GitHub 上是两套
> 不同的 tag，混用会让 Release 列表出现两串同号条目，electron-updater 取
> `/releases/download/<tag>/latest.yml` 时也会对不上。详见 AGENTS.md 第 3.3 节。

### 发布命令

```bash
# 发布补丁版本 (1.0.0 -> 1.0.1)
pnpm run release:patch

# 发布次要版本 (1.0.0 -> 1.1.0)
pnpm run release:minor

# 发布主要版本 (1.0.0 -> 2.0.0)
pnpm run release:major
```

### 发布流程详解

当执行发布命令时，会自动执行以下步骤：

1. **版本更新**: 更新 `package.json` 中的版本号
2. **Git 提交**: 提交版本更新（`chore(release): bump version to X.Y.Z`）
3. **创建标签**: 创建对应的注释 tag（`1.0.19`，**不带 `v` 前缀**）
4. **推送到 GitHub**: 推送代码和标签到远程仓库
5. **触发 CI/CD**: GitHub Actions 检测到 tag 推送，开始自动构建
6. **构建应用**: 在 GitHub 服务器上构建安装版和便携版
7. **创建 Release**: 自动创建 GitHub Release 并上传构建文件

> 脚本在 bump 之前还会校验三件事：工作区是否干净、版本号格式是否合法、
> **发版类型与本批提交是否匹配**（有 `feat` 却发 patch 会被直接拦下）。

## 🔧 GitHub Actions 配置

### 工作流文件

`.github/workflows/build-and-release.yml` 定义了自动构建和发布的流程。

### 主要步骤

1. **环境准备**: 设置 Node.js、pnpm 环境和缓存
2. **依赖安装**: 安装整个 workspace 的依赖
3. **构建过程**:
   - 构建 React 前端
   - 编译 TypeScript
   - 使用 electron-builder 打包应用
4. **文件上传**: 将构建的 exe 文件上传到 GitHub Release

### 构建产物

每次发布会生成以下文件：

- `QNote-Setup-x.x.x.exe` - Windows 安装程序
- `QNote-x.x.x-portable.zip` - Windows 便携版压缩包
- `latest.yml` - **自动更新元数据**（安装版更新时必需）

## 🔄 自动更新

安装版支持在设置页「数据与开发 → 应用更新」里检查、下载并安装新版本。
实现基于 [`electron-updater`](https://www.electron.build/auto-update)，
更新源是本仓库的 GitHub Releases。

### 运作方式

1. 应用启动后从 `resources/app-update.yml` 读取更新源配置
   （由 `build/electron-builder.json` 的 `publish` 段在打包时生成）
2. 用户点「检查更新」→ 请求 Releases 的 `latest.yml` 拿到最新版本号
3. 用户点「下载更新」→ 下载安装包并校验 SHA512，全程显示进度
4. 用户点「重启并安装」→ 静默执行 NSIS 安装器覆盖旧版本，装完自动拉起应用

下载完成后若用户没点安装，直接退出应用也会自动完成安装。

### latest.yml 必须随 Release 一起上传

`latest.yml` 里记着版本号、安装包文件名与 SHA512 校验和。
electron-updater 先取它，再据此下载安装包 —— **少了这个文件，
「检查更新」必然失败**（报 `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`）。

两个 workflow 都已把它加进上传列表：

| 文件 | 上传位置 |
| --- | --- |
| `.github/workflows/build-and-release.yml` | 构建产物 → Actions Artifact → Release |
| `.github/workflows/auto-build.yml` | 只进 Actions Artifact，**不创建 Release** |

`auto-build.yml` 每次推 master 跑一次，作用是验证「这次提交能构建出可用的包」。
正式 Release 一律由版本号 tag 触发 `build-and-release.yml` —— 这样版本号才有唯一来源。

### 版本号必须三处一致

以下三处必须指向同一个版本号，否则更新判定会失效：

| 位置 | 来源 |
| --- | --- |
| 安装包文件名 | `appInfo.version`（package.json 的 `version`） |
| `latest.yml` 里的 `version` | 同上 |
| 应用运行时 `app.getVersion()` | 同上 |

`auto-build.yml` 以前用 commit 数拼版本号（`1.0.<commit 数>`），并用
`ELECTRON_BUILDER_VERSION` 环境变量覆盖版本 —— 但 **electron-builder 25.x
并不支持这个变量**，实际版本始终取自 package.json。结果是产物叫 `1.0.18`、
tag 却叫 `1.0.447`，更新永远判定「已是最新」。

现在正式发布统一走 `build-and-release.yml`（打版本号 tag 触发），
`auto-build.yml` 只读取并打印 package.json 的版本号，不做任何改写，
也不会创建 Release。

### 便携版不支持自动更新

便携版是免安装的解压目录，没有安装器，无法"覆盖安装自己"——
NSIS 安装器只会把新版本装到程序目录，用户手里的便携目录还是旧的。

`scripts/build/post-build.js` 会在压缩前往 `resources/` 写入 `portable.marker`，
主进程启动时据此识别便携版并关闭自动更新，改为引导用户去下载页手动替换。

### 更新源不可达时

`build/electron-builder.json` 的 `publish` 段是更新源的唯一开关：

```json
"publish": {
  "provider": "github",
  "owner": "Ruciazyt",
  "repo": "qnote-elec"
}
```

**注意：GitHub 的 Release 附件只有仓库公开时才能被匿名下载。**
仓库若为私有，`electron-updater` 取 `latest.yml` 会拿到 404，
「检查更新」会提示"更新源不可访问"。

三种处理方式：

| 场景 | 做法 |
| --- | --- |
| 仓库公开 | 无需改动，现有配置直接可用 |
| 仓库私有但有公开分发渠道 | 把 `publish` 改成 `generic` 并指向一个公开可访问的目录（该目录里放 `latest.yml` 与安装包），`npmRebuild` 与上传步骤同步调整 |
| 仓库私有且只自用 | 不发 Release 即可；「打开下载页」按钮会带着浏览器登录态跳到 Releases 页 |

切换 `publish` 后需要重新构建 —— `app-update.yml` 是打包时生成并写进
`resources/` 的，改配置不会影响已经打好的安装包。

## 📁 目录结构

```
qnote-elec/
├── .github/
│   └── workflows/
│       └── build-and-release.yml    # GitHub Actions工作流
├── scripts/
│   ├── build/                        # 构建产物处理
│   │   ├── post-build.js             # 便携版后处理
│   │   └── build-icon.mjs            # 图标多尺寸生成
│   ├── release/                      # 发版
│   │   ├── release.js                # 发布脚本
│   │   └── verify-version.js         # 版本号校验
│   ├── git-hooks/                    # 提交规范钩子
│   │   ├── setup-hooks.js            # 启用 .githooks
│   │   └── verify-commit-msg.js      # 提交信息校验
│   ├── dev/                          # 开发期辅助
│   │   ├── kill-dev-electron.js      # 清理残留 dev 实例
│   │   └── wait-dist-stable.js       # 等 dist 写盘稳定
│   └── pixel-pet/                    # 像素桌宠素材与生成脚本
├── docs/
│   ├── BUILD.md                     # 构建指南（本文件）
│   └── PORTABLE.md                  # 便携版说明
├── src/main/                        # Electron主进程代码
├── src/renderer/                    # React前端代码
├── resources/                       # 资源文件
├── dist_electron/                   # 构建输出目录
└── package.json                     # 项目配置
```

## 🔍 构建验证

### 本地验证

```bash
# 执行完整构建
pnpm run build
```

建议验证以下内容：

- 构建过程中依赖安装与编译均成功完成
- `dist/` 与 `dist_electron/` 中生成预期产物
- 安装版和便携版都已生成

### 手动验证

构建完成后，检查 `dist_electron/` 目录：

```powershell
# 列出构建文件
Get-ChildItem -Path dist_electron -Force

# 应该看到类似以下文件：
# QNote-Setup-1.0.19.exe      # 安装版
# QNote-1.0.19-portable.zip   # 便携版
# latest.yml                  # 自动更新元数据
```

## 🐛 常见问题

### 构建失败

1. **依赖问题**: 确保工作区依赖都已正确安装

   ```bash
   pnpm install
   ```

2. **权限问题**: 确保有写入 `dist_electron/` 目录的权限

3. **内存不足**: electron-builder 需要较多内存，确保系统有足够可用内存

4. **`ENOENT: ... node_modules\.pnpm\node_modules\@emnapi\runtime`**

   electron-builder 的原生模块重建步骤会遍历整棵依赖树，撞上 pnpm 留下的
   **悬空 junction**（`@img/sharp-wasm32` 的 wasm 变体在 win32-x64 上不会安装，
   但 pnpm 仍会建链接）就报 ENOENT，整个打包直接失败。

   本项目的运行时原生模块只有 sqlite3，且它是 **N-API**（ABI 稳定，Node 和
   Electron 通用），本来就不需要针对 Electron 重编译，因此构建配置里已经
   关闭了该步骤（`build/electron-builder.json` 的 `"npmRebuild": false`）。

5. **`Cannot create symbolic link : 客户端没有所需的权限`**

   出在解压 `winCodeSign` 工具包时（里面带 darwin 的符号链接）。非管理员
   且没开「开发者模式」的 Windows 建不了符号链接，解压失败 → 打包失败。

   失败的是 macOS 的库文件，跟 Windows 构建毫无关系，纯粹是环境权限问题。

   **`pnpm run build` 已经能自动处理，不用手工干预**：打包脚本
   `scripts/build/build-app.js` 会先照常打包；一旦识别到这个报错，就自动
   改用「跳过 exe 资源写入」重打一次，再用缓存里的 `rcedit-x64.exe`
   把图标和版本信息补回去 —— `rcedit` 是独立可执行文件，不需要符号链接。
   产物与正常打包一致。

   想知道最终 exe 有没有写对，可以查一下：

   ```powershell
   (Get-Item dist_electron\win-unpacked\QNote.exe).VersionInfo |
     Select-Object FileDescription, ProductName, FileVersion
   ```

   另外两种处理方式：

   | 做法 | 说明 |
   | --- | --- |
   | 开启 Windows「开发者模式」 | 设置 → 系统 → 开发者选项，普通用户即可创建符号链接，之后连降级都不会触发 |
   | 以管理员身份运行终端 | 同上，权限直接满足 |

   注意：**CI（GitHub Actions）不受影响** —— 它的 runner 默认就有符号链接权限，
   走的是常规路径。

### GitHub Actions 失败

1. **Token 权限**: 确保 GitHub Token 有足够权限创建 Release
2. **文件大小**: 避免提交过大的文件到仓库
3. **网络问题**: 某些依赖下载可能因网络问题失败，重新运行即可

### 发布问题

1. **版本冲突**: 确保要发布的版本号不与现有版本冲突
2. **Git 状态**: 确保工作目录是干净的（没有未提交的更改）
3. **远程同步**: 确保本地分支与远程分支同步

## 📝 最佳实践

1. **发布前测试**: 始终在发布前运行 `pnpm run build`
2. **版本管理**: 遵循语义化版本规范
3. **Release Notes**: 在 GitHub Release 中添加详细的更新说明
4. **备份重要数据**: 发布前备份重要的配置和数据文件
5. **渐进发布**: 重大更新建议先发布预览版本进行测试

## 🔗 相关链接

- [Electron Builder 文档](https://www.electron.build/)
- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [语义化版本规范](https://semver.org/lang/zh-CN/)
- [便携版说明](./PORTABLE.md)
