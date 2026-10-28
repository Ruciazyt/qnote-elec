/**
 * 自研 Agent 循环 — 替代 langchain/agents 的 createToolCallingAgent + AgentExecutor
 *
 * 为什么不用 createToolCallingAgent：
 *   - 在主包 `langchain` 里（避免引入），且实现并不复杂
 *   - 自己写可控：流式 chunk 可以逐字推送；可以记录每次工具调用
 *
 * 协议：
 *   输入：RunAgentOptions（model 已 .bindTools(tools)、起始 messages、工具数组）
 *   输出：AgentResult { content / messages / toolCalls / hitIterationLimit / truncated }
 *   流式：通过 onEvent 回调 AgentEvent { type: 'text' | 'tool_call' | 'tool_result' }
 *
 * 类型全在 ./types，这里只有实现。
 *
 * 循环每一轮拆成五步，每步一个函数：
 *   1. callModelOnce      —— model.stream 逐块消费，拼成完整回复
 *   2. readToolDecision   —— 读它要不要调工具 / finish_reason 是不是 length
 *   3. 收尾分支            —— 不调工具就退出（必要时催一次「只说不做」）
 *   4. executeTools       —— 并发执行全部工具
 *   5. commitToolResults  —— ToolMessage 进上下文 + 记账 + 广播事件
 *   然后带着工具结果进入下一轮，maxIterations 防止无限循环（默认 8）
 */

import {
  AIMessage,
  type AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { randomUUID } from 'crypto';
import { extractTextContent } from '../providers';
import { log } from '../../log';
import type {
  AgentResult,
  RunAgentOptions,
  ToolDecision,
  ToolExecution,
} from './types';

// 类型都在 ./types，这里只做转出，方便外部从 runAgent 直接 import
export type { AgentEvent, AgentResult, RunAgentOptions } from './types';

/** 步骤 1 —— 调一次模型，把流式碎片拼成完整回复 */
async function callModelOnce(
  opts: RunAgentOptions,
  messages: BaseMessage[],
  callbacks: unknown[] | undefined
): Promise<AIMessage> {
  const stream = await opts.model.stream(messages, {
    signal: opts.signal,
    callbacks,
  } as any);

  // concat 同时聚合终态消息和可能分多块到达的 tool calls
  let responseChunk: AIMessageChunk | null = null;
  for await (const chunk of stream) {
    if (opts.signal?.aborted) break;
    responseChunk = responseChunk ? responseChunk.concat(chunk) : chunk;
    const delta = extractTextContent(chunk.content);
    if (delta) opts.onEvent?.({ type: 'text', text: delta });
  }
  opts.signal?.throwIfAborted();

  // AIMessageChunk 的 content 可能是 string | array；用 extractTextContent 归一成 string
  return responseChunk ?? new AIMessage('');
}

/** 步骤 2 —— 读模型的决定 */
function readToolDecision(response: AIMessage): ToolDecision {
  // tool_calls 是 LangChain 标准字段（args 已是对象）；additional_kwargs 里那份是
  // provider 原始格式（arguments 是 JSON 字符串且分块未合并），取它反而会拿到 undefined
  const calls = (response.tool_calls ?? []) as ToolDecision['calls'];

  return { calls, cutShort: (response as any).response_metadata?.finish_reason === 'length' };
}

/** 步骤 3 —— 并发执行工具。单个失败不影响其他（错误以 ToolMessage 的形式回给模型） */
async function executeTools(
  calls: ToolDecision['calls'],
  opts: RunAgentOptions,
  toolMap: Map<string, StructuredToolInterface>,
  callbacks: unknown[] | undefined
): Promise<ToolExecution[]> {
  return Promise.all(
    calls.map(async (tc): Promise<ToolExecution> => {
      const name: string = tc.name;
      const args: Record<string, any> = tc.args ?? {};
      const id: string = tc.id ?? '';
      const tool = toolMap.get(name);

      let isError = false;
      let resultText: string;
      if (!tool) {
        isError = true;
        resultText = `未知工具：${name}`;
      } else {
        try {
          // callbacks 透传给 tool.invoke，采集工具调用耗时
          const out = await tool.invoke(args, {
            signal: opts.signal,
            callbacks,
          } as any);
          resultText = typeof out === 'string' ? out : JSON.stringify(out);
        } catch (err) {
          isError = true;
          resultText = `工具执行错误：${err instanceof Error ? err.message : String(err)}`;
        }
      }

      return {
        toolMessage: new ToolMessage({ content: resultText, tool_call_id: id, name }),
        id,
        name,
        args,
        resultText,
        isError,
      };
    })
  );
}

/** 步骤 4 —— 记账：ToolMessage 进上下文，调用记录进返回值，并广播事件 */
function commitToolResults(
  executions: ToolExecution[],
  messages: BaseMessage[],
  toolCalls: AgentResult['toolCalls'],
  onEvent: RunAgentOptions['onEvent']
): void {
  for (const ex of executions) {
    messages.push(ex.toolMessage);
    toolCalls.push({
      name: ex.name,
      args: ex.args,
      result: ex.resultText,
      isError: ex.isError,
    });
    onEvent?.({
      type: 'tool_result',
      toolResult: {
        id: ex.id,
        name: ex.name,
        content: ex.resultText,
        isError: ex.isError,
      },
    });
  }
}

/** 广播「模型要调这些工具」，UI 据此显示调用中的卡片 */
function announceToolCalls(
  calls: ToolDecision['calls'],
  onEvent: RunAgentOptions['onEvent']
): void {
  for (const tc of calls) {
    onEvent?.({
      type: 'tool_call',
      toolCall: {
        id: tc.id ?? `tc-${Date.now()}-${randomUUID().slice(0, 8)}`,
        name: tc.name,
        args: tc.args ?? {},
      },
    });
  }
}

/**
 * 步骤 5 —— 触顶兜底：倒着找最后一条有内容的 AIMessage
 *
 * 必须倒着找而不是看 messages 最后一条：耗尽 maxIter 必然是带着工具调用走完
 * 最后一轮的，此时末尾是 ToolMessage —— 早先那句
 * `messages[last] instanceof AIMessage` 在任何真实触顶路径下都是 false，
 * 兜底形同虚设，用户只收到一条空白回复。
 */
function lastAiText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m instanceof AIMessage) {
      const text = extractTextContent(m.content);
      if (text.trim()) return text;
    }
  }
  return '';
}

/**
 * 跑一次 agent 循环
 *
 * 每轮五步，读起来就是这个顺序：
 *   1. callModelOnce   —— 调模型，流式拼接
 *   2. readToolDecision —— 读它要不要调工具 / 是不是被截断
 *   3. 收尾分支        —— 不调工具就退出（必要时催一次「只说不做」）
 *   4. executeTools    —— 并发执行
 *   5. commitToolResults —— 结果进上下文和调用记录
 *   然后带着工具结果进入下一轮
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const maxIter = opts.maxIterations ?? 8;
  const messages = [...opts.messages];
  const toolCalls: AgentResult['toolCalls'] = [];
  const toolMap = new Map<string, StructuredToolInterface>();
  for (const t of opts.tools) {
    toolMap.set(t.name, t);
  }

  let finalContent = '';
  // 循环是否以「模型主动收尾」的方式退出。只有收尾分支 break 时才置 true，
  // 耗尽 maxIter 自然结束则为 false —— 这是 hitIterationLimit 的唯一判据。
  let converged = false;
  let truncated = false;

  for (let iter = 0; iter < maxIter; iter++) {
    opts.signal?.throwIfAborted();

    // 每轮取一次 callbacks，模型调用和工具调用共用同一组 ——
    // ObservabilityCallback 内部用 runId → 计时 的 Map，一轮只能有一个实例，
    // 否则跨轮累积，agent_iteration 标签也会串
    const roundCallbacks = opts.callbacksFactory ? opts.callbacksFactory(iter) : opts.callbacks;

    // 步骤 1
    const response = await callModelOnce(opts, messages, roundCallbacks);

    // 步骤 2
    const { calls, cutShort } = readToolDecision(response);
    if (cutShort) {
      truncated = true;
      log.warn(`[agent] 第 ${iter} 轮输出被 maxTokens 截断（finish_reason=length）`);
    }

    // 步骤 3 —— 没有工具调用 = 模型自己收尾了
    if (calls.length === 0) {
      messages.push(response);
      finalContent = extractTextContent(response.content);
      converged = true;
      break;
    }

    messages.push(response);

    // 被 maxTokens 砍断的 tool_calls 参数是半截 JSON，而 @langchain/core 用的是
    // parsePartialJson（专门容忍残缺 JSON），会把它「修补」成一个合法对象 ——
    // 执行它等于拿半截正文覆盖用户文件。宁可这一轮什么都不做，
    // 把「你被截断了」明说出来，让模型下一轮自己重发。
    if (cutShort) {
      const names = calls.map((tc) => tc?.name ?? '?').join(', ');
      log.warn(`[agent] 丢弃被截断的工具调用：${names}`);
      // 用 ToolMessage 把这个 tool_call 关掉：assistant 消息带着 tool_calls
      // 却没有对应的 tool 消息，下一轮请求会被 OpenAI 判 400
      // （An assistant message with 'tool_calls' must be followed by tool messages）。
      for (const tc of calls) {
        messages.push(
          new ToolMessage({
            content:
              `[调用被丢弃] 你这次的参数因为超出单次输出上限被截断，没有传完。\n` +
              `请把内容拆小后重试：一次调用只写一部分，用 save_note 的 append:true 续写，不要一次写完。`,
            tool_call_id: tc.id ?? '',
            name: tc.name ?? '',
          })
        );
      }
      continue;
    }

    announceToolCalls(calls, opts.onEvent);

    // 步骤 4 + 5：执行，再把结果记账，然后带结果进下一轮
    const executions = await executeTools(calls, opts, toolMap, roundCallbacks);
    commitToolResults(executions, messages, toolCalls, opts.onEvent);
  }

  const content = converged ? finalContent : finalContent || lastAiText(messages);

  return {
    content,
    messages,
    toolCalls,
    hitIterationLimit: !converged,
    maxIterations: maxIter,
    truncated,
  };
}

/**
 * 把 AiMessage[] 转 BaseMessage[]（仅用于 type 兼容；具体 type 来自 LangChain 类型）
 */
export function fromAiMessages(messages: Array<{ role: string; content: string }>): BaseMessage[] {
  return messages.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });
}