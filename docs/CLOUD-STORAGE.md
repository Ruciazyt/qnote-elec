# 云端存储 —— 共享数据放公共目录，私有数据留本地

---

## 一、边界

| 层 | 内容 | 存哪 |
| --- | --- | --- |
| **私有** | 笔记 / 剪贴板 / Todo / AI 对话 / 快捷方式 / 书签 / 题单 / 记忆索引 / 设置 | **永远本地 SQLite**，零改动 |
| **共享** | 已发布的 APP 目录（`published_app`） | 本地 SQLite ⇄ 公共目录，设置页切 |

进云的只有 `published_app` 这一张表。

---

## 二、两种共享后端

| 后端 | 连什么 | 用户要做什么 | 凭据在哪 |
| --- | --- | --- | --- |
| `local` | 本地 SQLite 的 `published_app` 表 | 什么都不用做 | 无 |
| `catalog` | **TiDB Cloud Data Service** 的固定端点（HTTPS 443） | 什么都不用做（连接信息已内置） | **只在 TiDB 侧** |

### 公共目录怎么做到「内置但不暴露」

```
QNote 客户端 ──HTTPS + API Key──> Data Service ──> TiDB 集群
  只有 API Key                    端点 SQL 写死        数据库凭据
```

- 客户端**发不了任意 SQL**。它只能调 Data Service 里那几个固定端点。
- 数据库的用户名密码**永远在 TiDB 侧**，客户端拿不到。
- API Key 只能调已定义的端点，且能在 TiDB Cloud 控制台**一键作废或轮换**。
- 端点域名是 `*.data.tidbcloud.com`（普通 TiDB 域名，实测国内可直连）。

### 为什么把 D1 + Worker 换掉

`*.workers.dev` 在国内被 DNS 污染：每次解析出来的 IP 都不一样，落在 Dropbox / Facebook / Twitter
的 IP 段上，连 1.1.1.1 都返回伪造应答，请求必然超时。这不是代码问题，换个子域也解决不了。

---

## 三、步骤：搭起公共目录

### 1. 注册

打开 <https://tidbcloud.com/onboarding/survey?trigger=signup> 注册账号。

### 2. 建实例

选 **Starter** 套餐。Data Service 只支持 AWS 上的 Starter，区域挑用户近的。
免费额度 5 GiB 行存储 + 每月 5000 万 Request Units。

### 3. 建库建表

两种做法，效果一样：

- **控制台里跑**（推荐）：Data Service 页面中间的 SQL 编辑器，顶部集群下拉选 `public-apps`，
  把 `data-app/schema.sql` 的内容整段粘进编辑器，按 `Shift + Ctrl + Enter` 执行全部语句。
  结果区出现 `Query OK.` 就成了。
- **本地连库**：用 Connect 弹窗里的管理员账号连上去（本地 mysql 客户端或 Web Shell），执行
  `data-app/schema.sql`：

```sql
CREATE DATABASE IF NOT EXISTS qnote_catalog;
USE qnote_catalog;
CREATE TABLE IF NOT EXISTS published_app (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  author VARCHAR(128) NOT NULL DEFAULT '',
  manifest TEXT NOT NULL,
  repo_url VARCHAR(1024) NOT NULL DEFAULT '',
  tags VARCHAR(512) NOT NULL DEFAULT '',
  pulls BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY published_app_updated_at_idx (updated_at DESC)
);
```

### 4. 建 Data App

项目页 → `...` → **Data Service** → **Create Data App**，名字随意，关联上面那个 Starter 实例。

### 5. 建端点

`data-app/` 目录里是现成的 Data App 配置（7 个端点的定义与 SQL）。把它推到 GitHub，
在 Data App 的设置里连上该仓库并开启 Auto Sync & Deployment，就会自动部署。

不想走 GitHub，就在 Data Service 页面点 `+ Create Endpoint` 手工建 7 个，
参数定义与 SQL 照抄 `data-app/http_endpoints/config.json` 与 `data-app/http_endpoints/sql/`。

**每个端点的 SQL 都要先在 SQL 编辑器里跑通再部署。**

参数用占位符引用，**不要自己加引号** —— Data Service 按你在 Params 里声明的类型做替换与转义。
表名一律写全 `qnote_catalog.published_app`，不依赖 `USE` 的会话状态。
LIMIT / OFFSET 直接写占位符：`LIMIT ${limit} OFFSET ${offset};`。
**不要**写成 `CAST(${limit} AS UNSIGNED)` —— Data Service 的 SQL 校验器不认，
部署时报 `Parsing sql failed ... near "CAST(? AS UNSIGNED)"`。

#### 端点清单

| 端点 | 方法 | 参数 | 作用 |
| --- | --- | --- | --- |
| `/apps_list` | GET | `keyword`(string) `limit`(int) `offset`(int) | 列目录 |
| `/apps_count` | GET | `keyword`(string) | 总数 |
| `/apps_get` | GET | `id`(string) | 取一条 |
| `/apps_publish` | POST | `id` `name` `description` `author` `manifest` `repo_url` `tags`(string) `pulls` `created_at` `updated_at`(int) | 新发布 |
| `/apps_update` | POST | `id` `name` `description` `author` `manifest` `repo_url` `tags`(string) `updated_at`(int) | 覆盖发布 |
| `/apps_remove` | POST | `id`(string) | 删除 |
| `/apps_mark_pulled` | POST | `id`(string) | 被获取次数 +1 |

SQL 全文在 `data-app/http_endpoints/sql/`。覆盖发布那条不碰 `pulls` 与 `created_at`。

### 6. 建 API Key

Data App 详情页 → Authentication → **Create API Key**，角色选 `ReadAndWrite`（要发布就得能写），
限流默认 100 rpm。**Private Key 只在创建时显示一次**，复制下来。

### 7. 接进 QNote

**用户零配置**：正式版把公共目录的连接信息一起打包，用户装上就是「公共目录」模式，什么都不用填。
想换成自己的目录，在设置 → 数据与开发 → 云端存储 里改四个字段（站点地址 / App ID / Public Key /
Private Key），或者点那里的「公共目录说明」看步骤。

**凭据怎么进包的**（私钥不进仓库）：`scripts/build/inject-catalog-credentials.js` 在打包前把凭据写到
`resources/catalog/credentials.json`（该目录在 `.gitignore` 里），主进程运行时从
`process.resourcesPath/catalog/credentials.json` 读。四项来源二选一：

| 来源 | 用法 |
| --- | --- |
| 环境变量 | `QNOTE_CATALOG_BASE_URL` / `QNOTE_CATALOG_APP_ID` / `QNOTE_CATALOG_PUBLIC_KEY` / `QNOTE_CATALOG_PRIVATE_KEY`（CI 里用仓库 Secrets 注入） |
| 本地文件 | `.data/catalog-credentials.json`（同样在 `.gitignore` 里） |

打包脚本会自动调它（`scripts/build/build-app.js`），也可以单独跑
`node scripts/build/inject-catalog-credentials.js`。四项缺任何一项，打包出来的应用里「公共目录」
就是空的 —— 脚本会打印警告。

站点地址是**区域站点**，形如 `https://ap-northeast-1.data.tidbcloud.com`。在 Data App 的端点列表里点开
任一端点，复制 Properties 面板里的 `Endpoint URL`：`.../api/v1beta/app/` 前半段是站点地址，
`/app/` 与 `/endpoint` 中间那段是 App ID。

---

## 四、信息

### 客户端调的端点

| 操作 | 方法 | 路径 | 参数位置 |
| --- | --- | --- | --- |
| 列目录 | GET | `/apps_list` | query |
| 总数 | GET | `/apps_count` | query |
| 取一条 | GET | `/apps_get` | query |
| 新发布 | POST | `/apps_publish` | body |
| 覆盖发布 | POST | `/apps_update` | body |
| 删除 | POST | `/apps_remove` | body |
| 被获取次数 +1 | POST | `/apps_mark_pulled` | body |

### 端点地址怎么拼

```
{站点地址}/api/v1beta/app/{App ID}/endpoint{路径}
```

### 认证

Basic 认证，`Public Key` 是用户名，`Private Key` 是密码：

```
Authorization: Basic base64(PublicKey:PrivateKey)
```

### 响应长什么样

```json
{
  "type": "sql_endpoint",
  "data": {
    "columns": [{ "col": "id", "data_type": "VARCHAR", "nullable": false }],
    "rows": [{ "id": "app_1", "name": "番茄钟", "pulls": 3 }],
    "result": { "code": 200, "message": "Query OK", "row_count": 1, "row_affect": 0 }
  }
}
```

**HTTP 200 不等于成功** —— `data.result.code` 才是。`200` 是成功，`1146` 是表不存在，
`400` 是参数对不上（param check failed）。

### 表结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `VARCHAR(64)` PRIMARY KEY | 发布时生成，形如 `app_<时间戳36进制>_<随机>` |
| `name` | `VARCHAR(255)` | 展示名 |
| `description` | `TEXT` | 一句话简介 |
| `author` | `VARCHAR(128)` | 作者署名 |
| `manifest` | `TEXT` | 清单原文（plugin.json 的内容） |
| `repo_url` | `VARCHAR(1024)` | 源码 / 下载地址 |
| `tags` | `VARCHAR(512)` | 标签，逗号分隔 |
| `pulls` | `BIGINT` | 被「获取」的次数 |
| `created_at` | `BIGINT` | 发布时间（毫秒时间戳） |
| `updated_at` | `BIGINT` | 最后更新时间（毫秒时间戳） |

### 关键词转义

客户端把关键词里的反斜杠、百分号、下划线转义后传出去，通配符由服务端用
`CONCAT('%', ..., '%')` 包。MySQL 的 LIKE 默认转义符是反斜杠，和本地 SQLite 那边的
`ESCAPE '\'` 语义一致。

### 目录结构

```
src/database/cloud/
  catalogClient.ts   公共目录 HTTP 客户端（Basic 认证 + 响应解析 + 错误映射）
  catalogStore.ts    SharedStore 实现：操作 → 固定端点
  sharedStore.ts     SharedStore 接口 + 本地 SQLite 实现
  config.ts          配置读写 + 后端选择
  defaults.ts        内置的公共目录连接信息（常量 + 注入的凭据文件 + 环境变量）
  cloudManager.ts    门面 —— 主进程里所有入口都走它
src/shared/cloud/cloudTypes.ts   跨端类型
data-app/                          Data App 配置（端点定义 + SQL），部署时推给 TiDB Cloud
scripts/build/inject-catalog-credentials.js  打包前把公共目录凭据写进 resources/catalog/
```

### 环境变量

运行时覆盖，开发与自建部署时用：

| 变量 | 说明 |
| --- | --- |
| `QNOTE_CATALOG_BASE_URL` | 站点地址，如 `https://us-west-2.data.tidbcloud.com` |
| `QNOTE_CATALOG_APP_ID` | Data App 的 App ID |
| `QNOTE_CATALOG_PUBLIC_KEY` | API Key 的 Public Key |
| `QNOTE_CATALOG_PRIVATE_KEY` | API Key 的 Private Key |

四项齐了才启用 `catalog` 后端 —— 内置凭据文件或环境变量提供都行，缺任何一项就退回 `local`。

### IPC 通道

| 通道 | 作用 |
| --- | --- |
| `cloud:get-config` | 读当前配置（界面显示「本地还是云端」） |
| `cloud:save-config` | 保存配置；切 `catalog` 时先做连通性检查 |
| `cloud:switch-backend` | 只切前后端 |
| `cloud:test-connection` | 只做连通性检查，不改配置 |
| `cloud:list-apps` | 列出已发布的 APP |
| `cloud:get-app` | 取一条 |
| `cloud:publish-app` | 发布 / 更新 |
| `cloud:remove-app` | 删除 |
| `cloud:mark-pulled` | 被获取次数加一 |

### 测试

| 文件 | 守什么 |
| --- | --- |
| `src/database/cloud/sharedStore.test.ts` | 本地后端的契约测试 |
| `src/database/cloud/catalogStore.test.ts` | 公共目录的契约测试 + 端点映射断言 |
| `src/database/cloud/catalogClient.test.ts` | 地址拼装、Basic 认证、响应解析、错误映射 |
| `src/database/cloud/config.test.ts` | 配置解析的容错 + 读写 |
| `src/database/cloud/cloudManager.test.ts` | 云端错误到人话的映射 |

### 已知限制

| 限制 | 说明 |
| --- | --- |
| **Data Service 是预览版** | 只支持 AWS 上的 Starter 实例 |
| **只支持 GET / POST** | Data Service 不接受别的请求方法 |
| **限流 100 rpm** | 每个 API Key 每分钟 100 次，可在控制台调到 1000 |
| **必须用区域域名** | 全局域名 `data.tidbcloud.com` 会 307 跳到区域域名；跨域跳转按 Fetch 规范会丢掉 `Authorization` 头，跳转目标在公司 DNS 下还可能解析不到 |
| **企业 DNS 偶发解析失败** | 区域域名在部分企业内网 DNS 下会间歇性解析超时（Lenovo 内网实测），公共 DNS 正常，重试即可 |
| **列目录发两次请求** | 一次取列表，一次取总数（与本地实现一致） |
| **没有身份体系** | 谁都能发布，目录里可能出现垃圾条目 |
| **删除是无条件的** | DELETE 不检查发布者 |
| **没有速率限制** | 需要的话在 TiDB Cloud 侧加 |
| **没有同步** | 本地与云端是两个独立的目录，切换不会互相同步 |
| **Private Key 跟着安装包走** | 它只能调已定义的端点，出事可以在控制台作废；用户也能从安装包里提取出来 |
| **公共目录是共享的** | 谁都能往里发布条目，没有身份体系与审核 |

---

## 相关文档

- 《应用管理》—— 清单规范、项目模型：`docs/APP-MANAGEMENT.md`
- AGENTS.md 第 4 节 —— 密钥处理的红线
