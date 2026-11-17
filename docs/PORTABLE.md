# QNote 便携版

## 📦 什么是便携版？


## ✨ 便携版特点

- **无需安装**: 双击即可运行
- **绿色软件**: 不会在系统中留下注册表项，删掉文件夹即卸载干净
- **便于携带**: 可以放在U盘中随身携带
- **程序与数据分离**: 压缩包里只有程序文件，运行数据统一放在用户数据目录

## ⚠️ 便携版不支持自动更新




## 📍 数据存在哪里


| 内容 | 路径 |
| --- | --- |
| 数据库（剪贴板历史、待办、AI 会话等） | `%APPDATA%\qnote\db\clipboard.sqlite` |
| 默认笔记目录 | `%APPDATA%\qnote\notes` |
| 日志 | `%APPDATA%\qnote\app.log`、`app-error.log` |
| AI 长期记忆 | `%APPDATA%\qnote\ai-memory.json` |


## 🚀 获取便携版

### 方法一：从GitHub Releases下载（推荐）

1. 访问 [GitHub Releases页面](https://github.com/Ruciazyt/qnote-elec/releases)
2. 选择最新版本
3. 下载 `QNote-x.x.x-portable.zip` 文件
4. 解压到任意文件夹
5. 双击 `QNote.exe` 即可运行

### 方法二：本地构建

```bash
# 先安装工作区依赖
pnpm install

# 完整构建：打包 + 生成便携版 ZIP
pnpm run build
```



## 📁 便携版目录结构


```text
QNote-portable/
├── QNote.exe        # 主程序
├── resources/       # 应用资源
│   ├── app.asar     # 打包后的应用代码
│   └── portable.marker  # 便携版标记，用于关闭自动更新
├── locales/         # Electron 语言包
└── *.dll            # Electron 运行时依赖
```


## 🔧 GitHub自动构建


- **安装版**: `QNote-Setup-x.x.x.exe` - 传统安装程序
- **便携版**: `QNote-x.x.x-portable.zip` - 免安装压缩包

### 发布流程


```bash
# 发布补丁版本（如 1.0.0 -> 1.0.1）
pnpm run release:patch

# 发布次要版本（如 1.0.0 -> 1.1.0）
pnpm run release:minor

# 发布主要版本（如 1.0.0 -> 2.0.0）
pnpm run release:major
```



1. 构建安装版和便携版
2. 上传构建文件与 `latest.yml`（自动更新的元数据）
3. 创建 GitHub Release

## 🔄 升级方式


1. 打开 [GitHub Releases 页面](https://github.com/Ruciazyt/qnote-elec/releases) 下载最新的 `QNote-x.x.x-portable.zip`
2. 关闭正在运行的 QNote
3. 用新压缩包解压覆盖原目录


## ⚠️ 注意事项

1. **解压位置**: 建议解压到有读写权限的目录（如桌面、文档文件夹）
2. **首次运行**: 便携版首次运行时可能需要较长时间来初始化
3. **防火墙**: 某些防火墙可能会阻止便携版程序，请添加信任
4. **数据备份**: 建议定期备份 `%APPDATA%\qnote` 目录，也可以在「设置 → 数据与开发 → 数据迁移」里直接导出数据库
5. **完整解压**: 确保解压时保持目录结构完整
6. **单实例**: 便携版与安装版共用同一个单实例锁，同一时刻只能运行其中一个

## 🆚 便携版 vs 安装版

| 特性     | 便携版            | 安装版                 |
| -------- | ----------------- | ---------------------- |
| 安装过程 | 解压即用          | 需要安装               |
| 系统集成 | 无                | 开始菜单、桌面快捷方式 |
| 自动更新 | 不支持，手动替换   | 支持                   |
| 程序位置 | 自选目录          | 系统程序目录           |
| 数据位置 | `%APPDATA%\qnote` | `%APPDATA%\qnote`      |
| 卸载     | 删除文件夹        | 控制面板卸载           |
| 文件格式 | ZIP压缩包         | EXE安装程序            |
| 适用场景 | 临时使用、U盘携带 | 长期使用、系统集成     |

## 🐛 问题反馈


## 💾 数据迁移

### 便携版 ↔ 安装版


### 在不同设备间迁移

1. 在旧设备上备份 `%APPDATA%\qnote` 目录（或用「设置 → 数据与开发 → 数据迁移」导出数据库）
2. 把备份复制到新设备的同一个位置
3. 在新设备上启动 QNote


## 🔧 故障排除

- **无法运行**: 检查是否被杀毒软件拦截
- **权限错误**: 右键选择"以管理员身份运行"
- **缺少依赖**: 安装 Visual C++ Redistributable
- **解压失败**: 使用支持长路径的解压工具
- **启动提示已有实例在运行**: 便携版与安装版共用单实例锁，把另一个关掉再启动
