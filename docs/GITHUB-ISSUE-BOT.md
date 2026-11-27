# GitHub Issue @ QNote AI —— 被 @ 后自动回帖

| 项 | 值 |
| --- | --- |
| 能力 | 在 GitHub Issue / PR 评论里 @机器人，QNote 的 AI 接手回答并回帖 |
| 触发链路 | 推荐：主进程轮询（无需公网暴露） |
| 直接复用 | GitHub 读写工具、AI 会话表、GitHub 连接配置、AI provider 配置 |
| 新增 | 触发器 1 个目录 + 1 个 API 端点 + 6 个配置项 + 1 段系统提示词 |
| 运行前提 | QNote 在运行（托盘常驻即可，关窗口不退出） |

---

## 一、边界

| 做 | 不做 |
| --- | --- |
| 读 issue / PR / 提交 / 流水线 | 改代码、提 PR（要开需单独放权） |
| 在触发评论所在的会话里回答并回帖 | 主动巡检仓库、不被 @ 就发言 |
| 每个 issue 一个独立会话，上下文延续 | 跨仓库共享上下文 |

---

## 二、两条触发链路

| | A 主进程轮询（推荐） | B Webhook |
| --- | --- | --- |
| 新增外部依赖 | 无 | GitHub App + 内网穿透隧道 |
| 公网暴露 | 无 | 有（这台机器持有你的 API key） |
| 延迟 | ≤ 轮询间隔（默认 60s） | 秒级 |
| 新增代码 | 触发器（后台定时器） | 触发器 + 本地 HTTP 接收端 + HMAC 校验 |
| 断连风险 | 无 | 隧道断连即失联，需保活 |
| 前置条件 | QNote 常驻 | QNote 常驻（隧道通到本机）或整套跑在服务器上 |

选 A。B 只在「必须秒回」或「整套要跑在服务器上」时才划算。

---

## 三、步骤：GitHub 侧配置

### 1. 建机器人身份

组织里建机器用户（如 `qnote-bot`），或建 GitHub App。轮询方案用**机器用户 + PAT** 最省事。

**验收**：`GET /user`（QNote 里的「GitHub 配置 → 校验」）返回的 `login` 是这个账号。

### 2. 发令牌

| 类型 | 权限 |
| --- | --- |
| 细粒度 PAT | Issues: Read and write；Pull requests: Read and write；Metadata: Read |
| 经典 PAT | `repo` scope |

组织开了 SSO 的，令牌页要显式勾选授权该组织，否则 API 返回 403。

**验收**：令牌调 `GET /repos/{owner}/{repo}` 返回 200。

### 3. 把机器人加进目标仓库

给 collaborator + 写权限。只读权限只能读、不能回帖。

**验收**：令牌调 `POST /repos/{owner}/{repo}/issues/{n}/comments` 返回 201。

### 4. 填进 QNote

设置 → 技能 → 工具 → GitHub「配置」：

| 字段 | 填什么 |
| --- | --- |
| API 地址 | 公有实例 `https://api.github.com`；GHE 填 `https://<主机>/api/v3` |
| 访问令牌 | 上一步的 PAT |
| 允许的仓库 | `owner/repo`，逗号分隔，留空 = 不限制 |
| 只读模式 | **关**（开着时 `requireWritable` 会拒掉所有写工具） |

### 5. 定触发词

默认 `@qnote-bot`。写评论的人用 `@owner/qnote-bot` 或 `@qnote-bot` 都能匹配。

**验收**：在 issue 里发一条 `@qnote-bot 测试`，QNote 日志里能看到拉到这条评论。

---

## 四、步骤：QNote 侧实现

### 1. 补一个 API 端点

现有 `githubEndpoints` 只有单 issue 的评论端点，仓库级增量拉取要新加一条：

```ts
// src/main/core/ai/tools/github/api/endpoints.ts
repoIssueComments: (repository: string) => repositoryPath(repository) + '/issues/comments',
```

**验收**：`GET /repos/{owner}/{repo}/issues/comments?since=...` 能按时间增量返回该仓库所有 issue + PR 的普通评论。

### 2. 触发器骨架

新目录 `src/main/core/ai/githubBot/`：

```
src/main/core/ai/githubBot/
  trigger.ts        轮询主循环 + 命中判定 + 串行队列
  configStore.ts    触发器自己的配置项读写（settings 表）
  session.ts        issue → 会话 id 的映射，复用 ai_chat / ai_chat_session
  prompt.ts         issue 场景的系统提示词
```

定时器模式照抄 `src/main/core/todo/reminderScheduler.ts`（定时一轮 + 启动即注册）。

**验收**：QNote 启动后日志出现轮询记录，且只对「允许的仓库」发请求。

### 3. 增量水位与去重

| 机制 | 做法 |
| --- | --- |
| 水位 | 每仓库记一个 `lastCommentId`（GitHub 评论 id 单调递增），只处理 `id > 水位` 的评论 |
| 存储 | settings 表 `github_bot_cursor`，value = `{"owner/repo": 12345}` |
| 自触发 | 跳过 `user.login` == 机器人自身 login 的评论（自身 login 用 `GET /user` 取一次并缓存） |
| 并发 | 同一 issue 同时只跑一个任务；全局串行队列，避免同时发多条评论 |
| issue 编号 | 评论对象没有 issue number，从 `issue_url` 末段解析 |

**验收**：QNote 重启后不重复处理历史评论；机器人自己的回复不会引发新一轮回复。

### 4. 会话与提示词

| 项 | 做法 |
| --- | --- |
| 会话 id | `github:{owner}/{repo}#{number}`，用 `ensureAiChatSession` 建会话 |
| 历史 | 复用 `ai_chat` / `ai_chat_session` 表，同一 issue 的后续 @ 延续上下文 |
| 系统提示词 | `AGENT_SYSTEM_TEXT`（`src/main/core/ai/prompts/agentSystem.ts`）叠一段 issue 场景约束 |
| 场景约束要点 | 用中文回答；先给结论再给依据；正文控制在 N 字内；必须调用 `github_add_comment` 回帖；不确定就说不确定 |
| 模型 | `aiService.sendMessage()` + `configManager.getAiConfig()`（`src/main/core/system/config.ts`） |
| 执行 | opencode 执行层（`src/main/core/ai/runtime/opencode/`），工具经 QNote MCP server 暴露 |

**验收**：在同一个 issue 里连续 @ 两次，第二次的回答能引用第一次的内容。

### 5. 工具集

不要直接用 `getEnabledTools()` 全量下发。给 bot 的工具收窄成：

| 给 | 不给 |
| --- | --- |
| GitHub 读工具（issue / PR / commit / workflow） | 笔记、待办、剪贴板相关工具 |
| `github_add_comment`（回帖） | 分支创建/删除、提交文件、提 PR、合并 PR |
| `web_search` / `web_fetch`（查官方文档） | 浏览器工具、记忆写入工具 |

**验收**：bot 的回答里不会出现「已保存到笔记」这类动作；让它提 PR 会被工具层拒绝。

### 6. 回帖

复用 `github_add_comment`（`src/main/core/ai/tools/github/tools/issue.ts`），把模型回复的 `content` 格式化成 Markdown。

**验收**：issue 下出现 QNote 的回复评论，内容与模型输出一致。

### 7. 接线

`src/main/index.ts`：在 `initGithubConfigStore(DB)` 同一批初始化里注册触发器启动（与 `startReminderScheduler(DB)` 同位置）。

**验收**：改配置后重开 QNote 生效；关闭触发器后不再拉取。

---

## 五、信息

### 1. 配置项（settings 表）

| `configName` | value | 默认 |
| --- | --- | --- |
| `github_bot_enabled` | `"true"` / `"false"` | `false` |
| `github_bot_trigger` | JSON 字符串数组 | `["qnote-bot"]` |
| `github_bot_repositories` | JSON 字符串数组 | 空 = 跟 GitHub 配置的「允许的仓库」一致 |
| `github_bot_interval_sec` | 数字字符串 | `60` |
| `github_bot_max_rounds` | 数字字符串 | `8` |
| `github_bot_cursor` | JSON：`{repo: lastCommentId}` | `{}` |

### 2. GitHub API 端点

| 用途 | 端点 | 说明 |
| --- | --- | --- |
| 拉评论 | `GET /repos/{owner}/{repo}/issues/comments` | 参数 `since` / `sort=created` / `direction=asc` / `per_page`(≤100) |
| 自身身份 | `GET /user` | 取 `login` 做自触发过滤 |
| 回帖 | `POST /repos/{owner}/{repo}/issues/{n}/comments` | 已由 `github_add_comment` 实现 |
| 读 issue | `GET /repos/{owner}/{repo}/issues/{n}` | 已实现 |
| 限流 | `GET /rate_limit` | 已实现 |

细粒度 PAT 限流按仓库计（5000 次/小时）；经典 PAT 全账号 5000 次/小时。

### 3. 已知边界

| 现象 | 说明 |
| --- | --- |
| PR 行内 review 评论扫不到 | `/issues/comments` 只覆盖 issue / PR 的**普通评论**；行内评论在 `/pulls/comments` |
| 首次启动会翻历史 | 水位初始为空 → 首轮会拉到近期评论并全部命中。可先把 `github_bot_cursor` 预置成当前最大 id |
| 只读模式开着 | 回帖被 `requireWritable` 拒掉，触发器应先检查并跳过 |
| QNote 退出后不响应 | 轮询在主进程里，进程退出即停；托盘常驻不影响 |

### 4. 排障表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 一直没有回复 | QNote 没在运行 | 看托盘图标 / 进程 |
| 一直没有回复 | 只读模式开着 | 关掉 GitHub 配置里的「只读模式」 |
| 一直没有回复 | 触发词不匹配 | 评论里的 @ 必须是 `@login` 或 `@owner/login` |
| 403 | 组织 SSO 未授权 / 机器人无写权限 | 令牌页授权组织；给 collaborator 写权限 |
| 401 | token 过期或填错 | 换新 PAT 重填 |
| 429 | 轮询太频繁或仓库太多 | 调大 `github_bot_interval_sec`；收窄「允许的仓库」 |
| 循环回复 | 自触发没过滤 | 检查是否按 `user.login` 跳过自身评论 |
| 首轮刷屏 | 水位初始为空 | 预置 `github_bot_cursor`，或先关触发器再开 |

### 5. 验收清单

- [ ] 在 issue 里发 `@qnote-bot <问题>` → ≤ 1 分钟内该 issue 出现 QNote 的回复评论
- [ ] 回复里引用了 issue 标题 / 正文里的信息（说明上下文喂进去了）
- [ ] 同一 issue 第二次 @ 的回答能承接上一次上下文
- [ ] 机器人的回复不会再触发新一轮回复
- [ ] 重开 QNote 后不重复处理历史评论
- [ ] 退出 QNote 后不再有回复，重开后从水位续跑
- [ ] token 失效时有日志说明原因，不静默失败
- [ ] bot 无法调用笔记 / 待办 / 提 PR 类工具

---

## 六、待定项

| 项 | 选项 |
| --- | --- |
| 触发词默认值 | `qnote-bot` / `qnote` / 跟机器用户名走 |
| 机器人身份 | 机器用户 + PAT（当前方案）/ GitHub App |
| 是否给代码写权限 | 只读回答 / 允许提 PR / 允许直接推分支 |
| 回答语言与长度 | 中文 + N 字上限；N 取值 |
| 是否同时覆盖 GitLab | GitLab 侧工具已有同构能力，触发器可复用同一套骨架 |

---

## 七、附：公网部署变体的 key 保护

### 1. 按 key 类型分治

| key 类型 | 该怎么拿 | 泄露后能做什么 | 失效速度 |
| --- | --- | --- | --- |
| 模型 API key（OpenAI / MiniMax / Anthropic） | 网关代持，或云厂商 project 隔离 key | 直接烧配额 | 手动撤 |
| GitHub 长期 PAT | 换 GitHub App installation token（1 小时有效） | 读写所有授权仓库 | 立刻吊销 |
| GitLab 长期 PAT | project access token / deploy token | 按项目范围 | 立刻吊销 |
| 云厂商 AK / SK | IAM role / instance profile，代码里永不出现静态 AK | 拿云资源 | 立刻禁用 |

长期 key 泄露 = 长期失窃；短时 + 作用域受限的凭证泄露 = 最坏只损失 1 小时、1 个仓库。

### 2. 模型侧：网关代持

1. 网关（LiteLLM / Portkey / 云厂商 API 网关）持有真 key，agent 只拿一把带额度 + 时效的子 key
2. 没有网关：自己起一个本地代理进程持有真 key，agent 只连 `127.0.0.1`，整个进程只有这一个出口
3. 真 key 不出现在：system prompt、工具返回值、模型可读的环境变量、任何 trace

### 3. 公网输入这一侧

公网 agent 的输入不可信（issue 评论、用户消息），主要泄露路径是**注入**：诱导模型把 key 吐出来。

| 风险 | 防护 |
| --- | --- |
| 注入诱导模型输出 key | key 不在上下文里；工具结果先脱敏再进上下文；模型输出 / 回帖前再扫一遍 |
| SSRF 打云元数据服务（169.254.169.254） | 出网白名单；web_fetch 禁私网段与元数据地址 |
| 给了 shell / exec 工具 | 不给；只给参数化的窄工具（如 `github_add_comment`） |
| 工具返回值夹带 key | 复用现成 `redactSecrets` |

### 4. 可复用的两处现成机制

| 机制 | 位置 | 复用到哪 |
| --- | --- | --- |
| `redactSecrets` | `src/main/core/ai/tools/github/utils/shape.ts`、`gitlab/utils/shape.ts` | 已覆盖 GitHub PAT、GitLab PAT、Authorization 头、URL token 参数；**当前只用在工具结果上**（`tools/issue.ts:162`），**不覆盖模型 key**（`sk-...` 一类） |
| `hostApi.requireCapability` | `src/main/core/plugin/sdk/hostApi.ts:131` | 防泄露的通用结构：凭证留在宿主，调用方只报「我要做什么」。模型只能请求动作，执行层持 key，模型永远拿不到 token |

公网部署要补的脱敏位置：模型输出、HTTP 响应体、异常堆栈、审计日志、tracing；正则要补 `sk-` / `glpat-` / `AKIA` 一类。

### 5. 部署形态

```
公网请求 → [编排层：无 key，只做推理] → [执行层 sidecar：持 key，只做调用] → 平台 API
```

编排层可任意扩容，被攻陷也拿不到 key；执行层不出网，只接受编排层的结构化请求。

其他硬性项：

| 项 | 要求 |
| --- | --- |
| Docker | key 用 secret mount / envFrom，不要写进 Dockerfile ARG（会留在镜像层历史） |
| K8s | Secret 挂载成文件，不要用 env（env 会出现在 `/proc/*/environ`、crash dump、诊断端点） |
| CI | secret 不 `echo`；Actions 用 `secrets`，不要写进 workflow 文件 |
| 轮换 | 执行层 key 定期换；泄露后一键吊销（GitHub PAT 可即时吊销） |

### 6. 自检清单

- [ ] 真 key 不在 agent 进程的代码、配置、镜像层里
- [ ] 模型上下文里拿不到任何真 key（把 tool 返回值打出来看）
- [ ] grep 日志 / tracing / 审计表，没有 key 明文
- [ ] 泄露路径能一键失效（吊销 token / 禁用 key）
- [ ] 没有 shell / 任意 exec / 任意 URL fetch 工具
- [ ] 出网走白名单，禁 169.254.169.254 与私网段
- [ ] 子凭证有额度上限和时效

