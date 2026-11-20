# QNote 插件系统 —— 现行架构与全链路

> 本文描述**已落地的实现**，不是提案。设计理由与规范来源见 [PLUGIN-SYSTEM.md](./PLUGIN-SYSTEM.md)。
> 全文按一条主线展开：**创建插件 → 导入注册 → 启动运行 → 上传发布 → 下载安装**。

---

## 〇、一句话架构

**插件 = 一个文件夹 + 一份 `plugin.json`。**

QNote 只做三件事：读清单、跑进程、管权限。插件想扩展能力，必须以**独立进程**启动，通过 **loopback HTTP + 长轮询** 的 SDK 通道跟宿主对话；界面通过 `WebContentsView` 挂在现有预览面板上，不开新页签。

```
┌─────────────────────────────────────────────────────────────┐
│ 渲染层  src/renderer/pages/plugin/                           │
│   插件列表 / 清单编辑器 / 启动确认 / 日志控制台 / 插件市场     │
└──────────────┬──────────────────────────────────────────────┘
               │ preload 暴露的 plugin* API（18 个 invoke 通道）
┌──────────────▼──────────────────────────────────────────────┐
│ 主进程  src/main/core/plugin/                                │
│   PluginManager ── 进程启停 / 日志 / 权限校验 / 清单哈希      │
│   capabilities  ── 声明式权限判定                            │
│   sdk/rpcServer ── loopback HTTP + 长轮询                    │
│   sdk/hostApi  ── 宿主 API 面（notes/todos/settings/...）    │
│   core/window/plugin/pluginPreview ── qnote-app:// 预览协议   │
└──────┬────────────────────────────┬─────────────────────────┘
       │ SQLite                     │ spawn(shell:true)
┌──────▼──────────────┐   ┌─────────▼────────────────────────┐
│ plugin / plugin_    │   │ 插件进程（插件作者的程序）           │
│ setting / plugin_  │   │   env: QNOTE_PLUGIN_RPC / TOKEN    │
│ grant 三表          │   │        QNOTE_PLUGIN_ID / VERSION   │
└─────────────────────┘   │   resources/plugin-sdk/ 客户端     │
                          └────────────────────────────────────┘
```

---

## 一、分层与目录

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 共享层 | `src/shared/plugin/` | 类型定义、清单校验器、风险分析、preview 解析、SDK 协议类型 |
| 主进程 | `src/main/core/plugin/` | 插件管理器、能力校验、SDK 通道与宿主 API、迁移脚本、资源包打包 |
| 主进程 | `src/main/core/window/plugin/` | 预览协议 `qnote-app://`、`WebContentsView` 挂载 |
| 主进程 | `src/main/handlers/plugin/` | IPC 注册面（业务通道）、事件广播 |
| 数据层 | `src/database/` | `plugin` / `plugin_setting` / `plugin_grant` 三表 |
| 渲染层 | `src/renderer/pages/plugin/` | 插件页、清单编辑器、确认框、日志台、市场 |
| 插件侧 | `resources/plugin-sdk/qnote-plugin-sdk.js` | 插件作者 import 的纯 ESM SDK（无构建步骤） |
| 原生模块 | `src/shared/plugin/plugin-rs/` | Rust 移植的风险分析，宿主优先走原生、加载不到回退 TS |

关键文件：

| 文件 | 作用 |
| --- | --- |
| `src/shared/plugin/pluginTypes.ts` | 所有跨端类型（Manifest / Record / Capabilities / Contributes / RuntimeState） |
| `src/shared/plugin/pluginManifest.ts` | 清单解析与逐字段校验 + 自实现 semver 范围匹配 |
| `src/shared/plugin/pluginPreview.ts` | preview 三种形态的解析与 URL 生成 |
| `src/shared/plugin/pluginRisk.ts` | 命令风险分析（13 条规则，**不是安全边界**） |
| `src/main/core/plugin/pluginManager.ts` | 插件管理器：导入 / 启停 / 日志 / 权限 / 命令注册表 |
| `src/main/core/plugin/capabilities.ts` | `checkCapability` 权限判定 |
| `src/main/core/plugin/legacyMigration.ts` | 1.x 老应用 → 插件的幂等迁移 |
| `src/main/core/plugin/bundle.ts` | 资源包打包 / 解开（base64 + deflateRaw） |
| `src/main/core/plugin/sdk/rpcServer.ts` | SDK 传输层 |
| `src/main/core/plugin/sdk/hostApi.ts` | 宿主 API 面 |
| `src/main/handlers/plugin/pluginHandlers.ts` | 18 个 IPC 通道 + 事件广播 + 迁移钩子 |

---

## 二、核心概念

### 2.1 插件身份：两个 id 各司其职

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `id` | 字符串 `publisher.name` | **业务标识**：市场主键、命令前缀、SDK 会话键 |
| `local_id` | 本地自增整数 | **本地号**：预览协议 host 段只认数字 |

预览地址长这样：`qnote-app://p12/index.html` —— `p12` 里的 `12` 是 `local_id`。**内部一律用 `local_id` 做目录定位，别把字符串 id 塞进 URL。**

### 2.2 来源与状态

`origin`：`local`（本机导入）/ `market`（市场获取）—— 决定启动前要不要弹确认框。

`status`（由清单实时算出，不是存出来的）：

| status | 含义 | 能启动吗 |
| --- | --- | --- |
| `ready` | 清单合法且 `engines.qnote` 满足当前版本 | 能 |
| `incompatible` | 清单合法，但要求更高版本 QNote | 不能（装得上、跑不了） |
| `missing-manifest` | 目录里没有 `plugin.json` | 不能 |
| `invalid-manifest` | `plugin.json` 存在但解析不过 | 不能 |

### 2.3 清单写在插件里，不写数据库

数据库只存**索引**：路径、状态快照、来源、启用开关、清单哈希。清单真源永远在 `plugin.json` 里，改完点「刷新」即可生效。

---

## 三、清单规范（plugin.json）

### 3.1 位置与文件名

插件根目录下**必须**有一份 `plugin.json`。名字不是 `qnote.json`（1.x 的老清单已废弃）。

### 3.2 完整示例

```jsonc
{
  "id": "ichain.dev-console",          // 必填，publisher.name，只允许小写字母/数字/. / -
  "name": "iChain 开发编排台",           // 必填
  "version": "0.3.0",                 // 必填，MAJOR.MINOR.PATCH
  "publisher": "lenovo",              // 必填
  "description": "一键拉起四个仓库的 dev 服务",
  "license": "MIT",
  "icon": "icon.png",
  "engines": { "qnote": "^2.0.0" },   // 必填，宿主版本约束
  "activationEvents": ["onStartup"],  // 可选（声明了但尚未实现挂载）
  "runtime": {                        // 必填，command 与 preview 至少填一个
    "command": "node server.mjs",
    "args": [],
    "cwd": ".",
    "env": { "QNOTE_MANAGED": "1" },
    "preview": { "type": "port", "port": 7788 }
  },
  "capabilities": {                   // 可选，缺省 = 最小权限
    "process": { "spawn": true },
    "network": ["127.0.0.1:*"],
    "filesystem": { "read": ["./data"] },
    "qnote": { "notes": "read", "todos": "read" }
  },
  "contributes": {                    // 可选
    "commands": [{ "command": "ichain.up", "title": "拉起全部服务" }],
    "settings": [{ "key": "autoStart", "type": "boolean", "default": false }],
    "sidebar": [{ "id": "ichain.panel", "title": "编排台" }]
  },
  "extensionDependencies": []
}
```

### 3.3 校验规则（`src/shared/plugin/pluginManifest.ts`）

| 字段 | 规则 | 报错文案 |
| --- | --- | --- |
| `id` | `publisher.name` 形态：只允许小写字母、数字、`.`、`-`；必须含一个 `.`；不含 `..`；≤128 字符 | `id 必须是 publisher.name 格式（只允许小写字母、数字、. 和 -，且必须含一个 .）` |
| `name` / `version` / `publisher` / `engines` / `runtime` | 必填，缺一即拒 | `<字段> 是必填项` |
| `version` | 必须能被 semver 解析（`1.0` 不行，`1.0.0` 行） | `version 必须是 MAJOR.MINOR.PATCH 格式的语义化版本` |
| `engines.qnote` | 支持 `^` `~` `>=` `<=` `>` `<` `=` 与 `||` 多选；`*` 通配 | 不在当前发布线上时状态为 `incompatible` |
| `runtime.command` | 非空字符串，≤2000 字符 | `runtime.command 不能为空` / `runtime.command 太长了` |
| `runtime.args` | 字符串数组 | `runtime.args 必须是字符串数组` |
| `runtime.env` | 值的类型是 string / number / boolean（自动转字符串）；嵌套对象不行 | `runtime.env.NESTED 必须是字符串` |
| `runtime.preview` | 必须是对象形式，三选一：`{type:"port",port}` / `{type:"url",url}` / `{type:"path",path}` | `runtime.preview 必须是 {...} 三选一` |
| `runtime` | `command` 与 `preview` **至少填一个** | `runtime.command 和 runtime.preview 至少要填一个` |
| `capabilities` | 顶层键只能是 `process` / `network` / `filesystem` / `qnote` | `capabilities.X 不是已知的能力名` |
| `capabilities.qnote.*` | 只能是 `none` / `read` / `write` | `capabilities.qnote.notes 只能是 none / read / write` |
| `contributes.commands[]` | 必须有 `command` 和 `title` | `contributes.commands 里的 X 缺少 title` |
| `contributes.settings[]` | 必须有 `key`；`type` 只能 string/number/boolean | — |
| 未知字段 | **直接丢弃**，不让老清单失效 | — |

### 3.4 版本范围语义（自实现，项目没装 `semver`）

| 范围 | 含义 | 例子 |
| --- | --- | --- |
| `^2.0.0` | 主版本内浮动 | `2.1.0` ✅ / `3.0.0` ❌ |
| `^0.2.0` | 次版本内浮动 | `0.2.9` ✅ / `0.3.0` ❌ |
| `^0.0.3` | 补丁级锁定 | `0.0.3` ✅ / `0.0.4` ❌ |
| `~1.2.0` | 次版本内浮动 | `1.2.9` ✅ / `1.3.0` ❌ |
| `~1` | 主版本内浮动 | `1.9.0` ✅ / `2.0.0` ❌ |
| `^1.0.0 || ^2.0.0` | 多选 | 任一命中即可 |

---

## 四、链路一：创建插件（作者侧）

### 4.1 最小可用插件

目录长这样：

```
my-plugin/
├─ plugin.json        ← 必须
├─ server.mjs         ← 你要跑的程序
└─ package.json       ← 可选
```

`plugin.json`：

```json
{
  "id": "demo.my-plugin",
  "name": "演示插件",
  "version": "1.0.0",
  "publisher": "demo",
  "engines": { "qnote": "^2.0.0" },
  "runtime": {
    "command": "node server.mjs",
    "preview": { "type": "port", "port": 3000 }
  },
  "capabilities": { "process": { "spawn": true } }
}
```

**验收**：`node server.mjs` 起来后在 3000 端口提供服务，QNote 能预览。

### 4.2 接上 SDK（可选，但推荐）

插件侧 SDK 是**纯 ESM，零构建**：

```js
// server.mjs
import { createPlugin } from "qnote-plugin-sdk";   // 实际路径见 §9.3

const plugin = createPlugin({
  async activate(ctx) {
    ctx.commands.register("demo.hello", async () => {
      await ctx.notifications.info("hello from plugin");
      const todos = await ctx.todos.list({ limit: 5 });
      return todos.count;
    });
  },
  async deactivate() {},
});
```

宿主启动插件时会自动向进程注入四个环境变量：

| 变量 | 内容 |
| --- | --- |
| `QNOTE_PLUGIN_RPC` | `http://127.0.0.1:<随机端口>` |
| `QNOTE_PLUGIN_TOKEN` | 会话令牌（24 字节随机 hex） |
| `QNOTE_PLUGIN_ID` | 插件 `id` |
| `QNOTE_PLUGIN_VERSION` | 插件 `version` |

没注入这些变量就说明**这个进程不是 QNote 起的**，SDK 会直接抛错。

### 4.3 自己先验一遍

在装进 QNote 之前，先确认：

1. `node server.mjs` 能独立跑起来
2. 端口固定或可预测（preview 要指到它）
3. `plugin.json` 是合法 JSON，id 形如 `publisher.name`
4. 声明了 `capabilities.process.spawn`（**否则宿主拒绝启动**）

---

## 五、链路二：导入注册（装进 QNote）

入口：插件页 →「导入插件」→ 选文件夹。

### 5.1 判定顺序（`PluginManager.importPlugin`）

```
plugin:import(dirPath)
  │
  ├─ 目录为空 / 不存在 / 不是文件夹 ─────────────→ not-a-directory
  ├─ DB 里这个 path 已登记 ──────────────────────→ already-imported
  │
  ├─ readPluginRecord(dir, hostVersion)
  │    ├─ 没有 plugin.json ───────────────────────→ missing-manifest
  │    ├─ plugin.json 解析不过 ───────────────────→ invalid-manifest
  │    └─ 解析过了
  │         ├─ satisfiesRange(hostVersion, engines.qnote) 为假
  │         │      → status = incompatible  ✅ 照样落库（装得上、跑不了）
  │         └─ 为真 → status = ready
  │
  ├─ id 与已有插件撞了 ──────────────────────────→ duplicate-id
  │
  └─ INSERT plugin 表 → 广播 plugin:plugins-changed ✅
```

**关键点**：不合规的清单**不落库**（一个字节都不写）。版本不兼容的**照落库**，只是状态标成 `incompatible`，启动时被拒。

### 5.2 落库结构

`plugin` 表只存索引与快照：

| 列 | 说明 |
| --- | --- |
| `local_id` | 主键，自增整数 |
| `id` | 业务标识，唯一 |
| `name` / `version` / `publisher` / `description` | 展示字段 |
| `path` | 插件目录绝对路径，唯一 |
| `status` | 快照状态 |
| `manifest_text` / `command` / `preview` / `error` | 快照 |
| `runtime_json` / `capabilities_json` / `contributes_json` | 结构化快照 |
| `origin` | `local` / `market` |
| `enabled` | 启用开关 |
| `confirmed_manifest_hash` | **市场来源的启动确认指纹** |
| `sort_order` / `created_at` / `updated_at` | — |

### 5.3 老应用迁移（1.x → 2.0）

`legacyMigration.ts` 在插件管理器初始化时跑一次，**幂等**：

1. 读 `app_project` 表全部记录
2. 每条记录读原目录下的 `qnote.json`
3. 翻译成 `plugin.json`（老字段整体搬进 `runtime`）
4. 写回插件目录（已存在就不覆盖）
5. 插一条 `plugin` 记录（`origin = local`）
6. **原 `qnote.json` 保留不删**
7. **`app_project` 表不删** —— 留回滚口子

已迁过的路径会跳过，重复启动不会重复迁。

---

## 六、链路三：启动运行

### 6.1 启动判定顺序（`PluginManager.startPlugin`）

```
plugin:start(pluginId)
  │
  ├─ 已经在跑 ────────────────────────────────────→ "这个插件已经在运行了"
  ├─ 插件不存在 ──────────────────────────────────→ "插件不存在"
  ├─ enabled = false ─────────────────────────────→ "这个插件已被禁用"
  ├─ status = incompatible ───────────────────────→ "这个插件与当前 QNote 版本不兼容：…"
  ├─ status ≠ ready ──────────────────────────────→ 清单错误信息
  ├─ 清单里没有 command ───────────────────────────→ "清单里没有 command，无法启动"
  │
  ├─ checkCapability(capabilities, { kind:"spawn" })
  │    └─ 没声明 process.spawn ───────────────────→ 拒绝（最小权限）
  │
  ├─ cwd 解析后必须在插件目录内 ───────────────────→ "cwd 指向了插件目录之外"
  ├─ 工作目录不存在 ───────────────────────────────→ "工作目录不存在"
  │
  ├─ origin = market？
  │    └─ 是 → checkStartConfirmation()，要确认就返回
  │            needsConfirmation，**不启进程**
  │
  └─ spawn(commandLine, { shell: true, env: 注入四个变量 })
       ├─ 事件：plugin:runtime-changed
       ├─ stdout/stderr → 逐行切分 → plugin:log
       ├─ 关闭 → 状态 exited + 退出码
       └─ 5 秒内调 plugin.activate → 注册运行时命令
```

### 6.2 市场来源的启动确认

只在 `origin = market` 时触发，且**按清单指纹**判定：

| 情形 | 行为 |
| --- | --- |
| 从没确认过 | 弹确认框，展示命令、风险分析、声明的权限 |
| 确认过，指纹一致 | 直接启动 |
| 确认过，但 `plugin.json` 改过了 | **再弹一次**（指纹 = 清单内容哈希） |

指纹存 `plugin.confirmed_manifest_hash`。确认框里同时给出 `analyzeCommand` 的风险分析结果 —— 但那只是**提示**，真正的防线是声明式权限。

### 6.3 预览：三种形态

| `runtime.preview` | 预览地址 | 说明 |
| --- | --- | --- |
| `{type:"port",port}` | `http://127.0.0.1:<port>` | 插件自己起 HTTP 服务 |
| `{type:"url",url}` | 原样 | 指向任意地址 |
| `{type:"path",path}` | `qnote-app://p<local_id>/<相对路径>` | 插件目录里的静态页面 |

`qnote-app://` 是**私有协议，不能改**：

- 注册为特权 scheme：`standard / secure / supportFetchAPI / corsEnabled / stream`
- host 段形状 `p<数字>` 不变 —— 只认 `local_id`
- 请求进来后按 `local_id` 反查插件目录，**逐段校验不许越界**
- 预览容器是 `WebContentsView`，盖在 DOM 之上；渲染层用 `useNativeViewCover` 报告可见性与边界

渲染层与主进程的配合：

```
plugin:preview-load(localId)   → 主进程算出 URL → 创建/复用 WebContentsView
plugin:preview-visible(bool)   → 显示/隐藏
plugin:preview-bounds(rect)    → 设置边界
plugin:preview-loaded / plugin:preview-error → 回传渲染层
```

### 6.4 SDK 通道：loopback HTTP + 长轮询

**为什么不用 WebSocket**：插件的 stdout/stderr 要原样给用户看日志，stdin 是单向的撑不起「插件 → 宿主」的调用；WebSocket 要自己实现 RFC 6455 或者多引一个 `ws` 依赖。

**为什么不用 stdio JSON-RPC**：同上，stdio 已经被日志占用了。

协议：

| 方向 | 通道 | 说明 |
| --- | --- | --- |
| 插件 → 宿主 | `POST /rpc` | JSON-RPC 2.0，`x-qnote-token` 头带令牌 |
| 宿主 → 插件 | `GET /poll?token=…` | **长轮询，挂 25 秒**；有请求立刻返回，没请求 25 秒后返回 204，插件立刻重连 |
| 宿主等插件回话 | 内存中的 pending 表 | 按请求 `id` 配对 |

消息时序：

```
宿主                                   插件
 │  spawn + 注入 RPC/TOKEN/ID/VERSION     │
 │──────────────────────────────────────→│
 │  GET /poll ──────────────────────────→│  挂住 25 秒
 │                                       │
 │  POST /rpc  plugin.activate ─────────→│
 │◀──────────────────────────────────────│  { jsonrpc, id, method:"plugin.activate" }
 │  宿主等 5 秒                          │
 │  POST /rpc  { id, result:{commands} } │  ← 插件回传同一个 id
 │◀──────────────────────────────────────│
 │                                       │
 │  POST /rpc  qnote.notify ────────────→│  插件主动调宿主
 │  POST /rpc  { id, result } ──────────→│
 │◀──────────────────────────────────────│
```

宿主 → 插件只有三个方法：`plugin.activate`、`plugin.deactivate`、`qnote.command.invoke`。

### 6.5 宿主 API 面

插件能调的接口（全部逐个过 `checkCapability`）：

| 方法 | 需要的能力 | 返回 |
| --- | --- | --- |
| `qnote.plugin.info` | 无 | `{id, name, version, publisher}` |
| `qnote.notify` | 无 | `{ok}`，弹宿主通知 |
| `qnote.log` | 无 | `{ok}`，写日志台 |
| `qnote.settings.get` | 无（但 key 必须在 `contributes.settings` 里声明过） | `{value}`，没存过返回声明的 default |
| `qnote.settings.set` | 同上 + 类型校验 | `{ok}` |
| `qnote.commands.list` | 无 | `{items: PluginCommandEntry[]}` |
| `qnote.commands.execute` | 无 | 命令执行结果 |
| `qnote.todos.list` | `qnote.todos: "read"` | `{count, items}`，上限 100 |
| `qnote.notes.list` | `qnote.notes: "read"` | `{count, items, root}`，上限 500 |

**数据访问一律走主进程**，插件不许直接碰 SQLite。设置项还要求：key 必须是清单里声明过的，否则拒绝。

---

## 七、链路四：上传发布

入口：插件页选中插件 →「发布」→ 弹框填简介/作者/标签/仓库地址。

### 7.1 打包（`plugin:build-bundle`）

`packProjectBundle(plugin.path)`：

1. 遍历插件目录，收集文件
2. **跳过目录**：`node_modules`、`.git`、`.svn`、`.hg`、`dist`、`build`、`out`、`.next`、`.nuxt`、`.cache`、`.turbo`、`.parcel-cache`、`coverage`、`__pycache__`、`.venv`、`venv`、`.idea`、`.vscode`
3. **跳过文件**：`.DS_Store`、`Thumbs.db`、`.npmrc`、`id_rsa`、`id_ed25519`、**`plugin.json`**（清单单独走 manifest 字段）
4. **跳过密钥**：`.env*`、`.pem`、`.pfx`、`.p12`、`.key`
5. **超过 8MB 直接放弃**（`tooLarge = true`），本次只发布清单
6. 打包格式：`{ 相对路径: base64 }` → JSON → `deflateRawSync` → base64

> 依赖目录、缓存与密钥文件**不上传**。

### 7.2 发布（`cloud:publish-app`）

```
PublishDialog
  └─ cloudPublishApp({ name, description, author, manifest, repoUrl, tags, bundle })
       └─ cloudManager.publish()
            ├─ backend = local   → 写本地 SQLite 的 published_app 表
            └─ backend = catalog → CatalogClient
                 POST {baseUrl}/api/v1beta/app/{appId}/endpoint/apps_publish
                 Basic auth：publicKey:privateKey
                 body: { id, name, description, author, manifest, bundle,
                         repo_url, tags, pulls, created_at, updated_at }
```

公共目录（TiDB Cloud Data Service）的端点定义在 `data-app/http_endpoints/`，**SQL 写死在服务端**，客户端只能调已定义的端点：

| 端点 | 方法 | 用途 |
| --- | --- | --- |
| `/apps_list` | GET | 列目录（支持关键词 + 分页） |
| `/apps_count` | GET | 统计总数 |
| `/apps_get` | GET | 按 id 取一条（**含 bundle**） |
| `/apps_publish` | POST | 发布 |
| `/apps_update` | POST | 覆盖发布 |
| `/apps_remove` | POST | 删除 |
| `/apps_mark_pulled` | POST | 获取次数 +1 |

### 7.3 三个必须知道的坑

| 坑 | 现象 | 处理 |
| --- | --- | --- |
| **网关拦 IP 字面量** | 公共目录前面是 AWS ALB，它扫整个请求（URL、query、body），出现 `http://127.0.0.1:7799/`、`http://10.0.0.1` 这类**指向 IP 字面量的链接**就返回 **403 Forbidden**（HTML，不是 JSON） | preview 只写端口号（`{type:"port",port}`），别写 IP；纯主机名与不带 scheme 的 `127.0.0.1:7799` 不受影响 |
| **bundle 列要先建** | 端点 SQL 里 `bundle` 进了 INSERT 列清单，列还不存在时**整个发布被拦断**，客户端的退回逻辑救不回来 | 在 Data Service 的 SQL 编辑器跑 `ALTER TABLE qnote_catalog.published_app ADD COLUMN bundle MEDIUMTEXT NULL;`，**列必须可空**（TiDB 不给 TEXT 设默认值），然后去控制台点 Deploy |
| **端点改动不自动生效** | 线上公共目录没接 GitHub，推仓库不会触发部署 | 改完 SQL 要在控制台手工点 **Deploy**；客户端里的路径常量要与 `data-app/http_endpoints/config.json` 对齐 |

### 7.4 发布成功但 bundle 没带上的情况

端点不认的未知参数会被**静默忽略**，不会报错。所以客户端读回来发现没有 bundle，就标 `bundleDropped` —— 界面提示「公共目录还不支持上传资源，本次只发布了清单」，**不是错误**。

---

## 八、链路五：下载安装

入口：插件页 →「插件市场」→ 选中一条 →「获取」。

### 8.1 完整时序

```
PublishedPluginMarket.handlePull(entry)
  │
  ├─ cloudGetApp(entry.id)                       ← GET /apps_get（含 bundle）
  │    └─ bundle 为空 → 这次只装清单
  │
  ├─ toMarketPayload(entry.manifest, entry.name, bundle)
  │    ├─ 从清单原文里抽 runtime（兼容 1.x 老格式：顶层 command/args/cwd/env/preview）
  │    ├─ 抽 version / publisher / description / license / icon / engines
  │    ├─ 抽 capabilities
  │    └─ bundle 非空则挂上
  │
  ├─ pluginPickDir()                             ← 用户选一个目标文件夹
  │
  ├─ pluginImportFromMarket(dir, payload)
  │    ├─ 目标目录里已经有 plugin.json？
  │    │    └─ 是 → **拒绝，一个字节都不动**（防止覆盖用户自己的清单）
  │    ├─ 写 plugin.json（清单是唯一入口）
  │    ├─ 有 bundle → unpackProjectBundle(dir, bundle)
  │    │    └─ 逐文件落盘，**校验相对路径不许越界**
  │    ├─ importPlugin(dir, "market")
  │    │    └─ 清单解析不过 → 删掉刚写的清单，不落库
  │    └─ origin = market
  │
  ├─ cloudMarkPulled(entry.id)                   ← 被获取次数 +1
  │
  └─ 提示：「第一次运行前会请你确认它要执行的命令」
```

### 8.2 为什么市场导入要「专用路径」

别改回「写清单 + 导入插件」两步 —— 两步分开的话清单已经写了，导入才发现失败，用户自己已有插件的清单就被换成了别人的命令。**必须先检查目标目录、再写、再导入**，失败要回滚。

### 8.3 下载后第一次运行

因为 `origin = market`：

1. 点「启动」→ `checkStartConfirmation` → 清单指纹没确认过 → **返回 `needsConfirmation`**
2. 弹框展示：插件名、完整命令行、风险分析、声明的权限
3. 用户确认 → `confirmStart(pluginId, manifestHash)` → 指纹写进 `confirmed_manifest_hash`
4. 再点启动 → 直接跑
5. **清单改过了 → 指纹对不上 → 再弹一次**

---

## 九、权限模型

### 9.1 缺省最小权限

`capabilities` **不写就是最小权限**：只能加载预览页面，不能起子进程、不能读写笔记待办。

| 能力 | 键 | 作用 |
| --- | --- | --- |
| 起子进程 | `process.spawn` | 不声明 → `startPlugin` 直接拒绝 |
| 读环境变量 | `process.env` | 允许读取的变量名白名单 |
| 网络 | `network` | 允许访问的地址模式 |
| 文件系统 | `filesystem.read` / `filesystem.write` | 目录白名单 |
| 笔记 | `qnote.notes` | `none` / `read` / `write` |
| 待办 | `qnote.todos` | `none` / `read` / `write` |
| 剪贴板 | `qnote.clipboard` | `none` / `read` |
| AI | `qnote.ai` | `none` / `read` |

### 9.2 判定在哪

`src/main/core/plugin/capabilities.ts` 的 `checkCapability(capabilities, request)`：

- `{kind:"spawn"}` —— 启动插件时
- `{kind:"data", area:"notes"|"todos"|…, access:"read"|"write"}` —— 每次数据类宿主 API 调用时

**逐个调用逐个判**，不是启动时判一次就放行。

### 9.3 风险分析的位置

`pluginRisk.ts` 的 13 条正则（命令分隔符、命令替换、下载后直接执行、编码后执行、递归删除、提权……）只用来**在确认框里提示「这条命令看起来危险」**。

**它不是安全边界** —— 关键词匹配挡不住刻意伪装。真正的防线是「来源标记 + 运行前确认 + 声明式权限」三件套。

---

## 十、IPC 契约

### 10.1 preload 暴露（渲染层 → 主进程）

| API | 通道 | 说明 |
| --- | --- | --- |
| `pluginList()` | `plugin:list` | 列出插件 |
| `pluginImport(dir)` | `plugin:import` | 从本机目录导入 |
| `pluginImportFromMarket(dir, payload)` | `plugin:import-from-market` | 市场安装（专用路径） |
| `pluginRemove(id)` | `plugin:remove` | 移除 |
| `pluginSetEnabled(id, enabled)` | `plugin:set-enabled` | 启用/禁用 |
| `pluginRefresh()` | `plugin:refresh` | 重读清单 |
| `pluginWriteManifest(path, draft)` | `plugin:write-manifest` | 清单编辑器保存 |
| `pluginOpenFolder(target)` | `plugin:open-folder` | 打开插件目录（只允许已登记的） |
| `pluginPickDir()` | `plugin:pick-dir` | 选文件夹 |
| `pluginStart(id, hash?)` | `plugin:start` | 启动 |
| `pluginStop(id)` | `plugin:stop` | 停止 |
| `pluginRuntimeStates()` | `plugin:runtime-states` | 运行状态 |
| `pluginLogs(id)` | `plugin:logs` | 日志 |
| `pluginClearLogs(id)` | `plugin:clear-logs` | 清日志 |
| `pluginBuildBundle(id)` | `plugin:build-bundle` | 打资源包 |
| `pluginPreviewLoad(localId)` | `plugin:preview-load` | 加载预览 |
| `pluginPreviewVisible(bool)` | `plugin:preview-visible` | 显示/隐藏 |
| `pluginPreviewBounds(rect)` | `plugin:preview-bounds` | 设置边界 |

### 10.2 事件（主进程 → 渲染层）

| 事件 | 载荷 |
| --- | --- |
| `plugin:plugins-changed` | `PluginRecord[]` |
| `plugin:runtime-changed` | `PluginRuntimeState` |
| `plugin:log` | `PluginLogLine` |
| `plugin:notify` | `{pluginId, level, message}` |
| `plugin:preview-loaded` | `{localId}` |
| `plugin:preview-error` | `{localId, url, error}` |

### 10.3 云端通道

`cloud:list-apps`、`cloud:get-app`、`cloud:publish-app`、`cloud:remove-app`、`cloud:mark-pulled`、`cloud:get-config`、`cloud:save-config`、`cloud:switch-backend`、`cloud:test-connection`。

---

## 十一、插件侧 SDK 用法

`resources/plugin-sdk/qnote-plugin-sdk.js` —— 纯 ESM，无构建步骤，插件作者直接 `import`。

```js
import { createPlugin } from "…/resources/plugin-sdk/qnote-plugin-sdk.js";

createPlugin({
  async activate(ctx) {
    // ctx.commands.register(cmd, handler) —— 注册命令，返回 { dispose() }
    const sub = ctx.commands.register("demo.hello", async () => "hi");
    sub.dispose();  // 取消注册

    await ctx.notifications.info("启动好了");
    await ctx.log.warn("一条日志");

    const { value } = await ctx.settings.get("autoStart");
    await ctx.settings.set("autoStart", true);

    const todos = await ctx.todos.list({ limit: 20 });
    const notes = await ctx.notes.list({ limit: 50 });
  },
  async deactivate() {},
});
```

| ctx 命名空间 | 方法 |
| --- | --- |
| `ctx.commands` | `register` / `list` / `execute` |
| `ctx.notifications` | `info` / `warn` / `error` |
| `ctx.log` | `info` / `warn` / `error` |
| `ctx.settings` | `get` / `set` |
| `ctx.todos` | `list` |
| `ctx.notes` | `list` |

`ctx.id` 是插件自己的 id。

---

## 十二、现状：已实现 / 未实现

### 已实现 ✅

- `plugin.json` 清单 + 逐字段校验 + 自实现 semver 范围
- `plugin` / `plugin_setting` / `plugin_grant` 三表
- 老应用幂等迁移（1.x → 2.0）
- 进程启停、日志流、预览面板（三种 preview 形态）
- 声明式权限判定，数据类调用逐个校验
- SDK 通道（loopback HTTP + 长轮询）+ 宿主 API 面 + 插件侧 SDK
- 市场发布 / 获取全链路（清单 + 资源包）
- 静态命令注册（`contributes.commands`）

### 未实现 ⏳

| 能力 | 现状 |
| --- | --- |
| 命令面板 | 命令能注册、能执行，但**没有命令面板 UI** —— 插件注册的命令目前没有可见落点 |
| 侧栏动态入口 | `contributes.sidebar` 声明了，**挂载点没做** |
| 插件设置页 | `contributes.settings` 存了值，**没有设置界面** |
| `activationEvents` | 字段解析了，**触发机制没做** |
| `extensionDependencies` | 字段解析了，**依赖解析没做** |
| 市场版本与升级 | `published_app` 没有版本列，**装了新版不会提示升级** |
| 逐项授权撤销 | `plugin_grant` 表建了，**没有授权 UI 与撤销逻辑** |
| `qnote.clipboard.list` / `qnote.ai.chat` | 宿主 API 面里**没有这两个方法** |

---

## 十三、扩展点：加一个新能力改哪里

| 想加什么 | 动哪里 |
| --- | --- |
| 新的清单字段 | `src/shared/plugin/pluginTypes.ts` 加类型 → `pluginManifest.ts` 加校验 → `pluginManager.readPluginRecord` 加快照 |
| 新的宿主 API 方法 | `src/main/core/plugin/sdk/hostApi.ts` 的 `handlePluginCall` 加 case → `resources/plugin-sdk/qnote-plugin-sdk.js` 加 ctx 命名空间 |
| 新的贡献点 | `pluginTypes.ts` 的 `PluginContributes` 加字段 → 清单校验加规则 → 渲染层找挂载点 |
| 新的 IPC 通道 | `src/main/handlers/plugin/pluginHandlers.ts` 注册 → `src/main/preload.ts` 暴露 → `src/renderer/electron.d.ts` 补类型 → `src/renderer/test/electron-channel.test.ts` 的白名单（若是广播） |
| 新的数据访问 | `hostApi.ts` 里加方法，**每个方法都要过 `checkCapability`** |
| 新的发布字段 | `src/shared/cloud/cloudTypes.ts` → `data-app/http_endpoints/config.json` + SQL → **控制台手工 Deploy** → TiDB 侧建列 |
| 新的原生模块 | crate 放 `src/shared/<功能>/<功能>-rs/`，主进程入口 `src/main/core/<功能>/native*.ts`，加载器 `src/main/core/system/nativeModules.ts` |

---

## 十四、排障表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 导入报「清单不合规」 | `plugin.json` 解析不过，错误信息里有具体字段 | 按提示改；id 必须是 `publisher.name` 且小写 |
| 导入报「已经有 id 相同的插件」 | `duplicate-id` | 换 id，或先移除旧的 |
| 状态显示「版本不兼容」 | `engines.qnote` 要求更高版本 | 改清单的版本范围，或升级 QNote |
| 点了启动没反应 | 没声明 `capabilities.process.spawn` | 清单里补上；只做预览页面的插件本来就起不来 |
| 提示「cwd 指向了插件目录之外」 | `runtime.cwd` 越界 | 改成相对路径 |
| 市场插件每次启动都弹确认 | 清单改过了，指纹对不上 | 确认一次即可（指纹会记下来） |
| 预览空白 | 端口没起 / 路径写错 / 协议 host 段不是数字 | 看日志台；确认 preview 形态选对 |
| 插件收不到 SDK 调用 | 进程不是 QNote 起的，缺 `QNOTE_PLUGIN_RPC` | 只能由 QNote 启动，别自己 spawn |
| 发布报 403 | 公共目录网关拦了带 IP 字面量的内容 | preview 只写端口，别写 `http://127.0.0.1:…` |
| 发布成功但没有文件 | 端点不认 `bundle` 参数，静默忽略 | 界面会提示「只发布了清单」；需要文件就去控制台 Deploy 更新后的端点 |
| 获取后装不上 | 目标目录已有 `plugin.json` | 换一个空文件夹 |
| 获取后文件没解出来 | 老记录没有 bundle | 重新发布一次带资源包的版本 |

---

## 附：与 1.x 的对应关系

| 1.x | 2.0 |
| --- | --- |
| `qnote.json` | `plugin.json` |
| `app_project` 表 | `plugin` 表（+ `plugin_setting` / `plugin_grant`） |
| `AppManager` | `PluginManager` |
| `app:` channel 前缀 | `plugin:` channel 前缀 |
| `apps-rs` crate | `plugin-rs` crate |
| `window.electron.appXxx` | `window.electron.pluginXxx` |
| 风险关键词当安全边界 | 声明式权限 + 来源确认 |
| 无 SDK | 插件进程 + SDK 通道 |
