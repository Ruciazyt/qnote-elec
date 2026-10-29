# AI Prompts 版本记录

每次修改 prompt 文本必须在此追加一行，并保持 `systemBase` / `memoryRecall` 文件顶部注释的版本号同步。

## 2026-09-23 · v1.0

- `memoryRecall`（v1.0）：从 `aiHandlers.ts` 第 113-134 行硬编码字符串迁移，行为 1:1 等价
- `systemBase`（v1.0）：从 `aiHandlers.ts` 第 138-140 行硬编码字符串迁移，行为 1:1 等价
- `agentSystem`（v0.1 stub）：Phase 4 实现 tool calling 时填实
- `summarize`（v0.1 stub）：Phase 5 实现 hybrid retrieval 时填实

> 每次改动记一行。**改动前**先用 10 条问句 baseline 对照回归，确保不破坏 AI 行为。
> Phase 2 的原则是 **零行为变化**，只换代码组织。