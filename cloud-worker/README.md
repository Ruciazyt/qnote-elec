# QNote 公共目录 —— Worker 部署说明


---

## 一、为什么需要它


```
客户端 ──HTTP──> Worker ──D1 绑定──> D1 数据库
  无凭据        凭据不出服务端       只放 published_app
```


---

## 二、部署

### 1. 建 D1 库

```bash
cd cloud-worker
npx wrangler login          # 首次要登录
npx wrangler d1 create qnote-apps
```


```
🌀 Creating D1 database 'qnote-apps'...
Created D1 database 'qnote-apps'!
[[d1_databases]]
binding = "DB"
database_name = "qnote-apps"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 2. 填进 wrangler.jsonc


### 3. 部署

```bash
npx wrangler deploy
```


```
Uploaded qnote-catalog
Deployed qnote-catalog triggers
  https://qnote-catalog.<你的子域>.workers.dev
Current Version ID: xxxx
```


### 4. 灌给客户端




### 5. 验证

```bash
curl -X POST "https://qnote-catalog.<你的子域>.workers.dev" \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT 1 AS ok"}'
```


---

## 三、这个 Worker 允许什么


| 允许 | 拒绝 |
| --- | --- |
| `SELECT … FROM published_app` | 其它任何表 |
| `INSERT INTO published_app` | `DROP` / `ALTER` / `PRAGMA` / `VACUUM` |
| `UPDATE published_app` | 一次发多条语句（`;`） |
| `DELETE FROM published_app` | `CREATE TABLE` 以外的 DDL |
| `CREATE TABLE/INDEX IF NOT EXISTS published_app…` | |



---

## 四、已知的限制

| 限制 | 说明 |
| --- | --- |
| **没有身份体系** | 谁都能发布。目录里可能出现垃圾条目 |
| **没有速率限制** | 需要的话在 Cloudflare 后台给这个 Worker 加 WAF 规则 |
| **写操作没有审计** | Worker 的 observability 已开，能在后台看日志 |
| **删除是无条件的** | `DELETE FROM published_app WHERE id = ?` 不检查发布者 |

### 加发布者校验


- Cloudflare Access（Workers 有内置支持）
- Worker 里校验一个 HMAC 签名头


---

## 五、成本



---

## 六、本地开发

```bash
cd cloud-worker
npx wrangler dev            # 本地跑 Worker，用的是本地 D1 副本
```

