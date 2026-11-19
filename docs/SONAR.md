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


### 4.3 ⚠️ 组织 key 必须小写

SonarCloud 上组织 key 是 `ruciazyt`（显示名 "Rucia_zyt"）。
`sonar.organization` 写成大写 `Ruciazyt` 时，认证能过、也能连上服务器，
但加载插件那一步会报：

```
ERROR Fail to load the list of plugins installed on the server: Not authorized or organization not found
```

退出码同样是 3。这个错和下面「自动分析开启」的错长得不一样，别混。

项目 key 是 `Ruciazyt_qnote-elec`（大写 R），`sonar-project.properties` 与
`scripts/quality/sonar-issues.js` 两处一致，不用动。

### 4.4 ⚠️ 项目开着「自动分析」，CI 扫描会被挡

```
ERROR You are running CI analysis while Automatic Analysis is enabled.
      Please consider disabling one or the other.        (exit code 3)
```

```
POST /api/settings/set  key=sonar.autoscan.enabled  component=<项目>   → Setting cannot be set on a Project
POST /api/settings/set  key=sonar.autoscan.enabled  component=ruciazyt → Component key 'ruciazyt' not found
```

### 4.4.1 ⚠️ 在哪关：项目级，不是组织级

开关在**项目**上，不在组织菜单里：

`
Projects → Ruciazyt_qnote-elec → Administration → Analysis Method
                                          → 关掉 Automatic Analysis
`

- 组织级的那个（Administration → Organization Settings → Analysis → Analysis Method）
  **只有 Enterprise plan 才有**，Free plan 的组织菜单里根本没有这一项 —— 找不到是正常的。
- 需要**项目管理员**权限。**只有组织管理员不行**，得用对这个项目有管理员权限的账号
  登录才看得到并能改。
- Web API 改不动：`sonar.autoscan.enabled` 报 `Setting cannot be set on a Project`，
  组织级那个 key 又找不到对应组件。

官方文档：
<https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/automatic-analysis>

### 4.4.2 关掉之后的变化

关之前 CI 的表现：`SonarCloud scan` 那步的 exit 3 被 `continue-on-error` 兜住，
job 不再红；扫描诊断里 `Automatic Analysis is enabled` 这条记成 warning
（不再刷一屏红色 error），`Collect issue list` 仍会照常跑 —— 自动分析已经分析了
同一个提交，清单和门禁判定拿到的就是那次的分析结果。只有跟自动分析无关的
扫描失败（网络、令牌失效等）才会让 job 变红。

关掉之后，CI 扫描会真正跑起来并上传结果，**覆盖率也回来了** ——
自动分析不支持覆盖率（官方明确列了 "Code coverage information is not supported"），
`sonar.javascript.lcov.reportPaths` 指的那个 lcov 文件在自动分析里根本不存在。
代价是分析结果来自 CI 扫描（装依赖 + 跑覆盖率测试 + 扫描），比自动分析慢，
所以 `--wait` 的等待窗口从 4 分钟放宽到了 10 分钟，
发版门禁那个 job 的超时也从 15 分钟放宽到 30 分钟。

### 4.4.1 本地扫描漏掉过的安全规则

`eslint.config.mjs` 里只挑了 86 条 SonarJS 规则，SonarJS recommended 一共 295 条，
漏掉的正好有安全类：`sonarjs/hashing`（typescript:S4790 弱哈希）和
`sonarjs/os-command`（tssecurity:S2076 命令注入）—— 这两条在本地永远扫不出来，
直接漏到 SonarCloud 上算漏洞，拉低新代码的安全评级。

现在本地启用的安全类规则补到了 12 条（再加 `no-unsafe-unzip`、
`encryption-secure-mode`、`insecure-jwt-token`、`confidential-information-logging`、
`no-mixed-content`、`web-sql-database`、`post-message`、
`dynamically-constructed-templates`、`no-intrusive-permissions`、`production-debug`），
`pnpm run sonar:local` 能提前拦住这一类。

### 4.5 当前的覆盖范围（**待验证**）

`sonar.sources` 是四个目录，测试文件由 `sonar.test.inclusions` 单独标，没有设
`sonar.tests`（设了会退回全仓扫描，见 4.2）。下一次扫描跑通后按实际的 `ncloc`
重新核对 —— 免费额度 50000 LOC，超过就被拒。


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







