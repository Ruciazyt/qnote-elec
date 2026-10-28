/**
 * Agent 模块的类型定义
 *
 * 从 runAgent.ts 里拆出来单放 —— 那个文件是纯逻辑，混着一堆 interface
 * 读起来要来回跳。这里只放类型，实现留在 runAgent.ts。
 *
 * 分两类：
 *   对外契约 —— AgentEvent / AgentResult / RunAgentOptions，调用方会用到
 *   内部中间态 —— ToolDecision / ToolExecution，
 *                只在 runAgent 的某一步里传递，不出模块
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';

// ────────────────────────── 对外契约 ──────────────────────────

/** 循环过程中抛给渲染层的事件 */
export interface AgentEvent {
  type:
    | 'text'               // 模型流式输出的文本增量
    | 'tool_call'          // 模型决定调用工具
    | 'tool_result';       // 工具执行结果
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, any>;
  };
  toolResult?: {
    id: string;
    name: string;
    content: string;        // 序列化的工具返回值
    isError?: boolean;
  };
}

export interface AgentResult {
  /** 最终回复给用户的文本（最后一次 AIMessage.content） */
  content: string;
  /** 全量对话 messages（含 AIMessage、ToolMessage、HumanMessage 等）— 可写入 ai_chat */
  messages: BaseMessage[];
  /** 工具调用记录（按调用顺序） */
  toolCalls: Array<{ name: string; args: any; result: string; isError?: boolean }>;
  /**
   * 是否因为撞上 maxIterations 而没跑完。
   *
   * 用独立的 converged 标记而不是反推 `content === ''` —— 空回复本身是合法的
   * （模型确实可以什么都不说就结束），拿内容判空会把它误报成触顶，
   * 于是用户被问「是否继续」，而其实任务已经做完了。
   */
  hitIterationLimit: boolean;
  /** 本次的迭代上限，供 UI 文案与实际配置保持一致 */
  maxIterations: number;
  /**
   * 某轮因 maxTokens 被硬切断（finish_reason === 'length'）。
   * 该轮的 tool_calls 参数是半截 JSON，被 parsePartialJson 宽松修补后
   * 会变成一个「看起来合法」的残缺对象 —— 直接执行会把半截内容写进用户文件。
   */
  truncated: boolean;
}

export interface RunAgentOptions {
  /** 已绑定工具的 chat model：model.bindTools(tools) */
  model: BaseChatModel;
  /** 初始 messages（含 system / human） */
  messages: BaseMessage[];
  /** 工具列表 */
  tools: StructuredToolInterface[];
  /** 单次 session 最大工具循环轮次，防止死循环 */
  maxIterations?: number;
  /** AbortSignal — 用于中途取消 */
  signal?: AbortSignal;
  /**
   * Phase 6：LangChain callbacks（可观测性等）
   * 会透传给每轮 model.stream 和 tool.invoke，
   * 让 callback 层自动采集每一轮的 token / 延迟 / 错误
   */
  callbacks?: unknown[];
  /**
   * Phase 6：每轮迭代的 callback 工厂
   *
   * 为什么需要它而不是直接传 callbacks：
   *   ObservabilityCallback 内部用 runId → 计时 的 Map 记录每轮耗时。
   *   如果多轮共用一个实例，Map 会跨轮累积（虽然 runId 唯一不会串，
   *   但无法给每轮打上 agentIteration 标签）。
   *   用工厂让每轮拿到独立实例 + 独立的 iteration 编号。
   *
   * 一轮只调一次，模型调用和工具调用共用同一组 —— 同一个实例的 Map
   * 必须一轮只有一个，否则跨轮累积、agent_iteration 标签也会串。
   *
   * 与 callbacks 二选一；callbacksFactory 优先。
   */
  callbacksFactory?: (agentIteration: number) => unknown[];
  /** 流式事件回调 */
  onEvent?: (event: AgentEvent) => void;
}

// ────────────────────────── 内部中间态 ──────────────────────────

/** 模型这一轮的「决定」：要不要调工具，以及是不是被 maxTokens 砍断了 */
export interface ToolDecision {
  calls: Array<{ id?: string; name: string; args?: Record<string, any> }>;
  cutShort: boolean;
}

/** 一个工具跑完的结果 */
export interface ToolExecution {
  toolMessage: ToolMessage;
  id: string;
  name: string;
  args: Record<string, any>;
  resultText: string;
  isError: boolean;
}