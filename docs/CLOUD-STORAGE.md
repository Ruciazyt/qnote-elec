# 云端存储 —— 共享数据放 D1，私有数据留本地

> 这份文档是**规范本体**：QNote 的数据怎么分、共享数据放哪、
> 切后端时会发生什么。
>
> 实现位置：主进程 `src/database/cloud/`（存储层）、
> `src/main/handlers/cloudHandlers.ts`（IPC）、
> 渲染层 `src/renderer/components/core/CloudStorageCard.tsx`（设置）、
> `src/renderer/components/apps/PublishedAppMarket.tsx`（市场）。

---

## 一、为什么是「双层」而不是「整个库搬上云」

最初的设想是把数据库整个换成云端。走查 D1 的限制之后，
这条路走不通 —— 不是难，是**不划算**：

| D1 的限制 | 撞上什么 |
| --- | --- |
| 没有交互式事务 | 本地有 3 处 `DB.transaction`，其中「删会话」那处真的需要原子性 |
| 单行上限约 2MB | `note.content` 存剪贴板图片的 base64，单条几百 KB 起 |
| 免费额度每日 500 万行读 | 剪贴板每 2 秒查一次去重，一天就是几万次查询 |
| 每次查询一次网络往返 | 剪贴板监听这种高频路径扛不住 |
| 外键**永远**开启 | 本地 SQLite 默认关着，行为会变 |

于是改成两层：

```
┌─────────────────────────────────────────────────┐
│ 私有数据（永远本地）                              │
│   笔记 / 剪贴板 / Todo / AI 对话 / 快捷方式 /      │
│   书签 / 题单 / 记忆索引 / 设置                   │
│   → 本地 SQLite，零改动                            │
├─────────────────────────────────────────────────┤
│ 共享数据（可切本地 ⇄ D1 ⇄ 公共目录）              │
│   已发布的 APP 目录（published_app）              │
│   → 后端由用户选择                                 │
└─────────────────────────────────────────────────┘
```

**私有数据一行代码没动。** 本地库该有的东西一样不少，
切到云端之后笔记还在本地，切回来也还在。

共享数据是「所有人都能看的」那部分 —— 放云端才有意义。

---

## 一之二、三种共享后端

共享存储有三个后端，**接口完全一样**，设置页里切：

| 后端 | 连什么 | 用户要做什么 | 凭据在哪 |
| --- | --- | --- | --- |
| `local` | 本地 SQLite 的 `published_app` 表 | 什么都不用做 | 无 |
| `public` | **公共目录 Worker 代理** | 什么都不用做（地址已内置） | **只在 Worker 侧** |
| `d1` | 直连 Cloudflare D1 REST | 填账号 ID / 库 ID / Token | 在用户本机 |

### 为什么有「公共目录」这一档

用户要的是「**所有用户都能连上，不需要配置**」。要做到这点，
客户端必须内置一个能连的地址。

但如果那个地址背后是 Cloudflare 的 D1 REST API，就得有 API Token ——
而 **D1 的 Token 是账号级的**：Cloudflare 文档原话是
"A Cloudflare API token with D1 access is account-wide"，
控制台里也**没法**只授权到单个库。所以把 Token 内置进客户端，
等于把你账号下**所有** D1 库的写权限发给每一个装了你应用的人。
这既撞 AGENTS.md 第 4 节的红线，也是真实的安全暴露。

### 公共目录的解法：Worker 代理

```
   QNote 客户端 ──HTTP──> Worker ──D1 绑定──> D1 数据库
      无凭据               凭据不出服务端        只放 published_app
```

Worker 用 **D1 绑定**（`env.DB`）直连数据库 —— 这一步根本不需要 Token。
客户端只内置 Worker 的**公开地址**（不是密钥，可以随便内置），
于是所有用户开箱即用，零配置。

Worker 不是透明的 SQL 代理：它的地址是公开的，谁都能往里 POST。
所以它只允许操作 `published_app` 一张表，且只允许 DML 与幂等 DDL ——
详见 `cloud-worker/README.md`。

**协议的巧妙之处**：Worker 把 D1 的响应体形状原样吐回来，
所以客户端那一套 `D1Client` / `SharedStore` **一行都不用改**，
直连 D1 和走 Worker 共用同一份实现。

### 三个后端各自的代价

| | local | public | d1 |
| --- | --- | --- | --- |
| 用户零配置 | ✅ | ✅ | ❌ |
| 凭据暴露 | 无 | 无（只在 Worker 侧） | 在用户本机（是他自己的） |
| 需要额外部署 | 无 | **一个 Worker** | 无 |
| 目录是否共享 | ❌ | ✅ | 看连的是哪个库 |
| 依赖在线 | ❌ | ✅（Worker 挂了市场就空） | ✅ |

`public` 是「所有人看到同一份目录」的那一档。
`d1` 是「连自己的库」的那一档 —— 适合自己搭私有目录。
`local` 永远可用，是兜底。

---

## 一之三、已知限制（`public` 档）

| 限制 | 说明 |
| --- | --- |
| **没有身份体系** | 谁都能发布，目录里可能出现垃圾条目 |
| **没有速率限制** | 需要的话在 Cloudflare 后台给 Worker 加 WAF 规则 |
| **删除是无条件的** | `DELETE FROM published_app WHERE id = ?` 不检查发布者 |
| **Worker 是单点** | 它挂了，市场就是空的（私有数据不受影响） |

加身份校验的正确做法见 `cloud-worker/README.md` 的「已知的限制」——
注意**签名密钥不能内置在客户端里**，否则等于没有校验。

---

## 二、共享数据长什么样

只有一张表 `published_app`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PRIMARY KEY | 发布时生成，形如 `app_<时间戳36进制>_<随机>` |
| `name` | TEXT NOT NULL | 展示名 |
| `description` | TEXT NOT NULL | 一句话简介 |
| `author` | TEXT NOT NULL | 作者署名 |
| `manifest` | TEXT NOT NULL | 清单原文（qnote.json 的内容） |
| `repo_url` | TEXT NOT NULL | 源码 / 下载地址 |
| `tags` | TEXT NOT NULL | 标签，逗号分隔 |
| `pulls` | INTEGER NOT NULL | 被「获取」的次数 |
| `created_at` | INTEGER NOT NULL | 发布时间（毫秒时间戳） |
| `updated_at` | INTEGER NOT NULL | 最后更新时间（毫秒时间戳） |

### 为什么字段这么窄

这份数据所有人可见，所以**不能带本机路径、私有笔记内容之类的东西**。
项目代码不上传 —— 发布出去的只有清单与元数据。
别人「获取」时拿到的是清单，代码由用户自己从仓库地址拉。

### 为什么 id 用字符串而不是自增整数

自增 id 在本地库和云端库里是**两套完全不同的编号空间** ——
本地发一条是 id=1，切到 D1 再发一条可能是 id=1（不同库），
切回来又撞。字符串 id 由发布时生成，两边一致，切来切去不会认错。

---

## 三、分层结构

```
src/database/cloud/
  d1Client.ts      D1 REST 客户端 —— 唯一懂 D1 脾气的地方
  d1Store.ts       D1 的 SqlExecutor 实现（直连 / 走 Worker 共用）
  sharedStore.ts   共享存储的接口 + 通用实现 + 本地实现
  config.ts        配置读写 + 后端选择
  defaults.ts      公共目录的默认地址（常量 + 环境变量）
  cloudManager.ts  门面 —— 主进程里所有入口都走它
cloud-worker/      公共目录 Worker —— 服务端（见 cloud-worker/README.md）
  src/guard.ts       SQL 白名单
  src/index.ts       fetch handler
```

### SqlExecutor —— 两个后端的唯一差异

```ts
interface SqlExecutor {
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void>;
}
```

只有两个方法。上面所有查询逻辑都写在 `SharedStoreOnExecutor` 里，
**两个后端一字不差地共用**。

| | 本地 | D1 |
| --- | --- | --- |
| `all` | knex `DB.raw` | 一次 REST 请求，读 `result[0].results` |
| `batch` | knex 真事务 | 一次 REST 请求带 `batch` 数组 |

### batch 才是 D1 上唯一的原子性来源

D1 把每条查询包在自己的隐式事务里，`BEGIN` / `COMMIT` 跨请求无效。
但**一次请求里的多条语句（batch）是一个 SQL 事务**：
任何一条失败，整批回滚。

所以凡是「两条语句要么都成要么都不成」的地方，一律走 `batch`。

---

## 四、D1 的脾气（都影响实现）

`d1Client.ts` 里逐条处理了这些：

1. **写操作不重试。** D1 那边只自动重试只读查询，我们也不重试写 ——
   重试一次写可能变成写两条。只读查询遇到网络故障 / 7429（过载）/
   7500（平台侧事件）会指数退避重试。
2. **鉴权错误不重试。** 10000 / 7403 重试也没用。
3. **PRAGMA 只支持一部分。** `table_info` / `table_list` / `index_list` 有；
   `journal_mode` / `synchronous` / `wal_checkpoint` 没有 ——
   这几个只在本地迁移里用，本地路径不受影响。
4. **参数上限 100 个**，SQL 语句长度上限 100KB，单行上限约 2MB。
   共享表很小，碰不到这些线。
5. **批量语句上限** 免费版 1000 条 / 付费版 10000 条。
6. **D1 自动重试只读查询**，但写查询不重试 —— 与我们的策略一致。

---

## 五、配置与切换

### 配置存哪

存**本地** SQLite 的 `settings` 表，键名 `cloud_storage_config`。

看着别扭 —— 明明是「云端」的配置却存本地 —— 但这是必须的：
配置决定了「用哪个后端」，如果配置本身在云端，
那就是先鸡后蛋（要先连上云端才知道连哪个云端）。
而本地库是一定在的（私有数据都在那儿），所以配置永远读得到。

### 启动顺序

```
1. 本地库就绪（getDB + migrateRun）
2. initCloudStorage(DB)         ← 记下本地库，清掉缓存的共享存储实例
3. registerCloudHandlers()      ← 注册 IPC 通道
4. 第一次用到共享存储时 getStore()
   → 读配置 → 按配置建后端 → 建表
```

### 切换的语义

切换的是**共享存储的后端**，不影响任何私有数据：

- `local` ⇄ `public` ⇄ `d1`：发布目录换一个地方放
- 切到 `d1` 或 `public` 前会先做真实的连通性检查 —— 真发一条查询过去，
  顺带建表（顺便验证写权限）。通不过就不切，让用户留在本地后端上。

理由：填错账号 ID、token 过期、库不存在、网络不通、Worker 挂了 ——
这些都会让云端连不上。切不过却硬切，界面就变成「连不上」的样子，
用户还以为应用坏了。

**D1 建表失败 / 公共目录不可用时退回本地**，不让应用因为云端不可用而起不来。

**D1 建表失败时退回本地**，不让应用因为云端不可用而起不来。

### 密钥

API Token 由用户在设置页填，运行时注入，跟本项目的其它密钥
（百度 OCR、AI API Key）走同一条路 —— 见 AGENTS.md 第 4 节。
**不进仓库、不进版本库。**

---

## 六、发布 / 获取的完整链路

### 发布

```
用户选中本机项目 → 点「发布」→ 填简介 / 作者 / 仓库地址 / 标签
  → cloud:publish-app
  → SharedStore.publish()
  → INSERT ... ON CONFLICT(id) DO UPDATE
```

覆盖发布（带 `existingId`）保留原来的 `pulls` 与 `created_at`。

### 获取

```
市场列表里点「获取」
  → 选一个本机文件夹
  → 写 qnote.json（走 app:write-manifest，主进程会校验，不合法就不落盘）
  → app:import-project 按本机项目的规矩导入
  → cloud:mark-pull 记一次「被获取」
```

**清单仍然写在项目里** —— 跟《应用管理》第七节一致：
清单跟着项目走，项目被拷走也还能被识别。

导入进来的项目跟手工导入的项目没有区别，预览 / 启动都走同一套机制。

---

## 七、IPC 通道

前缀统一 `cloud:`。实现见 `src/main/handlers/cloudHandlers.ts`。

| 通道 | 作用 |
| --- | --- |
| `cloud:get-config` | 读当前配置（界面显示「本地还是云端」） |
| `cloud:save-config` | 保存配置；切 d1 时先做连通性检查 |
| `cloud:switch-backend` | 只切前后端 |
| `cloud:test-connection` | 只做连通性检查，不改配置 |
| `cloud:list-apps` | 列出已发布的 APP |
| `cloud:get-app` | 取一条 |
| `cloud:publish-app` | 发布 / 更新 |
| `cloud:remove-app` | 删除 |
| `cloud:mark-pulled` | 被获取次数加一 |

> 注意 preload 的 tsconfig 把 `rootDir` 钉在 `src/main`，
> 引用 `src/shared` 会报 TS6059。所以 preload 里的类型是就地写的，
> 完整类型声明在 `src/renderer/electron.d.ts`。

---

## 八、测试

六个文件，81 条用例：

| 文件 | 守什么 |
| --- | --- |
| `src/database/cloud/d1Client.test.ts` | D1 的脾气：什么能重试、什么不能、错误怎么冒出来 |
| `src/database/cloud/d1Http.test.ts` | **真 HTTP** 端到端：JSON 真的发出去、真的解析回来 |
| `src/database/cloud/sharedStore.test.ts` | **契约测试** —— 同一套用例跑本地与假 D1 两遍 |
| `src/database/cloud/config.test.ts` | 配置解析的容错 + 读写 |
| `cloud-worker/src/guard.test.ts` | Worker 的 SQL 白名单 |
| `cloud-worker/src/index.test.ts` | Worker 的协议对齐（响应形状跟客户端对得上） |
| `cloud-worker/src/index.live.test.ts` | **真机**回归 —— 对着真的 D1 跑（Worker 没起时跳过） |

### 契约测试是这里最要紧的

共享存储是三后端的 —— 同一份逻辑要跑在本地 SQLite、D1 和公共目录上。
行为只要有一处不一致，就会出现「本地能发布、云端发布不了」这类
只在特定环境下才暴露的问题，而云端需要联网、需要真实账号，平时测不到。

`sharedStore.test.ts` 把行为钉成一份契约，每个后端都跑一遍，
在**不联网**的情况下保证一致。

D1 那侧用「假 D1」执行器 —— 它按 D1 的语义实现，
尤其是 batch 的原子性（一条失败整批回滚，不会只写一半）。

这套测试已经抓到过一个真 bug：用户搜 `%` 时，
LIKE 把它当通配符，整个列表都显示出来了。
现在关键词会转义 `%` / `_` / `\` 并用 `ESCAPE '\'` 声明。

### Worker 的白名单必须有测试

Worker 的地址是**公开的**（内置在客户端里），谁都能往里 POST。
白名单一松，数据库的全权就暴露在公网上了。
`guard.test.ts` 守住「哪些语句能过」，`index.live.test.ts` 守住
「客户端实际发的语句一条都不被误伤」（尤其是 batch 里的 DDL）。

---

## 九、目前的范围

**做了**：

- 三后端共享存储（本地 ⇄ 公共目录 ⇄ 直连 D1），可切换
- D1 REST 客户端（含重试策略、错误映射、超时）
- 公共目录 Worker（受限 SQL 代理，凭据不出服务端）
- 发布 / 浏览 / 获取的完整链路
- 设置页的云端配置卡片 + 连接测试
- 应用页的「应用市场」视图
- 契约测试（各后端行为一致）+ Worker 白名单测试 + 真机回归

**没做**（明确不在当前范围）：

- **没有用户体系**。谁都能发布 —— 目录里可能出现垃圾条目。
- **没有代码上传**。发布出去的只有清单；代码要用户自己从仓库地址拉。
- **没有版本管理**。发布出去的清单是当前这一份，不留历史。
- **没有速率限制**。需要的话在 Cloudflare 后台给 Worker 加 WAF 规则。
- **没有同步**。本地与云端是两个独立的目录，切换不会互相同步。
  要把本地的发布搬到云端，目前得手动重发一遍。

---

## 十、怎么用

### 公共目录（推荐，所有人零配置）

见 `cloud-worker/README.md` —— 部署一个 Worker，把地址填进
`src/database/cloud/defaults.ts` 的 `DEFAULT_CLOUD_ENDPOINT`，重新打包。

### 自建 D1

见下。

```bash
npx wrangler d1 create qnote-apps
# 输出里的 database_id 就是「D1 数据库 ID」
```

### 建 Token

Cloudflare 后台 → API Tokens → Create Token →
Permissions 里勾 `D1` → `Read` + `Write`。

再拿账号 ID（控制台右侧的 Account ID）。

### 填进设置页

设置 → 数据与开发 → 云端存储 → 选「Cloudflare D1」→ 填三项 → 测试连接 → 保存。

切过去之后，「应用」页的「应用市场」标签就是云端那份目录了。

---

## 相关文档

- 《应用管理》—— 清单规范、项目模型：`docs/APP-MANAGEMENT.md`
- AGENTS.md 第 4 节 —— 密钥处理的红线
