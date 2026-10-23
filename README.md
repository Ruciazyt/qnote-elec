# QNote

一个简单易用的笔记应用，支持 Markdown 编辑、OCR 识别、绘图等功能。

## 📦 下载

### 安装版（推荐）

- 下载 `QNote-Setup-x.x.x.exe`
- 双击安装，支持自动更新
- 集成到系统（开始菜单、桌面快捷方式）

### 便携版

- 下载 `QNote-x.x.x-portable.zip`
- 解压到任意文件夹
- 双击 `QNote.exe` 即可运行
- 适合 U 盘携带或临时使用
- 不支持自动更新（无安装器，需手动替换新版本）

## 🔄 自动更新

安装版可在「设置 → 数据与开发 → 应用更新」中完成检查、下载、安装三步：

1. 点「检查更新」，应用会比对 GitHub Releases 上的最新版本
2. 点「下载更新」，进度、速度和剩余大小实时显示
3. 点「重启并安装」，静默完成替换并自动重新启动

更新包在下载完成后即校验 SHA512，避免安装损坏或被篡改的文件。
若更新源不可达，卡片上的「打开下载页」可直接转到 Releases 页面手动下载。

## ✨ 主要功能

- 📝 **Markdown 编辑**: 支持实时预览和语法高亮
- 🖼️ **OCR 识别**: 集成百度 OCR，支持图片文字识别
- 🎨 **绘图功能**: 内置 Excalidraw 绘图工具
- 🔍 **全文搜索**: 快速搜索笔记内容
- 📁 **分类管理**: 支持文件夹分类整理
- 🔄 **自动更新**: 支持自动检查和更新
- 💾 **数据安全**: 本地 SQLite 数据库存储

## 🚀 快速开始

### 使用安装版

1. 下载并安装 `QNote-Setup-x.x.x.exe`
2. 启动应用
3. 开始创建你的第一个笔记

### 使用便携版

1. 下载 `QNote-x.x.x-portable.zip`
2. 解压到任意文件夹
3. 双击 `QNote.exe` 启动
4. 所有数据将保存在程序目录下

## 🔧 配置说明

### 百度 OCR 配置

1. 打开设置页面
2. 输入百度 OCR 的 API Key 和 Secret Key
3. 保存后即可使用 OCR 功能

### 数据位置

- **安装版**: `%APPDATA%/qnote/`
- **便携版**: 程序目录下的 `data/` 文件夹

## 🛠️ 开发

### 环境要求

- Node.js 18+
- pnpm 10+

### 开发命令

```bash
# 安装工作区依赖（根目录 + src/renderer）
pnpm install

# 开发模式（同时启动：Electron 主进程 + Renderer 热更新 + TypeScript 监听）
pnpm run dev

# 仅启动渲染进程（Vite 热更新服务器）
pnpm run dev:renderer

# 仅构建 Electron 主进程（TypeScript 编译）
pnpm run dev:electron

# 构建应用
pnpm run build

# 构建便携版
pnpm run build-portable
```

### 发布

```bash
# 发布补丁版本
pnpm run release:patch

# 发布次要版本
pnpm run release:minor

# 发布主要版本
pnpm run release:major
```

## 📚 文档

- [便携版说明](docs/PORTABLE.md)
- [构建指南](docs/BUILD.md)

## 🐛 问题反馈

如果遇到问题，请在 [GitHub Issues](https://github.com/Ruciazyt/qnote-elec/issues) 中反馈。

## 📄 许可证

MIT License

## 更新日志

### v1.0.18 (当前版本)

> ⚠️ 详细更新日志请参考 [GitHub Releases](https://github.com/Ruciazyt/qnote-elec/releases)。以下为基础功能概述：

- 初始版本发布
- 基础笔记功能
- 剪贴板监听
- OCR 识别
- Excalidraw 绘图

## 联系方式

如有问题或建议，请提交 Issue 或 Pull Request。
