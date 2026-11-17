
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';

import { log } from '../../system/log';
import {
  classifyError,
  extractTokenUsage,
  recordUsage,
} from "./usageRecorder";

export interface ObservabilityCallbackOptions {
  provider: string;
  defaultModel?: string;
  sessionId?: string | null;
  agentIteration?: number;
}

interface RunTiming {
  startedAt: number;
  model?: string;
}

export class ObservabilityCallback extends BaseCallbackHandler {
  name = 'QNoteObservability';

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
  private readonly timings = new Map<string, RunTiming>();

  constructor(opts: ObservabilityCallbackOptions) {
    super();
    this.provider = opts.provider;
    this.defaultModel = opts.defaultModel ?? '';
    this.sessionId = opts.sessionId ?? null;
    this.agentIteration = opts.agentIteration ?? 0;
  }

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

  handleChatModelStart(
    _llm: unknown,
    _messages: unknown[][],
    runId: string
  ): void {
    this.handleLLMStart(_llm, [], runId);
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    const timing = this.timings.get(runId);
    this.timings.delete(runId);

    const latencyMs = timing ? Date.now() - timing.startedAt : 0;

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleChainStart(..._args: any[]): void {
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleChainEnd(..._args: any[]): void {
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleChainError(..._args: any[]): void {
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleLLMNewToken(..._args: any[]): void {
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRetrieverStart(..._args: any[]): void {
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRetrieverEnd(..._args: any[]): void {
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRetrieverError(..._args: any[]): void {
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleToolEvent(..._args: any[]): void {
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleChatModelStreamEvent(..._args: any[]): void {
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleCustomEvent(..._args: any[]): void {
  }
}
