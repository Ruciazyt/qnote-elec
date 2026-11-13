# SonarQube Cloud 质量门禁

QNote 接的是 [SonarQube Cloud](https://sonarcloud.io)（原名 SonarCloud，
界面右上角现在显示 "SonarQube cloud"），项目地址：

> https://sonarcloud.io/project/overview?id=Ruciazyt_qnote-elec

项目 key：`Ruciazyt_qnote-elec`（组织 `Ruciazyt`，host：`https://sonarcloud.io`）

这个文档说清楚三件事：令牌怎么配、清单怎么看、门禁怎么拦。

---

## 1. 为什么要有这套东西

SonarCloud 的问题一直"老是有很多"，根因不在扫描器，而在三处：

1. **分析范围没定义** —— 仓库里原先没有 `sonar-project.properties`，扫描全靠默认值，
   构建产物、测试夹具、生成文件被当成源码扫，产出一堆无意义的告警。
   现在补上了这个文件，分析范围、排除项、覆盖率路径都写死了。
2. **没有门禁** —— 问题只会被"看见"，不会被"卡住"。现在发版前会查一次，
   命中级别就中止发版，并把清单打出来。
3. **本地没有反馈** —— 现在 `pnpm run sonar:issues` 一条命令就能拿到清单，
   不用等 CI 跑完。

---

## 2. 令牌配置

项目是**私有**的，SonarCloud 的 API 对匿名访问一律返回 "Project doesn't exist"，
所以令牌是必需品。

### 2.1 生成令牌

SonarQube Cloud → 左侧菜单 → **Access tokens** → **Create token**：

> 新版界面没有 "My Account → Security" 那一栏了 —— 令牌统一在 **Access tokens** 里生成。
> 老版界面的路径是 My Account → Security → Generate Token。

| 项 | 值 |
| --- | --- |
| Name | `qnote-ci` |
| Type | **User Token**（脚本既要跑扫描、又要查 issue API，User Token 权限最全） |
| Expiration | 按需（别设太短，免得到期把流水线搞挂） |

> 老界面里没有 User Token 选项时，选 **Project Analysis Token**，
> 项目指定 `Ruciazyt_qnote-elec`。

令牌生成后**只显示一次**，当场复制 —— 关掉页面就再也拿不回来了。

### 2.2 三种投放方式

**CI（GitHub Actions）** —— 仓库 `Settings` → `Secrets and variables` → `Actions` →
`New repository secret`，名字必须是 `SONAR_TOKEN`，值填生成的令牌。

没有这个 secret 时：扫描作业直接跳过（不红），发版门禁也跳过 —— 不会把流水线堵死。
想强制要求它存在，把 secret 删掉再补上即可。

**本地（环境变量）**

```bash
# PowerShell
$env:SONAR_TOKEN = '你的令牌'
```

**本地（文件）** —— 推荐，终端历史里不会留痕：

```bash
# 目录 .data/ 整个在 .gitignore 里，不会进仓库
mkdir -p .data/sonar
echo '你的令牌' > .data/sonar/token
```

文件里允许写 `#` 开头的注释行 —— **第一条非注释、非空的行才是令牌**。
所以文件可以自带说明（怎么生成、怎么粘贴），不用每次粘贴前先把注释删掉。
文件已存在但还没填令牌时，门禁按"跳过"处理，不会拿着占位文字去请求 API。

三种方式的优先级：**环境变量 → `.data/sonar/token` 文件**。

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

SonarCloud 对 JS/TS 用的就是 `eslint-plugin-sonarjs` 这套规则（内部编号 S####），
所以本地现扫等于把 Sonar 的一部分提前搬到本地 —— 不用配令牌、不用等 CI：

```bash
pnpm run sonar:local          # 清单写到 .data/sonar/local-issues.md
pnpm run sonar:local -- --gate   # 有 error 就退出码 1
```

配置在根目录：

| 文件 | 作用 |
| --- | --- |
| `eslint.config.mjs` | flat config，规则是**挑过的**：只开缺陷类与安全类 |
| `tsconfig.lint.json` | 类型感知规则（null-dereference 等）用的 tsconfig |

规则挑选的取舍：Sonar 的推荐集里有 230 条，其中一大批是**代码异味**类的度量规则
（函数必须有显式返回类型、认知复杂度、行数上限）。本地一律关着 —— 开着只会把
真正的问题淹掉，一次能修的量就那么几十条。

两份清单的区别：

| | `sonar:issues` | `sonar:local` |
| --- | --- | --- |
| 数据来源 | SonarCloud 上**最近一次分析** | 本机现扫 |
| 需要令牌 | 是 | 否 |
| 跨文件数据流 | 有 | 没有 |
| 覆盖率 | 有 | 没有 |
| 安全热点 | 有（需人工复核结论） | 没有 |

**两份一起看**：SonarCloud 那份更全，本地这份是当天改完就能复扫的。

`sonar:scan` 需要本机有 JDK 17+ 和 sonar-scanner CLI：

- JDK：<https://adoptium.net/>
- scanner CLI：<https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/>，
  解压后把它的 `bin` 加进 PATH，或设 `SONAR_SCANNER_HOME` 指向解压目录

没装的话脚本会明确告诉你缺什么，不会闷声失败。**不想在本机装 JDK 也完全可以** ——
CI 每次推 master 都会自动扫描，本地只用 `sonar:issues` 看结果就够了。

---

## 4. 分析范围与配额

### 4.1 免费额度是硬约束

SonarCloud 免费版按**组织的代码行数**计上限：**50000 行**。超了不是「扣分」，
而是**直接拒绝产生这次分析**：

```
This analysis will make your organization 'ruciazyt' reach the maximum
allowed lines limit of 50000. Current LOC usage is: 0. LOC count in this
analysis: 60669.
```

一旦分析产生不了，质量门禁就永远是「判不了」—— 门禁形同虚设。
所以分析范围必须压在 50000 行以内。

当前范围（见 `sonar-project.properties`）只有 `src/` 下四个核心目录：
`src/main`、`src/renderer`、`src/shared`、`src/database`。`scripts/` 不扫。

代价要认：`S4036`（命令注入）、`S5852 / S8786`（正则回溯）、`S8705`（参数注入）
这几类原本主要落在 `scripts/` 里，现在 Sonar 不再报。它们的质量由
`pnpm run lint` 与项目自己的守卫测试覆盖。

### 4.2 ⚠️ 不要设 `sonar.tests`

这是 2026-11-13 实测踩出来的坑，两种写法都会让**分析范围整个失效**：

| 写法 | 现象 |
| --- | --- |
| `sonar.tests` 与 `sonar.sources` **完全相同** | Sonar 判定范围冲突，放弃这份额定、**退回扫描整个仓库** —— LOC 一直 60700+，超配额被拒。改 `exclusions`、`inclusions` 全都不管用。 |
| `sonar.tests` 指向某个 sources 目录的**子目录** | Sonar 为避免「文件被索引两次」把**整个父目录**踢出范围。实测只剩 98 个文件、`ncloc` 16522 —— 渲染层一行都没扫。 |

正确写法：**只给 `sonar.sources`**，测试文件靠 `sonar.test.inclusions` 标记。
落在 sources 范围内的测试文件会被算作测试代码，不计入 LOC 配额。

### 4.3 改了范围怎么确认生效

Actions 的日志匿名访问返回 403，**只有 SonarCloud 侧的数据能读到**。用 API 核对：

```bash
# 取令牌（.data/sonar/token 里第一条非注释行）
curl -s -H "Authorization: Bearer $TOKEN" \
  'https://sonarcloud.io/api/measures/component?component=Ruciazyt_qnote-elec&metricKeys=ncloc,files'
```

`ncloc` 明显小于 50000、`files` 明显大于几百，才说明范围真的生效了。
扫描失败时看组织任务状态（那儿有失败原因和 LOC 构成）：

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  'https://sonarcloud.io/api/ce/activity?component=Ruciazyt_qnote-elec&ps=5'
```

> 服务端设置改不了分析范围：`POST /api/settings/set` 写 `sonar.exclusions`
> 返回成功，但读回来是空串 —— SonarCloud 不允许用 API 改分析范围
> （那等于绕过配额）。范围只能在 `sonar-project.properties` 与 CI 参数里定。

---

## 5. 清单怎么看

两个脚本都会把清单写到：

```
.data/sonar/sonar-issues.md     # 人读：概览 + 逐条问题 + SonarCloud 链接
.data/sonar/sonar-issues.json   # 机器读：完整字段
```

`.data/` 在 `.gitignore` 里，清单不会进仓库。

清单里有三块信息：

- **概览** —— 按严重级别 / 类型 / 规则分布，先看哪条规则占大头
- **问题清单** —— 每条给出文件行号、规则号、说明和一条直达 SonarCloud 的链接
- **分析来源** —— 清单基于 SonarCloud 上**最近一次分析**。
  如果本地 HEAD 和那次分析的提交对不上，清单顶部会明确标出来：
  那说明你看到的不是当前工作区的状态（CI 里会自动 `--wait` 等本次分析算完）

---

## 6. 门禁口径

### 6.1 默认拦哪些

**默认拦「缺陷 + 漏洞」两类**（`BUG` / `VULNERABILITY`），代码异味只报不拦。

> **为什么按类型拦，不按严重级别拦**：这个项目当前有 703 个未解决问题，
> 其中代码异味 695 个。按级别拦（CRITICAL/MAJOR 有 334 个）会把发版
> **永久堵死** —— 门禁就成了摆设，最后肯定会被 `SKIP_SONAR=1` 绕过。
> 按类型拦只有 8 条，每一条都对应用户能感知的故障或安全风险，修得完。

想改：

```bash
# 连代码异味一起拦（配合级别过滤，只拦严重的那部分）
SONAR_BLOCK_TYPES=BUG,VULNERABILITY,CODE_SMELL SONAR_BLOCK_SEVERITIES=BLOCKER,CRITICAL,HIGH,MAJOR pnpm run verify:sonar

# 全拦
SONAR_BLOCK_TYPES=all pnpm run verify:sonar
```

CI 里用仓库变量覆盖（`Settings` → `Secrets and variables` → `Actions` → `Variables`）：
`SONAR_BLOCK_TYPES`、`SONAR_BLOCK_SEVERITIES`，不用改代码。

> **严重级别有两套名字**：SonarQube Cloud 换成了新的 impact 模型
> （级别是 BLOCKER / HIGH / MEDIUM / LOW / INFO），而老接口返回的 severity
> 仍是旧模型（BLOCKER / CRITICAL / MAJOR / MINOR / INFO）。
> 脚本两套都认 —— 只认一套的话，在 Cloud 上会**漏判**：
> HIGH 级别的问题会被当成"不拦"悄悄放过去。

### 6.2 发版时的拦截点

**本地（`scripts/release/release.js`）** —— 在 bump 版本号**之前**查一次：

```
pnpm run release:patch
   ├─ 拉代码 / 装依赖 / 跑测试
   ├─ 🔍 Sonar 质量门禁   ← 这里不过就中止
   ├─ bump 版本号 / 提交 / 打 tag / 推送
```

门禁不过时版本号还没动，tag 也没打 —— 不会有半成品推到远端。

**CI（`build-and-release.yml` 的 `sonar-gate` 作业）** —— tag 触发时先跑门禁，
不过就不出包、不建 Release。`release` 作业的条件是 `needs.build.result == 'success'`，
门禁失败会让 `build` 被跳过，Release 自然不会建。

### 6.3 应急跳过

```bash
SKIP_SONAR=1 pnpm run release:patch
```

跳过会在控制台打醒目提示。这个开关只在紧急发版时用 —— 它会留痕在提交历史里。

---

## 7. CI 里发生了什么

| 工作流 | 触发 | 干什么 |
| --- | --- | --- |
| `.github/workflows/sonar.yml` | 推 master / 提 PR / 手动 | 跑完整扫描 + 出清单 + 判定 |
| `.github/workflows/build-and-release.yml` 的 `sonar-gate` | 打 tag | 只查清单 + 判定，不过就不发版 |

`sonar.yml` 里有两个细节是有意为之的：

- **checkout 带 `fetch-depth: 0`** —— 浅克隆会让 Sonar 把整个仓库当成"新增代码"
- **判定步骤带 `--wait`** —— 扫描器把结果传上去之后计算任务还要跑一会儿，
  立刻查会拿到上一次的旧结果，门禁就成了假通过

覆盖率由 `pnpm run test:coverage` 产出 lcov（`src/renderer/coverage/lcov.info`），
对应 `sonar-project.properties` 里的 `sonar.javascript.lcov.reportPaths`。
不产出 lcov 的话 SonarCloud 侧覆盖率是 0，质量门禁里覆盖率那条必然红。

---

## 8. 常见问题

**`/api/issues/search 返回 401`**
令牌无效、过期或被撤销，**或者建成了分析令牌而不是用户令牌** ——
分析令牌只能跑扫描，查不了 issue API。这条最常见。

**`403`**
令牌对应的用户在该项目上没有 Browse 权限。

**`400` 说缺参数**
多半是缺组织（Cloud 上新建项目时必须给 `sonar.organization`）。

**`Project doesn't exist`**
项目是私有的，匿名访问就是这个样子 —— 带上令牌就好。

**本地清单和代码对不上**
看清单顶部的"分析来源"。本地命令查的是最近一次分析，不是现扫一遍。
要现扫用 `pnpm run sonar:scan`（需要 JDK），或者推 master 让 CI 扫。

**扫描报 `Java not found`**
CI runner 自带 Java，本机没有而已。装 JDK 17+ 或直接用 CI。

**想改分析范围**
改 `sonar-project.properties` 的 `sonar.sources` / `sonar.exclusions`，
改完推 master，CI 会用新配置重扫。
