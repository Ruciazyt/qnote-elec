# QNote 公共目录 —— Worker 部署说明

> 这个 Worker 是「公共 APP 目录」的服务端。用户零配置就能连上，
> 凭据不出 Cloudflare。
>
> 完整设计见 `docs/CLOUD-STORAGE.md`。

---

## 一、为什么需要它

「所有用户零配置连上同一个云端目录」，客户端总得有个凭据。
而 D1 的 API Token 是**账号级**的（Cloudflare 文档原话：
"A Cloudflare API token with D1 access is account-wide"），
控制台里也**没法**只授权到单个库 ——

```
客户端 ──HTTP──> Worker ──D1 绑定──> D1 数据库
  无凭据        凭据不出服务端       只放 published_app
```

Worker 用 **D1 绑定**（`env.DB`）直连数据库，这一步根本不需要 Token。
客户端只内置 Worker 的**公开地址**（不是密钥，可以随便内置）。

---

## 二、部署

### 1. 建 D1 库

```bash
cd cloud-worker
npx wrangler login          # 首次要登录
npx wrangler d1 create qnote-apps
```

输出里这串就是 **database_id**：

```
🌀 Creating D1 database 'qnote-apps'...
Created D1 database 'qnote-apps'!
[[d1_databases]]
binding = "DB"
database_name = "qnote-apps"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 2. 填进 wrangler.jsonc

把 `database_id` 那一行的 `"在这里填 database_id"` 换成真值。

### 3. 部署

```bash
npx wrangler deploy
```

输出里会有一个地址：

```
Uploaded qnote-catalog
Deployed qnote-catalog triggers
  https://qnote-catalog.<你的子域>.workers.dev
Current Version ID: xxxx
```

**这个地址就是给客户端用的公开地址。**

### 4. 灌给客户端

把那个地址填进 `src/database/cloud/defaults.ts` 的 `DEFAULT_CLOUD_ENDPOINT`，
然后重新打包。

> 为什么不是「CI 里设个环境变量就行」：主进程是 **tsc** 编译的（不是 esbuild），
> `process.env.X` 是在**运行时**读的 —— 打包时它不会被固定进安装包。
> 环境变量那一条只对开发期和「从源码直接跑」有效。

（`process.env.QNOTE_CLOUD_ENDPOINT` 仍然可用，用来在不改源码的情况下
临时切地址 —— 比如本地对着 `wrangler dev` 调试。）

### 5. 验证

```bash
curl -X POST "https://qnote-catalog.<你的子域>.workers.dev" \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT 1 AS ok"}'
```

返回 `{"success":true,"result":[{"success":true,"results":[{"ok":1}],...}]}` 就通了。

---

## 三、这个 Worker 允许什么

它**不是**透明的 SQL 代理 —— 它的地址是公开的（内置在客户端里），
谁都能往里 POST。所以它只允许：

| 允许 | 拒绝 |
| --- | --- |
| `SELECT … FROM published_app` | 其它任何表 |
| `INSERT INTO published_app` | `DROP` / `ALTER` / `PRAGMA` / `VACUUM` |
| `UPDATE published_app` | 一次发多条语句（`;`） |
| `DELETE FROM published_app` | `CREATE TABLE` 以外的 DDL |
| `CREATE TABLE/INDEX IF NOT EXISTS published_app…` | |

被拒绝的请求会返回 400 和一句中文原因。

**为什么这么紧**：公共目录用的那个 D1 库**只放 `published_app` 一张表**。
即使有人找到这个地址、绕过上面的检查，他的破坏范围也仅限这张公开表。
DDL 被拦掉，所以表结构改不了 —— 迁移由部署时的一次性脚本做。

---

## 四、已知的限制

| 限制 | 说明 |
| --- | --- |
| **没有身份体系** | 谁都能发布。目录里可能出现垃圾条目 |
| **没有速率限制** | 需要的话在 Cloudflare 后台给这个 Worker 加 WAF 规则 |
| **写操作没有审计** | Worker 的 observability 已开，能在后台看日志 |
| **删除是无条件的** | `DELETE FROM published_app WHERE id = ?` 不检查发布者 |

### 加发布者校验

如果不想让陌生人往目录里灌东西，在 `src/index.js` 的
`checkStatement` 之后加一道身份校验即可 —— 常见做法：

- Cloudflare Access（Workers 有内置支持）
- Worker 里校验一个 HMAC 签名头

但注意：**签名密钥不能内置在客户端里**，否则等于没有校验。
所以更现实的做法是用 Cloudflare Access（走 OAuth）或
「先在网页版登录换一枚短期 Token」的方案。

---

## 五、成本

Worker 免费额度足够：公共目录的读写量很小
（每次打开市场页一次读，每次发布一次写）。

D1 侧免费额度是每天 500 万行读 / 10 万行写 ——
发布目录这种规模远远用不满。

---

## 六、本地开发

```bash
cd cloud-worker
npx wrangler dev            # 本地跑 Worker，用的是本地 D1 副本
```

本地模式下的 D1 是 miniflare 里的 SQLite，语义跟线上基本一致
（batch 的事务性、PRAGMA 支持范围都能验）。
