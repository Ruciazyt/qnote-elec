
import {
  AIMessage,
  type AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { randomUUID } from 'node:crypto';
import { extractTextContent } from '../providers';
import { log } from '../../system/log';
import type {
  AgentResult,
  RunAgentOptions,
  ToolDecision,
  ToolExecution,
} from './types';

export type { AgentEvent, AgentResult, RunAgentOptions } from './types';

async function callModelOnce(
  opts: RunAgentOptions,
  messages: BaseMessage[],
  callbacks: unknown[] | undefined
): Promise<AIMessage> {
  const stream = await opts.model.stream(messages, {
    signal: opts.signal,
    callbacks,
  } as any);

  let responseChunk: AIMessageChunk | null = null;
  for await (const chunk of stream) {
    if (opts.signal?.aborted) break;
    responseChunk = responseChunk ? responseChunk.concat(chunk) : chunk;
    const delta = extractTextContent(chunk.content);
    if (delta) opts.onEvent?.({ type: 'text', text: delta });
  }
  opts.signal?.throwIfAborted();

  return responseChunk ?? new AIMessage('');
}

function readToolDecision(response: AIMessage): ToolDecision {
  const calls = (response.tool_calls ?? []) as ToolDecision['calls'];

  return { calls, cutShort: (response as any).response_metadata?.finish_reason === 'length' };
}

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

export const AGENT_SAFETY_MAX_ITERATIONS = 40;
export const AGENT_DEADLINE_MS = 10 * 60 * 1000;

const REPEAT_WARN_LIMIT = 3;
const REPEAT_STOP_LIMIT = 6;

function callSignature(calls: ToolDecision['calls']): string {
  return calls
    .map((tc) => `${tc.name}:${JSON.stringify(tc.args ?? {})}`)
    .join('|');
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const maxIter = opts.maxIterations ?? AGENT_SAFETY_MAX_ITERATIONS;
  const deadline = Date.now() + (opts.deadlineMs ?? AGENT_DEADLINE_MS);
  const messages = [...opts.messages];
  const toolCalls: AgentResult['toolCalls'] = [];
  const toolMap = new Map<string, StructuredToolInterface>();
  for (const t of opts.tools) {
    toolMap.set(t.name, t);
  }

  let finalContent = '';
  let converged = false;
  let truncated = false;
  let rounds = 0;
  let safetyReason = '';
  let lastSignature = '';
  let repeatCount = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    opts.signal?.throwIfAborted();

    if (Date.now() > deadline) {
      safetyReason = `单次运行超过 ${Math.round((opts.deadlineMs ?? AGENT_DEADLINE_MS) / 60000)} 分钟`;
      break;
    }

    rounds = iter + 1;
    const roundCallbacks = opts.callbacksFactory ? opts.callbacksFactory(iter) : opts.callbacks;

    const response = await callModelOnce(opts, messages, roundCallbacks);

    const { calls, cutShort } = readToolDecision(response);
    if (cutShort) {
      truncated = true;
      log.warn(`[agent] 第 ${iter} 轮输出被 maxTokens 截断（finish_reason=length）`);
    }

    if (calls.length === 0) {
      messages.push(response);
      finalContent = extractTextContent(response.content);
      converged = true;
      break;
    }

    messages.push(response);

    if (cutShort) {
      const names = calls.map((tc) => tc?.name ?? '?').join(', ');
      log.warn(`[agent] 丢弃被截断的工具调用：${names}`);
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

    const signature = callSignature(calls);
    if (signature === lastSignature) {
      repeatCount += 1;
    } else {
      lastSignature = signature;
      repeatCount = 0;
    }

    if (repeatCount >= REPEAT_STOP_LIMIT) {
      safetyReason = '连续多次用相同参数调用同一个工具';
      for (const tc of calls) {
        messages.push(
          new ToolMessage({
            content:
              '[重复调用已中断] 你连续多次用相同参数调用同一个工具，没有拿到新信息。请换一种做法，或者直接给出结论。',
            tool_call_id: tc.id ?? '',
            name: tc.name ?? '',
          })
        );
      }
      break;
    }

    if (repeatCount === REPEAT_WARN_LIMIT) {
      const names = calls.map((tc) => tc?.name ?? '?').join(', ');
      log.warn(`[agent] 工具调用重复 ${repeatCount} 次：${names}`);
      for (const tc of calls) {
        messages.push(
          new ToolMessage({
            content:
              '[提醒] 你刚才用完全相同的参数重复调用了同一个工具，结果不会变化。请换参数、换工具，或者直接给出结论。',
            tool_call_id: tc.id ?? '',
            name: tc.name ?? '',
          })
        );
      }
      continue;
    }

    announceToolCalls(calls, opts.onEvent);

    const executions = await executeTools(calls, opts, toolMap, roundCallbacks);
    commitToolResults(executions, messages, toolCalls, opts.onEvent);
  }

  const content = converged ? finalContent : finalContent || lastAiText(messages);
  if (!converged && !safetyReason) {
    safetyReason = `达到单次运行的熔断上限（${maxIter} 轮）`;
  }

  return {
    content,
    messages,
    toolCalls,
    rounds,
    hitSafetyLimit: !converged,
    safetyReason: safetyReason || undefined,
    truncated,
  };
}

export function fromAiMessages(messages: Array<{ role: string; content: string }>): BaseMessage[] {
  return messages.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });
}