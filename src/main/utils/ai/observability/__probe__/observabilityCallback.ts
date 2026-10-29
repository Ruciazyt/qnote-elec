/**
 * AI 可观测性 Callback
 *
 * 继承 LangChain 的 BaseCallbackHandler，通过 handleLLMStart/End/Error +
 * handleToolStart/End 自动采集所有 AI 调用的指标。
 *
 * 为什么用 callback 而不是手写埋点：
 *   runAgent 是自研的多轮循环，每轮都调 model.invoke；
 *   流式路径调 model.stream；工具执行调 tool.invoke。
 *   在 callback 层采集能一次覆盖所有路径，不会在某条新路径上漏埋点。
 *
 * 用法：
 *   const recorder = new ObservabilityCallback({
 *     provider: 'openai',
 *     sessionId,
 *     agentIteration: 0,
 *   });
 *   await model.invoke(msgs, { callbacks: [recorder] });
 */

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';

import { log } from '../../log';
import {
  classifyError,
  extractTokenUsage,
  recordUsage,
} from './usageRecorder';

export interface ObservabilityCallbackOptions {
  provider: string;
  /** 默认 model 名（provider 未回传 model_name 时兜底） */
  defaultModel?: string;
  sessionId?: string | null;
  /** agent 循环轮次 */
  agentIteration?: number;
}

/** 单次 LLM 调用的计时状态（按 runId 索引） */
interface RunTiming {
  startedAt: number;
  model?: string;
}

export class ObservabilityCallback extends BaseCallbackHandler {
  // BaseCallbackHandler 的抽象成员
  name = 'QNoteObservability';

  // lc_namespace 在基类是 getter，子类要用 get 覆盖（不能用实例属性）
  // 返回类型是字面量元组 ['langchain_core', 'callbacks', string]，
  // 前两位是锁定的字面量类型，所以整体需要断言
  get lc_namespace(): ['langchain_core', 'callbacks', string] {
    return ['langchain_core', 'callbacks', 'qnote_observability'] as [
      'langchain_core',
      'callbacks',
      string
    ];
  }

  private readonly provider: string;
  private readonly defaultModel: string;
  private readonly sessionId?: string | null;
  private readonly agentIteration: number;
  /** runId → 开始时间（LangChain 每个 invoke 生成唯一 runId） */
  private readonly timings = new Map<string, RunTiming>();

  constructor(opts: ObservabilityCallbackOptions) {
    super();
    this.provider = opts.provider;
    this.defaultModel = opts.defaultModel ?? '';
    this.sessionId = opts.sessionId ?? null;
    this.agentIteration = opts.agentIteration ?? 0;
  }

  /**
   * LLM 调用开始 —— 记录起始时间
   */
  handleLLMStart(
    _llm: unknown,
    _prompts: string[],
    runId: string
  ): void {
    this.timings.set(runId, {
      startedAt: Date.now(),
      model: this.defaultModel,
    });
  }

  /**
   * Chat model 调用开始（LangChain 1.x 优先走这个 hook）
   */
  handleChatModelStart(
    _llm: unknown,
    _messages: unknown[][],
    runId: string
  ): void {
    this.handleLLMStart(_llm, [], runId);
  }

  /**
   * LLM 调用结束 —— 提取 token 用量并落库
   */
  handleLLMEnd(output: LLMResult, runId: string): void {
    const timing = this.timings.get(runId);
    this.timings.delete(runId);

    const latencyMs = timing ? Date.now() - timing.startedAt : 0;

    // LLMResult.llmOutput 里各 provider 的 usage 字段位置不同
    // 同时拿 response_metadata 里的标准 usage_metadata
    const generations = output.generations?.[0] ?? [];
    const firstGen: any = generations[0];

    const usage = extractTokenUsage(
      output.llmOutput,
      firstGen?.message?.usage_metadata
    );

    const model =
      firstGen?.message?.response_metadata?.model_name ||
      timing?.model ||
      this.defaultModel;

    recordUsage({
      provider: this.provider,
      model,
      sessionId: this.sessionId,
      agentIteration: this.agentIteration,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      latencyMs,
      success: true,
      kind: 'llm',
    });
  }

  /**
   * LLM 调用失败
   */
  handleLLMError(err: Error, runId: string): void {
    const timing = this.timings.get(runId);
    this.timings.delete(runId);

    const latencyMs = timing ? Date.now() - timing.startedAt : 0;
    const classified = classifyError(err);

    log.warn(
      `[observability] LLM 调用失败 [${this.provider}] ${classified.type}: ${classified.message}`
    );

    recordUsage({
      provider: this.provider,
      model: timing?.model || this.defaultModel,
      sessionId: this.sessionId,
      agentIteration: this.agentIteration,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs,
      success: false,
      errorType: classified.type,
      errorMessage: classified.message,
      kind: 'llm',
    });
  }

  /**
   * 工具调用开始
   */
  handleToolStart(
    tool: { name?: string },
    _input: string,
    runId: string
  ): void {
    this.timings.set(runId, {
      startedAt: Date.now(),
      model: tool?.name,
    });
  }

  /**
   * 工具调用结束 —— 记一条 kind='tool' 的记录（不计 token，只计延迟）
   */
  handleToolEnd(output: unknown, runId: string): void {
    const timing = this.timings.get(runId);
    this.timings.delete(runId);

    recordUsage({
      provider: this.provider,
      model: timing?.model ?? 'tool',
      sessionId: this.sessionId,
      agentIteration: this.agentIteration,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: timing ? Date.now() - timing.startedAt : 0,
      success: true,
      kind: 'tool',
    });
  }

  /**
   * 工具调用失败
   */
  handleToolError(err: Error, runId: string): void {
    const timing = this.timings.get(runId);
    this.timings.delete(runId);

    const classified = classifyError(err);

    recordUsage({
      provider: this.provider,
      model: timing?.model ?? 'tool',
      sessionId: this.sessionId,
      agentIteration: this.agentIteration,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: timing ? Date.now() - timing.startedAt : 0,
      success: false,
      errorType: `tool_${classified.type}`,
      errorMessage: classified.message,
      kind: 'tool',
    });
  }

  /**
   * 忽略未处理的 hook（避免父类抛错）
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleChainStart(..._args: any[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleChainEnd(..._args: any[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleChainError(..._args: any[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleLLMNewToken(..._args: any[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRetrieverStart(..._args: any[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRetrieverEnd(..._args: any[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRetrieverError(..._args: any[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleToolEvent(..._args: any[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleChatModelStreamEvent(..._args: any[]): void {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleCustomEvent(..._args: any[]): void {}
}
