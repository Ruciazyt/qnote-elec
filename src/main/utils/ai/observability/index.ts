/**
 * AI 可观测性模块
 *
 * 采集内容（用户 2026-09-28 决策）：
 *   - token 用量（prompt / completion / total）
 *   - 延迟
 *   - 成功/失败 + 错误分类
 *   - provider / model / session / agent 轮次
 *   - 工具调用的次数和延迟
 *
 * **不算金额** —— 价格会过期，避免硬编码导致误导。
 * **不做定期清理** —— 个人使用量级（一年几万行）对 SQLite 无压力。
 *
 * 采集方式：LangChain BaseCallbackHandler，
 * 接入点在 model.invoke / model.stream / tool.invoke 的 callbacks 参数，
 * 覆盖 runAgent 多轮循环、流式、非流式全部路径。
 */

export {
  UsageRecorder,
  initUsageRecorder,
  getUsageRecorder,
  recordUsage,
  extractTokenUsage,
  classifyError,
} from './usageRecorder';
export type { UsageRecord, UsageKind, TokenUsage } from './usageRecorder';

export { ObservabilityCallback } from './observabilityCallback';
export type { ObservabilityCallbackOptions } from './observabilityCallback';

export { UsageStatsService } from './usageStats';
export type {
  UsageStats,
  UsageTotals,
  UsageByModel,
  UsageByDay,
  UsageRecordRow,
} from './usageStats';
