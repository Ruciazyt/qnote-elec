interface AiStreamChunkPayload {
  sessionId: string;
  delta: string;
}

interface AiStreamThinkingPayload {
  sessionId: string;
  delta: string;
}

interface AiStreamToolCallPayload {
  sessionId: string;
  id: string;
  name: string;
  title?: string;
  args: Record<string, any>;
}

interface AiStreamToolResultPayload {
  sessionId: string;
  id: string;
  name: string;
  result: string;
  isError: boolean;
}

interface AiStreamEndPayload {
  sessionId: string;
  content: string;
}

interface AiStreamCompactingPayload {
  sessionId: string;
  phase: "comppressing" | "compressing" | "done";
  round?: number;
  maxRounds?: number;
  tokens?: number;
}

interface AiStreamErrorPayload {
  sessionId: string;
  error: string;
}

export interface AiStreamHandlers {
  onChunk: (payload: AiStreamChunkPayload) => void;
  onThinking: (payload: AiStreamThinkingPayload) => void;
  onToolCall: (payload: AiStreamToolCallPayload) => void;
  onToolResult: (payload: AiStreamToolResultPayload) => void;
  onEnd: (payload: AiStreamEndPayload) => void;
  onCompacting: (payload: AiStreamCompactingPayload) => void;
  onError: (payload: AiStreamErrorPayload) => void;
}

export function subscribeAiStream(
  sessionId: string,
  isActive: () => boolean,
  handlers: AiStreamHandlers,
  onTerminal?: () => void
): () => void {
  const unsubscribers: Array<() => void> = [];
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };

  const subscribe = <T>(
    register: (callback: (event: unknown, payload: T) => void) => () => void,
    handler: (payload: T) => void,
    terminal = false
  ) => {
    unsubscribers.push(
      register((_event, payload) => {
        const current = payload as { sessionId?: string };
        if (current.sessionId !== sessionId) return;
        if (terminal) {
          cleanup();
          onTerminal?.();
        }
        if (!terminal && !isActive()) return;
        handler(payload);
      })
    );
  };

  subscribe(window.electron.onAiStreamChunk, handlers.onChunk);
  subscribe(window.electron.onAiStreamThinking, handlers.onThinking);
  subscribe(window.electron.onAiStreamToolCall, handlers.onToolCall);
  subscribe(window.electron.onAiStreamToolResult, handlers.onToolResult);
  subscribe(window.electron.onAiStreamEnd, handlers.onEnd, true);
  subscribe(window.electron.onAiCompacting, handlers.onCompacting);
  subscribe(window.electron.onAiStreamError, handlers.onError, true);

  return cleanup;
}
