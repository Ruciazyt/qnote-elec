# QNote Elec Agent Team

## 团队成员

| 角色 | 目录 | 输出 |
|------|------|------|
| 🔍 调研员 | `team/research/` | `ideas.md` — 调研报告 + 功能点子 |
| 🧠 PM（产品经理） | `team/pm/` | `spec.md` — 需求文档 |
| 🎨 UI 设计师 | `team/ui-designer/` | `design.md` — 交互设计方案 |
| 🏗️ 架构师 | `team/architect/` | `plan.md` — 开发计划 |
| 💻 开发者 | `team/developer/` | 代码（覆盖 `electron/` `renderer/` 等） |
| 🧪 测试员 | `team/qa/` | `report.md` — 测试报告 |

## 流水线运作方式

```
调研员 → PM → UI设计师 → 架构师 → 开发者 → 测试员 → (如有问题打回开发者重做)
```

## 如何启动一轮协作

在主对话中发送：

```
team: qnote-elec:research: [你想调研的方向]
```

例如：

```
team: qnote-elec:research: 调研如何利用 AI 提升知识管理效率
```

调研完成后看结果，选中意的点子再交给 PM 继续。

**或者直接启动完整流水线（跳过调研，直接 PM）**：

```
team: qnote-elec:pm: [你的需求描述]
```

## 规则

- 开发者 push 代码前必须经过 lint + 测试
- 测试失败自动打回开发者，不超过 3 轮
- UI 设计需与现有风格保持一致（参考 Obsidian/Logseq）
- 每次协作的输出文件记录在 `team/` 对应目录下
