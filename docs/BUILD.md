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

# 2. 构建所有版本（安装版 + 便携版）
pnpm run build

# 3. 仅构建便携版
pnpm run build-portable
```

### 构建脚本说明

| 脚本                     | 说明                             |
| ------------------------ | -------------------------------- |
| `pnpm run build`          | 完整构建流程，生成安装版和便携版 |
| `pnpm run build-portable` | 仅构建便携版                     |
| `pnpm run clean`          | 清理构建文件                     |

## 🚀 自动发布流程

### GitHub Actions 自动构建

每次推送带有版本标签的提交时，GitHub Actions 会自动：

1. **构建应用**: 同时构建安装版和便携版
2. **创建 Release**: 在 GitHub 上创建新的 Release
3. **上传文件**: 将构建的文件上传到 Release 中

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
2. **Git 提交**: 提交版本更新
3. **创建标签**: 创建对应的 Git 标签 (如 `v1.0.1`)
4. **推送到 GitHub**: 推送代码和标签到远程仓库
5. **触发 CI/CD**: GitHub Actions 检测到标签推送，开始自动构建
6. **构建应用**: 在 GitHub 服务器上构建安装版和便携版
7. **创建 Release**: 自动创建 GitHub Release 并上传构建文件

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

## 📁 目录结构

```
qnote-elec/
├── .github/
│   └── workflows/
│       └── build-and-release.yml    # GitHub Actions工作流
├── scripts/
│   ├── release.js                   # 发布脚本
│   └── post-build.js                # 后处理脚本
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

```bash
# 列出构建文件
ls -la dist_electron/

# 应该看到类似以下文件：
# QNote-Setup-1.0.7.exe      # 安装版
# QNote-1.0.7-portable.zip   # 便携版
```

## 🐛 常见问题

### 构建失败

1. **依赖问题**: 确保工作区依赖都已正确安装

   ```bash
   pnpm install
   ```

2. **权限问题**: 确保有写入 `dist_electron/` 目录的权限

3. **内存不足**: electron-builder 需要较多内存，确保系统有足够可用内存

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
