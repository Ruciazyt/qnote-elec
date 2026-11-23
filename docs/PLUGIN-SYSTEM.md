# QNote 插件系统 —— 设计文档

> 状态：**已实现**（当前发布线 2.1.x，落地版本 **2.1.0** —— 切线与版本号 bump 必须同一个提交，见 AGENTS.md 3.1）
> 取代对象：【应用】模块（`qnote.json` 清单 + `app_project` 表 + `AppManager`）
> 现行架构与全链路（创建 → 导入注册 → 启动运行 → 上传发布 → 下载安装）见 [PLUGIN-ARCHITECTURE.md](./PLUGIN-ARCHITECTURE.md)

### 实现现状

| 能力 | 状态 |
| --- | --- |
| `plugin.json` 清单与逐字段校验 | ✅ 已实现（`src/shared/plugin/manifest/pluginManifest.ts`） |
| `plugin` / `plugin_setting` / `plugin_grant` 三表 | ✅ 已实现 |
| 老应用幂等迁移（`qnote.json` → `plugin.json`） | ✅ 已实现（`src/main/core/plugin/migration/legacyMigration.ts`） |
| 进程启停、日志流、预览面板 | ✅ 已实现（预览协议 host 段仍用本地自增号） |
| 声明式权限判定 | ✅ 已实现（`capabilities.ts`），数据类调用逐个校验 |
| SDK 通道与宿主 API | ✅ 已实现，**传输用 loopback HTTP + 插件注册回调地址**（不是 WebSocket） |
| 插件侧 SDK | ✅ 已实现（`resources/plugin-sdk/qnote-plugin-sdk.js`，纯 ESM 无构建） |
| 命令面板、侧栏动态入口、插件设置页 | ✅ 已实现（`Ctrl+Shift+P` 唤起命令面板，侧栏按 `contributes.sidebar` 生成入口，插件页可读写清单声明的设置项） |
| 插件通知（宿主 toast） | ✅ 已实现（`plugin:notify` 事件，插件经 SDK 发通知） |
| 市场版本与依赖、逐项授权撤销 | ✅ 已实现（`published_app` 加 `version`/`dependencies`；授权项存在 `plugin_grant`，设置页逐项撤销，撤销后下次调用立刻失败） |
| `qnote.clipboard.list` / `qnote.ai.chat` | ✅ 已实现（宿主 API 面补齐到 16 个方法） |
| 依赖解析（`extensionDependencies`） | ✅ 已实现（`id` 或 `id@^1.0.0`；缺失或版本不满足时拒绝激活并指明缺哪个，不自动安装） |
| 运行状态机 | ✅ 已实现（`inactive` / `activating` / `active` / `deactivating` / `failed`） |
| 发布前网关兼容检查 | ✅ 已实现（`preview` / `env` / `capabilities.network` 里的 IP 字面量在发布前就拦下） |
| 迁移脚本独立入口 | ✅ 已实现（`pnpm run migrate:plugins`，幂等） |

---

## 一、目标与边界

### 1.1 这次改什么

把【应用】从「启动一个别人的程序、把它的网页显示在 QNote 里」升级为 VSCode 式插件系统：

| 维度 | 1.x 现状 | 2.0 目标 |
| --- | --- | --- |
| 清单 | `qnote.json`，只描述怎么跑 | `plugin.json`，描述身份、版本、引擎约束、运行期、权限、贡献点 |
| 生命周期 | 进程起停即生命周期 | 插件有独立生命周期：安装 → 未激活 → 激活中 → 已激活 → 停用中 → 未激活 |
| 扩展能力 | 无 | 插件通过 SDK 注册命令、读设置、弹通知、读写笔记与待办 |
| 权限 | 靠关键词扫命令猜风险 | 插件自己声明 `capabilities`，宿主按声明校验 |
| 挂载 | 路由与侧栏全静态 | 侧栏入口、命令、设置项由插件贡献点动态生成 |
| 分发 | 目录 + 拉取 | 目录 + 版本 + 依赖 + 升级 |

### 1.2 这次不改什么

- **不做进程内扩展**。插件代码不在 QNote 进程里跑，只跑在它自己的进程里（选定：进程外插件 + SDK）。
- **不做插件独立页签**。插件界面复用现有预览面板（`WebContentsView`），渲染层不需要动态路由。
- **不改私有协议** `qnote-app://`。
- **不改预览容器**。`useNativeViewCover` / `WebContentsView` 机制原样保留。
- **不动私有数据边界**。笔记、待办、剪贴板、设置永远只在本地 SQLite，插件只能通过受控的宿主 API 访问。

### 1.3 与 VSCode 的对应关系

| VSCode | QNote 插件系统 | 备注 |
| --- | --- | --- |
| `package.json` | `plugin.json` | 字段名刻意保持一致，便于插件作者迁移心智 |
| `publisher.name` | `id` | 全局唯一，`id` 用字符串不用自增整数 |
| `engines.vscode` | `engines.qnote` | 宿主版本约束 |
| `contributes.commands` | 同名 | 静态声明 |
| `registerCommand` | `ctx.commands.register` | 运行时注册 |
| `activationEvents` | 同名 | 激活触发条件 |
| `extensionDependencies` | 同名 | 依赖 |
| Workspace Trust | `capabilities` + 来源确认 | 声明式权限 + 运行时确认 |
| Extension Host | 插件自己的进程 | 宿主只提供 RPC 通道 |
| `vscode.*` API | `ctx.*` SDK | 命名不同，语义对齐 |

---

## 二、插件清单规范（plugin.json）

### 2.1 文件名与位置

- 文件名：`plugin.json`（**废弃 `qnote.json`**）
- 位置：插件根目录，插件根目录**就是**插件本体 —— 没有「根目录 + 扫描子目录」这层
- 一个目录只能是一个插件

### 2.2 完整示例

```jsonc
{
  "id": "ichain.dev-console",
  "name": "iChain 开发编排台",
  "version": "0.3.0",
  "publisher": "lenovo",
  "description": "四个仓库的 dev 编排与监控",
  "license": "MIT",
  "icon": "icon.png",

  "engines": { "qnote": "^2.0.0" },
  "activationEvents": ["onCommand:ichain.start"],

  "runtime": {
    "command": "node server.mjs",
    "args": [],
    "cwd": ".",
    "env": { "QNOTE_MANAGED": "1" },
    "preview": { "type": "port", "port": 7788 }
  },

  "capabilities": {
    "process": { "spawn": true },
    "network": ["127.0.0.1:*"],
    "qnote": { "notes": "read", "todos": "read" }
  },

  "contributes": {
    "commands": [
      { "command": "ichain.start", "title": "启动编排台", "category": "iChain" }
    ],
    "settings": [
      { "key": "port", "type": "number", "default": 7788, "title": "编排台端口" }
    ],
    "sidebar": [
      { "id": "ichain", "title": "编排台", "icon": "icon.png" }
    ]
  },

  "extensionDependencies": []
}
```

### 2.3 顶层字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 全局唯一标识，格式 `publisher.name`，只允许小写字母、数字、`.-` |
| `name` | string | 是 | 界面显示名 |
| `version` | string | 是 | 语义化版本 `MAJOR.MINOR.PATCH` |
| `publisher` | string | 是 | 发布者标识 |
| `description` | string | 否 | 一句话说明 |
| `license` | string | 否 | 许可证标识 |
| `icon` | string | 否 | 图标文件，相对插件根目录 |
| `engines.qnote` | string | 是 | 宿主版本约束，用 semver range（如 `^2.0.0`） |
| `activationEvents` | string[] | 否 | 激活触发条件，见 2.6 |
| `runtime` | object | 是 | 运行期配置，见 2.4 |
| `capabilities` | object | 否 | 声明式权限，见第六节 |
| `contributes` | object | 否 | 贡献点，见第五节 |
| `extensionDependencies` | string[] | 否 | 依赖的其他插件 id |

### 2.4 runtime 段

这一段**就是今天 `qnote.json` 的内容**，字段名与语义完全一致，迁移时整体搬进 `runtime` 即可。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `command` | string | 二选一 | 启动命令，在 `cwd` 下经 shell 执行 |
| `args` | string[] | 否 | 追加给命令的参数，含空格的自动加引号 |
| `cwd` | string | 否 | 工作目录，相对插件根。**不允许指向插件外** |
| `env` | object | 否 | 额外环境变量，值必须是字符串/数字/布尔 |
| `preview` | object | 二选一 | 预览目标，见下 |

`preview` 改成对象形式，消掉今天「字符串 `"3000"` 到底是端口还是文件夹名」的歧义：

| 写法 | 含义 |
| --- | --- |
| `{ "type": "port", "port": 7799 }` | 加载 `http://127.0.0.1:7799/` |
| `{ "type": "url", "url": "https://example.com" }` | 加载任意网址 |
| `{ "type": "path", "path": "dist/index.html" }` | 加载插件目录内的文件，相对插件根解析 |

> **发布约束**：公共目录前面的网关（TiDB Cloud Data Service 前的 AWS ALB）会拦「内容里带具体 IP 地址」的请求。
> `type: "port"` 只含端口号，安全；`type: "url"` 若写 `http://127.0.0.1:7799/` 这类指向 IP 字面量的地址，
> **发布会被网关挡成 403**。发布前要本地先做一次「网关兼容检查」并直接报错提示（见 8.4）。

### 2.5 校验规则

校验不通过就**不落库**，界面上要指出错在哪个字段：

- 顶层必须是对象
- `id` 必填且格式合法；`id` 已存在则拒绝（一个 id 只能装一份）
- `version` 必填且是合法 semver
- `engines.qnote` 必填；不满足当前宿主版本 → 状态标 `incompatible`，**允许安装但禁止激活**
- `runtime.command` 与 `runtime.preview` 至少有一个
- `args` 必须是字符串数组；`env` 的值必须是字符串/数字/布尔
- `cwd` 解析后必须落在插件根目录内
- `capabilities` 里出现未知的能力名 → 拒绝（不静默忽略，插件作者要知道写错了）

### 2.6 activationEvents

| 事件 | 含义 |
| --- | --- |
| `onStartup` | QNote 启动后激活 |
| `onCommand:<id>` | 该命令被执行时激活 |
| `onPreview` | 插件的预览面板被打开时激活 |

不写 `activationEvents` = 只在用户手动点「启动」时激活（等价于今天的行为）。这是**默认且最安全**的形态。

---

## 三、插件运行时与生命周期

### 3.1 状态机

```
installed ──▶ inactive ──activate()──▶ activating ──▶ active
                  ▲                        │              │
                  └────deactivate()────────┴──────────────┘
                                    crash ──▶ failed ──▶ inactive
```

| 状态 | 含义 |
| --- | --- |
| `inactive` | 已安装未激活，进程没起 |
| `activating` | 进程已起，SDK 正在握手，`activate()` 还没返回 |
| `active` | `activate()` 已返回，命令与 API 可用 |
| `deactivating` | 正在收尾 |
| `failed` | 进程崩溃或握手失败，可重启 |

### 3.2 激活流程

1. 宿主按 `runtime` 起进程（`spawn(commandLine, { shell: true })`）
2. 宿主在 127.0.0.1 随机端口起 RPC 服务，把地址与令牌注入环境变量（见 4.2）
3. 插件用 SDK 起自己的回调服务，向宿主 `POST /register-callback` 报端口 —— 注册成功即视为接通
4. 宿主调 `plugin.activate` → 插件跑 `activate(ctx)`，返回它注册的命令
5. 宿主把命令写入命令表，状态置 `active`
6. 握手超时（5s）→ 插件压根没接过 RPC 就按普通程序运行；接过却没回应 → 激活失败，记日志，状态 `failed`

### 3.3 停用流程

1. 宿主调 `plugin.deactivate` → 插件跑 `deactivate()`
2. 超时（默认 5s）→ 直接结束进程
3. 进程退出；Windows 上按进程树收（`taskkill /T /F`），macOS/Linux 上按进程组收
4. QNote 退出时**所有插件进程同步收掉** —— 关掉 QNote 就是真的停了

### 3.4 已知限制

- `command` 仍经 shell 执行（`shell: true`）。老应用迁移过来依赖这个行为，2.0.0 不改。
  后续可加 `runtime.argv` 数组形式绕开 shell，但那是另一个版本的事。
- 一个插件同时只能有一个实例在跑（与今天一致）。

---

## 四、SDK 与 RPC 通道

### 4.1 为什么用 loopback HTTP + 回调注册，不用 WebSocket

- 插件的 **stdout / stderr 要原样给用户看**（运行控制台是现成功能，不能丢）
- **stdin 是单向的**，撑不起「插件 → 宿主」的调用
- Windows 上不可靠地继承额外 fd（fd 3+）
- **不引新依赖** —— Node 内置 `http` 模块就能起一个只监听 127.0.0.1 的服务，
  WebSocket 得自己实现 RFC 6455 握手与帧编码，或者多一个 `ws` 依赖
- **插件作者未必用 JS** —— HTTP 是各语言标准库都有的东西（Python `http.server`、
  Go `net/http`、Rust `axum`）；WebSocket 客户端每种语言都得额外装库

**双向怎么做的**：宿主是服务方、插件是客户端 —— **两个方向都是一次 HTTP 往返**，
请求与结果装在同一个响应里：

| 方向 | 通道 | 谁发起 |
| --- | --- | --- |
| 插件 → 宿主 | `POST /rpc`（JSON-RPC 2.0） | 插件 |
| 宿主 → 插件 | `POST http://127.0.0.1:<插件端口>/host-call`（JSON-RPC 2.0） | 宿主 |

**注册这一步**：插件起来后自己 `listen(0, "127.0.0.1")` 起一个 HTTP 服务，
拿到端口后向宿主 `POST /register-callback` 报备（带令牌）。注册成功即视为接通，
宿主之后直接 POST 那个端口就行。

这样换来的是：**不需要 id 配对、不需要常驻连接、不需要 pending 表**。
宿主侧只留一张「插件 id → 回调地址」的表，调用就是一次普通的 HTTP 请求。

插件也可以完全不接 SDK（不起服务、不注册）—— 那种插件按普通程序运行，
宿主只收它的日志和预览页。**注册成功与否就是「接没接 SDK」的判据**，
不用再靠「调用超时」反推。

### 4.2 环境变量契约

宿主启动插件进程时注入：

| 变量 | 内容 |
| --- | --- |
| `QNOTE_PLUGIN_ID` | 插件 id |
| `QNOTE_PLUGIN_VERSION` | 插件版本 |
| `QNOTE_PLUGIN_RPC` | `http://127.0.0.1:<随机端口>` |
| `QNOTE_PLUGIN_TOKEN` | 一次性令牌，握手时校验 |

令牌每次启动重新生成，令牌不对的连接一律拒绝 —— 防止本机其他进程连上宿主冒充插件。

### 4.3 消息格式

JSON-RPC 2.0。插件注册回调地址：

```json
POST /register-callback
{ "port": 54321 }
```

之后两个方向都是 JSON-RPC 2.0 的请求/响应：

```json
{ "jsonrpc": "2.0", "id": 7, "method": "qnote.notes.list", "params": {} }
{ "jsonrpc": "2.0", "id": 7, "result": { "items": [] } }
{ "jsonrpc": "2.0", "id": 7, "error": { "code": -32001, "message": "未授权访问笔记" } }
```

### 4.4 宿主 API 面

| 方法 | 说明 | 需要 capability |
| --- | --- | --- |
| `qnote.commands.list` | 列出所有可用命令 | — |
| `qnote.commands.execute` | 执行某个命令 | — |
| `qnote.notify` | 弹宿主通知（info/warn/error） | — |
| `qnote.log.info/warn/error` | 写进插件自己的日志流 | — |
| `qnote.settings.get/set` | 读/写插件自己的配置项 | 只限自己 `contributes.settings` 声明的 key |
| `qnote.notes.list/get` | 读笔记 | `qnote.notes: read` |
| `qnote.notes.create/update` | 写笔记 | `qnote.notes: write` |
| `qnote.todos.list/create/update` | 待办 | `qnote.todos` |
| `qnote.clipboard.list` | 剪贴板历史 | `qnote.clipboard: read` |
| `qnote.ai.chat` | 调 AI | `qnote.ai` |

> 笔记与待办的数据访问**必须走主进程**，插件不能直接碰 SQLite（守住 `qnote/no-direct-database-import` 这条边界）。

### 4.5 SDK 形态

- **协议语言无关**：任何语言都能按 4.3 自己实现
- **官方 SDK 发 Node/TS 版**，单文件 ESM，无构建依赖，插件直接 `import`：

```ts
// extension.ts
import { createPlugin } from "@qnote/plugin-sdk";

export default createPlugin({
  async activate(ctx) {
    ctx.commands.register("ichain.start", async () => {
      await ctx.notifications.info("编排台已启动");
      const notes = await ctx.notes.list({ limit: 5 });
      ctx.log.info(`读到 ${notes.items.length} 条笔记`);
    });
  },
  async deactivate() {
    // 收尾
  },
});
```

- SDK 源码放 `src/shared/plugin/sdk/`，构建产物拷到 `resources/plugin-sdk/` 随安装包分发，插件从仓库取一份或直接引用

---

## 五、贡献点与动态挂载

### 5.1 静态声明 vs 运行时注册

| | 静态（`contributes`） | 运行时（`ctx.`） |
| --- | --- | --- |
| 时机 | 读清单时就有 | 插件激活后才有 |
| 用途 | 命令面板在插件没激活时也能列出、绑定快捷键 | 插件自己按条件注册 |
| 例子 | `contributes.commands` | `ctx.commands.register()` |

### 5.2 支持的贡献点

| 贡献点 | 挂到哪 | 说明 |
| --- | --- | --- |
| `commands` | 命令面板 | `command` / `title` / `category` / `icon` |
| `settings` | 设置页 | `key`（插件内相对）/ `type` / `default` / `title` / `description` |
| `sidebar` | 主侧栏 | `id` / `title` / `icon`，点进去是插件的预览面板 |

### 5.3 挂载点改造

只有两处要动：

1. **侧栏**（`src/renderer/components/shell/AppSidebar.tsx`）：现在「应用」是静态项，改成读已装插件的 `contributes.sidebar` 动态生成。**保留**一个静态的「插件」管理入口（装/卸/启用），插件自己的入口挂在它下面或同级。
2. **命令面板**（新增）：`Ctrl+Shift+P` 唤起，模糊搜索所有 `contributes.commands` 与已注册命令。这是插件命令唯一的落点 —— **不做命令面板，插件注册的命令就没地方用**。

路由**不动**：插件界面在预览面板里，不占路由。

---

## 六、权限与信任模型

### 6.1 声明式权限

```jsonc
"capabilities": {
  "process": { "spawn": true, "env": ["QNOTE_MANAGED"] },
  "network": ["127.0.0.1:*", "https://api.example.com/*"],
  "filesystem": { "read": ["${pluginRoot}/**"], "write": [] },
  "qnote": { "notes": "read", "todos": "read", "clipboard": "none", "ai": "none" }
}
```

| 能力 | 取值 | 含义 |
| --- | --- | --- |
| `process.spawn` | bool | 允许起子进程 |
| `process.env` | string[] | 允许设置的环境变量名白名单 |
| `network` | string[] | 允许访问的主机模式 |
| `filesystem.read/write` | string[] | 允许访问的路径模式 |
| `qnote.notes/todos/clipboard/ai` | `none\|read\|write` | 对宿主数据的访问级别 |

### 6.2 缺省行为

**没声明 capabilities = 最小权限**：只能加载预览页面，不能起子进程，不能读笔记待办。

这条保证老插件在 2.0.0 上不会被新模型卡死，也保证「装了个插件就被读了笔记」这种事不会发生。

### 6.3 与现有风险分析的关系

- 现有的关键词风险分析（`appRisk.ts`，13 条正则）**保留**，但降级为「命令看起来危险」的补充提示
- **主判断依据换成声明**：宿主按 `capabilities` 校验，声明了才放行
- 市场来源的插件仍走现有的**启动确认**（`confirmed_manifest_hash` 比对），确认框的展示内容从「这条命令有什么风险」改成「这个插件要什么权限」

### 6.4 授权粒度

| 时机 | 行为 |
| --- | --- |
| 安装（市场来源） | 一次性确认，展示全部声明的权限 |
| 首次激活 | 若权限与上次确认时不同 → 重新确认 |
| 运行时 | 调用超出声明范围的 API → 拒绝 + 记日志，**不弹窗打断** |
| 设置页 | 能逐项查看与撤销每个插件的授权 |

授权记录存 `plugin_grant` 表。

---

## 七、数据存储与迁移

### 7.1 新表

```sql
CREATE TABLE plugin (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  publisher TEXT NOT NULL,
  description TEXT,
  path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'missing-manifest',
  manifest_text TEXT,
  runtime_json TEXT,
  capabilities_json TEXT,
  error TEXT,
  origin TEXT NOT NULL DEFAULT 'local',
  enabled INTEGER NOT NULL DEFAULT 1,
  confirmed_manifest_hash TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE plugin_setting (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (plugin_id, key)
);

CREATE TABLE plugin_grant (
  plugin_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 0,
  granted_at TIMESTAMP,
  PRIMARY KEY (plugin_id, capability)
);
```

> **两个 id 各司其职**：`id` 是对外的全局业务标识（`publisher.name`），用字符串，能跨机器、跨市场对账；
> `local_id` 是本地内部自增号，只给预览协议用 —— `qnote-app://p<local_id>/…` 的 host 段必须是纯数字，
> 插件 id 里的 `.` 与 `-` 塞不进 hostname。两者并存，别把 `local_id` 暴露给插件。
> `plugin_setting` 独立成表而不是塞进 `settings`，因为键要带插件命名空间。

### 7.2 迁移步骤（2.0.0 首次启动自动执行，必须幂等）

1. 读 `app_project` 表全部记录
2. 每条记录：读原目录下的 `qnote.json`
3. 生成新的 `plugin.json`：

   ```jsonc
   {
     "id": "local.<目录名的 slug>",
     "name": "<原 name>",
     "version": "0.0.1",
     "publisher": "local",
     "description": "<原 description>",
     "engines": { "qnote": "^2.0.0" },
     "runtime": { /* 原 qnote.json 的 command/args/cwd/env/preview，原样搬进来 */ },
     "capabilities": { "process": { "spawn": true } }
   }
   ```

4. `preview` 从旧格式转成新对象格式（旧值是数字/端口字符串 → `{ "type": "port", "port": N }`；`http(s)://` 开头 → `{ "type": "url", "url": ... }`；其余 → `{ "type": "path", "path": ... }`）
5. 写入插件根目录的 `plugin.json`
6. **原 `qnote.json` 保留不删**（改名回滚成本高；新解析器只认 `plugin.json`）
7. 写 `plugin` 表
8. 迁移完成后 `app_project` 表**不删**，标记为已废弃（留个回滚口子）

> 迁移脚本要能单独跑（`pnpm run migrate:plugins`），便于出问题时手动重跑。

---

## 八、市场与版本

### 8.1 `published_app` 加版本列

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `version` | VARCHAR(32) NULL | 插件版本，可空（老发布记录没有） |
| `dependencies` | TEXT NULL | JSON 数组，依赖的插件 id 与版本范围 |

### 8.2 安装与升级

- 市场条目按 `id + version` 唯一
- 装的是**指定版本**，不是「最新版」
- 升级 = 重新拉 bundle 覆盖 → 清单哈希变了 → **重新走一次权限确认**

### 8.3 依赖

`extensionDependencies: ["a.b"]`，格式 `id` 或 `id@^1.0.0`。

- 依赖缺失 → 拒绝激活，提示缺哪个
- 不做自动安装（避免装插件顺手装一堆东西），给出跳转市场的手动入口

### 8.4 发布前检查

发布到公共目录前本地先查：

1. `preview` 里有没有 IP 字面量（`type: "url"` 的地址）→ 有就拒绝并提示改用 `type: "port"`
2. `env` 的值里有没有 IP 字面量 → 同上
3. `capabilities.network` 的模式里有没有 IP 字面量 → 同上

这三条是网关（AWS ALB）的硬约束，**本地先拦比发布后吃 403 好**。

---

## 九、分期落地清单

### P0 · 地基：清单 + 存储 + 迁移

| 项 | 内容 |
| --- | --- |
| 改哪 | 新增 `src/shared/plugin/manifest/pluginTypes.ts`、`src/main/core/plugin/manifest/pluginManifest.ts`（新清单解析器）；`src/database/migrations/index.ts` 加三张表；新增迁移脚本 `scripts/migrate/` |
| 交付 | 清单 schema 与校验器；新表；`qnote.json` → `plugin.json` 迁移脚本 |

**验收标准**

1. 校验器对每类非法输入都指出**具体字段与原因**（不是一句「清单有误」）
2. 迁移脚本跑完后，老项目的每个目录里都有合法的 `plugin.json`，原 `qnote.json` 未被删除或改动
3. 迁移脚本跑第二遍结果不变（幂等）
4. `engines.qnote` 不含当前版本 → 状态 `incompatible`，能装不能激活
5. `id` 重复 → 导入被拒，原有插件不受影响

### P1 · 运行时：进程 + 预览 + 日志 + SDK 通道

| 项 | 内容 |
| --- | --- |
| 改哪 | `src/main/core/apps/appManager.ts` → `src/main/core/plugin/runtime/pluginManager.ts`；新增 `src/main/core/plugin/rpcServer.ts`、`src/main/core/plugin/hostApi.ts`；`src/shared/plugin/sdk/`；`src/main/handlers/apps/appHandlers.ts` → `src/main/handlers/plugin/runtime/pluginHandlers.ts` |
| 交付 | 插件进程生命周期；WebSocket RPC 服务；Node SDK |

**验收标准**

1. 插件能启动、停止、重启，stdout/stderr 实时进日志面板
2. 插件进程用 SDK 连上宿主，完成一次往返调用（`qnote.notify`）并在界面弹出来
3. 三种 `preview` 形态（port / url / path）都正常加载
4. QNote 退出时所有插件进程被收掉，Windows 上无孤儿进程
5. 令牌不对的连接被拒绝，且不影响正常插件
6. 插件崩溃后状态为 `failed`，可重启，日志里有崩溃原因

### P2 · 贡献点：命令 / 设置 / 侧栏

| 项 | 内容 |
| --- | --- |
| 改哪 | 新增 `src/renderer/components/panel/CommandPalette.tsx`；`src/renderer/pages/plugin/runtime/PluginSettingsPanel.tsx`；`src/renderer/components/shell/AppSidebar.tsx` 改动态挂载 |
| 交付 | 命令面板；插件设置项落设置页；侧栏动态入口 |
| 状态 | ✅ 已落地（2.1.0） |

**验收标准**

1. `Ctrl+Shift+P` 唤出命令面板，模糊搜索能匹配 `contributes.commands` 与运行时注册的命令
2. 执行一个插件命令 → 插件被激活 → 命令执行 → 结果回显
3. `contributes.settings` 的配置项出现在设置页，改动能通过 `qnote.settings.set` 传到插件
4. 侧栏出现插件入口，点进去预览面板加载该插件的 preview
5. 插件未激活时，命令面板仍能列出它的静态命令（点一下触发激活）

### P3 · 权限与生态：capabilities + 版本依赖

| 项 | 内容 |
| --- | --- |
| 改哪 | `src/main/core/plugin/permissions/capabilities.ts`；`src/renderer/pages/plugin/PluginPermissions.tsx`；`src/database/cloud/` + `data-app/http_endpoints/sql/` 加 `version`/`dependencies` 列；发布流程加网关兼容检查 |
| 交付 | 声明式权限校验；授权管理页；市场版本与依赖 |

**验收标准**

1. 插件调用超出 `capabilities` 的 API 被拒绝并记日志，进程不崩
2. 没声明 capabilities 的插件只能加载预览页面，起不了子进程
3. 设置页能逐项查看与撤销每个插件的授权，撤销后对应调用立即失败
4. 市场能按指定版本安装、能升级，升级后重新走权限确认
5. 依赖缺失时拒绝激活并指明缺哪个
6. 含 IP 字面量的 preview/env/network 在**发布前**就被拦下并给出可操作的提示

---

## 十、受影响文件清单

### 10.1 主进程

| 文件 | 改动 |
| --- | --- |
| `src/main/utils/appManifest.ts` | **废弃**，换成 `src/main/core/plugin/manifest/pluginManifest.ts` |
| `src/main/core/apps/appManager.ts` | **重写**为 `src/main/core/plugin/runtime/pluginManager.ts` |
| `src/main/core/apps/bundle.ts` | → `src/main/core/plugin/runtime/bundle.ts`；跳过列表 `qnote.json` → `plugin.json`；打包规则按新清单结构调整 |
| `src/main/core/apps/nativeApps.ts` | → `src/main/core/plugin/permissions/nativePlugin.ts`；保留（风险分析），调用点跟着换 |
| `src/main/handlers/apps/appHandlers.ts` | **重命名**为 `src/main/handlers/plugin/runtime/pluginHandlers.ts`，channel 前缀 `app:` → `plugin:` |
| `src/main/core/window/apps/appPreview.ts` | → `src/main/core/window/plugin/runtime/pluginPreview.ts`；基本不动；按 `local_id`（本地自增号）查目录，不是按字符串 id；协议 host 段仍是 `p<local_id>` |
| `src/main/preload.ts` | `app*` 系列暴露 → `plugin*` |
| `src/main/core/system/nativeModules.ts` | plugin-rs crate 的入口路径跟着换目录 |

### 10.2 共享层与数据层

| 文件 | 改动 |
| --- | --- |
| `src/shared/apps/appTypes.ts` | → `src/shared/plugin/manifest/pluginTypes.ts` |
| `src/shared/apps/appRisk.ts` | 迁到 `src/shared/plugin/`，保留逻辑 |
| `src/shared/apps/preview.ts` | 迁到 `src/shared/plugin/`，改成对象形式的 preview |
| `src/database/migrations/index.ts` | 新增 `plugin` / `plugin_setting` / `plugin_grant` 三表 |
| `src/database/cloud/` + `data-app/` | `published_app` 加 `version`/`dependencies` 列（TiDB 侧要手工 ALTER + Deploy） |

### 10.3 渲染层

| 文件 | 改动 |
| --- | --- |
| `src/renderer/pages/apps/` | **重命名**为 `src/renderer/pages/plugin/` |
| `src/renderer/App.tsx` | `/apps` → `/plugins` |
| `src/renderer/components/shell/AppSidebar.tsx` | 「应用」→「插件」，并按 `contributes.sidebar` 动态挂载 |
| `src/renderer/components/panel/CommandPalette.tsx` | **新增** |
| `src/renderer/electron.d.ts` | 补新的 preload 类型 |

### 10.4 文档

| 文件 | 改动 |
| --- | --- |
| `docs/APP-MANAGEMENT.md` | 标记废弃，指向本文 |
| `docs/CLOUD-STORAGE.md` | `published_app` 的 `manifest` 列说明更新 |
| `docs/SONAR-DEBT.md` | `appManager.ts`/`appManifest.ts` 的路径条目跟着改名 |
| `AGENTS.md` 6.4 | 实现完成后重写为插件系统规范 |
| `README.md` | 应用清单那段改成插件清单 |

---

## 十一、破坏性变更与版本策略

| 变更 | 影响 |
| --- | --- |
| `qnote.json` → `plugin.json` | 老插件目录需迁移 |
| `app_project` 表 → `plugin` 表 | 数据库结构变更，迁移脚本自动跑 |
| IPC channel `app:*` → `plugin:*` | 内部暴露，属重构 |
| 侧栏「应用」→「插件」，路由 `/apps` → `/plugins` | 用户可见 |
| 清单字段大改（新增 id/version/engines/contributes/capabilities） | 不兼容 |

按 AGENTS.md 3.2 的规则，这是**不兼容的配置与数据结构变更 → major → 2.0.0**。

- 当前发布线 1.19.x → 新线 2.0.x
- `scripts/release/verify-version.js` 的 `RELEASE_LINE` 要改成 `2.0.x`
- **切线与 `package.json` 的 version bump 必须是同一个提交**（AGENTS.md 3.1 的硬规则）
- 迁移脚本在 2.0.0 首次启动时自动执行，且必须幂等
