# QNote 公共目录 —— Data App 配置文件

TiDB Cloud Data App 的声明式配置。推到 GitHub 并在 TiDB Cloud 里连上该仓库，
这 7 个端点会自动部署。

**线上那个公共目录（集群 `public-apps`、Data App「New App」）走的是手工那条路** ——
端点在控制台里建、逐个点 Deploy 维护，没接 GitHub：推这个仓库不会触发部署。
改了端点 SQL 要去控制台里改对应端点再点 Deploy，这里的 `http_endpoints/` 是对账用的副本。

---

## 一、步骤

### 1. 建集群

TiDB Cloud → New Cluster → **Starter**（Data Service 只支持托管在 AWS 上的 Starter）。
建好后从 URL 取集群 ID：`https://tidbcloud.com/tidbs/<集群 ID>/overview`。
填进 `data_sources/cluster.json`。

### 2. 建表

用 Connect 弹窗里的管理员账号连上去（Web Shell 或本地 mysql 客户端），执行 `schema.sql`。

### 3. 建 Data App 并连 GitHub

TiDB Cloud → 项目 → Data Service → **Create Data App**，关联第 1 步的集群，
勾选 **Connect to GitHub**，指定仓库、分支、目录（目录要以 `/` 开头，例如 `/qnote-catalog`）。

创建完成后，TiDB Cloud 会把一份配置文件推到那个目录：

```
data_sources/cluster.json
dataapp_config.json
http_endpoints/config.json
http_endpoints/sql/<method>-<endpoint-path>.sql
```

**保留它推上来的 `data_sources/cluster.json` 与 `dataapp_config.json`**（里面是真 ID），
把本目录的 `http_endpoints/` 整个替换过去，提交推送。
开了 Auto Sync & Deployment 就会自动部署。

没连 GitHub 的话，在 Data Service 页面点 `+ Create Endpoint` 手工建，
参数定义与 SQL 直接照抄 `http_endpoints/config.json` 和 `http_endpoints/sql/`。

### 4. 建 API Key

Data App 详情页 → Authentication → **Create API Key**，角色选 `ReadAndWrite`（要发布就得能写），
限流默认 100 rpm。**Private Key 只显示一次**，复制下来。

### 5. 接进 QNote

连接信息是**构建期注入**的，用户那边装好就能用，设置页不提供填写入口：

- 把四个值放进 `.data/catalog-credentials.json`，或设环境变量
  `QNOTE_CATALOG_BASE_URL` / `QNOTE_CATALOG_APP_ID` /
  `QNOTE_CATALOG_PUBLIC_KEY` / `QNOTE_CATALOG_PRIVATE_KEY`
- 打包时 `scripts/build/inject-catalog-credentials.js` 写进 `resources/catalog/credentials.json`
- 主进程运行时读它；可用 `QNOTE_CATALOG_*` 换一套自己的目录

站点地址是区域站点，形如 `https://us-west-2.data.tidbcloud.com`，
从端点详情页的 Endpoint URL 里取前半段。

### 6. 补一列：资源包 `bundle`

发布时可以把项目文件一起传上去（别人「获取」时直接能跑）。这一列建表脚本里已经有了，
但**已建好的库要手动补一次**，在 Data Service 页面中间的 SQL 编辑器里跑：

```sql
ALTER TABLE qnote_catalog.published_app ADD COLUMN bundle MEDIUMTEXT NULL;
```

列必须是可空的：TiDB 不给 TEXT/BLOB 列设默认值，而老版本客户端发布时不带 `bundle` 参数，
列要是 NOT NULL 又没默认值，严格模式下那条 INSERT 会直接报 `Field 'bundle' doesn't have a default value`。
新建的表用 `schema.sql` 建，本来就是可空的。

没补这一列也能发布 —— 客户端发现端点不认 `bundle` 就会退回「只发清单」，
不会报错。端点定义在 `http_endpoints/`，改完推 GitHub，Auto Sync & Deployment 会自动部署。

线上那个公共目录（集群 `public-apps`）的这一列已在 2026-11-20 补好，上面那条只在新建库时才需要再跑一次。
**建列要排在部署端点之前** —— 端点 SQL 里 `bundle` 进了 INSERT 的列清单，列还不存在时发布会整个失败。

### 7. 补两列：版本 `version` 与依赖 `dependencies`

市场条目要带上插件版本与依赖（清单里的 `extensionDependencies`），这两列在已建好的库里要手动补一次，
在 Data Service 页面中间的 SQL 编辑器里跑：

```sql
ALTER TABLE qnote_catalog.published_app ADD COLUMN version VARCHAR(32) NULL;
ALTER TABLE qnote_catalog.published_app ADD COLUMN dependencies TEXT NULL;
```

两列都**必须可空**：TiDB 不给 TEXT 列设默认值，而老客户端发布时不带这两个参数，
列要是 NOT NULL 又没默认值，严格模式下那条 INSERT 会直接报 `Field 'version' doesn't have a default value`。

**建列要排在部署端点之前** —— 端点 SQL 里 `version` 与 `dependencies` 进了 INSERT 的列清单，
列还不存在时发布会整个失败，客户端的退回逻辑救不回来。

老记录没有这两列时，客户端按空版本、空依赖处理。

### 8. 已知限制：清单里的本机地址发不出去

公共目录前面挂的是 AWS ALB，它会扫整个请求，只要出现**指向 IP 字面量的链接**
（`http://127.0.0.1:7799/`、`http://10.0.0.1`）就返回 `403 Forbidden`（HTML，不是 JSON）。
纯主机名 `http://localhost` 与不带 scheme 的 `127.0.0.1:7799` 不受影响。

QNote 自己的清单现在把 `preview` 写成端口号（`"preview": 7799`），不带 IP 字面量，
所以发布不会被拦。

---

## 二、信息

### 端点

| 端点 | 方法 | 参数 | 作用 |
| --- | --- | --- | --- |
| `/apps_list` | GET | keyword(string) limit(int) offset(int) | 列目录 |
| `/apps_count` | GET | keyword(string) | 总数 |
| `/apps_get` | GET | id(string) | 取一条 |
| `/apps_publish` | POST | id name description author manifest repo_url tags bundle version dependencies(string) pulls created_at updated_at(int) | 新发布 |
| `/apps_update` | POST | id name description author manifest repo_url tags bundle version dependencies(string) updated_at(int) | 覆盖发布 |
| `/apps_remove` | POST | id(string) | 删除 |
| `/apps_mark_pulled` | POST | id(string) | 被获取次数 +1 |

参数位置由方法决定：GET 进 query string，POST 进 JSON body。

### 端点地址

```
{站点地址}/api/v1beta/app/{App ID}/endpoint{路径}
```

### 写 SQL 时的几条硬规矩

- **占位符不要自己加引号**。`string` 类型的 `${keyword}` 会被替换成 `"keyword"`；
  自己加引号会变成 `""keyword""`。`integer` 类型同理，直接写 `${limit}`。
- **LIMIT / OFFSET 里的整数参数用 `CAST(${limit} AS UNSIGNED)` 包一层**，
  免得被替换成带引号的字符串。
- **表名写全 `qnote_catalog.published_app`**，不依赖 `USE` 的会话状态。
- **关键词的通配符由服务端包**：客户端把 `\` `%` `_` 转义好传过来，
  服务端用 `CONCAT('%', ..., '%')` 包，MySQL 的 LIKE 默认转义符就是反斜杠。
- **多语句只返回最后一句的结果**，所以 `USE` 放最前面、查询放最后。

### 表结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | VARCHAR(64) PRIMARY KEY | 形如 `app_<时间戳36进制>_<随机>` |
| `name` | VARCHAR(255) | 展示名 |
| `description` | TEXT | 一句话简介 |
| `author` | VARCHAR(128) | 作者署名 |
| `manifest` | TEXT | 清单原文 |
| `repo_url` | VARCHAR(1024) | 源码 / 下载地址 |
| `tags` | VARCHAR(512) | 标签，逗号分隔 |
| `bundle` | MEDIUMTEXT | 项目文件资源包（base64），空串表示只发清单 |
| `version` | VARCHAR(32) NULL | 插件版本，可空（老发布记录没有） |
| `dependencies` | TEXT NULL | 依赖列表，JSON 数组，如 `[{"id":"a.b","range":"^1.0.0"}]` |
| `pulls` | BIGINT | 被获取次数 |
| `created_at` | BIGINT | 发布时间（毫秒时间戳） |
| `updated_at` | BIGINT | 最后更新时间（毫秒时间戳） |

### 目录结构

```
data-app/
  README.md
  schema.sql                        建表 DDL，手动执行一次
  data_sources/cluster.json         关联的集群 ID
  dataapp_config.json               Data App 的 ID / 名称 / 版本
  http_endpoints/config.json        7 个端点的定义
  http_endpoints/sql/*.sql          7 个端点的 SQL
```

### 限制

| 限制 | 说明 |
| --- | --- |
| Data Service 是预览版 | 只支持 AWS 上的 Starter 实例 |
| 限流 100 rpm | 每个 API Key 每分钟 100 次，可调到 1000 |
| 没有身份体系 | 谁都能发布，目录里可能出现垃圾条目 |
| 删除是无条件的 | 不检查发布者 |
| 没有同步 | 本地与云端是两个独立目录 |
