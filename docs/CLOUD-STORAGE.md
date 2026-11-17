# 云端存储 —— 共享数据放 D1，私有数据留本地


---

## 一、为什么是「双层」而不是「整个库搬上云」


| D1 的限制 | 撞上什么 |
| --- | --- |
| 没有交互式事务 | 本地有 3 处 `DB.transaction`，其中「删会话」那处真的需要原子性 |
| 单行上限约 2MB | `note.content` 存剪贴板图片的 base64，单条几百 KB 起 |
| 免费额度每日 500 万行读 | 剪贴板每 2 秒查一次去重，一天就是几万次查询 |
| 每次查询一次网络往返 | 剪贴板监听这种高频路径扛不住 |
| 外键**永远**开启 | 本地 SQLite 默认关着，行为会变 |


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



---

## 一之二、三种共享后端


| 后端 | 连什么 | 用户要做什么 | 凭据在哪 |
| --- | --- | --- | --- |
| `local` | 本地 SQLite 的 `published_app` 表 | 什么都不用做 | 无 |
| `public` | **公共目录 Worker 代理** | 什么都不用做（地址已内置） | **只在 Worker 侧** |
| `d1` | 直连 Cloudflare D1 REST | 填账号 ID / 库 ID / Token | 在用户本机 |

### 为什么有「公共目录」这一档



### 公共目录的解法：Worker 代理

```
   QNote 客户端 ──HTTP──> Worker ──D1 绑定──> D1 数据库
      无凭据               凭据不出服务端        只放 published_app
```




### 三个后端各自的代价

| | local | public | d1 |
| --- | --- | --- | --- |
| 用户零配置 | ✅ | ✅ | ❌ |
| 凭据暴露 | 无 | 无（只在 Worker 侧） | 在用户本机（是他自己的） |
| 需要额外部署 | 无 | **一个 Worker** | 无 |
| 目录是否共享 | ❌ | ✅ | 看连的是哪个库 |
| 依赖在线 | ❌ | ✅（Worker 挂了市场就空） | ✅ |


---

## 一之三、已知限制（`public` 档）

| 限制 | 说明 |
| --- | --- |
| **没有身份体系** | 谁都能发布，目录里可能出现垃圾条目 |
| **没有速率限制** | 需要的话在 Cloudflare 后台给 Worker 加 WAF 规则 |
| **删除是无条件的** | `DELETE FROM published_app WHERE id = ?` 不检查发布者 |
| **Worker 是单点** | 它挂了，市场就是空的（私有数据不受影响） |


---

## 二、共享数据长什么样


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


### 为什么 id 用字符串而不是自增整数


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


| | 本地 | D1 |
| --- | --- | --- |
| `all` | knex `DB.raw` | 一次 REST 请求，读 `result[0].results` |
| `batch` | knex 真事务 | 一次 REST 请求带 `batch` 数组 |

### batch 才是 D1 上唯一的原子性来源



---

## 四、D1 的脾气（都影响实现）


1. **写操作不重试。** D1 那边只自动重试只读查询，我们也不重试写 ——
2. **鉴权错误不重试。** 10000 / 7403 重试也没用。
3. **PRAGMA 只支持一部分。** `table_info` / `table_list` / `index_list` 有；
4. **参数上限 100 个**，SQL 语句长度上限 100KB，单行上限约 2MB。
5. **批量语句上限** 免费版 1000 条 / 付费版 10000 条。
6. **D1 自动重试只读查询**，但写查询不重试 —— 与我们的策略一致。

---

## 五、配置与切换

### 配置存哪



### 启动顺序

```
1. 本地库就绪（getDB + migrateRun）
2. initCloudStorage(DB)         ← 记下本地库，清掉缓存的共享存储实例
3. registerCloudHandlers()      ← 注册 IPC 通道
4. 第一次用到共享存储时 getStore()
   → 读配置 → 按配置建后端 → 建表
```

### 切换的语义


- `local` ⇄ `public` ⇄ `d1`：发布目录换一个地方放
- 切到 `d1` 或 `public` 前会先做真实的连通性检查 —— 真发一条查询过去，




### 密钥


---

## 六、发布 / 获取的完整链路

### 发布

```
用户选中本机项目 → 点「发布」→ 填简介 / 作者 / 仓库地址 / 标签
  → cloud:publish-app
  → SharedStore.publish()
  → INSERT ... ON CONFLICT(id) DO UPDATE
```


### 获取

```
市场列表里点「获取」
  → 选一个本机文件夹
  → 写 qnote.json（走 app:write-manifest，主进程会校验，不合法就不落盘）
  → app:import-project 按本机项目的规矩导入
  → cloud:mark-pull 记一次「被获取」
```



---

## 七、IPC 通道


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


---

## 八、测试


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





### Worker 的白名单必须有测试


---

## 九、目前的范围


- 三后端共享存储（本地 ⇄ 公共目录 ⇄ 直连 D1），可切换
- D1 REST 客户端（含重试策略、错误映射、超时）
- 公共目录 Worker（受限 SQL 代理，凭据不出服务端）
- 发布 / 浏览 / 获取的完整链路
- 设置页的云端配置卡片 + 连接测试
- 应用页的「应用市场」视图
- 契约测试（各后端行为一致）+ Worker 白名单测试 + 真机回归


- **没有用户体系**。谁都能发布 —— 目录里可能出现垃圾条目。
- **没有代码上传**。发布出去的只有清单；代码要用户自己从仓库地址拉。
- **没有版本管理**。发布出去的清单是当前这一份，不留历史。
- **没有速率限制**。需要的话在 Cloudflare 后台给 Worker 加 WAF 规则。
- **没有同步**。本地与云端是两个独立的目录，切换不会互相同步。

---

## 十、怎么用

### 公共目录（推荐，所有人零配置）


### 自建 D1


```bash
npx wrangler d1 create qnote-apps
# 输出里的 database_id 就是「D1 数据库 ID」
```

### 建 Token



### 填进设置页



---

## 相关文档

- 《应用管理》—— 清单规范、项目模型：`docs/APP-MANAGEMENT.md`
- AGENTS.md 第 4 节 —— 密钥处理的红线
