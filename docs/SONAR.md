# SonarQube Cloud 质量门禁





---

## 1. 为什么要有这套东西


1. **分析范围没定义** —— 仓库里原先没有 `sonar-project.properties`，扫描全靠默认值，
2. **没有门禁** —— 问题只会被"看见"，不会被"卡住"。现在发版前会查一次，
3. **本地没有反馈** —— 现在 `pnpm run sonar:issues` 一条命令就能拿到清单，

---

## 2. 令牌配置


### 2.1 生成令牌



| 项 | 值 |
| --- | --- |
| Name | `qnote-ci` |
| Type | **User Token**（脚本既要跑扫描、又要查 issue API，User Token 权限最全） |
| Expiration | 按需（别设太短，免得到期把流水线搞挂） |



### 2.2 三种投放方式




```bash
# PowerShell
$env:SONAR_TOKEN = '你的令牌'
```


```bash
# 目录 .data/ 整个在 .gitignore 里，不会进仓库
mkdir -p .data/sonar
echo '你的令牌' > .data/sonar/token
```



---

## 3. 三个命令

| 命令 | 干什么 | 需要 Java 吗 |
| --- | --- | --- |
| `pnpm run sonar:issues` | 拉 SonarCloud 上未解决的 issue，出清单（不阻断） | 否 |
| `pnpm run verify:sonar` | 同上，但命中拦截级别就退出码 1 | 否 |
| `pnpm run sonar:local` | **本地现扫**（SonarJS 规则），出清单 | 否 |
| `pnpm run sonar:scan` | **本机跑一次完整扫描**，把结果传上去 | 是（JDK 17+） |
| `pnpm run lint` / `lint:fix` | 底层 ESLint 命令（`eslint .`） | 否 |
| `pnpm run test:coverage` | 跑测试并产出 lcov 覆盖率报告 | 否 |

### 3.1 没有令牌时：本地扫描


```bash
pnpm run sonar:local          # 清单写到 .data/sonar/local-issues.md
pnpm run sonar:local -- --gate   # 有 error 就退出码 1
```


| 文件 | 作用 |
| --- | --- |
| `eslint.config.mjs` | flat config，规则是**挑过的**：只开缺陷类与安全类 |
| `tsconfig.lint.json` | 类型感知规则（null-dereference 等）用的 tsconfig |



| | `sonar:issues` | `sonar:local` |
| --- | --- | --- |
| 数据来源 | SonarCloud 上**最近一次分析** | 本机现扫 |
| 需要令牌 | 是 | 否 |
| 跨文件数据流 | 有 | 没有 |
| 覆盖率 | 有 | 没有 |
| 安全热点 | 有（需人工复核结论） | 没有 |



- JDK：<https://adoptium.net/>
- scanner CLI：<https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/>，


---

## 4. 分析范围与配额

### 4.1 免费额度是硬约束


```
This analysis will make your organization 'ruciazyt' reach the maximum
allowed lines limit of 50000. Current LOC usage is: 0. LOC count in this
analysis: 60669.
```




### 4.2 ⚠️ 不要设 `sonar.tests`


| 写法 | 现象 |
| --- | --- |
| `sonar.tests` 与 `sonar.sources` **完全相同** | Sonar 判定范围冲突，放弃这份额定、**退回扫描整个仓库** —— LOC 一直 60700+，超配额被拒。改 `exclusions`、`inclusions` 全都不管用。 |
| `sonar.tests` 指向某个 sources 目录的**子目录** | Sonar 为避免「文件被索引两次」把**整个父目录**踢出范围。实测只剩 98 个文件、`ncloc` 16522 —— 渲染层一行都没扫。 |


### 4.3 ⚠️ 组织开着「自动分析」，CI 扫描会被挡



```
ERROR You are running CI analysis while Automatic Analysis is enabled.
      Please consider disabling one or the other.        (exit code 3)
```



```
POST /api/settings/set  key=sonar.autoscan.enabled  component=<项目>   → Setting cannot be set on a Project
POST /api/settings/set  key=sonar.autoscan.enabled  component=ruciazyt → Component key 'ruciazyt' not found
```

### 4.4 当前的覆盖范围（**未解决**）



- ❌ properties 没被读到 —— scanner 日志里明确写着
- ❌ 多目录写法不支持 —— `sonar.sources=src`（单目录）与四个目录（多目录）结果一样
- ❌ `sonar.tests` 导致 —— 现在根本设了 `sonar.tests`
- ⚠️ `src/renderer` 自带 `package.json`，可能被 Sonar 当成**独立模块**而剔除


### 4.5 改了范围怎么确认生效


```bash
# 取令牌（.data/sonar/token 里第一条非注释行）
curl -s -H "Authorization: Bearer $TOKEN" \
  'https://sonarcloud.io/api/measures/component?component=Ruciazyt_qnote-elec&metricKeys=ncloc,files'
```


```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  'https://sonarcloud.io/api/ce/activity?component=Ruciazyt_qnote-elec&ps=5'
```


---

## 5. 清单怎么看


```
.data/sonar/sonar-issues.md     # 人读：概览 + 逐条问题 + SonarCloud 链接
.data/sonar/sonar-issues.json   # 机器读：完整字段
```



- **概览** —— 按严重级别 / 类型 / 规则分布，先看哪条规则占大头
- **问题清单** —— 每条给出文件行号、规则号、说明和一条直达 SonarCloud 的链接
- **分析来源** —— 清单基于 SonarCloud 上**最近一次分析**。

---

## 6. 门禁口径

### 6.1 默认拦哪些




```bash
# 连代码异味一起拦（配合级别过滤，只拦严重的那部分）
SONAR_BLOCK_TYPES=BUG,VULNERABILITY,CODE_SMELL SONAR_BLOCK_SEVERITIES=BLOCKER,CRITICAL,HIGH,MAJOR pnpm run verify:sonar

# 全拦
SONAR_BLOCK_TYPES=all pnpm run verify:sonar
```



### 6.2 发版时的拦截点


```
pnpm run release:patch
   ├─ 拉代码 / 装依赖 / 跑测试
   ├─ 🔍 Sonar 质量门禁   ← 这里不过就中止
   ├─ bump 版本号 / 提交 / 打 tag / 推送
```



### 6.3 应急跳过

```bash
SKIP_SONAR=1 pnpm run release:patch
```


---

## 7. CI 里发生了什么

| 工作流 | 触发 | 干什么 |
| --- | --- | --- |
| `.github/workflows/sonar.yml` | 推 master / 提 PR / 手动 | 跑完整扫描 + 出清单 + 判定 |
| `.github/workflows/build-and-release.yml` 的 `sonar-gate` | 打 tag | 只查清单 + 判定，不过就不发版 |


- **checkout 带 `fetch-depth: 0`** —— 浅克隆会让 Sonar 把整个仓库当成"新增代码"
- **判定步骤带 `--wait`** —— 扫描器把结果传上去之后计算任务还要跑一会儿，


---

## 8. 常见问题







