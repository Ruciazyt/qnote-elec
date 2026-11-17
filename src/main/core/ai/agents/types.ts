
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';


export interface AgentEvent {
  type:
    | 'text'
    | 'tool_call'
    | 'tool_result';
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, any>;
  };
  toolResult?: {
    id: string;
    name: string;
    content: string;
    isError?: boolean;
  };
}

export interface AgentResult {
  content: string;
  messages: BaseMessage[];
  toolCalls: Array<{ name: string; args: any; result: string; isError?: boolean }>;
  hitIterationLimit: boolean;
  maxIterations: number;
  truncated: boolean;
}

export interface RunAgentOptions {
  model: BaseChatModel;
  messages: BaseMessage[];
  tools: StructuredToolInterface[];
  maxIterations?: number;
  signal?: AbortSignal;
  callbacks?: unknown[];
  callbacksFactory?: (agentIteration: number) => unknown[];
  onEvent?: (event: AgentEvent) => void;
}


export interface ToolDecision {
  calls: Array<{ id?: string; name: string; args?: Record<string, any> }>;
  cutShort: boolean;
}

export interface ToolExecution {
  toolMessage: ToolMessage;
  id: string;
  name: string;
  args: Record<string, any>;
  resultText: string;
  isError: boolean;
}