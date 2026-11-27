# QNote

> 桌面端的个人信息中枢 —— 剪贴板、笔记、待办、AI 助手与内嵌浏览器，装在一个应用里。

[![Release](https://img.shields.io/github/v/release/Ruciazyt/qnote-elec?label=Release&color=1d97a8)](https://github.com/Ruciazyt/qnote-elec/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Ruciazyt/qnote-elec/total?label=Downloads&color=1d97a8)](https://github.com/Ruciazyt/qnote-elec/releases)
[![License](https://img.shields.io/github/license/Ruciazyt/qnote-elec?label=License&color=1d97a8)](LICENSE)

[![Electron](https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=9FEAF9)](https://www.electronjs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=20232A)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)

---

## 目录

- [这是什么](#这是什么)
- [功能总览](#功能总览)
- [下载与安装](#下载与安装)
- [功能详解](#功能详解)
  - [剪贴板](#剪贴板)
  - [笔记](#笔记)
  - [待办](#待办)
  - [AI 助手](#ai-助手)
  - [技能与 MCP](#技能与-mcp)
  - [内嵌浏览器](#内嵌浏览器)
  - [OCR 与语音输入](#ocr-与语音输入)
  - [灵动岛](#灵动岛)
  - [插件系统](#插件系统)
  - [力扣题单](#力扣题单)
  - [快捷方式](#快捷方式)
  - [其他](#其他)
- [配置](#配置)
- [数据与隐私](#数据与隐私)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [开发](#开发)
- [版本与发布](#版本与发布)
- [代码签名](#代码签名)
- [相关文档](#相关文档)
- [反馈与贡献](#反馈与贡献)
- [许可证](#许可证)

---

## 这是什么

- **你复制的东西都给你留着** —— 剪贴板后台自动记录，可搜索、可置顶、可一键转成笔记或待办。
- **想法变成文件，而不是被锁在某个软件里** —— 笔记就是磁盘上的普通文件：Markdown、网页、绘图、图片、PDF 并排放在一起。
- **任务带权重和截止日** —— 待办分三级优先级，可设到期日、备注与图片附件。
- **不想手动做的事交给 AI** —— 它能读你的笔记、翻你的剪贴板历史，还能替你在内置浏览器里点、填、跳转。
- **查东西不该意味着切窗口** —— 内嵌浏览器留住书签，AI 侧边栏直接读你正在看的页面。
- **最小化也不消失** —— 灵动岛把关键摘要留在屏幕顶边；桌宠、便签随时待命。

---

## 功能总览

| 模块 | 能力 |
| --- | --- |
| **剪贴板** | 后台捕获文本与图片、置顶、标记重要、全文搜索、代码高亮与一键格式化、存为笔记、加为待办、写入记忆索引、百度 OCR 识别 |
| **笔记** | 纯文件存储、5 种笔记类型、任意层级文件夹树、拖拽移动、重命名、批量导入、外部文件夹挂载、TipTap 富文本、Excalidraw 绘图、PDF 阅读、Markdown 链接可点击 |
| **待办** | 三级优先级、可选到期日与备注、图片附件、归档、一键完成 |
| **AI 助手** | 浮窗与桌宠两种形态、流式输出、思维链展示、图片提问、Agent 工具循环、15 个内置工具、会话分组与自动压缩、技能模板、长期记忆、本地记忆索引、用量统计 |
| **技能与 MCP** | 技能模板管理、从远程地址导入、MCP 服务器接入（stdio / HTTP / SSE）、按项目目录配置、工具动态挂载 |
| **内嵌浏览器** | 多标签页、书签管理、AI 侧边栏读取当前页、AI 代为点击与填表、网页检索与抓取工具 |
| **OCR** | 百度 OCR 通用 / 高精度 / 网络图片三种模式，识别结果可写回记录 |
| **语音输入** | MiniMax ASR 语音转文字，全局热键唤起（默认 `F1`，可改） |
| **灵动岛** | 主窗口最小化后吸附屏幕顶边，收起是一行摘要，展开是一块面板（待办 / 剪贴板 / 笔记 / AI） |
| **插件系统** | VSCode 式插件：`plugin.json` 清单声明身份/权限/贡献点，启停进程、原生视图预览、SDK 扩展能力、已发布插件市场 |
| **力扣题单** | 题单增删改查、题单总结、题目列表维护、按文本批量导入 |
| **快捷方式** | 首页磁贴打开网址 / 应用 / 文件夹、拖拽排序、资源管理器右键菜单直达 |
| **其他** | 浅色与深色主题、像素桌宠、便签窗口、系统托盘、剪贴板小窗、数据导入导出、云端共享目录、自动更新 |

---

## 下载与安装

### 安装版（推荐）

- 文件名：`QNote-Setup-x.x.x.exe`
- 双击安装，可自选目录，自动创建桌面与开始菜单快捷方式
- **自动更新** —— 设置 → 数据与开发 → 应用更新，走完检查、下载、重装安装三步
- 更新包在落盘前做 SHA512 校验，损坏或被篡改的文件装不上

### 便携版

- 文件名：`QNote-x.x.x-portable.zip`
- 解压到任意目录，双击 `QNote.exe` 即可运行
- 适合放 U 盘、临时使用，或需要「绿色卸载」的场景
- **不支持自动更新** —— 没有安装器就无法自我覆盖，升级需自行下载新版替换目录

### macOS

- 产物：`QNote-<版本>-mac-arm64.dmg` / `-mac-x64.dmg`，以及同名的 `.zip`
- mac 自动更新依赖 zip 与 `latest-mac.yml`，两者必须与安装包在同一个 Release 里

---

## 功能详解

### 剪贴板

- **后台捕获**：文本与图片复制即入库，重复内容自动折叠。
- **置顶与重要**：置顶项浮在列表顶部；标记「重要」的条目在清空时会被保留。
- **全文搜索**：输入即过滤，命中的内容仍可就地编辑并保存。
- **代码高亮**：用 Prism 渲染，`JavaScript` / `TypeScript` / `JSON` / `HTML` / `CSS` 可一键格式化。
- **随手转走**：任意条目都能变成笔记、待办，或写入本地记忆索引供 AI 召回。
- **图片识别**：图片条目可送百度 OCR，识别结果写回原条目。
- **小窗速取**：`Ctrl + Shift + C`（可改）弹出独立小窗，显示最近 5 条记录，不打断手头的事。

### 笔记

| 类型 | 扩展名 | 说明 |
| --- | --- | --- |
| 绘图 | `.excalidraw` | 内置 Excalidraw，手绘草图与流程图 |
| 文本 | `.md` / `.markdown` | TipTap 富文本，落盘为标准 Markdown |
| 网页 | `.html` / `.htm` | 单文件，图片抽到 `assets/` |
| 图片 | `.png` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` `.svg` | 截图与素材原样存放 |
| PDF | `.pdf` | 内置阅读器，支持翻页与缩放 |

- **文件夹树**：任意层级，拖拽移动、重命名、批量导入。
- **资源目录**：富文本里的图片写进 `assets/`，笔记正文保持干净可读。
- **外部文件夹**：可把磁盘上已有的目录挂进来一起管理。
- **默认目录**：`%APPDATA%\qnote\notes`，可改到任意路径。
- **AI 可写**：助手能往笔记目录写文件（追加后缀，不覆盖你的版本）。

### 待办

- **三级优先级**：高 / 中 / 低，颜色区分。
- **到期日与备注**：可设截止日期，补充说明文字。
- **图片附件**：截图直接贴进待办。
- **归档**：完成的事项可归档，不占列表。
- **随手新建**：从剪贴板或 OCR 结果一键转待办。

### AI 助手

- **流式输出**：回复逐字返回，随时可中断。
- **Agent 模式**：模型自主循环调用工具，直到任务完成。
- **思维链**：思考过程单独折叠展示，不淹没正文。
- **图片**：粘贴、拖拽或选择文件，单次提问最多 4 张图。
- **多会话**：历史按会话分组，随时回看。
- **自动压缩**：超过阈值的长对话自动摘要，界面会明确提示。
- **技能**：常用提示词沉淀为模板，支持 `{content}` 与 `{clipboard}` 占位符，也可从远程地址导入。
- **长期记忆**：助手能记住你的偏好、事实与工作约定，存于 `<userData>/ai-memory.json`，纯文本可读可改。
- **本地记忆索引**：本地关键词 + 时间权重的召回，剪贴板与笔记可手动入索引。
- **用量统计**：今日、本周与总 Token 消耗，按模型与日期拆分，可在设置页查看。

内置工具一览：

| 工具 | 作用 | 类型 |
| --- | --- | --- |
| `list_notes` | 列出笔记目录 | 读 |
| `read_note` | 读取指定笔记 | 读 |
| `get_clipboard_history` | 读取剪贴板历史 | 读 |
| `get_todos` | 读取待办列表 | 读 |
| `get_app_info` | 读取版本与数据路径 | 读 |
| `recall` | 召回长期记忆 | 读 |
| `web_search` | 网页检索 | 读 |
| `web_fetch` | 抓取网页正文 | 读 |
| `browser_get_snapshot` | 读取当前页面结构 | 读 |
| `save_note` | 写入笔记（追加后缀，不覆盖） | 写 |
| `remember` | 写入长期记忆 | 写 |
| `forget` | 删除长期记忆 | 写 |
| `browser_click` | 点击页面元素 | 写 |
| `browser_fill` | 填写表单 | 写 |
| `browser_navigate` | 页面跳转 | 写 |

> MCP 服务器接入的工具会动态追加到上面这张表。

### 技能与 MCP

- **技能页**：技能的增删改查、分类、占位符提示，支持从 GitHub 或 raw 地址导入。
- **MCP 服务器**：可添加 stdio / HTTP / SSE 三种传输方式，配置命令、参数、环境变量与超时。
- **按项目隔离**：可为不同项目目录配置各自的 MCP 与工作目录。
- **启停控制**：服务器可单独启用或停用，连接失败有明确错误提示。

### 内嵌浏览器

- **多标签页**：新建、关闭、切换、前进后退、刷新与停止加载。
- **书签**：收藏当前页、收藏夹分组管理、用系统默认浏览器打开。
- **AI 侧边栏**：与 AI 对话时可直接读取当前页面结构，助手能代为点击、填表、跳转。
- **网页工具**：`web_search` 检索、`web_fetch` 抓取正文，供 AI 独立取数。

### OCR 与语音输入

- **OCR**：百度 OCR 三种模式 —— 通用（`general_basic`）、高精度（`accurate_basic`）、网络图片（`webimage`）。API Key 与 Secret 在设置页填写，源码里只留空默认值。
- **语音输入**：录音送 MiniMax ASR 转写。默认 `F1` 唤起，快捷键可改，非法组合会被拒绝并说明原因；收起为桌宠时，回复显示在宠物气泡里。

### 灵动岛

- **顶边浮层**：主窗口最小化后，岛吸附在屏幕顶边（或左侧、右侧）显示摘要。
- **收起 / 展开**：收起是一行摘要（AI 运行中 > 剪贴板首条 > 未完成待办 > 最近笔记），展开是 400×480 的面板，含待办 / 剪贴板 / 笔记 / AI 四个页签。
- **摘要可复制**：点击剪贴板摘要直接复制回系统剪贴板。
- **可配置**：停靠边、展开方式（点击 / 悬停）、悬停延时、吸附与浮动模式，都在设置页调整。

### 插件系统

- **导入的是插件本身**：插件根目录下需有一份 `plugin.json` 清单，清单不合规不落库。
- **声明式权限**：清单里的 `capabilities` 说明这个插件要什么（起子进程、读笔记、写待办）。
  **没声明就是最小权限** —— 只能显示预览页面。
- **SDK 扩展能力**：插件通过 SDK 注册命令、读自己的设置项、弹通知、取笔记与待办。
- **启动即确认**：来自市场的插件首次运行会弹确认框，清单内容变更后需重新确认。
- **原生预览**：预览区是 `WebContentsView`，盖在 DOM 之上，跑的就是插件真实页面。
- **日志控制台**：查看 stdout / stderr，实时跟踪运行状态。
- **已发布插件市场**：把插件发布到共享目录，其他设备可从市场导入。

清单格式与 SDK 说明详见 [docs/PLUGIN-SYSTEM.md](docs/PLUGIN-SYSTEM.md)。

### 力扣题单

- **题单管理**：新建、编辑、删除题单，题单可写总结，题单内维护题目列表。
- **题目维护**：按链接添加题目、标记题目状态、删除题目，点题目用系统浏览器打开。
- **批量导入**：粘贴一段文本即可拆成多个题单，导入结果逐条报告成功与失败。

### 快捷方式

- **三种形态**：网址、应用、文件夹，统一在首页磁贴里。
- **拖拽排序**：自研拖拽引擎，键盘也能排（空格拾起、方向键移动、空格放下、Esc 取消）。
- **右键直达**：可选在资源管理器右键菜单注册「添加到 QNote」入口。

### 其他

- **像素桌宠**：会待机、思考、被拖动的像素小狗。
- **便签**：在剪贴板条目上长按约 1 秒即可拖出便签，独立窗口、可拖动缩放，内容落库。
- **系统托盘**：常驻托盘，菜单控制显示、设置与退出。
- **主题**：浅色 / 深色 / 跟随系统。
- **数据迁移**：设置页可导出 / 导入数据库，用于设备间搬家。
- **云端共享目录**：已发布的 APP 目录可选存放于本地或公共目录（TiDB Cloud Data Service）。

---

## 配置

| 配置项 | 用途 | 位置 |
| --- | --- | --- |
| 笔记目录 | 笔记文件存放路径 | 笔记页 → 切换 |
| 百度 OCR Key / Secret | 图片文字识别 | 设置 → 服务与 AI → OCR 识别 |
| AI 协议 / 端点 / Key / 模型 | AI 助手与语音识别 | 设置 → 服务与 AI → AI 助手 |
| 语音热键 | 语音输入全局热键（默认 `F1`） | 设置 → 服务与 AI → 语音输入 |
| 记忆索引 | 本地关键词与时间权重召回 | 设置 → 服务与 AI → 本地记忆索引 |
| 剪贴板面板热键 / 位置 | 小窗唤出快捷键（默认 `Ctrl+Shift+C`）与停靠位置 | 设置 → 界面 → 剪贴板面板 |
| 灵动岛 | 停靠边、展开方式、延时 | 设置 → 界面 → 灵动岛 |
| 侧边栏标签 | 显示哪些功能入口 | 设置 → 界面 → 侧边栏标签 |
| 主题 | 外观配色 | 设置 → 界面 → 外观 |
| 云端存储 | 已发布 APP 目录的存放后端 | 设置 → 数据与开发 → 云端存储 |
| 数据迁移 | 导出 / 导入数据库 | 设置 → 数据与开发 → 数据迁移 |
| 应用更新 | 检查、下载、安装新版本 | 设置 → 数据与开发 → 应用更新 |

---

## 数据与隐私

| 内容 | 位置 |
| --- | --- |
| 数据库 | `%APPDATA%\qnote\db\clipboard.sqlite` |
| 默认笔记目录 | `%APPDATA%\qnote\notes` |
| 日志 | `%APPDATA%\qnote\app.log` / `app-error.log` |
| AI 长期记忆 | `%APPDATA%\qnote\ai-memory.json` |

**私有数据永远留在本地**：笔记、剪贴板、待办、AI 对话、快捷方式、书签、题单、记忆索引与设置都只写入本地 SQLite。

外部服务只在用户主动触发时才会联系：

| 功能 | 目的地 | 触发时机 |
| --- | --- | --- |
| AI 助手 | 用户在设置页填写的端点（OpenAI / Anthropic 兼容协议，含 Ollama、LM Studio 等本地端点） | 用户发送消息 |
| 语音输入 | MiniMax ASR | 用户录音并转写 |
| OCR | 百度 OCR | 用户点击「识别」 |
| 内嵌浏览器 | 用户访问的网站 | 用户导航到页面 |
| 检查更新 | GitHub Releases | 用户点击「检查更新」 |

> API Key 走运行时配置，只存用户本机；数据库凭据不出服务端。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面框架 | Electron 45 |
| 界面 | React 18 · Vite 6 · Tailwind CSS 3 · shadcn/ui（new-york）· lucide-react |
| 编辑器 | TipTap 3（富文本 / Markdown）· Excalidraw 0.18 · Prism · Prettier |
| 数据 | Knex 3 · SQLite（sqlite3） |
| AI | opencode 1.19（自托管执行层）· MCP 工具通道 · 长期记忆层 · 插件 SDK |
| 语言 | TypeScript 5.6 |
| 构建 | electron-builder 26（NSIS 安装版 + 便携 ZIP + macOS dmg/zip） |
| 测试 | Vitest 3 · Testing Library |

---

## 项目结构

```text
qnote-elec/
├── src/
│   ├── main/                  # 主进程
│   │   ├── core/              # 常驻能力：托盘、快捷键、剪贴板监听、窗口、自动更新
│   │   │   └── ai/            # AI 域：agents / memory / observability / prompts / skills / tools / mcp
│   │   ├── handlers/          # IPC handler，按功能分子目录
│   │   ├── utils/             # 纯工具（扁平，不分子目录）
│   │   └── preload.ts         # contextBridge，渲染层接触系统能力的唯一入口
│   ├── renderer/              # React 界面
│   │   ├── pages/             # 路由级页面：ai / apps / browser / home / island / leetcode / notes / settings / skills / sticky / todo
│   │   ├── components/        # 跨页面复用的公共件（ui / panel / shell / shortcuts）
│   │   ├── hooks/             # 按功能分：ai / apps / browser / panel / sticky / system / ui …
│   │   └── utils/             # 跨页面复用的工具
│   ├── shared/                # 主进程与渲染层共用的类型
│   └── database/              # Knex 连接与迁移
├── build/                     # 打包与编译配置（electron-builder / tsconfig / macOS 权限声明）
├── scripts/                   # build / release / quality / git-hooks / dev / pixel-pet
├── docs/                      # 补充文档
├── DESIGN.md                  # 设计规范：配色、密度、组件约定
└── AGENTS.md                  # 开发规范：提交信息、版本号、红线
```

---

## 开发

### 环境要求

- **Node.js >= 18**
- **pnpm 10.32.0**（请勿改用 npm 或 yarn）

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

# 完整构建：clean → 编译 → 打包 → 便携版后处理
pnpm run build

# 只产出便携版
pnpm run build-portable

# 单元测试（vitest run，跑完自行退出）
pnpm test

# ESLint
pnpm run lint
```

### 提交规范

Angular 提交规范：`<type>(<scope>): <subject>`。先装好 Git Hook，再本地校验：

```bash
pnpm run setup:hooks
pnpm run verify:commit "feat(updater): 增加应用更新卡片"
```

完整约定见 [AGENTS.md](AGENTS.md)。

### 质量门禁

```bash
pnpm run sonar:issues     # 拉取 SonarCloud 问题清单（不阻断）
pnpm run verify:sonar     # 同上，命中拦截级别则退出码 1
pnpm run sonar:local      # 本地现扫，无需 Java 与令牌
```

---

## 版本与发布

版本号的唯一来源是根目录 `package.json` 的 `version` 字段。

```bash
pnpm run release:patch     # 1.15.0 → 1.15.1
pnpm run release:minor     # 1.15.0 → 1.16.0
pnpm run release:major     # 1.15.0 → 2.0.0

pnpm run verify:version    # 校验版本号格式与发布线
```

- Tag 名即版本号本身，不加 `v` 前缀，且带注释（`Release 1.15.0`）
- Release 标题为 `QNote 1.15.0`
- 一个版本号只发一次；内容改动需重发时 bump 到下一个 patch 号
- 换发布线（如 1.14.x → 1.15.x）必须与版本 bump 合成同一个提交，且同步改 `scripts/release/verify-version.js` 的 `RELEASE_LINE`

---

## 代码签名

| 产物 | 是否签名 | 说明 |
| --- | --- | --- |
| `QNote-Setup-<version>.exe` | 配置 SignPath 后签名 | 用户下载的安装包 |
| 安装后的 `QNote.exe` | 否 | 随安装包一并处理 |
| `QNote-<version>-portable.zip` | 否 | 次要渠道，用 `SHA256SUMS.txt` 校验 |
| `latest.yml` / `latest-mac.yml` | 不适用 | 自动更新元数据，完整性靠安装包哈希保证 |

签名流程：GitHub Actions 构建产物 → 上传为 workflow artifact → SignPath 校验来源 → 项目 approver 在控制台人工批准 → 应用 Authenticode 签名 → CI 重算 `latest.yml` 中的哈希并发布。未配置 `SIGNPATH_API_TOKEN` 时自动跳过签名，不阻断发版。

用户侧校验：

```powershell
Get-FileHash .\QNote-Setup-<version>.exe -Algorithm SHA256
Get-AuthenticodeSignature .\QNote-Setup-<version>.exe |
  Select-Object Status, StatusMessage, SignerCertificate
```

```bash
sha256sum -c SHA256SUMS.txt
```

### 安装时的系统改动

- 默认安装到当前用户的 `%LOCALAPPDATA%\Programs\QNote`，安装向导第一页可改为「所有用户」（装进 `Program Files`），第二页可自选目录。
- 创建桌面与开始菜单快捷方式。
- 注册三个全局热键（QNote 运行时占用，退出即释放）：`Ctrl/⌘ + Enter` 唤出主窗口、`Ctrl + Shift + C` 唤出剪贴板面板、`F1` 启动语音输入。后两个可在设置页修改。
- 可选：在资源管理器右键菜单注册「添加到 QNote」（默认关闭，写入 `HKCU\Software\Classes\*\shell`）。

### 卸载

- Windows 10 / 11：设置 → 应用 → 已安装的应用 → QNote → 卸载，卸载程序会移除程序目录与它创建的快捷方式。
- 便携版没有安装器：直接删掉解压目录。
- 用户数据（笔记、剪贴板、待办、AI 记忆）留在 `%APPDATA%\qnote` 不会被自动删除；彻底清除请手动删除该目录，迁移前可在应用内导出。

---

## 相关文档

| 文档 | 内容 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 开发规范：提交信息、版本号、红线清单 |
| [DESIGN.md](DESIGN.md) | 设计规范：配色系统、视觉密度、组件与交互约定 |
| [docs/BUILD.md](docs/BUILD.md) | 本地打包、产物位置与常见构建问题 |
| [docs/MACOS-BUILD.md](docs/MACOS-BUILD.md) | macOS 双架构打包与自动更新注意事项 |
| [docs/PORTABLE.md](docs/PORTABLE.md) | 便携版的构成、目录结构与迁移方式 |
| [docs/PLUGIN-SYSTEM.md](docs/PLUGIN-SYSTEM.md) | 插件清单 `plugin.json` 的字段与校验规则、SDK 通道、声明式权限 |
| [docs/CLOUD-STORAGE.md](docs/CLOUD-STORAGE.md) | 共享数据与私有数据的边界、两种云端后端、TiDB Cloud 接入步骤 |
| [docs/SONAR.md](docs/SONAR.md) | SonarQube Cloud 扫描与门禁配置 |
| [更新日志](https://github.com/Ruciazyt/qnote-elec/releases) | 每个版本的完整变更 |

---

## 反馈与贡献

- 发现缺陷或想提新功能 → 提 [issue](https://github.com/Ruciazyt/qnote-elec/issues)
- 准备动手写代码 → 先读 [AGENTS.md](AGENTS.md)（提交规范与红线）与 [DESIGN.md](DESIGN.md)（界面规范）
- 提 issue 时附上版本号、系统版本与复现步骤；带上日志（`%APPDATA%\qnote\app.log`）会更快定位

---

## 许可证

[MIT](LICENSE) © Rucia zyt
