<div align="center">
  <img src="https://raw.githubusercontent.com/Ruciazyt/qnote-elec/master/src/renderer/public/icon-256.png" width="88" height="88" alt="QNote" />
  <h1>QNote</h1>
  <p><b>安静地待在桌面角落的效率工具</b><br />剪贴板 · 笔记 · Todo · AI 助手 · 内嵌浏览器 —— 一处收下</p>
</div>

<div align="center">

[![Release](https://img.shields.io/github/v/release/Ruciazyt/qnote-elec?label=Release&color=1d97a8)](https://github.com/Ruciazyt/qnote-elec/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Ruciazyt/qnote-elec/total?label=Downloads&color=1d97a8)](https://github.com/Ruciazyt/qnote-elec/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/Ruciazyt/qnote-elec/build-and-release.yml?label=release-build&color=1d97a8)](https://github.com/Ruciazyt/qnote-elec/actions/workflows/build-and-release.yml)
[![CI](https://img.shields.io/github/actions/workflow/status/Ruciazyt/qnote-elec/auto-build.yml?label=ci&color=1d97a8)](https://github.com/Ruciazyt/qnote-elec/actions/workflows/auto-build.yml)
[![Windows](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)](https://github.com/Ruciazyt/qnote-elec/releases/latest)
[![License](https://img.shields.io/github/license/Ruciazyt/qnote-elec?label=License&color=1d97a8)](LICENSE)

[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=9FEAF9)](https://www.electronjs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=20232A)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)

</div>

---

<p align="center">
  <a href="https://github.com/Ruciazyt/qnote-elec/releases/latest"><img src="https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD-latest-1d97a8?style=for-the-badge&logo=github&logoColor=white" alt="下载最新版本" /></a>
  <a href="#-功能一览"><img src="https://img.shields.io/badge/%E7%9C%8B%E4%BB%80%E4%B9%88-%E5%8A%9F%E8%83%BD%E4%B8%80%E8%A7%88-1d97a8?style=for-the-badge&logo=readthedocs&logoColor=white" alt="功能一览" /></a>
  <a href="#-%E5%BC%80%E5%8F%91"><img src="https://img.shields.io/badge/%E5%BC%80%E5%8F%91-8A94A7?style=for-the-badge&logo=github&logoColor=white" alt="开发" /></a>
</p>

---

## 📌 这是什么

QNote 是一个基于 **Electron** 的桌面效率工具。它把日常最高频的几件事收进同一个窗口：

- 复制过的每一段文字，都替你留着 —— **剪贴板历史**即时入库、可搜索、可置顶
- 想法落成文件，不锁在某个专有格式里 —— **笔记**是纯文件制，Markdown / 网页 / 绘图 / 图片 / PDF 都能放
- 事情有轻重缓急 —— **Todo** 带优先级、截止时间与图片附件
- 不想动手的那部分，交给 **AI 助手** —— 它能读你的笔记、翻你的剪贴板，甚至替你操作网页
- 要查的东西不必切浏览器 —— **内嵌浏览器**带书签，AI 侧栏能直接读当前页面

设计取向只有一条：**安静**。单一品牌色、克制的动效、几乎不抢注意力的视觉密度，让工具消失在肌肉记忆里，而不是时刻提醒你它的存在。

---

## 📚 目录

- [这是什么](#-这是什么)
- [功能一览](#-功能一览)
- [界面预览](#-界面预览)
- [下载安装](#-下载安装)
- [功能详解](#-功能详解)
  - [📋 剪贴板](#-剪贴板)
  - [📓 笔记](#-笔记)
  - [✅ Todo](#-todo)
  - [🤖 AI 助手](#-ai-助手)
  - [🌐 内嵌浏览器](#-内嵌浏览器)
  - [🖼️ OCR 与语音输入](#-ocr-与语音输入)
  - [🚀 快捷方式](#-快捷方式)
- [配置说明](#-配置说明)
- [技术栈](#-技术栈)
- [项目结构](#-项目结构)
- [开发](#-开发)
- [版本号与发版](#版本号与发版)
- [相关文档](#-相关文档)
- [反馈与贡献](#-反馈与贡献)
- [许可证](#-许可证)

---

## ✨ 功能一览

| 模块 | 能力 |
| --- | --- |
| 📋 **剪贴板** | 后台监听文本与图片、置顶、标记重要、全文搜索、代码高亮、一键格式化、存为笔记、加为待办、写入记忆索引 |
| 📓 **笔记** | 纯文件制存储、5 种笔记类型、文件夹树、拖拽移动、重命名、批量导入、富文本编辑、Excalidraw 绘图、PDF 阅读 |
| ✅ **Todo** | 三级优先级、截止时间、备注、图片附件、一键完成 |
| 🤖 **AI 助手** | 全局浮框、流式输出、支持图片提问、Agent 工具循环、13 个内置工具、会话历史与自动压缩、AI 技能模板、长期记忆、用量统计 |
| 🌐 **内嵌浏览器** | 多标签页、书签收藏、AI 侧栏读取当前页面、AI 可点击 / 填表 / 导航 |
| 🖼️ **OCR** | 百度 OCR 标准版 / 高精度版 / 网页图片识别，结果可存回记录 |
| 🎤 **语音输入** | MiniMax ASR 语音转文字，全局快捷键唤起（默认 `F1`，可改） |
| 🚀 **快捷方式** | 主页磁贴一键打开应用与文件夹、拖拽排序、系统右键菜单直接收录 |
| 🎨 **其它** | 深浅色主题、像素桌宠、系统托盘常驻、剪贴板小窗（`Ctrl/⌘ + Shift + V`）、数据导出导入、应用自动更新 |

---

## 🖼️ 界面预览

> 截图待补 —— 把图片放进 `docs/images/`，再把下面每行的 `<!-- -->` 注释去掉即可。
>
> - **主页** —— 剪贴板列表、搜索、OCR、格式化的操作条
> - **笔记** —— 文件夹树 + 多类型编辑器（文本 / 绘图 / 网页 / 图片 / PDF）
> - **AI 助手浮框** —— 折叠球与展开卡片两种形态
> - **内嵌浏览器** —— 标签栏、书签栏与 AI 侧栏

```markdown
<!-- <p align="center"><img src="docs/images/home.png" width="880" alt="主页" /></p> -->
<!-- <p align="center"><img src="docs/images/notes.png" width="880" alt="笔记" /></p> -->
<!-- <p align="center"><img src="docs/images/ai.png" width="880" alt="AI 助手" /></p> -->
```

---

## 📥 下载安装

当前发布渠道为 **Windows**，每次发版由 GitHub Actions 自动产出两种形态：

### 安装版（推荐）

- 文件名：`QNote-Setup-x.x.x.exe`
- 双击安装，可选择安装目录，自动创建桌面与开始菜单快捷方式
- **支持自动更新** —— 应用内「设置 → 数据与开发 → 应用更新」可完成检查、下载、重启安装三步
- 更新包下载完成后即校验 SHA512，损坏或被篡改的文件不会装上

### 便携版

- 文件名：`QNote-x.x.x-portable.zip`
- 解压到任意目录，双击 `QNote.exe` 即可运行
- 适合 U 盘携带、临时使用、绿色卸载
- **不支持自动更新** —— 便携版没有安装器，无法覆盖自己，升级需手动下载新版本替换目录

> 📌 笔记默认存放在 `%APPDATA%\qnote\notes`，在笔记页点「更换目录」即可改到任意本地路径。

---

## 🧩 功能详解

### 📋 剪贴板

打开就是历史列表 —— 复制过什么，都在。

- **自动入库**：文本与图片复制后立刻入列，重复内容自动去重
- **置顶 / 重要**：置顶的排在最前；标为「重要」的记录在清空时会被保留
- **全文搜索**：边输入边筛，命中后仍可直接编辑保存
- **代码高亮**：代码片段用 Prism 渲染，支持 `JavaScript` / `TypeScript` / `JSON` / `HTML` / `CSS` 五种语言一键格式化
- **一键流转**：任意一条记录可以存成笔记、加成待办、写入记忆索引
- **图片识别**：图片记录可直接调百度 OCR，识别结果回写到该条记录
- **小窗速取**：`Ctrl/⌘ + Shift + V` 唤出独立小窗，不打断当前窗口的操作

### 📓 笔记

**笔记是纯文件制** —— 没有专有数据库，也没有私有格式，类型完全由扩展名决定。

| 类型 | 扩展名 | 说明 |
| --- | --- | --- |
| 绘图 | `.excalidraw` | 内置 Excalidraw，手绘草图、流程图随手存 |
| 文本 | `.md` / `.markdown` | TipTap 富文本编辑，落盘为标准 Markdown |
| 网页 | `.html` / `.htm` | 单文件网页，图片资源自动抽取到 `assets/` |
| 图片 | `.png` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` `.svg` | 截图、素材直接存进来 |
| PDF | `.pdf` | 内置阅读器，翻页与缩放 |

配套能力：

- **文件夹树**：多级目录、拖拽移动、重命名、批量导入（拖入文件即可）
- **资源目录**：富文本里的图片统一存进 `assets/`，笔记正文保持纯文本可读
- **默认目录**：`%APPDATA%\qnote\notes`，可改为任意本地路径
- **AI 可写**：AI 助手能直接往笔记目录写文件（同名自动追加后缀，不覆盖你的版本）

### ✅ Todo

- 三级优先级（高 / 中 / 低）、可选截止时间与备注
- 支持图片附件 —— 从剪贴板直接「加为待办」时，图片和 OCR 文本会一并带上
- 剪贴板、笔记、AI 助手三处都能创建待办

### 🤖 AI 助手

右下角常驻一颗球，点开是一张可拖动的浮窗卡片，位置与展开状态跨窗口同步。

- **流式输出**：逐字返回，随时可中断
- **Agent 模式**：模型自己决定调用哪些工具，循环直到任务完成
- **支持图片**：输入框里可直接粘贴、拖入或选文件，最多 4 张，随提问一起发给模型
- **多会话**：历史会话分组保存，随时回溯
- **长会话自动压缩**：超过阈值时自动摘要历史，界面给出「正在压缩历史…」提示
- **AI 技能**：把常用提示词存成模板，支持 `{content}` / `{clipboard}` 占位符，也能从远程 URL 导入
- **长期记忆**：AI 可以主动记住你的偏好、事实与协作约定，存在 `<userData>/ai-memory.json`，明文可读可改
- **用量统计**：今日 / 本周 / 累计的 token 消耗与按模型、按日期分布，设置页可直接查看

**内置工具清单**

| 工具 | 作用 | 类型 |
| --- | --- | --- |
| `list_notes` | 列出笔记目录 | 读 |
| `read_note` | 读取指定笔记内容 | 读 |
| `save_note` | 写入笔记（同名自动改名） | 写 |
| `get_clipboard_history` | 读取剪贴板历史 | 读 |
| `get_todos` | 读取待办清单 | 读 |
| `get_app_info` | 读取应用信息与数据路径 | 读 |
| `remember` / `recall` / `forget` | 长期记忆的写入 / 召回 / 删除 | 混合 |
| `browser_get_snapshot` | 读取当前网页的结构化快照 | 读 |
| `browser_click` / `browser_fill` / `browser_navigate` | 操作内嵌浏览器当前标签页 | 写 |

> 🛡️ 浏览器类工具只作用于**你当前正在看的那一个标签页**，不会新建或关闭标签，每次操作都会落进应用日志。涉及密码、验证码、支付信息时，模型被明确要求停下来交给你确认。

**接入方式**：兼容 OpenAI 与 Anthropic 两种协议，填入 API Key、模型名与 Base URL 即可 —— 官方端点、聚合网关、Ollama、LM Studio 都能用。

> 🖼️ 带图提问需要模型本身支持视觉（GPT-4o / Claude / MiniMax 视觉型号这一类）。模型不支持时上游会直接报错，错误原样显示在提示条里 —— 纯文字提问不受影响。

### 🌐 内嵌浏览器

- 多标签页、书签收藏、地址栏与前进 / 后退 / 刷新
- 右侧可展开 **AI 侧栏**，让模型直接读当前页面并操作
- 网页由主进程的 `WebContentsView` 承载，界面层只负责工具栏与位置同步，因此不会被页面的样式干扰

### 🖼️ OCR 与语音输入

- **OCR**：百度 OCR 三种模式 —— 标准版、高精度版、网页图片识别。API Key 与 Secret Key 在设置页填写，源码里只保留空默认值
- **语音输入**：录音后送 MiniMax ASR（`asr-1.0`）转成文字。默认用 `F1` 唤起，快捷键可改，非法组合会被拦下并说明原因

### 🚀 快捷方式

- 主页磁贴：把常用应用与文件夹钉在首页，一点直达
- 拖拽排序，图标自动解析
- 开启系统右键菜单后，在资源管理器里右键任意文件即可「添加到 QNote」

---

## ⚙️ 配置说明

所有密钥与第三方服务配置都在**设置页**填写，运行时注入，仓库里不含任何凭据。

| 配置项 | 用途 | 位置 |
| --- | --- | --- |
| 笔记目录 | 笔记文件存放路径 | 笔记页 → 更换目录 |
| 百度 OCR Key / Secret | 图片文字识别 | 设置 → 服务与 AI → OCR 识别 |
| AI Provider / Key / 模型 / Base URL | AI 助手与语音识别 | 设置 → 服务与 AI → AI 助手 |
| 语音快捷键 | 语音输入的全局唤起键 | 设置 → 服务与 AI → 语音输入 |
| 主题 | 浅色 / 深色 / 跟随系统 | 设置 → 界面 → 外观 |
| 应用更新 | 检查 / 下载 / 安装新版本 | 设置 → 数据与开发 → 应用更新 |

**数据存放位置**

| 内容 | 路径 |
| --- | --- |
| 数据库 | `%APPDATA%\qnote\db\clipboard.sqlite` |
| 默认笔记目录 | `%APPDATA%\qnote\notes` |
| 日志 | `%APPDATA%\qnote\app.log` / `app-error.log` |
| AI 长期记忆 | `%APPDATA%\qnote\ai-memory.json` |

> 💾 数据库支持在设置页一键导出 / 导入，换机时直接搬文件即可。

---

## 🛠️ 技术栈

| 层次 | 技术选型 |
| --- | --- |
| 桌面框架 | Electron 33 |
| 界面 | React 18 · Vite 5 · Tailwind CSS 3 · shadcn/ui · lucide-react |
| 编辑器 | TipTap（富文本 / Markdown）· Excalidraw · Prism · Prettier |
| 数据 | Knex · SQLite（sqlite3） |
| AI | LangChain（`@langchain/openai` / `@langchain/anthropic`）· 自研 Agent 循环与记忆层 |
| 语言 | TypeScript 5 |
| 构建 | electron-builder 25（NSIS 安装包 + 便携版 ZIP） |

---

## 📁 项目结构

```text
qnote-elec/
├── src/
│   ├── main/                  # 主进程
│   │   ├── core/              # 常驻能力：托盘、快捷键、剪贴板监听、浮窗、自动更新
│   │   ├── handlers/          # IPC 处理器，一个模块一个文件
│   │   └── utils/             # AI / OCR / ASR / 向量检索 / 配置
│   ├── preload.ts             # 上下文桥接，渲染层唯一的系统能力入口
│   ├── renderer/              # React 界面
│   ├── shared/                # 主进程与渲染层共用的类型定义
│   └── database/              # Knex 连接与迁移
├── build/                     # 打包与编译配置（electron-builder / tsconfig）
├── scripts/                   # 构建、发版、提交钩子脚本
├── docs/                      # 补充文档
├── DESIGN.md                  # 设计规范：色彩、密度、组件哲学
└── AGENTS.md                  # 开发规范：提交信息、版本号、红线
```

---

## 🛠️ 开发

### 环境要求

- **Node.js >= 18**
- **pnpm 10.32.0**（请勿改用 npm / yarn）

### 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式：主进程编译监听 + 渲染层热更新 + 应用启动，三者并行
pnpm run dev

# 只编译主进程与 preload
pnpm run build:electron

# 只构建渲染层
pnpm run build:react

# 完整构建：清理 → 编译 → 打包 → 便携版后处理
pnpm run build

# 构建便携版
pnpm run build-portable
```

### 提交规范

仓库启用了提交信息校验钩子（Angular 提交规范），首次克隆后执行一次：

```bash
pnpm run setup:hooks
```

提交信息形如 `feat(ocr): 增加百度 OCR 表格识别`。也可以单独校验：

```bash
pnpm run verify:commit "feat(updater): 增加应用更新卡片"
```

> Windows 上若钩子文件权限不对会被静默跳过，`setup:hooks` 会自动补正。

### 版本号与发版

版本号的唯一来源是根目录 `package.json` 的 `version` 字段。发布走「打 tag → CI 构建 → 创建 Release」这一条路径：

```bash
pnpm run release:patch     # 1.1.0 → 1.1.1
pnpm run release:minor     # 1.1.0 → 1.2.0
pnpm run release:major     # 1.1.0 → 2.0.0
```

脚本会校验工作区是否干净、版本号格式是否合法、**发版类型是否与本批提交匹配**（有 `feat` 却发 patch 会被直接拦下），然后 bump 版本、打注释 tag、推送分支与 tag。CI 随之产出安装版、便携版与 `latest.yml`，并创建 GitHub Release。

校验版本号：

```bash
pnpm run verify:version
```

---

## 📚 相关文档

| 文档 | 内容 |
| --- | --- |
| [便携版说明](docs/PORTABLE.md) | 便携版的特点、目录结构与迁移方式 |
| [构建指南](docs/BUILD.md) | 本地打包、产物位置与常见构建问题 |
| [设计规范](DESIGN.md) | 色彩体系、视觉密度、组件与交互约定 |
| [开发规范](AGENTS.md) | 提交信息、版本号规范与红线清单 |
| [更新日志](https://github.com/Ruciazyt/qnote-elec/releases) | 每个版本的完整变更记录 |

---

## 🐛 反馈与贡献

- 遇到问题或想要新功能 → 提 [Issue](https://github.com/Ruciazyt/qnote-elec/issues)
- 准备动手改 → 先读 [AGENTS.md](AGENTS.md)（提交规范与红线）与 [DESIGN.md](DESIGN.md)（界面约定）
- 提 Issue 时附上版本号、系统版本与复现步骤，能贴日志最好（`%APPDATA%\qnote\app.log`）

---

## 📄 许可证

[MIT](LICENSE) © Rucia zyt
